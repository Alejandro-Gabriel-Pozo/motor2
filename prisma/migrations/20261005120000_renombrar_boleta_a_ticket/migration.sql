-- Renombre «boleta» → «ticket»: la tabla `EjemplarBoleta` pasa a `EjemplarTicket` y dos claves de acción pasan a llamarse con «ticket».
-- NO es aditiva: el código viejo no funciona con la tabla renombrada. Por eso NO se aplica por adelantado: va en el MISMO deploy que el código nuevo
-- (build con `npm run migrar:aprobar`), base por base y fuera de hora pico, con una copia de Neon justo antes. Reversa: la copia de Neon
-- (no el Instant Rollback de Vercel). El motivo del renombre: el ejemplar es un comprobante interno SIN validez fiscal; la factura de ARCA se
-- vinculará a él, así que «ticket» y «factura» tienen que quedar separados.
--
-- 1) Tabla, clave primaria, claves foráneas e índices, con los nombres que Prisma espera para `EjemplarTicket` (el `migrate diff` contra el schema
--    tiene que dar vacío). El RLS viaja con la tabla (la política y el `ENABLE ROW LEVEL SECURITY` pertenecen a la tabla, no al nombre).
-- 2) Las claves de acción `reporte_boletas` y `pos_emitir_boleta_corregida` → `reporte_tickets` y `pos_emitir_ticket_corregido`, en las tres tablas que
--    las guardan como dato: `Accion`, `PermisoRol` y `CapacidadSucursal`. Las filas de permisos se MUEVEN (UPDATE), no se copian: conservan su `id`,
--    que es lo que las filas viejas de `AuditoriaRegistro` tienen como `entidadId`. La auditoría NO se reescribe: la pantalla muestra las claves viejas
--    con la vigente (`descripcionParaMostrar`).
-- Idempotente: se puede correr sobre una base donde ya estuviera hecho (no falla ni duplica).

DO $$
BEGIN
  IF to_regclass('public."EjemplarBoleta"') IS NOT NULL AND to_regclass('public."EjemplarTicket"') IS NULL THEN
    ALTER TABLE "EjemplarBoleta" RENAME TO "EjemplarTicket";

    ALTER TABLE "EjemplarTicket" RENAME CONSTRAINT "EjemplarBoleta_pkey" TO "EjemplarTicket_pkey";
    ALTER TABLE "EjemplarTicket" RENAME CONSTRAINT "EjemplarBoleta_emitidoPorId_fkey" TO "EjemplarTicket_emitidoPorId_fkey";
    ALTER TABLE "EjemplarTicket" RENAME CONSTRAINT "EjemplarBoleta_empresaId_corrigeAId_fkey" TO "EjemplarTicket_empresaId_corrigeAId_fkey";
    ALTER TABLE "EjemplarTicket" RENAME CONSTRAINT "EjemplarBoleta_empresaId_cuentaId_fkey" TO "EjemplarTicket_empresaId_cuentaId_fkey";
    ALTER TABLE "EjemplarTicket" RENAME CONSTRAINT "EjemplarBoleta_empresaId_fkey" TO "EjemplarTicket_empresaId_fkey";
    ALTER TABLE "EjemplarTicket" RENAME CONSTRAINT "EjemplarBoleta_empresaId_sucursalId_fkey" TO "EjemplarTicket_empresaId_sucursalId_fkey";

    ALTER INDEX "EjemplarBoleta_corrigeAId_idx" RENAME TO "EjemplarTicket_corrigeAId_idx";
    ALTER INDEX "EjemplarBoleta_cuentaId_ejemplar_key" RENAME TO "EjemplarTicket_cuentaId_ejemplar_key";
    ALTER INDEX "EjemplarBoleta_empresaId_id_key" RENAME TO "EjemplarTicket_empresaId_id_key";
    ALTER INDEX "EjemplarBoleta_sucursalId_numero_ejemplar_key" RENAME TO "EjemplarTicket_sucursalId_numero_ejemplar_key";
  END IF;
END $$;

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('reporte_tickets', 'Ver el reporte «Tickets emitidos»'),
  ('pos_emitir_ticket_corregido', 'Emitir el ticket corregido de una cuenta ya cerrada (POS)')
ON CONFLICT ("clave") DO NOTHING;

-- Si ya hubiera una fila con la clave nueva para el mismo rol / la misma sucursal, la vieja sobra (el UPDATE chocaría con el único).
DELETE FROM "PermisoRol" v
USING (VALUES ('reporte_boletas', 'reporte_tickets'), ('pos_emitir_boleta_corregida', 'pos_emitir_ticket_corregido')) AS m("vieja", "nueva")
WHERE v."accionClave" = m."vieja"
  AND EXISTS (SELECT 1 FROM "PermisoRol" n WHERE n."rolId" = v."rolId" AND n."accionClave" = m."nueva");

DELETE FROM "CapacidadSucursal" v
USING (VALUES ('reporte_boletas', 'reporte_tickets'), ('pos_emitir_boleta_corregida', 'pos_emitir_ticket_corregido')) AS m("vieja", "nueva")
WHERE v."accionClave" = m."vieja"
  AND EXISTS (SELECT 1 FROM "CapacidadSucursal" n WHERE n."accionClave" = m."nueva" AND n."sucursalId" IS NOT DISTINCT FROM v."sucursalId");

UPDATE "PermisoRol" SET "accionClave" = 'reporte_tickets' WHERE "accionClave" = 'reporte_boletas';
UPDATE "PermisoRol" SET "accionClave" = 'pos_emitir_ticket_corregido' WHERE "accionClave" = 'pos_emitir_boleta_corregida';
UPDATE "CapacidadSucursal" SET "accionClave" = 'reporte_tickets' WHERE "accionClave" = 'reporte_boletas';
UPDATE "CapacidadSucursal" SET "accionClave" = 'pos_emitir_ticket_corregido' WHERE "accionClave" = 'pos_emitir_boleta_corregida';

DELETE FROM "Accion" WHERE "clave" IN ('reporte_boletas', 'pos_emitir_boleta_corregida');
