"""
Pull Request API — /api/prs

Endpoints:
  GET  /api/prs?repo_url=...          — list all PRs for a repo
  GET  /api/prs/{pr_number}?repo_url=... — full PR detail (diff, commits, agent analysis)
  POST /api/prs/{pr_number}/analyze   — trigger on-demand agent analysis
  POST /api/prs/{pr_number}/merge     — merge the PR via GitHub API
  POST /api/prs/{pr_number}/comment   — post a comment (fix summary) on the PR
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.graph.neo4j_client import neo4j_client
from app.brain.indexing_pipeline import repo_tokens
from app.core.config import settings

router = APIRouter()


def _get_token(repo_url: str) -> str:
    return repo_tokens.get(repo_url) or settings.GITHUB_TOKEN or ""


def _repo_full_name(repo_url: str) -> str:
    """Extract 'owner/repo' from a GitHub URL."""
    parts = repo_url.rstrip("/").split("/")
    if len(parts) >= 2:
        return f"{parts[-2]}/{parts[-1]}"
    return ""


# ── Models ───────────────────────────────────────────────────────────────────

class MergeRequest(BaseModel):
    repo_url: str
    commit_message: Optional[str] = "Merged via MergeMind"

class CommentRequest(BaseModel):
    repo_url: str
    comment: str

class AnalyzeRequest(BaseModel):
    repo_url: str
    sync: Optional[bool] = False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fetch_pr_node(repo_url: str, pr_number: int) -> dict:
    """Fetch the PullRequest node from Neo4j and return it as a dict."""
    repo_fragment = _repo_full_name(repo_url)
    with neo4j_client.get_session() as session:
        result = session.run("""
            MATCH (pr:PullRequest)
            WHERE pr.pr_number = $pr_number
              AND pr.id CONTAINS $repo_fragment
            RETURN pr
        """, pr_number=pr_number, repo_fragment=repo_fragment).single()

        if not result:
            return None

        node = dict(result["pr"])
        return node


def _fetch_pr_files(pr_id: str) -> list:
    """Fetch files changed by this PR from the graph."""
    with neo4j_client.get_session() as session:
        result = session.run("""
            MATCH (pr:PullRequest {id: $pr_id})-[:MODIFIES]->(f:File)
            RETURN f.path AS path, f.language AS language
        """, pr_id=pr_id)
        return [{"path": r["path"], "language": r["language"]} for r in result]


def _fetch_github_pr_details(repo_full_name: str, pr_number: int, token: str) -> dict:
    """Fetch live diff, commits, description from GitHub."""
    empty = {
        "diff": "", "commits": [], "body": "", "changed_files": [],
        "additions": 0, "deletions": 0, "head_branch": "", "base_branch": "",
        "mergeable": None, "mergeable_state": "unknown",
        "github_url": "", "created_at": "", "updated_at": ""
    }
    if not token:
        return empty

    try:
        from github import Github
        g = Github(token)
        repo = g.get_repo(repo_full_name)
        pr = repo.get_pull(pr_number)

        commits = [
            {
                "sha": c.sha[:7],
                "message": c.commit.message.split("\n")[0],
                "author": c.commit.author.name,
                "date": c.commit.author.date.isoformat() if c.commit.author.date else ""
            }
            for c in pr.get_commits()
        ]

        diff_parts = []
        changed_files = []
        for f in pr.get_files():
            diff_parts.append(f"--- {f.filename}\n{f.patch or ''}")
            changed_files.append({
                "filename": f.filename,
                "status": f.status,
                "additions": f.additions,
                "deletions": f.deletions,
                "changes": f.changes,
            })

        return {
            "diff": "\n\n".join(diff_parts),
            "commits": commits,
            "body": pr.body or "",
            "changed_files": changed_files,
            "additions": pr.additions,
            "deletions": pr.deletions,
            "head_branch": pr.head.ref,
            "base_branch": pr.base.ref,
            "mergeable": pr.mergeable,
            "mergeable_state": pr.mergeable_state,
            "github_url": pr.html_url,
            "created_at": pr.created_at.isoformat() if pr.created_at else "",
            "updated_at": pr.updated_at.isoformat() if pr.updated_at else "",
        }
    except Exception as e:
        print(f"[PR API] GitHub fetch error: {e}")
        return empty


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_prs(repo_url: str, status: Optional[str] = None):
    """List all PRs for a repository, optionally filtered by status."""
    repo_fragment = _repo_full_name(repo_url)
    with neo4j_client.get_session() as session:
        query = """
            MATCH (pr:PullRequest)
            WHERE pr.id CONTAINS $repo_fragment
        """
        params = {"repo_fragment": repo_fragment, "status": status}
        if status:
            query += " AND pr.status = $status"
        query += " RETURN pr ORDER BY pr.created_at DESC"

        result = session.run(query, **params)
        prs = []
        for r in result:
            node = dict(r["pr"])
            prs.append({
                "id": node.get("pr_number"),
                "title": node.get("title", ""),
                "author": node.get("author", "unknown"),
                "status": node.get("status", "OPEN"),
                "timestamp": node.get("created_at", 0),
                "priority": node.get("agent_priority", "Normal"),
                "has_errors": node.get("agent_has_errors", False),
                "agent_status": node.get("agent_status", ""),
                "head_branch": node.get("head_branch", ""),
                "base_branch": node.get("base_branch", ""),
                "github_url": node.get("github_url", ""),
            })
    return {"prs": prs}


@router.get("/{pr_number}")
async def get_pr_detail(pr_number: int, repo_url: str):
    """Full PR detail: node data + live GitHub info + agent analysis."""
    token = _get_token(repo_url)
    repo_full_name = _repo_full_name(repo_url)

    # 1. Fetch from Neo4j
    node = _fetch_pr_node(repo_url, pr_number)
    if not node:
        raise HTTPException(status_code=404, detail=f"PR #{pr_number} not found in graph.")

    pr_id = node.get("id", "")
    files_in_graph = _fetch_pr_files(pr_id)

    # 2. Fetch live data from GitHub
    gh_data = _fetch_github_pr_details(repo_full_name, pr_number, token)

    return {
        "pr_number": pr_number,
        "title": node.get("title", ""),
        "author": node.get("author", "unknown"),
        "status": node.get("status", "OPEN"),
        "body": gh_data.get("body") or node.get("body", ""),
        "head_branch": gh_data.get("head_branch") or node.get("head_branch", ""),
        "base_branch": gh_data.get("base_branch") or node.get("base_branch", ""),
        "github_url": gh_data.get("github_url") or node.get("github_url", ""),
        "created_at": gh_data.get("created_at") or str(node.get("created_at", "")),
        "updated_at": gh_data.get("updated_at", ""),
        "additions": gh_data.get("additions", 0),
        "deletions": gh_data.get("deletions", 0),
        "changed_files": gh_data.get("changed_files", []),
        "commits": gh_data.get("commits", []),
        "diff": gh_data.get("diff", ""),
        "mergeable": gh_data.get("mergeable"),
        "mergeable_state": gh_data.get("mergeable_state", "unknown"),
        # Agent analysis data
        "agent_priority": node.get("agent_priority", ""),
        "agent_priority_reason": node.get("agent_priority_reason", ""),
        "agent_has_errors": bool(node.get("agent_has_errors", False)),
        "agent_issues": node.get("agent_issues") or [],
        "agent_fix_steps": node.get("agent_fix_steps") or [],
        "agent_fix_code": node.get("agent_fix_code", ""),
        "agent_fix": node.get("agent_fix", ""),
        "agent_status": node.get("agent_status", ""),
        "agent_summary": node.get("agent_summary", ""),
        # Graph-indexed changed files
        "files_in_graph": files_in_graph,
    }


@router.post("/{pr_number}/analyze")
async def analyze_pr(pr_number: int, req: AnalyzeRequest):
    """Trigger on-demand agent analysis for a PR."""
    token = _get_token(req.repo_url)
    repo_full_name = _repo_full_name(req.repo_url)

    if not repo_full_name:
        raise HTTPException(status_code=400, detail="Invalid repo_url")

    from app.agent.orchestrator import run_agent_for_pr

    if req.sync:
        import asyncio
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, run_agent_for_pr, repo_full_name, pr_number, token)
        return {"status": "analysis_completed", "pr_number": pr_number}

    import threading
    def run_analysis():
        try:
            run_agent_for_pr(repo_full_name, pr_number, token)
        except Exception as e:
            print(f"[PR Analyze] Error: {e}")

    t = threading.Thread(target=run_analysis, daemon=True)
    t.start()

    return {"status": "analysis_started", "pr_number": pr_number}


@router.post("/{pr_number}/merge")
async def merge_pr(pr_number: int, req: MergeRequest):
    """Merge the PR via GitHub API and update Neo4j status."""
    token = _get_token(req.repo_url)
    repo_full_name = _repo_full_name(req.repo_url)

    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured. Cannot merge.")
    if not repo_full_name:
        raise HTTPException(status_code=400, detail="Invalid repo_url")

    try:
        from github import Github
        g = Github(token)
        repo = g.get_repo(repo_full_name)
        pr = repo.get_pull(pr_number)

        if pr.state == "closed":
            raise HTTPException(status_code=400, detail="PR is already closed.")
        if pr.mergeable is False:
            raise HTTPException(status_code=409, detail=f"PR is not mergeable. State: {pr.mergeable_state}")

        merge_result = pr.merge(
            commit_message=req.commit_message or "Merged via MergeMind",
            merge_method="merge"
        )

        # Update Neo4j status
        with neo4j_client.get_session() as session:
            pr_id = f"pr:{repo_full_name}:{pr_number}"
            session.run(
                "MATCH (pr:PullRequest {id: $id}) SET pr.status = 'MERGED'",
                id=pr_id
            )

        return {
            "status": "merged",
            "sha": merge_result.sha,
            "message": merge_result.message,
            "pr_number": pr_number,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Merge failed: {str(e)}")


@router.post("/{pr_number}/comment")
async def post_pr_comment(pr_number: int, req: CommentRequest):
    """Post a comment (fix summary) on the PR in GitHub."""
    token = _get_token(req.repo_url)
    repo_full_name = _repo_full_name(req.repo_url)

    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured.")

    try:
        from github import Github
        g = Github(token)
        repo = g.get_repo(repo_full_name)
        pr = repo.get_pull(pr_number)
        comment_body = f"**MergeMind Fix Summary:**\n\n{req.comment}"
        comment = pr.create_issue_comment(comment_body)

        # Also store in Neo4j
        with neo4j_client.get_session() as session:
            pr_id = f"pr:{repo_full_name}:{pr_number}"
            session.run(
                "MATCH (pr:PullRequest {id: $id}) SET pr.agent_summary = $summary",
                id=pr_id, summary=req.comment
            )

        return {"status": "comment_posted", "comment_id": comment.id, "pr_number": pr_number}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to post comment: {str(e)}")
