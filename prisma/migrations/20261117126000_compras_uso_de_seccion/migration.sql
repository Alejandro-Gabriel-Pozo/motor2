-- Compras, depósitos de uso RECHAZO y CUARENTENA, etapa (i) (docs/diseno-compras-cuarentena-y-rechazo-2026-11-17.md, nivel 6). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- Decisión del dueño, 2026-11-17: «4.-lo recomendado» (como Pedernal: depósitos de uso RECHAZO y CUARENTENA; la línea rechazada va a RECHAZO, la con observaciones a CUARENTENA). El dueño autorizó el 2026-11-15 migraciones ADITIVAS y
-- REVERSIBLES (con down.sql) de etapas ratificadas; aplicarlas en bases reales sigue congelado (solo al desplegar, con backup y ensayo).
--
-- QUÉ: UNA columna nueva, "Seccion"."uso" (TEXT NOT NULL DEFAULT 'NORMAL'), con la lista cerrada NORMAL / CUARENTENA / RECHAZO (CHECK), y un disparador que impide cambiarla: el uso se elige al CREAR la sección y no se edita después (como Pedernal,
-- `deposito_uso_inmutable`). Toda sección que ya existe queda NORMAL: nada cambia hasta que alguien cree una sección de otro uso. SIN índice único por sucursal a propósito (Pedernal «2B»: puede haber varias de un mismo uso; el sistema propone la
-- primera por nombre y deja elegir).
-- QUÉ DECIDE LA BASE: el valor de `uso` es de la lista cerrada (23514) y nunca cambia una vez escrito (23514). QUÉ DECIDE EL CASO DE USO: quién crea la sección, qué se propone al confirmar una recepción y el bloqueo si falta la sección del uso necesario.
-- ADITIVA: solo agrega una columna con valor por defecto (en Postgres 11+ no reescribe la tabla); el código anterior no la lee ni la escribe (sus INSERT toman NORMAL), así que se puede aplicar por adelantado y el Instant Rollback de Vercel sigue
-- siendo seguro. Sin políticas ni GRANT nuevos: la tabla ya tiene los de sucursal y empresa.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; ABORTA si alguna sección ya tiene un uso distinto de NORMAL; después `prisma migrate resolve --rolled-back 20261117126000_compras_uso_de_seccion`).

ALTER TABLE "Seccion" ADD COLUMN "uso" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Seccion" ADD CONSTRAINT "Seccion_uso_chk" CHECK ("uso" IN ('NORMAL', 'CUARENTENA', 'RECHAZO'));

-- Inmutable: un UPDATE que deja el uso como estaba pasa (idempotente); uno que lo cambia, no.
CREATE FUNCTION "Seccion_uso_inmutable"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."uso" IS DISTINCT FROM OLD."uso" THEN
    RAISE EXCEPTION 'el uso de un depósito se elige al crearlo y no se cambia (se crea otro depósito)'
      USING ERRCODE = '23514', CONSTRAINT = 'Seccion_uso_inmutable_chk', TABLE = 'Seccion';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "Seccion_uso_inmutable_chk"
  BEFORE UPDATE OF "uso" ON "Seccion"
  FOR EACH ROW EXECUTE FUNCTION "Seccion_uso_inmutable"();
