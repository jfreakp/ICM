from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AuditLog
from app.routers.auth import require_admin
from app.schemas import AuditLogItem, AuditLogListResponse

router = APIRouter(prefix="/api/auditoria", tags=["auditoria"])

PAGE_SIZE = 50


def _filter_conditions(
    desde: date | None, hasta: date | None, accion: str | None, usuario_email: str | None
):
    conditions = []
    if desde is not None:
        conditions.append(cast(AuditLog.occurred_at, Date) >= desde)
    if hasta is not None:
        conditions.append(cast(AuditLog.occurred_at, Date) <= hasta)
    if accion is not None:
        conditions.append(AuditLog.action == accion)
    if usuario_email is not None:
        conditions.append(AuditLog.user_email == usuario_email)
    return conditions


@router.get("", response_model=AuditLogListResponse)
async def list_auditoria(
    desde: date | None = None,
    hasta: date | None = None,
    accion: str | None = None,
    usuario_email: str | None = None,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
) -> AuditLogListResponse:
    conditions = _filter_conditions(desde, hasta, accion, usuario_email)

    total = await db.scalar(select(func.count()).select_from(AuditLog).where(*conditions))

    stmt = (
        select(AuditLog)
        .where(*conditions)
        .order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.scalars(stmt)).all()
    items = [AuditLogItem.model_validate(row) for row in rows]
    return AuditLogListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)
