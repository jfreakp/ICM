from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.auth import create_access_token, hash_password
from app.models import User


async def _create_user(db_session, email="user@example.com", password="Sup3rSecret!"):
    user = User(email=email, password_hash=hash_password(password), full_name="Test User")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _auth_headers(client, db_session):
    await _create_user(db_session)
    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def _crv_row_ids(db_session):
    ids: list[int] = []
    yield ids
    if ids:
        await db_session.execute(text("DELETE FROM axis.axis_crv WHERE id = ANY(:ids)"), {"ids": ids})
        await db_session.commit()


async def _insert_crv_row(db_session, crv_ids, deleted_at=None):
    result = await db_session.execute(
        text("INSERT INTO axis.axis_crv (deleted_at) VALUES (:deleted_at) RETURNING id"),
        {"deleted_at": deleted_at},
    )
    new_id = result.scalar_one()
    crv_ids.append(new_id)
    await db_session.commit()
    return new_id


EXPECTED_ORDER = [
    ("crv", "CRV"),
    ("impugnaciones", "Impugnaciones"),
    ("infracciones", "Infracciones"),
    ("juicios", "Juicios Coactivos"),
    ("modificacion_infracciones", "Modificación de Infracciones"),
    ("pagos", "Pagos"),
    ("titulos", "Títulos de Crédito"),
]


@pytest.mark.asyncio
async def test_resumen_returns_all_seven_tables_in_order(client, db_session):
    headers = await _auth_headers(client, db_session)

    response = await client.get("/api/dashboard/resumen", headers=headers)

    assert response.status_code == 200
    body = response.json()
    tablas = [(item["tabla"], item["etiqueta"]) for item in body["tablas"]]
    assert tablas == EXPECTED_ORDER
    for item in body["tablas"]:
        assert item["total"] >= 0


@pytest.mark.asyncio
async def test_resumen_excludes_soft_deleted_rows(client, db_session, _crv_row_ids):
    headers = await _auth_headers(client, db_session)

    baseline = await client.get("/api/dashboard/resumen", headers=headers)
    baseline_total = next(
        item["total"] for item in baseline.json()["tablas"] if item["tabla"] == "crv"
    )

    await _insert_crv_row(db_session, _crv_row_ids, deleted_at=None)
    await _insert_crv_row(db_session, _crv_row_ids, deleted_at=datetime.now(timezone.utc))

    response = await client.get("/api/dashboard/resumen", headers=headers)

    assert response.status_code == 200
    new_total = next(
        item["total"] for item in response.json()["tablas"] if item["tabla"] == "crv"
    )
    assert new_total == baseline_total + 1


@pytest.mark.asyncio
async def test_resumen_without_token_returns_401(client, db_session):
    response = await client.get("/api/dashboard/resumen")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_resumen_blocked_when_must_change_password_is_true(client, db_session):
    user = User(
        email="pendiente@example.com",
        password_hash=hash_password("Sup3rSecret!"),
        full_name="Usuario Pendiente",
        must_change_password=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)

    response = await client.get(
        "/api/dashboard/resumen", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "password_change_required"
