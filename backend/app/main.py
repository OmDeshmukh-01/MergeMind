from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.api.brain import router as brain_router
from app.api.webhooks import router as webhooks_router
from app.api.auth import router as auth_router
from app.api.pull_requests import router as prs_router
from app.database import engine, Base

# Create all SQLAlchemy tables (users, etc.) on startup if they don't exist
import app.models.user  # noqa: F401 — ensure model is registered with Base
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="MergeMind Codebase Brain API",
    description="API for ingesting repositories and constructing the Neo4j Codebase Brain.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(brain_router, prefix="/api/brain", tags=["brain"])
app.include_router(webhooks_router, prefix="/api/webhooks", tags=["webhooks"])
app.include_router(prs_router, prefix="/api/prs", tags=["prs"])

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "Codebase Brain"}

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
