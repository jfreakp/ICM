import pytest

from app.models import AuditLog


@pytest.mark.asyncio
async def test_audit_log_persists_with_null_user_id(db_session):
    log = AuditLog(
        user_id=None,
        user_email="nobody@example.com",
        action="auth.login_failed",
        ip_address="127.0.0.1",
        details={"motivo": "credenciales_invalidas"},
    )
    db_session.add(log)
    await db_session.commit()
    await db_session.refresh(log)

    assert log.id is not None
    assert log.occurred_at is not None
    assert log.user_id is None
    assert log.user_email == "nobody@example.com"
    assert log.action == "auth.login_failed"
    assert log.ip_address == "127.0.0.1"
    assert log.details == {"motivo": "credenciales_invalidas"}


@pytest.mark.asyncio
async def test_audit_log_persists_with_user_id(db_session):
    from app.auth import hash_password
    from app.models import User

    user = User(email="user@example.com", password_hash=hash_password("Sup3rSecret!"), full_name="Test User")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    log = AuditLog(user_id=user.id, user_email=user.email, action="auth.login_success")
    db_session.add(log)
    await db_session.commit()
    await db_session.refresh(log)

    assert log.user_id == user.id
    assert log.ip_address is None
    assert log.details is None
