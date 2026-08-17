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
    fecha_registro: date | None
    fecha_acta: date | None
    estado: str | None
    codigo_infraccion_axis: str | None
    contravencion: str | None
    tipo_acta: str | None
    articulo_original: str | None
    monto_capital_original: float | None
    observacion: str | None
    hora_generacion: time | None
    fecha_generacion: date | None
    numero_credito: str | None
    numero_tramite: str | None
    codigo_infraccion_generada_axis: str | None
    juzgado: str | None
    codigo_provincia: str | None
    codigo_localidad: str | None
    numero_proceso: str | None
    monto_modificado_sentencia: float | None
    puntos_original: str | None
    puntos_modificados_sentencia: str | None
    literal_original: str | None
    articulo_modificado_sentencia: str | None
    literal_modificado_sentencia: str | None
    fecha_vencimiento_original: date | None
    fecha_vencimiento_modificado_sentencia: date | None
    sancion_original: str | None
    sancion_modificada_sentencia: str | None
    codigo_usuario: str | None
    codigo_usuario_aprueba: str | None
    numero_acta_juzgamiento: str | None
    fecha_aprobacion: date | None
    fecha_anulacion: date | None
    codigo_usuario_anula: str | None
    observacion_anulacion: str | None
    articulo_original_catalogo_item_id: int | None
    articulo_modificado_sentencia_catalogo_item_id: int | None
    codigo_localidad_catalogo_item_id: int | None
    codigo_provincia_catalogo_item_id: int | None
    tipo_acta_catalogo_item_id: int | None

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
    fecha_registro: date | None
    fecha_emision: date | None
    fecha_aprobacion: date | None
    fecha_vencimiento: date | None
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
    hora_generacion: time | None
    fecha_generacion: date | None
    tipo_infraccion: str | None
    codigo_usuario_aprueba: str | None
    codigo_usuario_notifica: str | None
    tipo_licencia: str | None
    zona: str | None
    distrito: str | None
    circuito: str | None
    dispositivo: str | None
    geo_referencia_x: str | None
    geo_referencia_y: str | None
    tipo_identificacion_agente: str | None
    numero_identificacion_agente: str | None
    nombre_agente: str | None
    codigo_agente_transito: str | None
    tipo_infraccion_2: str | None
    codigo_infraccion_origen: str | None
    codigo_empresa_convenio: str | None
    porcentaje_principal: str | None
    porcentaje_convenio: str | None
    cuenta_bancaria_principal: str | None
    cuenta_bancaria_convenio: str | None
    fecha_notificacion: date | None
    fecha_pago: date | None
    fecha_impugnacion: date | None
    fecha_convenio: date | None
    fecha_anulacion: date | None
    fecha_coactiva: date | None
    canal_catalogo_item_id: int | None
    estado_catalogo_item_id: int | None
    localidad_catalogo_item_id: int | None
    origen_registro_catalogo_item_id: int | None
    provincia_catalogo_item_id: int | None
    tipo_deudor_catalogo_item_id: int | None
    tipo_emision_catalogo_item_id: int | None
    tipo_identificacion_agente_catalogo_item_id: int | None
    tipo_identificacion_infractor_catalogo_item_id: int | None
    tipo_identificacion_propietario_catalogo_item_id: int | None
    tipo_licencia_catalogo_item_id: int | None
    tipo_registro_infraccion_catalogo_item_id: int | None
    zona_catalogo_item_id: int | None

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
    tipo_identificacion_catalogo_item_id: int | None

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
    fecha_operacion: date | None
    fecha_transaccion: date | None
    monto_recaudado: float | None
    monto_cuenta_1: float | None
    monto_cuenta_2: float | None
    tipo_documento_catalogo_item_id: int | None
    tipo_recaudador_catalogo_item_id: int | None
    tipo_servicio_catalogo_item_id: int | None

    model_config = {"from_attributes": True}


class PagoListResponse(BaseModel):
    items: list[PagoItem]
    total: int
    page: int
    page_size: int


