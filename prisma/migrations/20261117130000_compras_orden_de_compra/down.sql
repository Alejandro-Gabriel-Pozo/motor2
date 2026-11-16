-- Reversa de 20261117130000_compras_orden_de_compra (Compras, etapa OC). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `prisma migrate resolve --rolled-back 20261117130000_compras_orden_de_compra`.
-- Orden: bajar ANTES 20261117130200_compras_permisos_orden_de_compra y 20261117130100_rls_sucursal_vinculo_de_renglon_con_orden. Antes de bajar: volver el código y apagar el módulo `ordenes_de_compra`.
-- ABORTA, sin tocar nada, si hay filas en cualquiera de las cinco tablas (se perderían órdenes, saldos, vínculos o la configuración del control; la auditoría no guarda su detalle). Con las tablas vacías el estado resultante es el de antes. Idempotente.
DO $$
DECLARE
  ordenes bigint := 0;
  lineas bigint := 0;
  saldos bigint := 0;
  vinculos bigint := 0;
  niveles bigint := 0;
BEGIN
  IF to_regclass('public."OrdenDeCompra"') IS NOT NULL THEN SELECT count(*) INTO ordenes FROM public."OrdenDeCompra"; END IF;
  IF to_regclass('public."LineaDeOrdenDeCompra"') IS NOT NULL THEN SELECT count(*) INTO lineas FROM public."LineaDeOrdenDeCompra"; END IF;
  IF to_regclass('public."SaldoDeLineaDeOrden"') IS NOT NULL THEN SELECT count(*) INTO saldos FROM public."SaldoDeLineaDeOrden"; END IF;
  IF to_regclass('public."VinculoDeRenglonConOrden"') IS NOT NULL THEN SELECT count(*) INTO vinculos FROM public."VinculoDeRenglonConOrden"; END IF;
  IF to_regclass('public."NivelDeControl"') IS NOT NULL THEN SELECT count(*) INTO niveles FROM public."NivelDeControl"; END IF;
  IF ordenes + lineas + saldos + vinculos + niveles > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117130000_compras_orden_de_compra: hay % orden(es), % línea(s), % saldo(s), % vínculo(s) y % nivel(es) de control registrados', ordenes, lineas, saldos, vinculos, niveles;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS "FacturaProveedor_devuelve_a_la_orden" ON "FacturaProveedor";
DROP TRIGGER IF EXISTS "FacturaProveedorSucursal_suma_a_la_orden" ON "FacturaProveedorSucursal";
DROP TABLE IF EXISTS "VinculoDeRenglonConOrden";
DROP TABLE IF EXISTS "SaldoDeLineaDeOrden";
DROP TABLE IF EXISTS "LineaDeOrdenDeCompra";
DROP TABLE IF EXISTS "OrdenDeCompra";
DROP TABLE IF EXISTS "NivelDeControl";
DROP FUNCTION IF EXISTS compras_factura_anulada_devuelve_a_la_orden();
DROP FUNCTION IF EXISTS compras_recepcion_confirmada_suma_a_la_orden();
DROP FUNCTION IF EXISTS compras_vinculo_de_orden_valida();
DROP FUNCTION IF EXISTS compras_saldo_de_orden_solo_por_disparadores();
DROP FUNCTION IF EXISTS compras_linea_de_orden_valida();
DROP FUNCTION IF EXISTS compras_orden_abre_saldos();
DROP FUNCTION IF EXISTS compras_orden_cambia();
