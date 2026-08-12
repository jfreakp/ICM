from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


async def registrar_evento(
    db: AsyncSession,
    *,
    user_id: int | None,
    user_email: str,
    action: str,
    ip_address: str | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            user_email=user_email,
            action=action,
            ip_address=ip_address,
            details=details,
        )
    )
