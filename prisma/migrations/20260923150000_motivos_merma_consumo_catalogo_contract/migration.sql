-- CONTRACT (2 de 2, plan "motivos de Consumo/Merma como catálogo administrable", 2026-09-23, P8) — cierra la ventana
-- de convivencia abierta por la migración EXPAND (20260923143350_motivos_merma_consumo_catalogo, P3). Desde P5,
-- registrarMovimiento solo escribe motivoId/destinoId — motivo/destino (las columnas del enum viejo) quedaron de
-- solo lectura como fallback de perdidas.ts (P4). Este es el corte: ya no hace falta ninguna de las dos cosas.

-- 1) Repetir el backfill (idempotente, WHERE motivoId IS NULL — igual que en la migración expand) por si algo quedó
-- escrito en motivo/destino en la ventana entre P3 y el deploy de P5: después de este paso ya no hay ninguna otra
-- oportunidad de recuperarlo, las columnas se dropean a continuación.
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

-- 2) Dropear las columnas legacy y sus enums — ya nadie las lee (perdidas.ts prioriza motivo/destino, la relación vía
-- FK, desde P4; el fallback al enum era transitorio) y el backfill de arriba cerró cualquier hueco.
ALTER TABLE "Operacion" DROP COLUMN "motivo";
ALTER TABLE "Operacion" DROP COLUMN "destino";
DROP TYPE "MotivoMermaLegacy";
DROP TYPE "DestinoConsumoLegacy";
