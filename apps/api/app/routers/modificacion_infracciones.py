import csv
import io
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from openpyxl import Workbook
from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.audit import registrar_evento
from app.axis_tables import axis_modificacion_infracciones
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
from app.schemas import ModificacionInfraccionItem, ModificacionInfraccionListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "hora_generacion": "Hora de Generación del Registro",
    "codigo_infraccion_original": "Código de la Infracción (Original)",
    "contravencion": "Contravención",
    "observacion": "Observación",
    "codigo_infraccion_acta": "Código de la Infracción (Acta)",
    "codigo_usuario_modifica": "Código de Usuario que Modifica",
    "numero_credito": "Número de Crédito",
    "fecha_generacion": "Fecha de Generación del Registro",
    "fecha_registro": "Fecha de Registro",
}
COLUMN_NAMES = list(COLUMN_HEADERS)

DATE_ONLY_COLUMNS = {"fecha_registro"}


def _select_column(name: str):
    column = axis_modificacion_infracciones.c[name]
    if name in DATE_ONLY_COLUMNS:
        return cast(column, Date).label(name)
    return column


def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )


def _date_range_conditions(fecha_desde: date, fecha_hasta: date):
    return [
        cast(axis_modificacion_infracciones.c.fecha_registro, Date).between(fecha_desde, fecha_hasta),
        axis_modificacion_infracciones.c.deleted_at.is_(None),
    ]


@router.get("/modificacion-infracciones", response_model=ModificacionInfraccionListResponse)
async def list_modificacion_infracciones(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> ModificacionInfraccionListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    total = await db.scalar(
        select(func.count()).select_from(axis_modificacion_infracciones).where(and_(*conditions))
    )

    columns = [axis_modificacion_infracciones.c.id] + [_select_column(name) for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_modificacion_infracciones.c.fecha_registro.desc(), axis_modificacion_infracciones.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [ModificacionInfraccionItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.modificacion_infracciones.search",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "page": page,
            "total": total or 0,
        },
    )
    await db.commit()

    return ModificacionInfraccionListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)


def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/modificacion-infracciones/export")
async def export_modificacion_infracciones(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    formato: Literal["csv", "xlsx"],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> Response:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    columns = [_select_column(name) for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_modificacion_infracciones.c.fecha_registro.desc(), axis_modificacion_infracciones.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"modificacion-infracciones_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.modificacion_infracciones.export",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "formato": formato,
            "filas_exportadas": len(rows),
        },
    )
    await db.commit()

    def _build_csv() -> str:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(list(COLUMN_HEADERS.values()))
        for row in rows:
            writer.writerow([_export_value(row[name]) for name in COLUMN_NAMES])
        return "﻿" + buffer.getvalue()

    def _build_xlsx() -> bytes:
        workbook = Workbook(write_only=True)
        sheet = workbook.create_sheet()
        sheet.append(list(COLUMN_HEADERS.values()))
        for row in rows:
            sheet.append([_export_value(row[name]) for name in COLUMN_NAMES])
        xlsx_buffer = io.BytesIO()
        workbook.save(xlsx_buffer)
        return xlsx_buffer.getvalue()

    if formato == "csv":
        content = await run_in_threadpool(_build_csv)
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    content = await run_in_threadpool(_build_xlsx)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
