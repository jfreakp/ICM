import csv
import io
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from openpyxl import Workbook
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.audit import registrar_evento
from app.axis_tables import axis_titulos
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
from app.schemas import FechaMinimaResponse, TituloItem, TituloListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "hora_generacion": "Hora de Generación del Registro",
    "codigo_titulo_credito": "Código Título Crédito",
    "tipo_identificacion": "Tipo de Identificación",
    "identificacion": "Identificación",
    "nombre_completo": "Nombre Completo",
    "etapa_cobranza": "Etapa Cobranza",
    "estado": "Estado",
    "codigo_referencia": "Código de Referencia",
    "concepto": "Concepto",
    "nombre_elabora_titulo": "Nombre Elabora Título de Crédito",
    "nombre_solicita": "Nombre que Solicita",
    "nombre_aprobacion": "Nombre de Aprobación",
    "motivo_anulacion": "Motivo de Anulación",
    "fecha_generacion": "Fecha de Generación del Registro",
    "fecha_registro": "Fecha de Registro",
    "fecha_elaboracion": "Fecha de Elaboración",
    "fecha_solicitud": "Fecha de Solicitud",
    "fecha_aprobacion": "Fecha de Aprobación",
    "fecha_notificacion": "Fecha de Notificación",
    "fecha_pago": "Fecha de Pago",
    "fecha_anulacion": "Fecha de Anulación",
    "valor": "Valor",
    "multas": "Multas",
    "interes": "Interés",
    "valor_total": "Valor Total",
    "estado_catalogo_item_id": "ID de Catálogo (Estado)",
    "etapa_cobranza_catalogo_item_id": "ID de Catálogo (Etapa de Cobranza)",
    "tipo_identificacion_catalogo_item_id": "ID de Catálogo (Tipo de Identificación)",
}
COLUMN_NAMES = list(COLUMN_HEADERS)


def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )


def _date_range_conditions(fecha_desde: date, fecha_hasta: date):
    return [
        axis_titulos.c.fecha_registro.between(fecha_desde, fecha_hasta),
        axis_titulos.c.deleted_at.is_(None),
    ]


@router.get("/titulos/fecha-minima", response_model=FechaMinimaResponse)
async def get_fecha_minima_titulos(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> FechaMinimaResponse:
    stmt = select(func.min(axis_titulos.c.fecha_registro)).where(axis_titulos.c.deleted_at.is_(None))
    fecha_minima = await db.scalar(stmt)
    return FechaMinimaResponse(fecha_minima=fecha_minima)


@router.get("/titulos", response_model=TituloListResponse)
async def list_titulos(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> TituloListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    total = await db.scalar(select(func.count()).select_from(axis_titulos).where(and_(*conditions)))

    columns = [axis_titulos.c.id] + [axis_titulos.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_titulos.c.fecha_registro.desc(), axis_titulos.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [TituloItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.titulos.search",
        ip_address=get_client_ip(request),
        details={
            "fecha_desde": fecha_desde.isoformat(),
            "fecha_hasta": fecha_hasta.isoformat(),
            "page": page,
            "total": total or 0,
        },
    )
    await db.commit()

    return TituloListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)


def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/titulos/export")
async def export_titulos(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    formato: Literal["csv", "xlsx"],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> Response:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta)

    columns = [axis_titulos.c[name] for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_titulos.c.fecha_registro.desc(), axis_titulos.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"titulos_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.titulos.export",
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
