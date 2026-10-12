"""
PR Event Handlers — one function per GitHub PR action.

Connects the raw webhook payload to:
 1. Creating / updating PullRequest nodes in Neo4j.
 2. Running the incremental file updater.
"""

import threading
from datetime import datetime, timezone
from app.graph.node_builder import NodeBuilder
from app.graph.relationship_builder import RelationshipBuilder
from app.graph.neo4j_client import neo4j_client
from app.models.code_entities import PullRequestModel
from app.brain.incremental_updater import get_changed_files, process_changed_files


def _build_pr_id(repo_full_name: str, pr_number: int) -> str:
    return f"pr:{repo_full_name}:{pr_number}"


def _build_repo_id(repo_full_name: str) -> str:
    return f"repo:{repo_full_name}"


def _extract_pr_model(payload: dict) -> PullRequestModel:
    """Extracts a PullRequestModel from the raw GitHub webhook payload."""
    pr = payload["pull_request"]
    repo = payload["repository"]
    repo_full_name = repo["full_name"]
    pr_number = pr["number"]

    created_at_str = pr.get("created_at", "")
    try:
        dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        created_at_ms = int(dt.timestamp() * 1000)
    except Exception:
        created_at_ms = 0

    return PullRequestModel(
        id=_build_pr_id(repo_full_name, pr_number),
        pr_number=pr_number,
        title=pr.get("title", ""),
        author=pr.get("user", {}).get("login", "unknown"),
        status="OPEN",
        base_branch=pr.get("base", {}).get("ref", ""),
        head_branch=pr.get("head", {}).get("ref", ""),
        repository_id=_build_repo_id(repo_full_name),
        github_url=pr.get("html_url", ""),
        created_at=created_at_ms
    )


def _run_incremental_update(repo_full_name: str, pr_number: int, pr_id: str, repo_id: str, github_token: str = None):
    """
    Background thread target:
    1. Fetch the list of changed files for the PR from GitHub.
    2. Link the PR node to each changed file in Neo4j.
    3. Re-parse and upsert the modified file contents into the graph.
    """
    rb = RelationshipBuilder()
    neo4j_client.connect()

    try:
        changed_files = get_changed_files(repo_full_name, pr_number, github_token=github_token)

        # Link PR to each changed File node
        for f in changed_files:
            file_id = f"file:{repo_id}:{f['filename']}"
            if f["status"] != "removed":
                rb.link_pr_to_file(pr_id, file_id)

        # Re-parse and upsert changed file code entities
        stats = process_changed_files(repo_id, changed_files, github_token=github_token)
        print(f"[PR #{pr_number}] Incremental update: {stats}")

        # Kick off the Orchestrator Agent
        try:
            from app.agent.orchestrator import run_agent_for_pr
            print(f"[PR #{pr_number}] Starting Orchestrator Agent...")
            run_agent_for_pr(repo_full_name, pr_number, github_token)
        except Exception as agent_e:
            print(f"[PR #{pr_number}] Orchestrator Agent failed: {agent_e}")

    except Exception as e:
        print(f"[PR #{pr_number}] Incremental update failed: {e}")


def handle_pr_opened(payload: dict, github_token: str = None):
    """
    Handles 'opened' and 're-opened' PR actions.
    - Creates the PullRequest node in Neo4j.
    - Links it to the Repository.
    - Triggers an incremental update of all changed files.
    """
    pr_model = _extract_pr_model(payload)
    repo_full_name = payload["repository"]["full_name"]
    repo_id = _build_repo_id(repo_full_name)

    nb = NodeBuilder()
    rb = RelationshipBuilder()
    neo4j_client.connect()

    nb.create_pull_request(pr_model)
    rb.link_pr_to_repository(pr_model.id, repo_id)

    print(f"[Webhook] PR #{pr_model.pr_number} OPENED — '{pr_model.title}' by {pr_model.author}")

    # Run incremental file updates in the background (non-blocking)
    t = threading.Thread(
        target=_run_incremental_update,
        args=(repo_full_name, pr_model.pr_number, pr_model.id, repo_id, github_token)
    )
    t.start()

    return {"status": "accepted", "job": "pr_opened", "pr_id": pr_model.id}


def handle_pr_synchronize(payload: dict, github_token: str = None):
    """
    Handles 'synchronize' action (new commits pushed to an existing PR).
    - Updates the PullRequest node (already exists via MERGE).
    - Re-runs incremental update on the newly changed files.
    """
    pr_model = _extract_pr_model(payload)
    repo_full_name = payload["repository"]["full_name"]
    repo_id = _build_repo_id(repo_full_name)

    nb = NodeBuilder()
    rb = RelationshipBuilder()
    neo4j_client.connect()

    # MERGE will update the existing PR node with the latest data
    nb.create_pull_request(pr_model)
    rb.link_pr_to_repository(pr_model.id, repo_id)

    print(f"[Webhook] PR #{pr_model.pr_number} SYNCHRONIZE (new commits)")

    # Re-run the incremental update in the background
    t = threading.Thread(
        target=_run_incremental_update,
        args=(repo_full_name, pr_model.pr_number, pr_model.id, repo_id, github_token)
    )
    t.start()

    return {"status": "accepted", "job": "pr_synchronize", "pr_id": pr_model.id}


def handle_pr_closed(payload: dict):
    """
    Handles 'closed' action (PR was either merged or just closed/rejected).
    - Updates the PullRequest node status to MERGED or CLOSED.
    - Does NOT re-parse files (the merged state is already in the graph from pr_synchronize).
    """
    pr = payload["pull_request"]
    repo_full_name = payload["repository"]["full_name"]
    pr_number = pr["number"]
    was_merged = pr.get("merged", False)

    pr_id = _build_pr_id(repo_full_name, pr_number)
    new_status = "MERGED" if was_merged else "CLOSED"

    nb = NodeBuilder()
    neo4j_client.connect()
    nb.update_pull_request_status(pr_id, new_status)

    print(f"[Webhook] PR #{pr_number} {new_status}")
    return {"status": "accepted", "job": "pr_closed", "pr_id": pr_id, "new_status": new_status}
