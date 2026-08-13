import pytest
from sqlalchemy import select

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


@pytest.mark.asyncio
async def test_login_auto_binds_allowed_ip_on_first_login(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    assert user.allowed_ip is None

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 200
    await db_session.refresh(user)
    assert user.allowed_ip == "127.0.0.1"


@pytest.mark.asyncio
async def test_login_rejected_when_ip_does_not_match_allowed_ip(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    user.allowed_ip = "10.0.0.9"
    await db_session.commit()

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ip_not_allowed"


@pytest.mark.asyncio
async def test_admin_login_is_exempt_from_ip_check(client, db_session):
    from app.auth import hash_password
    from app.models import User

    user = User(
        email="admin@example.com",
        password_hash=hash_password("Sup3rSecret!"),
        full_name="Admin User",
        is_admin=True,
        allowed_ip="10.0.0.9",
    )
    db_session.add(user)
    await db_session.commit()

    response = await client.post(
        "/api/auth/login", json={"email": "admin@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 200
    await db_session.refresh(user)
    assert user.allowed_ip == "10.0.0.9"


@pytest.mark.asyncio
async def test_me_returns_403_when_ip_changed_mid_session(client, db_session):
    from httpx import ASGITransport, AsyncClient
    from app.main import app

    await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    login_response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )
    token = login_response.json()["access_token"]

    other_ip_client = AsyncClient(
        transport=ASGITransport(app=app, client=("10.0.0.9", 123)), base_url="http://test"
    )
    async with other_ip_client as oc:
        response = await oc.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ip_not_allowed"


@pytest.mark.asyncio
async def test_me_exempts_admin_from_ip_check(client, db_session):
    from app.auth import create_access_token, hash_password
    from app.models import User

    user = User(
        email="admin@example.com",
        password_hash=hash_password("Sup3rSecret!"),
        full_name="Admin User",
        is_admin=True,
        allowed_ip="10.0.0.9",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200


async def _create_admin(db_session, email="admin@example.com", password="Sup3rSecret!"):
    from app.auth import hash_password
    from app.models import User

    user = User(email=email, password_hash=hash_password(password), full_name="Admin", is_admin=True)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_admin_can_list_users(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")

    response = await client.get("/api/auth/users", headers={"Authorization": f"Bearer {admin_token}"})

    assert response.status_code == 200
    emails = {u["email"] for u in response.json()}
    assert emails == {"admin@example.com", "user@example.com"}


@pytest.mark.asyncio
async def test_non_admin_cannot_list_users(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.get("/api/auth/users", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "admin_required"


@pytest.mark.asyncio
async def test_admin_can_reset_allowed_ip(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    target = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    target.allowed_ip = "10.0.0.9"
    await db_session.commit()

    response = await client.patch(
        f"/api/auth/users/{target.id}/allowed-ip",
        json={"allowed_ip": None},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    assert response.json()["allowed_ip"] is None


@pytest.mark.asyncio
async def test_non_admin_cannot_reset_allowed_ip(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.patch(
        f"/api/auth/users/{user.id}/allowed-ip",
        json={"allowed_ip": None},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "admin_required"


@pytest.mark.asyncio
async def test_admin_reset_allowed_ip_for_unknown_user_returns_404(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.patch(
        "/api/auth/users/9999/allowed-ip",
        json={"allowed_ip": None},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_admin_can_create_user(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "nuevo@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Nuevo Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "nuevo@example.com"
    assert body["full_name"] == "Nuevo Usuario"
    assert body["is_admin"] is False
    assert body["is_active"] is True
    assert body["allowed_ip"] is None
    assert "password" not in body
    assert "password_hash" not in body


@pytest.mark.asyncio
async def test_created_user_password_is_hashed_and_usable_for_login(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    await client.post(
        "/api/auth/users",
        json={
            "email": "nuevo2@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Nuevo Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    result = await db_session.execute(select(User).where(User.email == "nuevo2@example.com"))
    created = result.scalar_one()
    assert created.password_hash != "Sup3rSecret!"

    login_response = await client.post(
        "/api/auth/login", json={"email": "nuevo2@example.com", "password": "Sup3rSecret!"}
    )
    assert login_response.status_code == 200


@pytest.mark.asyncio
async def test_admin_can_create_admin_user(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "nuevoadmin@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Nuevo Admin",
            "is_admin": True,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 201
    assert response.json()["is_admin"] is True


@pytest.mark.asyncio
async def test_create_user_with_duplicate_email_returns_409(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    await _create_user(db_session, email="existente@example.com")

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "existente@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Otro Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 409


@pytest.mark.asyncio
async def test_non_admin_cannot_create_user(client, db_session):
    user = await _create_user(db_session, email="empleado@example.com")
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "otro@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Otro Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "admin_required"


@pytest.mark.asyncio
async def test_create_user_without_token_returns_401(client, db_session):
    response = await client.post(
        "/api/auth/users",
        json={
            "email": "sinauth@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Sin Auth",
            "is_admin": False,
        },
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_user_with_short_password_returns_422(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "cortita@example.com",
            "password": "short",
            "full_name": "Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_user_with_password_over_72_bytes_returns_422(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "largo@example.com",
            "password": "x" * 100,
            "full_name": "Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_user_email_duplicate_check_is_case_insensitive(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    await _create_user(db_session, email="persona@example.com")

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "Persona@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Otra Persona",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 409


@pytest.mark.asyncio
async def test_login_is_case_insensitive_on_email(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    await client.post(
        "/api/auth/users",
        json={
            "email": "MixedCase@example.com",
            "password": "Sup3rSecret!",
            "full_name": "Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    response = await client.post(
        "/api/auth/login", json={"email": "mixedcase@example.com", "password": "Sup3rSecret!"}
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_admin_can_reset_password(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    target = await _create_user(db_session, email="resetear@example.com", password="Original123!")

    response = await client.patch(
        f"/api/auth/users/{target.id}/password",
        json={"new_password": "NuevaClave123!"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    assert "password" not in response.json()
    assert "password_hash" not in response.json()

    old_login = await client.post(
        "/api/auth/login", json={"email": "resetear@example.com", "password": "Original123!"}
    )
    assert old_login.status_code == 401

    new_login = await client.post(
        "/api/auth/login", json={"email": "resetear@example.com", "password": "NuevaClave123!"}
    )
    assert new_login.status_code == 200


@pytest.mark.asyncio
async def test_reset_password_for_unknown_user_returns_404(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.patch(
        "/api/auth/users/9999/password",
        json={"new_password": "NuevaClave123!"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_non_admin_cannot_reset_password(client, db_session):
    user = await _create_user(db_session, email="empleado2@example.com")
    other = await _create_user(db_session, email="otroempleado@example.com")
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.patch(
        f"/api/auth/users/{other.id}/password",
        json={"new_password": "NuevaClave123!"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "admin_required"


@pytest.mark.asyncio
async def test_reset_password_with_short_password_returns_422(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)
    target = await _create_user(db_session, email="cortita2@example.com")

    response = await client.patch(
        f"/api/auth/users/{target.id}/password",
        json={"new_password": "short"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_user_with_multibyte_password_over_72_bytes_does_not_crash(client, db_session):
    admin = await _create_admin(db_session)
    admin_token = create_access_token(user_id=admin.id, email=admin.email)

    response = await client.post(
        "/api/auth/users",
        json={
            "email": "multibyte@example.com",
            "password": "ñ" * 72,
            "full_name": "Usuario",
            "is_admin": False,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 201
