-- M1 (Paquete 2, C20): clasificación del proveedor. REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR a una base real (Neon): la corre el dueño, por paquete (docs/deploy-con-migraciones.md).
--
-- QUÉ HACE: suma dos columnas a "Proveedor": "ofreceProductos" (default true) y "ofreceServicios" (default false), y un CHECK que exige que al menos una sea verdadera
-- (productos, servicios o ambos; «ninguno» es imposible, también con dos ediciones concurrentes: el CHECK se evalúa sobre la fila ya combinada).
--
-- ES ADITIVA: el código anterior no conoce las columnas y su INSERT toma el default, así que sigue andando con la base nueva (y un Instant Rollback del deploy es seguro).
-- NO HAY BACKFILL APARTE: el DEFAULT constante deja cada proveedor existente como «productos» (decisión del dueño, 2026-10-06: nacen como productos sin reinterpretarse).
-- Quien sea de servicios se reclasifica después desde la pantalla, no con una migración.
--
-- BLOQUEO: en Postgres 17 un ADD COLUMN con default constante no reescribe la tabla (el ACCESS EXCLUSIVE dura un instante). El CHECK se agrega NOT VALID y se valida en
-- el mismo script (recorre una tabla chica). Idempotente (IF NOT EXISTS / DROP IF EXISTS); la reversa está en down.sql.
--
-- NO CREA TABLAS NI POLÍTICAS: "Proveedor" ya tiene RLS por empresa y los permisos de motor2_app son por tabla, así que las columnas nuevas quedan cubiertas.

ALTER TABLE "Proveedor" ADD COLUMN IF NOT EXISTS "ofreceProductos" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Proveedor" ADD COLUMN IF NOT EXISTS "ofreceServicios" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Proveedor" DROP CONSTRAINT IF EXISTS "Proveedor_ofrece_productos_o_servicios_chk";
ALTER TABLE "Proveedor" ADD CONSTRAINT "Proveedor_ofrece_productos_o_servicios_chk" CHECK ("ofreceProductos" OR "ofreceServicios") NOT VALID;
ALTER TABLE "Proveedor" VALIDATE CONSTRAINT "Proveedor_ofrece_productos_o_servicios_chk";
