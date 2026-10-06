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
    has_errors: bool
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
    You are an AI Orchestrator analyzing a Pull Request.
    
    Commit Messages: {state['commits']}
    Diff: {state['diff']}
    Graph Context (Blast Radius): {state['graph_context']}
    Business/Architecture Context (RAG): {state['rag_context']}
    
    Determine:
    1. priority: 'HIGH' or 'LOW'. If it touches many dependents or critical business logic based on the RAG context, it's HIGH. Otherwise LOW.
    2. has_errors: true or false. Are there any bugs, logical flaws, or anti-patterns in the diff?
    3. fix_suggestion: If has_errors is true, provide the exact code fix. If false, leave empty.
    
    Output strictly in JSON format:
    {{
        "priority": "HIGH" | "LOW",
        "has_errors": true | false,
        "fix_suggestion": "string"
    }}
    """
    
    try:
        msg = llm.invoke([SystemMessage(content=prompt)])
        result = json.loads(msg.content)
        state["priority"] = result.get("priority", "LOW")
        state["has_errors"] = result.get("has_errors", False)
        state["fix_suggestion"] = result.get("fix_suggestion", "")
    except Exception as e:
        print(f"[Agent] LLM error: {e}")
        state["priority"] = "HIGH"
        state["has_errors"] = True
        state["fix_suggestion"] = "Failed to parse LLM output."

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
    if not state.get("github_token"):
        print("[Agent] No github token provided, skipping execute.")
        return state

    g = Github(state["github_token"])
    repo = g.get_repo(state["repo_full_name"])
    pr = repo.get_pull(state["pr_number"])
    
    if state["decision"] == "AUTO_MERGE":
        try:
            pr.merge(commit_message="Auto-merged by MergeMind Agent (Low Priority, No Risks)")
            state["status_message"] = "Merged automatically."
            
            with neo4j_client.get_session() as session:
                pr_id = f"pr:{state['repo_full_name']}:{state['pr_number']}"
                session.run("MATCH (pr:PullRequest {id: $id}) SET pr.status = 'MERGED'", id=pr_id)
        except Exception as e:
            state["status_message"] = f"Failed to merge: {e}"
    else:
        comment_body = f"**MergeMind PR Analysis**\n\nPriority: {state['priority']}\nErrors Found: {state['has_errors']}\n\n"
        if state['has_errors']:
            comment_body += f"**Suggested Fix:**\n```\n{state['fix_suggestion']}\n```\n"
        comment_body += "\n*Waiting for Admin approval to merge. Review these suggestions, resolve issues if any, and merge manually.*"
        
        pr.create_issue_comment(comment_body)
        state["status_message"] = "Sent to Admin for approval."
        
        with neo4j_client.get_session() as session:
            pr_id = f"pr:{state['repo_full_name']}:{state['pr_number']}"
            session.run("""
                MATCH (pr:PullRequest {id: $id}) 
                SET pr.agent_priority = $priority,
                    pr.agent_has_errors = $has_errors,
                    pr.agent_fix = $fix,
                    pr.agent_status = 'PENDING_APPROVAL'
            """, id=pr_id, priority=state["priority"], has_errors=state["has_errors"], fix=state["fix_suggestion"])

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
        "has_errors": False,
        "fix_suggestion": "",
        "decision": "",
        "status_message": ""
    }
    app_graph.invoke(initial_state)
