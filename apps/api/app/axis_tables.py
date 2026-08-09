from sqlalchemy import BigInteger, Column, DateTime, MetaData, Numeric, Table, Text

axis_metadata = MetaData(schema="axis")

axis_impugnaciones = Table(
    "axis_impugnaciones",
    axis_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("registro", Text),
    Column("fecha_registro", DateTime),
    Column("fecha_acta", DateTime),
    Column("estado", Text),
    Column("codigo_infraccion_axis", Text),
    Column("contravencion", Text),
    Column("tipo_acta", Text),
    Column("articulo_original", Text),
    Column("monto_capital_original", Numeric(14, 2)),
    Column("observacion", Text),
)
