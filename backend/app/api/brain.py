from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Form
from pydantic import BaseModel
from typing import Dict, Any, Optional
from app.brain.indexing_pipeline import pipeline, repo_tokens, indexing_jobs
from app.core.github_services import setup_github_webhook
from app.ingestion.pdf_processor import process_pdf
router = APIRouter()

class IndexRequest(BaseModel):
    project_name: str
    repository_url: str
    github_token: Optional[str] = None

@router.post("/index")
async def start_indexing(req: IndexRequest):
    if not req.repository_url:
        raise HTTPException(status_code=400, detail="Repository URL is required")
    
    # Store token in memory so webhooks can use it later
    if req.github_token:
        repo_tokens[req.repository_url] = req.github_token

    # Try to set up webhook if token is provided
    if req.github_token:
        setup_github_webhook(req.repository_url, req.github_token)

    # We will trigger the background pipeline
    try:
        job_id = pipeline.start_job(req.repository_url, req.github_token)
        return {
            "job_id": job_id,
            "repository": req.repository_url,
            "status": "queued"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...), project_name: str = Form("MergeMind")):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    try:
        result = await process_pdf(file, project_name)
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")

@router.get("/status/latest")
async def get_latest_status(repo_url: str):
    # Find the most recently created job for this repo_url
    latest_job = None
    for j_id, job in reversed(list(indexing_jobs.items())):
        if job["repository_url"] == repo_url:
            latest_job = job
            break
    
    if not latest_job:
        # Return IDLE instead of 404 to prevent terminal error spam
        return {"status": "IDLE", "progress": 100, "files_discovered": 0, "files_processed": 0, "nodes_created": 0, "relationships_created": 0}
    return latest_job

@router.get("/dashboard")
async def get_dashboard_data(repo_url: str):
    from app.graph.neo4j_client import neo4j_client
    with neo4j_client.get_session() as session:
        # Get repository basic info
        repo_res = session.run("MATCH (r:Repository {github_url: $repo_url}) RETURN r.id AS id", repo_url=repo_url).single()
        if not repo_res:
            return {"active_prs": [], "stats": {"total_prs": 0, "active_prs": 0, "total_files": 0, "total_entities": 0}}
        
        repo_id = repo_res["id"]

        # Get PRs
        prs_res = session.run("""
            MATCH (pr:PullRequest)-[:TARGETS]->(r:Repository {id: $repo_id})
            RETURN pr.title AS title, pr.author AS author, pr.status AS status, pr.created_at AS created_at, pr.pr_number AS pr_number
            ORDER BY pr.created_at DESC
        """, repo_id=repo_id)
        
        prs = []
        for record in prs_res:
            # Format time simply (e.g. "2h ago" is hard to do precisely in python without libs, so return timestamp)
            prs.append({
                "id": record["pr_number"],
                "title": record["title"],
                "author": record["author"],
                "status": record["status"],
                "timestamp": record["created_at"],
                "priority": "Normal" # Mock priority for now
            })

        total_prs = len(prs)
        active_prs = sum(1 for p in prs if p["status"] == "OPEN")

        # Get Total Files
        files_res = session.run("MATCH (f:File {repository_id: $repo_id}) RETURN count(f) AS c", repo_id=repo_id).single()
        total_files = files_res["c"] if files_res else 0

        # Get Total Classes/Functions
        entities_res = session.run("MATCH (f:File {repository_id: $repo_id})-[:DEFINES]->(c) RETURN count(c) AS c", repo_id=repo_id).single()
        total_entities = entities_res["c"] if entities_res else 0

        return {
            "active_prs": prs,
            "stats": {
                "total_prs": total_prs,
                "active_prs": active_prs,
                "total_files": total_files,
                "total_entities": total_entities
            }
        }

@router.get("/repositories")
async def get_repositories():
    from app.graph.neo4j_client import neo4j_client
    with neo4j_client.get_session() as session:
        result = session.run("MATCH (r:Repository) RETURN r.id AS id, r.name AS name, r.github_url AS url")
        return [{"id": record["id"], "name": record["name"], "url": record["url"]} for record in result]

@router.get("/status/{job_id}")
async def get_status(job_id: str):
    status = pipeline.get_job_status(job_id)
    if not status:
        raise HTTPException(status_code=404, detail="Job not found")
    return status
