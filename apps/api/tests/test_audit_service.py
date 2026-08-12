import pytest
from sqlalchemy import select

from app.audit import registrar_evento
from app.models import AuditLog


@pytest.mark.asyncio
async def test_registrar_evento_adds_row_visible_before_commit(db_session):
    await registrar_evento(
        db_session,
        user_id=None,
        user_email="user@example.com",
        action="auth.login_success",
        ip_address="127.0.0.1",
        details={"foo": "bar"},
    )

    result = await db_session.execute(select(AuditLog).where(AuditLog.user_email == "user@example.com"))
    log = result.scalar_one()
    assert log.action == "auth.login_success"
    assert log.ip_address == "127.0.0.1"
    assert log.details == {"foo": "bar"}

    await db_session.commit()


@pytest.mark.asyncio
async def test_registrar_evento_does_not_commit_itself(db_session):
    await registrar_evento(
        db_session,
        user_id=None,
        user_email="norollback@example.com",
        action="auth.login_success",
    )
    await db_session.rollback()

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_email == "norollback@example.com")
    )
    assert result.scalar_one_or_none() is None
