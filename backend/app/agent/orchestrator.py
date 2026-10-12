import json
from typing import TypedDict
from langgraph.graph import StateGraph, END
from langchain_ollama import ChatOllama
from langchain_core.messages import SystemMessage
from github import Github
from app.graph.neo4j_client import neo4j_client
from app.ingestion.pdf_processor import get_embedding_model

class PRState(TypedDict):
    repo_full_name: str
    pr_number: int
    github_token: str
    diff: str
    commits: str
    rag_context: str
    graph_context: str
    priority: str
    priority_reason: str
    has_errors: bool
    issues: list
    fix_steps: list
    fix_code: str
    fix_suggestion: str
    decision: str
    status_message: str

def fetch_pr_context(state: PRState) -> PRState:
    print(f"[Agent] Fetching context for PR #{state['pr_number']}")
    if not state.get("github_token"):
        print("[Agent] No github token provided, skipping github fetch.")
        return state
        
    g = Github(state["github_token"])
    repo = g.get_repo(state["repo_full_name"])
    pr = repo.get_pull(state["pr_number"])
    
    # Get commits
    commits = []
    for commit in pr.get_commits():
        commits.append(commit.commit.message)
    state["commits"] = "\n".join(commits)
    
    # Get diff
    diff = []
    changed_files = []
    for f in pr.get_files():
        diff.append(f"File: {f.filename}\nPatch:\n{f.patch}")
        changed_files.append(f.filename)
    state["diff"] = "\n".join(diff)

    # Get Graph Context (Blast Radius)
    graph_context = []
    with neo4j_client.get_session() as session:
        for filename in changed_files:
            file_id = f"file:repo:{state['repo_full_name']}:{filename}"
            res = session.run("""
                MATCH (f:File {id: $file_id})<-[:DEPENDS_ON]-(other)
                RETURN count(other) as dep_count
            """, file_id=file_id).single()
            if res:
                graph_context.append(f"{filename} has {res['dep_count']} dependents in the codebase.")
    state["graph_context"] = "\n".join(graph_context)

    # Get RAG Context
    rag_context = []
    try:
        model = get_embedding_model()
        with neo4j_client.get_session() as session:
            for filename in changed_files:
                query_embedding = model.encode(filename).tolist()
                res = session.run("""
                    CALL db.index.vector.queryNodes('document_chunk_index', 3, $emb)
                    YIELD node, score
                    RETURN node.text AS text, score
                """, emb=query_embedding)
                for record in res:
                    rag_context.append(record["text"])
    except Exception as e:
        print(f"[Agent] RAG Error: {e}")
        
    state["rag_context"] = "\n".join(rag_context)
    return state

def analyze_pr(state: PRState) -> PRState:
    print(f"[Agent] Analyzing PR #{state['pr_number']}")
    llm = ChatOllama(model="qwen2.5:7b", format="json", temperature=0)
    
    prompt = f"""
    You are an AI Code Review & Architecture Orchestrator analyzing a Pull Request.
    
    Commit Messages:
    {state.get('commits', '')}
    
    Diff:
    {state.get('diff', '')}
    
    Graph Context (Blast Radius - dependents in codebase):
    {state.get('graph_context', '')}
    
    Business/Architecture Context (RAG documentation chunks):
    {state.get('rag_context', '')}
    
    Analyze the PR and determine:
    1. priority: 'HIGH' or 'LOW'. If it touches multiple dependents (high blast radius) or modifies critical business logic from architecture docs, mark HIGH. Otherwise mark LOW.
    2. priority_reason: 1-2 clear sentences explaining why this PR was classified as HIGH or LOW priority.
    3. has_errors: true or false. Are there bugs, logical flaws, missing checks, bad patterns, or syntax/runtime issues in the diff?
    4. issues: A list of concise strings detailing each specific issue/bug found (empty list if no errors).
    5. fix_steps: A list of clear, actionable step-by-step instructions describing what fixes need to be done (empty list if no errors).
    6. fix_code: Suggested code snippet showing the exact corrected code (empty string if no errors).
    7. fix_suggestion: A comprehensive, developer-friendly explanation detailing what fixes need to be done clearly.
    
    Output STRICTLY valid JSON with no markdown wrapping:
    {{
        "priority": "HIGH" | "LOW",
        "priority_reason": "string",
        "has_errors": true | false,
        "issues": ["string"],
        "fix_steps": ["string"],
        "fix_code": "string",
        "fix_suggestion": "string"
    }}
    """
    
    try:
        msg = llm.invoke([SystemMessage(content=prompt)])
        content = msg.content.strip()
        # Handle cases where LLM wraps JSON in code block
        if content.startswith("```"):
            lines = content.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            content = "\n".join(lines).strip()
            
        result = json.loads(content)
        state["priority"] = result.get("priority", "LOW")
        state["priority_reason"] = result.get("priority_reason", "")
        state["has_errors"] = bool(result.get("has_errors", False))
        
        issues = result.get("issues", [])
        if isinstance(issues, str):
            issues = [issues]
        state["issues"] = [str(i) for i in issues if str(i).strip()]
        
        fix_steps = result.get("fix_steps", [])
        if isinstance(fix_steps, str):
            fix_steps = [fix_steps]
        state["fix_steps"] = [str(s) for s in fix_steps if str(s).strip()]
        
        state["fix_code"] = str(result.get("fix_code", ""))
        state["fix_suggestion"] = str(result.get("fix_suggestion", ""))
        
        # Build clean fix_suggestion if missing
        if not state["fix_suggestion"] and state["fix_steps"]:
            steps_text = "\n".join([f"{idx+1}. {step}" for idx, step in enumerate(state["fix_steps"])])
            state["fix_suggestion"] = f"Actionable Fix Steps:\n{steps_text}"
            if state["fix_code"]:
                state["fix_suggestion"] += f"\n\nSuggested Code:\n```\n{state['fix_code']}\n```"

    except Exception as e:
        print(f"[Agent] LLM parsing error: {e}")
        state["priority"] = "HIGH"
        state["priority_reason"] = "Automated fallback review required."
        state["has_errors"] = True
        state["issues"] = ["Failed to parse model output"]
        state["fix_steps"] = ["Review PR diff manually"]
        state["fix_code"] = ""
        state["fix_suggestion"] = "Please review the code changes manually."

    return state

