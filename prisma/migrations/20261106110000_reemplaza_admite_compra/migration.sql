-- Corrección de compras por ejemplar, etapa C0 (docs/diseno-correccion-de-compras-2026-11-06.md §6; AUTORIZADA por el dueño el 2026-11-06 para su ensayo local; aplicar en cada base real REQUIERE autorización
-- expresa, base por base, con respaldo y ensayo en una rama de Neon).
--
-- POR QUÉ: una compra corregida es un ejemplar nuevo que reemplaza a la original (`reemplazaAOperacionId`, que la migración M2 creó solo para VENTAS). Acá el CHECK se AMPLÍA: el reemplazo es una VENTA o
-- una COMPRA, y nunca se reemplaza a sí misma. No cambia ningún dato: es una restricción más laxa que la anterior, así que toda fila existente la cumple (con el enlace en NULL en todas).
-- Reversa: down.sql (aborta si ya hay una compra con reemplazo).

ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_reemplaza_solo_venta_chk";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_reemplaza_venta_o_compra_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_reemplaza_venta_o_compra_chk" CHECK (
  "reemplazaAOperacionId" IS NULL OR (proceso IN ('VENTA', 'COMPRA') AND "reemplazaAOperacionId" <> id)
) NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_reemplaza_venta_o_compra_chk";

-- El motivo (`motivoId`) también se admite en una COMPRA: la compra corregida por ejemplar guarda el motivo de la corrección (catálogo MotivoMerma con ámbito CORRECCION). Antes: solo MERMA. Se conserva el NOMBRE de la restricción
-- (como ya se hizo con `Operacion_anulacion_coherente_chk`) para no romper la migración original ni su verificación previa; ahora admite MERMA o COMPRA. Más laxo: toda fila existente la cumple.
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_motivo_solo_merma_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_motivo_solo_merma_chk" CHECK ("motivoId" IS NULL OR proceso IN ('MERMA', 'COMPRA')) NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_motivo_solo_merma_chk";
