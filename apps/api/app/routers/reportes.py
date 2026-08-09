import csv
import io
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from openpyxl import Workbook
from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.axis_tables import axis_impugnaciones
from app.database import get_db
from app.models import User
from app.routers.auth import get_current_user
from app.schemas import ImpugnacionItem, ImpugnacionListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "fecha_registro": "Fecha de Registro",
    "fecha_acta": "Fecha de Acta",
    "estado": "Estado",
    "codigo_infraccion_axis": "Código de Infracción AXIS",
    "contravencion": "Contravención",
    "tipo_acta": "Tipo de Acta",
    "articulo_original": "Artículo Original",
    "monto_capital_original": "Monto Capital Original",
    "observacion": "Observación",
}
COLUMN_NAMES = list(COLUMN_HEADERS)


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


def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/impugnaciones/export")
async def export_impugnaciones(
    fecha_desde: date,
    fecha_hasta: date,
    formato: Literal["csv", "xlsx"],
    estado: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Response:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta, estado)

    columns = [axis_impugnaciones.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_impugnaciones.c.fecha_registro.desc(), axis_impugnaciones.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"impugnaciones_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    if formato == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(list(COLUMN_HEADERS.values()))
        for row in rows:
            writer.writerow([_export_value(row[name]) for name in COLUMN_NAMES])
        content = "﻿" + buffer.getvalue()
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    workbook = Workbook()
    sheet = workbook.active
    sheet.append(list(COLUMN_HEADERS.values()))
    for row in rows:
        sheet.append([_export_value(row[name]) for name in COLUMN_NAMES])
    xlsx_buffer = io.BytesIO()
    workbook.save(xlsx_buffer)
    return Response(
        content=xlsx_buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
