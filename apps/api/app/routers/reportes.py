import csv
import io
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from openpyxl import Workbook
from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import registrar_evento
from app.axis_tables import axis_impugnaciones
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
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
    "hora_generacion": "Hora de Generación del Registro",
    "fecha_generacion": "Fecha de Generación del Registro",
    "numero_credito": "Número de Crédito",
    "numero_tramite": "Número de Trámite",
    "codigo_infraccion_generada_axis": "Código de la Infracción Generada en AXIS Cloud",
    "juzgado": "Juzgado",
    "codigo_provincia": "Código de la Provincia",
    "codigo_localidad": "Código de la Localidad",
    "numero_proceso": "Número del Proceso",
    "monto_modificado_sentencia": "Monto Modificado por la Sentencia",
    "puntos_original": "Puntos Original",
    "puntos_modificados_sentencia": "Puntos Modificados por la Sentencia",
    "literal_original": "Literal Original",
    "articulo_modificado_sentencia": "Artículo Modificado por la Sentencia",
    "literal_modificado_sentencia": "Literal Modificado por la Sentencia",
    "fecha_vencimiento_original": "Fecha de Vencimiento Original",
    "fecha_vencimiento_modificado_sentencia": "Fecha de Vencimiento Modificado por la Sentencia",
    "sancion_original": "Sanción Original",
    "sancion_modificada_sentencia": "Sanción Modificada por la Sentencia",
    "codigo_usuario": "Código del Usuario",
    "codigo_usuario_aprueba": "Código del Usuario que Aprueba",
    "numero_acta_juzgamiento": "Número de Acta de Juzgamiento",
    "fecha_aprobacion": "Fecha de Aprobación",
    "fecha_anulacion": "Fecha de Anulación",
    "codigo_usuario_anula": "Código de Usuario que Anula",
    "observacion_anulacion": "Observación de Anulación",
    "articulo_original_catalogo_item_id": "ID de Catálogo (Artículo Original)",
    "articulo_modificado_sentencia_catalogo_item_id": "ID de Catálogo (Artículo Modificado por la Sentencia)",
    "codigo_localidad_catalogo_item_id": "ID de Catálogo (Localidad)",
    "codigo_provincia_catalogo_item_id": "ID de Catálogo (Provincia)",
    "tipo_acta_catalogo_item_id": "ID de Catálogo (Tipo de Acta)",
}
COLUMN_NAMES = list(COLUMN_HEADERS)


def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )


def _date_range_conditions(fecha_desde: date, fecha_hasta: date, estado: str | None):
    conditions = [cast(axis_impugnaciones.c.fecha_registro, Date).between(fecha_desde, fecha_hasta)]
    if estado is not None:
        conditions.append(axis_impugnaciones.c.estado == estado)
    return conditions


DATE_ONLY_COLUMNS = {
    "fecha_registro",
    "fecha_acta",
    "fecha_vencimiento_original",
    "fecha_vencimiento_modificado_sentencia",
    "fecha_aprobacion",
    "fecha_anulacion",
}


def _select_column(name: str):
    column = axis_impugnaciones.c[name]
    if name in DATE_ONLY_COLUMNS:
        return cast(column, Date).label(name)
    return column


@router.get("/impugnaciones/estados", response_model=list[str])
async def list_estados(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
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
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    estado: str | None = None,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> ImpugnacionListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta, estado)

    total = await db.scalar(
        select(func.count()).select_from(axis_impugnaciones).where(and_(*conditions))
    )

    columns = [axis_impugnaciones.c.id] + [_select_column(name) for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_impugnaciones.c.fecha_registro.desc(), axis_impugnaciones.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [ImpugnacionItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.impugnaciones.search",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "estado": estado,
            "page": page,
            "total": total or 0,
        },
    )
    await db.commit()

    return ImpugnacionListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)


def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/impugnaciones/export")
async def export_impugnaciones(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    formato: Literal["csv", "xlsx"],
    estado: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> Response:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta, estado)

    columns = [_select_column(name) for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_impugnaciones.c.fecha_registro.desc(), axis_impugnaciones.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"impugnaciones_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.impugnaciones.export",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "estado": estado,
            "formato": formato,
            "filas_exportadas": len(rows),
        },
    )
    await db.commit()

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
