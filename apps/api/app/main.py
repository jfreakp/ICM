from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.auditoria import router as auditoria_router
from app.routers.auth import router as auth_router
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
app.include_router(auditoria_router)
