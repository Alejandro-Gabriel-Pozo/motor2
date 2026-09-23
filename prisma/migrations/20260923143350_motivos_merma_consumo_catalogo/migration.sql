-- EXPAND (1 de 2, plan "motivos de Consumo/Merma como catálogo administrable", 2026-09-23, P3). NO tocar la columna
-- Operacion.motivo/destino: siguen intactas (renombradas en Prisma a motivoLegacy/destinoLegacy vía @map, pero la
-- columna real de la base no cambia de nombre acá). El corte real (borrar lo viejo) es la migración CONTRACT (P8),
-- aparte, con su propia autorización — hasta entonces conviven las dos columnas.

-- 1) Renombrar los enums viejos — instantáneo (ALTER TYPE), preserva intactos los valores ya guardados en
-- Operacion.motivo/destino. Prisma no distingue un rename de enum de un drop+create al diffear el schema (lo probé:
-- generaba DROP COLUMN + ADD COLUMN, pérdida de datos) — por eso esta migración se escribió a mano.
ALTER TYPE "MotivoMerma" RENAME TO "MotivoMermaLegacy";
ALTER TYPE "DestinoConsumo" RENAME TO "DestinoConsumoLegacy";

-- 2) Las tablas nuevas — catálogo administrable, mismo patrón que CategoriaProducto/Insumo/Grupo.
CREATE TABLE "MotivoMerma" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MotivoMerma_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MotivoMerma_nombre_key" ON "MotivoMerma"("nombre");

CREATE TABLE "DestinoConsumo" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DestinoConsumo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DestinoConsumo_nombre_key" ON "DestinoConsumo"("nombre");

-- 3) Semilla — EXACTAMENTE los labels de hoy (src/core/movimientos/motivos-semilla.ts es la fuente única; este INSERT
-- tiene que coincidir con ella, verificado por test/movimientos/migracion-motivos-catalogo.test.ts). La descripción de
-- "Devolución de cliente (no revendible)" traslada la nota de negocio de BUGFIX A-3 que vivía en el docstring del enum
-- viejo. ON CONFLICT DO NOTHING: si esta migración se corre dos veces, no duplica.
INSERT INTO "MotivoMerma" ("id", "nombre", "descripcion", "activo") VALUES
  (gen_random_uuid()::text, 'Vencido', NULL, true),
  (gen_random_uuid()::text, 'Roto o caído', NULL, true),
  (gen_random_uuid()::text, 'Mal preparado / quemado', NULL, true),
  (gen_random_uuid()::text, 'Devolución de cliente (no revendible)', 'Devuelto por el cliente pero NO revendible: descuenta stock de verdad. Si la mercadería vuelve en condiciones de revenderse, va por el proceso «Devolución de cliente (revendible)», que SUMA stock — nunca por este motivo.', true),
  (gen_random_uuid()::text, 'Robo o faltante', NULL, true),
  (gen_random_uuid()::text, 'Otro', NULL, true)
ON CONFLICT ("nombre") DO NOTHING;

INSERT INTO "DestinoConsumo" ("id", "nombre", "descripcion", "activo") VALUES
  (gen_random_uuid()::text, 'Personal', NULL, true),
  (gen_random_uuid()::text, 'Degustación / cortesía', NULL, true),
  (gen_random_uuid()::text, 'Evento', NULL, true),
  (gen_random_uuid()::text, 'Elaboración interna', NULL, true),
  (gen_random_uuid()::text, 'Otro', NULL, true)
ON CONFLICT ("nombre") DO NOTHING;

-- 4) La FK nueva en Operacion. ON DELETE RESTRICT (no SET NULL, que es lo que genera Prisma por defecto para una
-- relación opcional): refuerza "nunca DELETE" — ni siquiera a nivel de base se puede borrar un motivo/destino que
-- ya esté referenciado por una Operacion, solo desactivarlo.
ALTER TABLE "Operacion" ADD COLUMN "motivoId" TEXT;
ALTER TABLE "Operacion" ADD COLUMN "destinoId" TEXT;
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_motivoId_fkey" FOREIGN KEY ("motivoId") REFERENCES "MotivoMerma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "DestinoConsumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) Backfill — cada Operacion con un motivo/destino del enum viejo pasa a apuntar también a la fila nueva
-- equivalente (src/core/movimientos/motivos-semilla.ts::EQUIVALENCIA_*_LEGACY es la fuente de esta correspondencia;
-- este UPDATE tiene que coincidir con ella). `WHERE ... IS NULL` lo deja seguro de re-correr: una segunda pasada no
-- pisa lo que ya se backfilleó (y la migración CONTRACT, P8, repite este mismo backfill por si quedó algo escrito
-- en la ventana entre esta migración y el deploy del código que ya escribe motivoId/destinoId, P5).
UPDATE "Operacion" o
SET "motivoId" = m."id"
FROM (VALUES
  ('VENCIDO', 'Vencido'),
  ('ROTO_O_CAIDO', 'Roto o caído'),
  ('MAL_PREPARADO_O_QUEMADO', 'Mal preparado / quemado'),
  ('DEVOLUCION_CLIENTE_NO_REVENDIBLE', 'Devolución de cliente (no revendible)'),
  ('ROBO_O_FALTANTE', 'Robo o faltante'),
  ('OTRO', 'Otro')
) AS eq(legacy, nombre)
JOIN "MotivoMerma" m ON m."nombre" = eq.nombre
WHERE o."motivo"::text = eq.legacy AND o."motivoId" IS NULL;

UPDATE "Operacion" o
SET "destinoId" = d."id"
FROM (VALUES
  ('PERSONAL', 'Personal'),
  ('DEGUSTACION_CORTESIA', 'Degustación / cortesía'),
  ('EVENTO', 'Evento'),
  ('ELABORACION_INTERNA', 'Elaboración interna'),
  ('OTRO', 'Otro')
) AS eq(legacy, nombre)
JOIN "DestinoConsumo" d ON d."nombre" = eq.nombre
WHERE o."destino"::text = eq.legacy AND o."destinoId" IS NULL;
