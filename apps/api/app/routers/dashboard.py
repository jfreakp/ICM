from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.axis_tables import (
    axis_crv,
    axis_impugnaciones,
    axis_infracciones,
    axis_juicios,
    axis_modificacion_infracciones,
    axis_pagos,
    axis_titulos,
)
from app.database import get_db
from app.models import User
from app.routers.auth import require_active_user
from app.schemas import DashboardResumenResponse, ResumenTablaItem

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

TABLAS_RESUMEN = [
    ("crv", "CRV", axis_crv),
    ("impugnaciones", "Impugnaciones", axis_impugnaciones),
    ("infracciones", "Infracciones", axis_infracciones),
    ("juicios", "Juicios Coactivos", axis_juicios),
    ("modificacion_infracciones", "Modificación de Infracciones", axis_modificacion_infracciones),
    ("pagos", "Pagos", axis_pagos),
    ("titulos", "Títulos de Crédito", axis_titulos),
]


@router.get("/resumen", response_model=DashboardResumenResponse)
async def get_resumen(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_active_user),
) -> DashboardResumenResponse:
    items = []
    for tabla, etiqueta, table in TABLAS_RESUMEN:
        total = await db.scalar(
            select(func.count()).select_from(table).where(table.c.deleted_at.is_(None))
        )
        items.append(ResumenTablaItem(tabla=tabla, etiqueta=etiqueta, total=total or 0))
    return DashboardResumenResponse(tablas=items)
