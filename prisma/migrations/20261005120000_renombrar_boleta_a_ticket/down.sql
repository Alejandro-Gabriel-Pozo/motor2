-- Reversa de la migración 20261005120000_renombrar_boleta_a_ticket. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas (DIRECT_URL),
-- con `scripts/operaciones/con-env.mjs <archivo-env> -- ...`, y se marca con `prisma migrate resolve --rolled-back 20261005120000_renombrar_boleta_a_ticket`.
-- Esto solo vuelve el esquema y las claves. El rollback del DEPLOY (código viejo + base vieja) previsto es la copia de Neon tomada justo antes de
-- aplicar la migración, no esta reversa.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('reporte_boletas', 'Ver el reporte «Boletas emitidas»'),
  ('pos_emitir_boleta_corregida', 'Emitir la boleta corregida de una cuenta ya cerrada (POS)')
ON CONFLICT ("clave") DO NOTHING;

DELETE FROM "PermisoRol" v
USING (VALUES ('reporte_tickets', 'reporte_boletas'), ('pos_emitir_ticket_corregido', 'pos_emitir_boleta_corregida')) AS m("nueva", "vieja")
WHERE v."accionClave" = m."nueva"
  AND EXISTS (SELECT 1 FROM "PermisoRol" n WHERE n."rolId" = v."rolId" AND n."accionClave" = m."vieja");

DELETE FROM "CapacidadSucursal" v
USING (VALUES ('reporte_tickets', 'reporte_boletas'), ('pos_emitir_ticket_corregido', 'pos_emitir_boleta_corregida')) AS m("nueva", "vieja")
WHERE v."accionClave" = m."nueva"
  AND EXISTS (SELECT 1 FROM "CapacidadSucursal" n WHERE n."accionClave" = m."vieja" AND n."sucursalId" IS NOT DISTINCT FROM v."sucursalId");

UPDATE "PermisoRol" SET "accionClave" = 'reporte_boletas' WHERE "accionClave" = 'reporte_tickets';
UPDATE "PermisoRol" SET "accionClave" = 'pos_emitir_boleta_corregida' WHERE "accionClave" = 'pos_emitir_ticket_corregido';
UPDATE "CapacidadSucursal" SET "accionClave" = 'reporte_boletas' WHERE "accionClave" = 'reporte_tickets';
UPDATE "CapacidadSucursal" SET "accionClave" = 'pos_emitir_boleta_corregida' WHERE "accionClave" = 'pos_emitir_ticket_corregido';

DELETE FROM "Accion" WHERE "clave" IN ('reporte_tickets', 'pos_emitir_ticket_corregido');

DO $$
BEGIN
  IF to_regclass('public."EjemplarTicket"') IS NOT NULL AND to_regclass('public."EjemplarBoleta"') IS NULL THEN
    ALTER TABLE "EjemplarTicket" RENAME TO "EjemplarBoleta";

    ALTER TABLE "EjemplarBoleta" RENAME CONSTRAINT "EjemplarTicket_pkey" TO "EjemplarBoleta_pkey";
    ALTER TABLE "EjemplarBoleta" RENAME CONSTRAINT "EjemplarTicket_emitidoPorId_fkey" TO "EjemplarBoleta_emitidoPorId_fkey";
    ALTER TABLE "EjemplarBoleta" RENAME CONSTRAINT "EjemplarTicket_empresaId_corrigeAId_fkey" TO "EjemplarBoleta_empresaId_corrigeAId_fkey";
    ALTER TABLE "EjemplarBoleta" RENAME CONSTRAINT "EjemplarTicket_empresaId_cuentaId_fkey" TO "EjemplarBoleta_empresaId_cuentaId_fkey";
    ALTER TABLE "EjemplarBoleta" RENAME CONSTRAINT "EjemplarTicket_empresaId_fkey" TO "EjemplarBoleta_empresaId_fkey";
    ALTER TABLE "EjemplarBoleta" RENAME CONSTRAINT "EjemplarTicket_empresaId_sucursalId_fkey" TO "EjemplarBoleta_empresaId_sucursalId_fkey";

    ALTER INDEX "EjemplarTicket_corrigeAId_idx" RENAME TO "EjemplarBoleta_corrigeAId_idx";
    ALTER INDEX "EjemplarTicket_cuentaId_ejemplar_key" RENAME TO "EjemplarBoleta_cuentaId_ejemplar_key";
    ALTER INDEX "EjemplarTicket_empresaId_id_key" RENAME TO "EjemplarBoleta_empresaId_id_key";
    ALTER INDEX "EjemplarTicket_sucursalId_numero_ejemplar_key" RENAME TO "EjemplarBoleta_sucursalId_numero_ejemplar_key";
  END IF;
END $$;
