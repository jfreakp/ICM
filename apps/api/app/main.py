from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.config import settings
from app.routers.auditoria import router as auditoria_router
from app.routers.auth import router as auth_router
from app.routers.infracciones import router as infracciones_router
from app.routers.reportes import router as reportes_router

app = FastAPI(title="Matriculación API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(reportes_router)
app.include_router(infracciones_router)
app.include_router(auditoria_router)


def mount_frontend(app: FastAPI, static_dir: Path) -> None:
    if not static_dir.is_dir():
        return
    root = static_dir.resolve()
    index_file = root / "index.html"

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        if full_path:
            candidate = (root / full_path).resolve()
            if candidate.is_relative_to(root) and candidate.is_file():
                return FileResponse(candidate)
        return FileResponse(index_file)


mount_frontend(app, Path(settings.static_dir))
