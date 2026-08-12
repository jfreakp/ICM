from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy import select, text

from app.auth import create_access_token, hash_password
from app.models import AuditLog, User


async def _create_user(db_session, email="user@example.com", password="Sup3rSecret!", **overrides):
    user = User(email=email, password_hash=hash_password(password), full_name="Test User", **overrides)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _create_admin(db_session, email="admin@example.com", password="Sup3rSecret!"):
    user = User(email=email, password_hash=hash_password(password), full_name="Admin", is_admin=True)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _last_audit_log(db_session, action):
    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.id.desc())
    )
    return result.scalars().first()


@pytest.mark.asyncio
async def test_successful_login_creates_login_success_event(client, db_session):
    await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 200
    log = await _last_audit_log(db_session, "auth.login_success")
    assert log is not None
    assert log.user_email == "user@example.com"
    assert log.ip_address == "127.0.0.1"


@pytest.mark.asyncio
async def test_wrong_password_creates_login_failed_event_with_known_user(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "wrong"}
    )

    assert response.status_code == 401
    log = await _last_audit_log(db_session, "auth.login_failed")
    assert log is not None
    assert log.user_id == user.id
    assert log.user_email == "user@example.com"


@pytest.mark.asyncio
async def test_unknown_email_creates_login_failed_event_with_null_user_id(client, db_session):
    response = await client.post(
        "/api/auth/login", json={"email": "ghost@example.com", "password": "whatever"}
    )

    assert response.status_code == 401
    log = await _last_audit_log(db_session, "auth.login_failed")
    assert log is not None
    assert log.user_id is None
    assert log.user_email == "ghost@example.com"


@pytest.mark.asyncio
async def test_ip_mismatch_creates_login_blocked_ip_event(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    user.allowed_ip = "10.0.0.9"
    await db_session.commit()

    response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )

    assert response.status_code == 403
    log = await _last_audit_log(db_session, "auth.login_blocked_ip")
    assert log is not None
    assert log.user_id == user.id
    assert log.details == {"ip_esperada": "10.0.0.9"}


@pytest.mark.asyncio
async def test_logout_creates_event_and_returns_204(client, db_session):
    user = await _create_user(db_session, email="user@example.com", password="Sup3rSecret!")
    login_response = await client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "Sup3rSecret!"}
    )
    token = login_response.json()["access_token"]

    response = await client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 204
    log = await _last_audit_log(db_session, "auth.logout")
    assert log is not None
    assert log.user_id == user.id
    assert log.user_email == "user@example.com"


@pytest.mark.asyncio
async def test_logout_without_token_returns_401(client, db_session):
    response = await client.post("/api/auth/logout")
    assert response.status_code == 401


INSERT_IMPUGNACION_SQL = text(
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


def _impugnacion_row(registro, fecha_registro, estado="A"):
    return {
        "registro": registro,
        "fecha_registro": fecha_registro,
        "fecha_acta": fecha_registro,
        "estado": estado,
        "codigo_infraccion_axis": "COD-1",
        "contravencion": "Contravencion de prueba",
        "tipo_acta": "Tipo A",
        "articulo_original": "Art 1",
        "monto_capital_original": None,
        "observacion": "Observación de prueba",
    }


async def _seed_impugnaciones(db_session, rows):
    for row in rows:
        await db_session.execute(INSERT_IMPUGNACION_SQL, row)
    await db_session.commit()


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_audit_impugnaciones(db_session):
    yield
    await db_session.execute(text("DELETE FROM axis.axis_impugnaciones WHERE registro LIKE 'TEST-AUD-%'"))
    await db_session.commit()


async def _auth_headers(client, db_session, email="user@example.com"):
    await _create_user(db_session, email=email, password="Sup3rSecret!")
    response = await client.post("/api/auth/login", json={"email": email, "password": "Sup3rSecret!"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.asyncio
async def test_search_creates_audit_event_with_filters_and_total(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(
        db_session,
        [
            _impugnacion_row("TEST-AUD-001", datetime(2031, 6, 5), estado="A"),
            _impugnacion_row("TEST-AUD-002", datetime(2031, 6, 6), estado="A"),
        ],
    )

    response = await client.get(
        "/api/reportes/impugnaciones",
        params={"fecha_desde": "2031-06-01", "fecha_hasta": "2031-06-30", "estado": "A"},
        headers=headers,
    )

    assert response.status_code == 200
    log = await _last_audit_log(db_session, "reportes.impugnaciones.search")
    assert log is not None
    assert log.details == {
        "fecha_desde": "2031-06-01",
        "fecha_hasta": "2031-06-30",
        "estado": "A",
        "page": 1,
        "total": 2,
    }


@pytest.mark.asyncio
async def test_export_creates_audit_event_with_row_count(client, db_session):
    headers = await _auth_headers(client, db_session)
    await _seed_impugnaciones(db_session, [_impugnacion_row("TEST-AUD-101", datetime(2031, 7, 5), estado="A")])

    response = await client.get(
        "/api/reportes/impugnaciones/export",
        params={"fecha_desde": "2031-07-01", "fecha_hasta": "2031-07-31", "formato": "csv"},
        headers=headers,
    )

    assert response.status_code == 200
    log = await _last_audit_log(db_session, "reportes.impugnaciones.export")
    assert log is not None
    assert log.details["formato"] == "csv"
    assert log.details["filas_exportadas"] == 1
