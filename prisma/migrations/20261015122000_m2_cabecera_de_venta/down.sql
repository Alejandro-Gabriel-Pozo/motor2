-- Reversa de 20261015122000_m2_cabecera_de_venta. DESTRUCTIVA si ya hay cabeceras: se pierden el canal, la cuenta y el total copiado de cada venta (las líneas `Operacion` y el Kardex no se tocan; `Operacion.ventaId` se borra).
-- Antes de bajar, contar: `SELECT count(*) FROM "Venta"` y `SELECT count(*) FROM "Operacion" WHERE "ventaId" IS NOT NULL`.
-- Recomendación: bajar M2 solo ANTES de desplegar la Etapa C (con la tabla vacía no se pierde nada).
-- Bajar ANTES M2-4 (20261015123000_m2_rls_sucursal_venta): sus políticas viven sobre esta tabla (aunque `DROP TABLE` también las borra, la reversa de M2-4 es la que las saca de forma ordenada).
-- Orden de la reversa del Paquete 2: M2-4, esta (M2-3), M2-2 y M2-1 al final. Y la reversa de B1 (funciones de alcance) va DESPUÉS de M2-4.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261015122000_m2_cabecera_de_venta`. Idempotente (IF EXISTS).

ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_venta_solo_en_ventas_chk";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_empresaId_ventaId_fkey";
DROP INDEX IF EXISTS "Operacion_ventaId_idx";
ALTER TABLE "Operacion" DROP COLUMN IF EXISTS "ventaId";

DROP TABLE IF EXISTS "Venta";
DROP TYPE IF EXISTS "CanalDeVenta";
