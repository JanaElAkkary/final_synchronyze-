from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.routes.health import router as health_router
from backend.app.routes.posts import router as posts_router
from backend.app.routes.analysis import router as analysis_router
from backend.app.routes.results import router as results_router
from backend.app.routes.auth import router as auth_router
from backend.app.routes.search import router as search_router
from backend.app.routes.tasks import router as tasks_router


def create_app():
    app = FastAPI(title="Synchronyze API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router, prefix="/api", tags=["health"])
    app.include_router(posts_router, prefix="/api/posts", tags=["posts"])
    app.include_router(analysis_router, prefix="/api/analysis", tags=["analysis"])
    app.include_router(results_router, prefix="/api/results", tags=["results"])
    app.include_router(auth_router, prefix="/api", tags=["auth"])
    app.include_router(search_router, prefix="/api/search", tags=["search"])
    app.include_router(tasks_router, prefix="/api/tasks", tags=["tasks"])

    return app


app = create_app()
