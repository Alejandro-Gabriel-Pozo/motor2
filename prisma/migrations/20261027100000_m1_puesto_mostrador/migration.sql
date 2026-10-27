-- M1 DEL MOSTRADOR COMO PUESTO DEL SALÓN (ADR-039; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): NO APLICADA en ninguna base real.
-- `Mesa.tipo`: SALON (las mesas numeradas de siempre) o MOSTRADOR (UN puesto por sucursal que atiende en el momento, con ticket, cliente y descuentos como una mesa). Lista cerrada en la base (TEXT + CHECK, como
-- `GrupoDeOpciones_tipo_chk`), espejo de `TIPOS_DE_PUESTO` (src/core/pos/puesto.ts): ampliar la lista es ampliar el CHECK. El mostrador ocupa el NÚMERO 0 (`Mesa_numero_segun_tipo_chk`: `(tipo = 'MOSTRADOR') =
-- (numero = 0)`; el alta de mesas da de 1 a 9999 y la guarda de abajo frena si ya hubiera una mesa con número <= 0): así no choca con `Mesa_sucursalId_numero_key` ni obliga a volver nulo `numero`, y ese par
-- (único por sucursal y número + el CHECK) YA garantiza a lo sumo UN mostrador por sucursal (no hace falta un índice parcial nuevo).
-- `Cuenta.tipoMesa` + FK COMPUESTA CON DISCRIMINADOR `(empresaId, mesaId, tipoMesa) -> Mesa(empresaId, id, tipo)` (precedente: ADR-029 §10 y §11, `ImputacionDeGasto.naturalezaRenglon`): la base impide una cuenta con un
-- tipo distinto del de su puesto y cambiar el tipo de un puesto que tiene cuentas (RESTRICT en ambos sentidos; la FK anterior era ON UPDATE CASCADE). Entra en M1 y no en M2 a propósito: aplicar la FK después, con
-- el código de M1 en marcha, rechazaría (23503) toda apertura del mostrador que escribiera SALON. `Cuenta_comensales_segun_tipo_chk`: el mostrador no lleva comensales (`tipoMesa = 'SALON' OR comensales IS NULL`).
-- ADITIVA y SIN UPDATE de filas: los defaults constantes (`SALON`) solo tocan el catálogo (PG >= 11) y son lo que cada mesa y cuenta existente ya es; no se crea ningún puesto «Mostrador» (lo crea el administrador
-- con el botón de la sucursal). El código anterior no lee ni escribe las columnas (sus INSERT toman el default y la FK se cumple con él). Sin políticas de RLS, GRANT ni clasificación nuevos: `Mesa` sigue PROPIA y
-- `Cuenta` y sus hijos HEREDADAS de la mesa (sus políticas filtran por `mesaId`, no por las columnas nuevas); `motor2_app` tiene privilegios de TABLA, que cubren las columnas nuevas.
-- COSTO: `Cuenta` es tabla caliente. Quitar y agregar la FK compuesta valida contra `Mesa` (poca volumetría) y toma un bloqueo corto sobre `Cuenta` y `Mesa`: aplicar FUERA DE HORARIO con `SET lock_timeout = '5s'`
-- en la conexión del dueño (precedente M-9). Sin CONCURRENTLY (Prisma corre el archivo entero en una transacción). Guarda de volumen: si `Cuenta` pasa de 500.000 filas, no aplicar y replantear con la FK NOT VALID.
-- Reversa: down.sql (a mano, como dueño; ABORTA si existe algún puesto MOSTRADOR o alguna cuenta suya; después marcarla revertida en `_prisma_migrations`: ver el pie de down.sql).

DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM "Mesa" WHERE "numero" <= 0;
  IF n > 0 THEN
    RAISE EXCEPTION 'No se puede aplicar 20261027100000_m1_puesto_mostrador: hay % mesa(s) con número <= 0 (el 0 queda reservado al puesto mostrador). Resolvelo antes: SELECT "id", "empresaId", "sucursalId", "numero" FROM "Mesa" WHERE "numero" <= 0;', n;
  END IF;
END
$$;

-- El tipo de cada puesto, y el número que le toca a cada tipo.
ALTER TABLE "Mesa" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'SALON';
ALTER TABLE "Mesa" ADD CONSTRAINT "Mesa_tipo_chk" CHECK ("tipo" IN ('SALON', 'MOSTRADOR'));
ALTER TABLE "Mesa" ADD CONSTRAINT "Mesa_numero_segun_tipo_chk" CHECK (("tipo" = 'MOSTRADOR') = ("numero" = 0));

-- Destino de la FK con discriminador de `Cuenta`.
CREATE UNIQUE INDEX "Mesa_empresaId_id_tipo_key" ON "Mesa"("empresaId", "id", "tipo");

-- La cuenta lleva el tipo de su puesto, y la base lo mantiene igual al de su mesa.
ALTER TABLE "Cuenta" ADD COLUMN "tipoMesa" TEXT NOT NULL DEFAULT 'SALON';
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_tipoMesa_chk" CHECK ("tipoMesa" IN ('SALON', 'MOSTRADOR'));
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_comensales_segun_tipo_chk" CHECK ("tipoMesa" = 'SALON' OR "comensales" IS NULL);
ALTER TABLE "Cuenta" DROP CONSTRAINT "Cuenta_empresaId_mesaId_fkey";
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_empresaId_mesaId_tipoMesa_fkey" FOREIGN KEY ("empresaId", "mesaId", "tipoMesa") REFERENCES "Mesa"("empresaId", "id", "tipo") ON DELETE RESTRICT ON UPDATE RESTRICT;