def route_pr(state: PRState) -> PRState:
    if state["has_errors"]:
        state["decision"] = "REQUIRE_APPROVAL"
    elif state["priority"] == "LOW":
        state["decision"] = "AUTO_MERGE"
    else:
        state["decision"] = "REQUIRE_APPROVAL"
    print(f"[Agent] Routing PR #{state['pr_number']} -> Decision: {state['decision']}")
    return state

def execute_decision(state: PRState) -> PRState:
    print(f"[Agent] Executing decision for PR #{state['pr_number']}")
    pr_id = f"pr:{state['repo_full_name']}:{state['pr_number']}"
    
    # NOTE: We DO NOT send automated comments to GitHub!
    # All analysis, priority, and suggested fixes are stored and displayed only on MergeMind platform.
    
    if state["decision"] == "AUTO_MERGE" and state.get("github_token"):
        try:
            g = Github(state["github_token"])
            repo = g.get_repo(state["repo_full_name"])
            pr = repo.get_pull(state["pr_number"])
            pr.merge(commit_message="Auto-merged by MergeMind Agent (Low Priority, No Risks)")
            status = "MERGED"
            state["status_message"] = "Merged automatically."
        except Exception as e:
            print(f"[Agent] Auto-merge failed: {e}")
            status = "READY_TO_MERGE"
            state["status_message"] = f"Failed to merge automatically: {e}"
    else:
        status = "PENDING_APPROVAL" if state["has_errors"] or state["priority"] == "HIGH" else "READY_TO_MERGE"
        state["status_message"] = "Analysis complete. Waiting for admin review."

    with neo4j_client.get_session() as session:
        session.run("""
            MATCH (pr:PullRequest {id: $id}) 
            SET pr.agent_priority = $priority,
                pr.agent_priority_reason = $priority_reason,
                pr.agent_has_errors = $has_errors,
                pr.agent_issues = $issues,
                pr.agent_fix_steps = $fix_steps,
                pr.agent_fix_code = $fix_code,
                pr.agent_fix = $fix,
                pr.agent_status = $status
        """, 
            id=pr_id, 
            priority=state["priority"], 
            priority_reason=state.get("priority_reason", ""),
            has_errors=state["has_errors"], 
            issues=[str(i) for i in state.get("issues", [])],
            fix_steps=[str(s) for s in state.get("fix_steps", [])],
            fix_code=str(state.get("fix_code", "")),
            fix=str(state.get("fix_suggestion", "")),
            status=status
        )

    return state

# Graph construction
workflow = StateGraph(PRState)
workflow.add_node("fetch_context", fetch_pr_context)
workflow.add_node("analyze", analyze_pr)
workflow.add_node("route", route_pr)
workflow.add_node("execute", execute_decision)

workflow.set_entry_point("fetch_context")
workflow.add_edge("fetch_context", "analyze")
workflow.add_edge("analyze", "route")
workflow.add_edge("route", "execute")
workflow.add_edge("execute", END)

app_graph = workflow.compile()

def run_agent_for_pr(repo_full_name: str, pr_number: int, github_token: str):
    """
    Kicks off the orchestrator graph.
    """
    initial_state = {
        "repo_full_name": repo_full_name,
        "pr_number": pr_number,
        "github_token": github_token,
        "diff": "",
        "commits": "",
        "rag_context": "",
        "graph_context": "",
        "priority": "",
        "priority_reason": "",
        "has_errors": False,
        "issues": [],
        "fix_steps": [],
        "fix_code": "",
        "fix_suggestion": "",
        "decision": "",
        "status_message": ""
    }
    app_graph.invoke(initial_state)
