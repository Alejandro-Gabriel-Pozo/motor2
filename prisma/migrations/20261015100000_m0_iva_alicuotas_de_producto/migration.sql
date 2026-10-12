-- M0-IVA (Paquete 2, fase EXPANDIR; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Alícuotas de IVA del producto: `alicuotaIvaVenta` (la del plato o producto que se vende) y `alicuotaIvaCompra` (la que trae la factura del proveedor). Es un código semántico
-- (no el porcentaje ni el código de ARCA: eso lo traduce el adaptador fiscal), de lista cerrada en la base (TEXT + CHECK, como `Invitacion_rol_check`): ampliar la lista es ampliar el CHECK.
-- NULL significa «sin declarar»: ninguna fila existente recibe un valor deducido (sin default y sin backfill). No hay CHECK de obligatoriedad, ni siquiera NOT VALID, porque
-- Postgres también lo evalúa al actualizar una fila vieja y rompería la edición de productos de hoy; la obligatoriedad va en una fase CONTRAER posterior.
-- ADITIVA: el código anterior no lee ni escribe estas columnas (sus `data` son explícitos). Sin políticas de RLS nuevas ni GRANT nuevo: `motor2_app` ya tiene los privilegios de TABLA sobre
-- `Producto`, que cubren las columnas nuevas.
-- ADD COLUMN sin default solo toca el catálogo; validar el CHECK recorre las filas de `Producto` (todas en NULL). Aplicar sin tráfico y con `lock_timeout` corto.
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261015100000_m0_iva_alicuotas_de_producto`).

ALTER TABLE "Producto" ADD COLUMN "alicuotaIvaVenta" TEXT, ADD COLUMN "alicuotaIvaCompra" TEXT;

ALTER TABLE "Producto" ADD CONSTRAINT "Producto_alicuotaIvaVenta_check"
  CHECK ("alicuotaIvaVenta" IS NULL OR "alicuotaIvaVenta" IN ('IVA_0', 'IVA_2_5', 'IVA_5', 'IVA_10_5', 'IVA_21', 'IVA_27', 'EXENTO', 'NO_GRAVADO'));
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_alicuotaIvaCompra_check"
  CHECK ("alicuotaIvaCompra" IS NULL OR "alicuotaIvaCompra" IN ('IVA_0', 'IVA_2_5', 'IVA_5', 'IVA_10_5', 'IVA_21', 'IVA_27', 'EXENTO', 'NO_GRAVADO'));
