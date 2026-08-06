import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.database import async_session_maker, get_db
from app.main import app


@pytest_asyncio.fixture
async def db_session():
    async with async_session_maker() as session:
        yield session
        await session.rollback()
        await session.execute(text("TRUNCATE TABLE app.users RESTART IDENTITY CASCADE"))
        await session.commit()


@pytest_asyncio.fixture
async def client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
