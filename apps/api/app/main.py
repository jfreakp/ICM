from fastapi import FastAPI

from app.routers.auth import router as auth_router

app = FastAPI(title="Matriculación API")
app.include_router(auth_router)
