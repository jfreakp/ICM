from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.axis_tables import axis_impugnaciones
from app.database import get_db
from app.models import User
from app.routers.auth import get_current_user
from app.schemas import ImpugnacionItem, ImpugnacionListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_NAMES = [
    "registro",
    "fecha_registro",
    "fecha_acta",
    "estado",
    "codigo_infraccion_axis",
    "contravencion",
    "tipo_acta",
    "articulo_original",
    "monto_capital_original",
    "observacion",
]


def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )
    if (fecha_desde.year, fecha_desde.month) != (fecha_hasta.year, fecha_hasta.month):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El rango de fechas debe estar dentro del mismo mes calendario",
        )


def _date_range_conditions(fecha_desde: date, fecha_hasta: date, estado: str | None):
    conditions = [cast(axis_impugnaciones.c.fecha_registro, Date).between(fecha_desde, fecha_hasta)]
    if estado is not None:
        conditions.append(axis_impugnaciones.c.estado == estado)
    return conditions


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


@router.get("/impugnaciones", response_model=ImpugnacionListResponse)
async def list_impugnaciones(
    fecha_desde: date,
    fecha_hasta: date,
    estado: str | None = None,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> ImpugnacionListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta, estado)

    total = await db.scalar(
        select(func.count()).select_from(axis_impugnaciones).where(and_(*conditions))
    )

    columns = [axis_impugnaciones.c.id] + [axis_impugnaciones.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_impugnaciones.c.fecha_registro.desc(), axis_impugnaciones.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [ImpugnacionItem(**row) for row in rows]
    return ImpugnacionListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)
