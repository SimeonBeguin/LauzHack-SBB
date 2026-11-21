"""FastAPI entry point. Run from backend/: uvicorn app.main:app --reload"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import alternatives, disruptions, notifications, situation

app = FastAPI(title="SBB Disruption Helper", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",  # the Vite dev server, any port
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(disruptions.router)
app.include_router(alternatives.router)
app.include_router(notifications.router)
app.include_router(situation.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