class TituloItem(BaseModel):
    id: int
    registro: str | None
    hora_generacion: time | None
    codigo_titulo_credito: str | None
    tipo_identificacion: str | None
    identificacion: str | None
    nombre_completo: str | None
    etapa_cobranza: str | None
    estado: str | None
    codigo_referencia: str | None
    concepto: str | None
    nombre_elabora_titulo: str | None
    nombre_solicita: str | None
    nombre_aprobacion: str | None
    motivo_anulacion: str | None
    fecha_generacion: date | None
    fecha_registro: date | None
    fecha_elaboracion: date | None
    fecha_solicitud: date | None
    fecha_aprobacion: date | None
    fecha_notificacion: date | None
    fecha_pago: date | None
    fecha_anulacion: date | None
    valor: float | None
    multas: float | None
    interes: float | None
    valor_total: float | None
    estado_catalogo_item_id: int | None
    etapa_cobranza_catalogo_item_id: int | None
    tipo_identificacion_catalogo_item_id: int | None

    model_config = {"from_attributes": True}


class TituloListResponse(BaseModel):
    items: list[TituloItem]
    total: int
    page: int
    page_size: int


class ModificacionInfraccionItem(BaseModel):
    id: int
    registro: str | None
    hora_generacion: time | None
    codigo_infraccion_original: str | None
    contravencion: str | None
    observacion: str | None
    codigo_infraccion_acta: str | None
    codigo_usuario_modifica: str | None
    numero_credito: str | None
    fecha_generacion: date | None
    fecha_registro: date | None

    model_config = {"from_attributes": True}


class ModificacionInfraccionListResponse(BaseModel):
    items: list[ModificacionInfraccionItem]
    total: int
    page: int
    page_size: int


class CrvItem(BaseModel):
    id: int
    registro: str | None
    hora_generacion: time | None
    codigo_orden_crv: str | None
    codigo_actividad: str | None
    codigo_oficina: str | None
    descripcion_oficina: str | None
    placa: str | None
    nombre_agente: str | None
    identificacion_agente: str | None
    motivo_ingreso_crv: str | None
    clase: str | None
    provincia: str | None
    localidad_ciudad: str | None
    ciudadela: str | None
    area: str | None
    direccion: str | None
    remolque: str | None
    km_remolque: str | None
    valor_remolque: str | None
    fecha_generacion: date | None
    fecha_ingreso: date | None
    fecha_salida: date | None
    localidad_ciudad_catalogo_item_id: int | None
    provincia_catalogo_item_id: int | None

    model_config = {"from_attributes": True}


class CrvListResponse(BaseModel):
    items: list[CrvItem]
    total: int
    page: int
    page_size: int


class LibretinItem(BaseModel):
    id: int
    registro: str | None
    hora_generacion: time | None
    codigo_libretin: str | None
    prefijo_boleta: str | None
    rango_inicio_boleta: str | None
    rango_fin_boleta: str | None
    cantidad_boletas: str | None
    longitud_boleta: str | None
    estado: str | None
    codigo_tramite: str | None
    codigo_usuario_creacion: str | None
    codigo_tramite_asignacion: str | None
    codigo_usuario_asignacion: str | None
    codigo_usuario_inactiva: str | None
    observacion: str | None
    codigo_agente: str | None
    identificacion_agente: str | None
    agente: str | None
    codigo_distrito: str | None
    descripcion_distrito: str | None
    codigo_oficina: str | None
    descripcion_oficina: str | None
    codigo_provincia: str | None
    descripcion_provincia: str | None
    codigo_localidad: str | None
    descripcion_localidad: str | None
    tipo: str | None
    origen_tramite: str | None
    motivo_baja: str | None
    disponibles: str | None
    utilizadas: str | None
    desactivadas: str | None
    fecha_generacion: date | None
    fecha_registro: date | None
    fecha_asignacion: date | None
    fecha_inactivacion: date | None
    codigo_localidad_catalogo_item_id: int | None
    codigo_provincia_catalogo_item_id: int | None
    estado_catalogo_item_id: int | None
    tipo_catalogo_item_id: int | None

    model_config = {"from_attributes": True}


class LibretinListResponse(BaseModel):
    items: list[LibretinItem]
    total: int
    page: int
    page_size: int
