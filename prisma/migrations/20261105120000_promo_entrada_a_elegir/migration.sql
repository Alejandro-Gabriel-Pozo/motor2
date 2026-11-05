-- «PROMO QUE DEJA ELEGIR AL MOZO SOLO LO PERMITIDO» (etapa N1, PR A: servidor; docs/diseno-promo-subconjunto-2026-11-04.md §6; enmienda de ADR-032 D-6 aprobada por el dueño el 2026-11-05; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR
-- EN PRODUCCIÓN, base por base, con respaldo y ensayo en una rama de Neon):
--  - `EntradaDeCupo.modoDeOpciones`: `FIJAS` (DEFAULT, lo de hoy: las opciones de la entrada son la configuración fija) o `A_ELEGIR` (las opciones de la entrada son las PERMITIDAS y el mozo elige entre ellas, dentro de los
--    límites del grupo). Todas las filas actuales quedan `FIJAS`: el comportamiento de hoy no cambia.
-- ADITIVA: el código anterior no lee ni escribe la columna (sus `data` son explícitos y el INSERT toma el DEFAULT). Sin políticas ni GRANT nuevos: `EntradaDeCupo` tiene `GRANT SELECT, INSERT` de TABLA, que cubre la columna
-- nueva; el UPDATE sigue limitado a `orden`, `activa` y `actualizadoEn` (la identidad, modo incluido, es inmutable). ADD COLUMN con DEFAULT constante no reescribe la tabla.
-- Reversa: down.sql (a mano, como dueño; ABORTA si hay alguna entrada `A_ELEGIR`; después marcar la migración como revertida).

ALTER TABLE "EntradaDeCupo" ADD COLUMN "modoDeOpciones" TEXT NOT NULL DEFAULT 'FIJAS';
ALTER TABLE "EntradaDeCupo" ADD CONSTRAINT "EntradaDeCupo_modo_de_opciones_chk" CHECK ("modoDeOpciones" IN ('FIJAS', 'A_ELEGIR'));
