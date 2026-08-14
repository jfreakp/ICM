from datetime import date, datetime, time

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    is_admin: bool
    must_change_password: bool

    model_config = {"from_attributes": True}


class UserListItem(BaseModel):
    id: int
    email: str
    full_name: str
    is_admin: bool
    is_active: bool
    allowed_ip: str | None

    model_config = {"from_attributes": True}


class UpdateAllowedIpRequest(BaseModel):
    allowed_ip: str | None


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    full_name: str = Field(min_length=1)
    is_admin: bool = False


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=72)


class ChangeOwnPasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)


class ImpugnacionItem(BaseModel):
    id: int
    registro: str | None
    fecha_registro: datetime | None
    fecha_acta: datetime | None
    estado: str | None
    codigo_infraccion_axis: str | None
    contravencion: str | None
    tipo_acta: str | None
    articulo_original: str | None
    monto_capital_original: float | None
    observacion: str | None

    model_config = {"from_attributes": True}


class ImpugnacionListResponse(BaseModel):
    items: list[ImpugnacionItem]
    total: int
    page: int
    page_size: int


class AuditLogItem(BaseModel):
    id: int
    occurred_at: datetime
    user_id: int | None
    user_email: str
    action: str
    ip_address: str | None
    details: dict | None

    model_config = {"from_attributes": True}


class AuditLogListResponse(BaseModel):
    items: list[AuditLogItem]
    total: int
    page: int
    page_size: int


class InfraccionItem(BaseModel):
    id: int
    registro: str | None
    fecha_registro: datetime | None
    fecha_emision: datetime | None
    fecha_aprobacion: datetime | None
    fecha_vencimiento: datetime | None
    estado: str | None
    codigo_infraccion: str | None
    codigo_infraccion_ant: str | None
    contravencion: str | None
    articulo: str | None
    literal: str | None
    descripcion_articulo: str | None
    periodo_fiscal: str | None
    oficina: str | None
    origen_registro: str | None
    tipo_registro_infraccion: str | None
    tipo_emision: str | None
    tipo_deudor: str | None
    codigo_usuario_registra: str | None
    observacion: str | None
    provincia: str | None
    localidad: str | None
    lugar_infraccion: str | None
    canal: str | None
    placa: str | None
    tipo_identificacion_infractor: str | None
    numero_identificacion_infractor: str | None
    nombre_infractor: str | None
    tipo_identificacion_propietario: str | None
    numero_identificacion_propietario: str | None
    nombre_propietario: str | None
    indicador_bloqueada: str | None
    indicador_acta_juzgamiento: str | None
    indicador_modificada: str | None
    indicador_calcula_recargo: str | None
    valor_capital: float | None
    valor_capital_exonerado: float | None
    valor_recargo: float | None
    valor_recargo_exonerado: float | None
    valor_intereses: float | None
    valor_total: float | None

    model_config = {"from_attributes": True}


class InfraccionListResponse(BaseModel):
    items: list[InfraccionItem]
    total: int
    page: int
    page_size: int


class JuicioItem(BaseModel):
    id: int
    registro: str | None
    hora_generacion: time | None
    codigo: str | None
    tipo_identificacion: str | None
    identificacion: str | None
    nombre_completo: str | None
    gestor_responsable: str | None
    gestor_secretario: str | None
    gestor_anulacion: str | None
    gestor_suspension: str | None
    gestor_reactivacion: str | None
    motivo_anulacion: str | None
    fecha_generacion: date | None
    fecha_registro: date | None
    fecha_inicio_juicio: date | None
    fecha_notificacion: date | None
    fecha_pago: date | None
    fecha_fin: date | None
    fecha_anulacion: date | None
    fecha_suspension: date | None
    fecha_reactivacion: date | None
    valor_capital: float | None
    valor_interes: float | None
    valor_multas: float | None
    valor_costas: float | None
    valor_total: float | None

    model_config = {"from_attributes": True}


class JuicioListResponse(BaseModel):
    items: list[JuicioItem]
    total: int
    page: int
    page_size: int


class ResumenTablaItem(BaseModel):
    tabla: str
    etiqueta: str
    total: int


class DashboardResumenResponse(BaseModel):
    tablas: list[ResumenTablaItem]


class PagoItem(BaseModel):
    id: int
    registro: str | None
    hora_generacion: time | None
    tipo_recaudador: str | None
    recaudador: str | None
    comprobante_pago_interno: str | None
    comprobante_pago_recaudador: str | None
    tipo_servicio: str | None
    tipo_documento: str | None
    numero_documento: str | None
    fecha_generacion: date | None
    fecha_operacion: datetime | None
    fecha_transaccion: datetime | None
    monto_recaudado: float | None
    monto_cuenta_1: float | None
    monto_cuenta_2: float | None

    model_config = {"from_attributes": True}


class PagoListResponse(BaseModel):
    items: list[PagoItem]
    total: int
    page: int
    page_size: int
