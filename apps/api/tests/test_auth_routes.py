import pytest

from app.auth import create_access_token, hash_password
from app.models import User


async def _create_user(db_session, email="user@example.com", password="Sup3rSecret!"):
    user = User(email=email, password_hash=hash_password(password), full_name="Test User")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_login_with_valid_credentials_returns_token(client, db_session):
    await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert len(body["access_token"]) > 20


@pytest.mark.asyncio
async def test_login_with_wrong_password_returns_401(client, db_session):
    await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "wrong"}
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_with_unknown_email_returns_401(client, db_session):
    response = await client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "whatever"}
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_with_valid_token_returns_user(client, db_session):
    await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    login_response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )
    token = login_response.json()["access_token"]

    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "user@example.com"
    assert body["full_name"] == "Test User"


@pytest.mark.asyncio
async def test_me_without_token_returns_401(client, db_session):
    response = await client.get("/api/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_with_invalid_token_returns_401(client, db_session):
    response = await client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_with_overlong_password_returns_401_not_500(client, db_session):
    await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "x" * 100}
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_with_inactive_user_returns_401(client, db_session):
    user = User(email="inactive@example.com", password_hash=hash_password("Sup3rSecret!"), full_name="Inactive User", is_active=False)
    db_session.add(user)
    await db_session.commit()

    response = await client.post(
        "/api/auth/login", json={"email": "inactive@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_with_inactive_user_returns_401(client, db_session):
    user = User(email="inactive2@example.com", password_hash=hash_password("Sup3rSecret!"), full_name="Inactive User", is_active=True)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)

    user.is_active = False
    await db_session.commit()

    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
