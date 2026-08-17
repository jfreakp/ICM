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
from app.axis_tables import axis_infracciones
from app.database import get_db
from app.models import User
from app.routers.auth import get_client_ip, require_active_user
from app.schemas import FechaMinimaResponse, InfraccionItem, InfraccionListResponse

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

PAGE_SIZE = 50

COLUMN_HEADERS: dict[str, str] = {
    "registro": "Registro",
    "fecha_registro": "Fecha de Registro",
    "fecha_emision": "Fecha de Emisión",
    "fecha_aprobacion": "Fecha de Aprobación",
    "fecha_vencimiento": "Fecha de Vencimiento",
    "estado": "Estado",
    "codigo_infraccion": "Código de Infracción",
    "codigo_infraccion_ant": "Código de Infracción Anterior",
    "contravencion": "Contravención",
    "articulo": "Artículo",
    "literal": "Literal",
    "descripcion_articulo": "Descripción del Artículo",
    "periodo_fiscal": "Período Fiscal",
    "oficina": "Oficina",
    "origen_registro": "Origen de Registro",
    "tipo_registro_infraccion": "Tipo de Registro",
    "tipo_emision": "Tipo de Emisión",
    "tipo_deudor": "Tipo de Deudor",
    "codigo_usuario_registra": "Usuario que Registra",
    "observacion": "Observación",
    "provincia": "Provincia",
    "localidad": "Localidad",
    "lugar_infraccion": "Lugar de Infracción",
    "canal": "Canal",
    "placa": "Placa",
    "tipo_identificacion_infractor": "Tipo de Identificación (Infractor)",
    "numero_identificacion_infractor": "Número de Identificación (Infractor)",
    "nombre_infractor": "Nombre del Infractor",
    "tipo_identificacion_propietario": "Tipo de Identificación (Propietario)",
    "numero_identificacion_propietario": "Número de Identificación (Propietario)",
    "nombre_propietario": "Nombre del Propietario",
    "indicador_bloqueada": "Bloqueada",
    "indicador_acta_juzgamiento": "Acta de Juzgamiento",
    "indicador_modificada": "Modificada",
    "indicador_calcula_recargo": "Calcula Recargo",
    "valor_capital": "Valor Capital",
    "valor_capital_exonerado": "Valor Capital Exonerado",
    "valor_recargo": "Valor Recargo",
    "valor_recargo_exonerado": "Valor Recargo Exonerado",
    "valor_intereses": "Valor Intereses",
    "valor_total": "Valor Total",
    "hora_generacion": "Hora de Generación del Registro",
    "fecha_generacion": "Fecha de Generación del Registro",
    "tipo_infraccion": "Tipo de Infracción",
    "codigo_usuario_aprueba": "Código del Usuario que Aprueba",
    "codigo_usuario_notifica": "Código del Usuario que Notifica",
    "tipo_licencia": "Tipo de Licencia",
    "zona": "Zona",
    "distrito": "Distrito",
    "circuito": "Circuito",
    "dispositivo": "Dispositivo",
    "geo_referencia_x": "Geo-referencia-X",
    "geo_referencia_y": "Geo-referencia-Y",
    "tipo_identificacion_agente": "Tipo de Identificación del Agente",
    "numero_identificacion_agente": "Número de Identificación del Agente",
    "nombre_agente": "Nombre del Agente",
    "codigo_agente_transito": "Código del Agente de Tránsito",
    "tipo_infraccion_2": "Tipo de Infracción (2)",
    "codigo_infraccion_origen": "Código de la Infracción Origen",
    "codigo_empresa_convenio": "Código de la Empresa del Convenio",
    "porcentaje_principal": "Porcentaje Principal",
    "porcentaje_convenio": "Porcentaje Convenio",
    "cuenta_bancaria_principal": "Cuenta Bancaria Principal",
    "cuenta_bancaria_convenio": "Cuenta Bancaria Convenio",
    "fecha_notificacion": "Fecha de Notificación",
    "fecha_pago": "Fecha de Pago",
    "fecha_impugnacion": "Fecha de Impugnación",
    "fecha_convenio": "Fecha de Convenio",
    "fecha_anulacion": "Fecha de Anulación",
    "fecha_coactiva": "Fecha de Coactiva",
    "canal_catalogo_item_id": "ID de Catálogo (Canal)",
    "estado_catalogo_item_id": "ID de Catálogo (Estado)",
    "localidad_catalogo_item_id": "ID de Catálogo (Localidad)",
    "origen_registro_catalogo_item_id": "ID de Catálogo (Origen de Registro)",
    "provincia_catalogo_item_id": "ID de Catálogo (Provincia)",
    "tipo_deudor_catalogo_item_id": "ID de Catálogo (Tipo de Deudor)",
    "tipo_emision_catalogo_item_id": "ID de Catálogo (Tipo de Emisión)",
    "tipo_identificacion_agente_catalogo_item_id": "ID de Catálogo (Tipo de Identificación del Agente)",
    "tipo_identificacion_infractor_catalogo_item_id": "ID de Catálogo (Tipo de Identificación del Infractor)",
    "tipo_identificacion_propietario_catalogo_item_id": "ID de Catálogo (Tipo de Identificación del Propietario)",
    "tipo_licencia_catalogo_item_id": "ID de Catálogo (Tipo de Licencia)",
    "tipo_registro_infraccion_catalogo_item_id": "ID de Catálogo (Tipo de Registro de Infracción)",
    "zona_catalogo_item_id": "ID de Catálogo (Zona)",
}
COLUMN_NAMES = list(COLUMN_HEADERS)


