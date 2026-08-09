from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.axis_tables import axis_impugnaciones
from app.database import get_db
from app.models import User
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/reportes", tags=["reportes"])


@router.get("/impugnaciones/estados", response_model=list[str])
async def list_estados(
    db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)
) -> list[str]:
    stmt = (
        select(axis_impugnaciones.c.estado)
        .where(axis_impugnaciones.c.estado.is_not(None))
        .distinct()
        .order_by(axis_impugnaciones.c.estado)
    )
    result = await db.execute(stmt)
    return [row[0] for row in result.all()]
