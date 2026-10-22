-- FASE 4 de la ola «precio y carta», C2 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): «se lee en la carta como» (ADR-035, DEC-34).
-- `GrupoDeOpciones.prefijoEnCarta`: el prefijo OPCIONAL con que la carta lee cada opción del grupo («De» → «De carne», «De pollo»), distinto del nombre de administración. NULL (default) = sin
-- prefijo: cada opción se lee con su nombre. Solo lo lee la carta (Fase 5); no entra al precio ni a la foto de la venta, y el POS y el ticket muestran grupo y opción tal cual. Que solo vaya en
-- grupos VARIANTE y MEDIDA lo aplica el caso de uso (el tipo es inmutable). CHECK: NULL, o algún carácter visible, sin espacios a los costados y hasta 20 caracteres.
-- ADITIVA: el código anterior no lee ni escribe la columna (sus `data` son explícitos y los INSERT toman NULL). Sin políticas nuevas: `aislamiento_empresa` es por fila y cubre la columna.
-- GRANT: `GrupoDeOpciones` tiene privilegios de UPDATE POR COLUMNA para `motor2_app` (GO-1b): la columna nueva necesita el suyo (sin él, editar el prefijo da 42501). Condicional al rol, como GO-1b.
-- ADD COLUMN sin default solo toca el catálogo; validar el CHECK recorre las filas de `GrupoDeOpciones` (todas en NULL).
-- Reversa: down.sql (a mano, como dueño; ABORTA si hay algún prefijo cargado; después marcar la migración como revertida).

ALTER TABLE "GrupoDeOpciones" ADD COLUMN "prefijoEnCarta" TEXT;

-- `^\S(.*\S)?$`: empieza y termina con un carácter visible (rechaza vacío, solo espacios y cualquier espacio —también un tabulador o un salto— a los costados).
ALTER TABLE "GrupoDeOpciones" ADD CONSTRAINT "GrupoDeOpciones_prefijo_en_carta_chk"
  CHECK ("prefijoEnCarta" IS NULL OR ("prefijoEnCarta" ~ '^\S(.*\S)?$' AND char_length("prefijoEnCarta") <= 20));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT UPDATE ("prefijoEnCarta") ON "GrupoDeOpciones" TO motor2_app;
  END IF;
END
$$;