def _validate_date_range(fecha_desde: date, fecha_hasta: date) -> None:
    if fecha_desde > fecha_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_desde no puede ser posterior a fecha_hasta",
        )


def _date_range_conditions(fecha_desde: date, fecha_hasta: date, estado: str | None):
    conditions = [cast(axis_infracciones.c.fecha_registro, Date).between(fecha_desde, fecha_hasta)]
    if estado is not None:
        conditions.append(axis_infracciones.c.estado == estado)
    return conditions


DATE_ONLY_COLUMNS = {
    "fecha_registro",
    "fecha_emision",
    "fecha_aprobacion",
    "fecha_vencimiento",
    "fecha_notificacion",
    "fecha_pago",
    "fecha_impugnacion",
    "fecha_convenio",
    "fecha_anulacion",
    "fecha_coactiva",
}


def _select_column(name: str):
    column = axis_infracciones.c[name]
    if name in DATE_ONLY_COLUMNS:
        return cast(column, Date).label(name)
    return column


@router.get("/infracciones/estados", response_model=list[str])
async def list_estados_infracciones(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> list[str]:
    stmt = (
        select(axis_infracciones.c.estado)
        .where(axis_infracciones.c.estado.is_not(None))
        .distinct()
        .order_by(axis_infracciones.c.estado)
    )
    result = await db.execute(stmt)
    return [row[0] for row in result.all()]


@router.get("/infracciones/fecha-minima", response_model=FechaMinimaResponse)
async def get_fecha_minima_infracciones(
    db: AsyncSession = Depends(get_db), _user: User = Depends(require_active_user)
) -> FechaMinimaResponse:
    stmt = select(func.min(_select_column("fecha_registro"))).where(axis_infracciones.c.deleted_at.is_(None))
    fecha_minima = await db.scalar(stmt)
    return FechaMinimaResponse(fecha_minima=fecha_minima)


@router.get("/infracciones", response_model=InfraccionListResponse)
async def list_infracciones(
    request: Request,
    fecha_desde: date,
    fecha_hasta: date,
    estado: str | None = None,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
) -> InfraccionListResponse:
    _validate_date_range(fecha_desde, fecha_hasta)
    conditions = _date_range_conditions(fecha_desde, fecha_hasta, estado)

    total = await db.scalar(
        select(func.count()).select_from(axis_infracciones).where(and_(*conditions))
    )

    columns = [axis_infracciones.c.id] + [_select_column(name) for name in COLUMN_NAMES]
    stmt = (
        select(*columns)
        .where(and_(*conditions))
        .order_by(axis_infracciones.c.fecha_registro.desc(), axis_infracciones.c.id.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    rows = (await db.execute(stmt)).mappings().all()
    items = [InfraccionItem(**row) for row in rows]

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.infracciones.search",
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

    return InfraccionListResponse(items=items, total=total or 0, page=page, page_size=PAGE_SIZE)


def _export_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


@router.get("/infracciones/export")
async def export_infracciones(
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
        .order_by(axis_infracciones.c.fecha_registro.desc(), axis_infracciones.c.id.desc())
    )
    rows = (await db.execute(stmt)).mappings().all()
    filename = f"infracciones_{fecha_desde.isoformat()}_{fecha_hasta.isoformat()}.{formato}"

    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="reportes.infracciones.export",
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
