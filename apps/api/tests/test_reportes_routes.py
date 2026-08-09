from datetime import datetime
from decimal import Decimal

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


INSERT_SQL = text(
    """
    INSERT INTO axis.axis_impugnaciones
        (registro, fecha_registro, fecha_acta, estado, codigo_infraccion_axis,
         contravencion, tipo_acta, articulo_original, monto_capital_original, observacion)
    VALUES
        (:registro, :fecha_registro, :fecha_acta, :estado, :codigo_infraccion_axis,
         :contravencion, :tipo_acta, :articulo_original, :monto_capital_original, :observacion)
    RETURNING id
    """
)


async def _seed_impugnaciones(db_session, rows):
    ids = []
    for row in rows:
        result = await db_session.execute(INSERT_SQL, row)
        ids.append(result.scalar_one())
    await db_session.commit()
    return ids


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_impugnaciones(db_session):
    yield
    await db_session.execute(text("DELETE FROM axis.axis_impugnaciones WHERE registro LIKE 'TEST-%'"))
    await db_session.commit()


def _row(registro, fecha_registro, estado="A", **overrides):
    base = {
        "registro": registro,
        "fecha_registro": fecha_registro,
        "fecha_acta": fecha_registro,
        "estado": estado,
        "codigo_infraccion_axis": "COD-1",
        "contravencion": "Contravencion de prueba",
        "tipo_acta": "Tipo A",
        "articulo_original": "Art 1",
        "monto_capital_original": Decimal("100.00"),
        "observacion": "Observación de prueba",
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_estados_returns_distinct_values(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(
        db_session,
        [
            _row("TEST-001", datetime(2024, 3, 5), estado="A"),
            _row("TEST-002", datetime(2024, 3, 6), estado="B"),
            _row("TEST-003", datetime(2024, 3, 7), estado="A"),
        ],
    )

    response = await client.get("/api/reportes/impugnaciones/estados", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert "A" in body
    assert "B" in body


@pytest.mark.asyncio
async def test_estados_without_token_returns_401(client, db_session):
    response = await client.get("/api/reportes/impugnaciones/estados")
    assert response.status_code == 401
