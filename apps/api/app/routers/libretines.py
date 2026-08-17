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
from app.axis_tables import axis_libretines
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
from app.schemas import FechaMinimaResponse, LibretinItem, LibretinListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "hora_generacion": "Hora de Generación del Registro",
    "codigo_libretin": "Código Libretin",
    "prefijo_boleta": "Prefijo Boleta",
    "rango_inicio_boleta": "Rango Inicio Boleta",
    "rango_fin_boleta": "Rango Fin Boleta",
    "cantidad_boletas": "Cantidad Boletas",
    "longitud_boleta": "Longitud Boleta",
    "estado": "Estado",
    "codigo_tramite": "Código de Trámite",
    "codigo_usuario_creacion": "Código de Usuario Creación",
    "codigo_tramite_asignacion": "Código de Trámite Asignación",
    "codigo_usuario_asignacion": "Código de Usuario Asignación",
    "codigo_usuario_inactiva": "Código de Usuario Inactiva",
    "observacion": "Observación",
    "codigo_agente": "Código Agente",
    "identificacion_agente": "Identificación Agente",
    "agente": "Agente",
    "codigo_distrito": "Código Distrito",
    "descripcion_distrito": "Descripción Distrito",
    "codigo_oficina": "Código Oficina",
    "descripcion_oficina": "Descripción Oficina",
    "codigo_provincia": "Código Provincia",
    "descripcion_provincia": "Descripción Provincia",
    "codigo_localidad": "Código Localidad",
    "descripcion_localidad": "Descripción Localidad",
    "tipo": "Tipo",
    "origen_tramite": "Origen Trámite",
    "motivo_baja": "Motivo Baja",
    "disponibles": "Disponibles",
    "utilizadas": "Utilizadas",
    "desactivadas": "Desactivadas",
    "fecha_generacion": "Fecha de Generación del Registro",
    "fecha_registro": "Fecha de Registro",
    "fecha_asignacion": "Fecha Asignación",
    "fecha_inactivacion": "Fecha Inactivación",
    "codigo_localidad_catalogo_item_id": "ID de Catálogo (Localidad)",
    "codigo_provincia_catalogo_item_id": "ID de Catálogo (Provincia)",
    "estado_catalogo_item_id": "ID de Catálogo (Estado)",
    "tipo_catalogo_item_id": "ID de Catálogo (Tipo)",
}
COLUMN_NAMES = list(COLUMN_HEADERS)

DATE_ONLY_COLUMNS = {"fecha_registro", "fecha_asignacion", "fecha_inactivacion"}


def _select_column(name: str):
    column = axis_libretines.c[name]
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
        cast(axis_libretines.c.fecha_registro, Date).between(fecha_desde, fecha_hasta),
        axis_libretines.c.deleted_at.is_(None),
    ]


@router.get("/libretines/fecha-minima", response_model=FechaMinimaResponse)
async def get_fecha_minima_libretines(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> FechaMinimaResponse:
    stmt = select(func.min(_select_column("fecha_registro"))).where(axis_libretines.c.deleted_at.is_(None))
    fecha_minima = await db.scalar(stmt)
    return FechaMinimaResponse(fecha_minima=fecha_minima)


@router.get("/libretines", response_model=LibretinListResponse)
async def list_libretines(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> LibretinListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    total = await db.scalar(select(func.count()).select_from(axis_libretines).where(and_(*conditions)))

    columns = [axis_libretines.c.id] + [_select_column(name) for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_libretines.c.fecha_registro.desc(), axis_libretines.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [LibretinItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.libretines.search",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "page": page,
            "total": total or 0,
        },
    )
    await db.commit()

    return LibretinListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)


def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/libretines/export")
async def export_libretines(
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
        .order_by(axis_libretines.c.fecha_registro.desc(), axis_libretines.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"libretines_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.libretines.export",
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
