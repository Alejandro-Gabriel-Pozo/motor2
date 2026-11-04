-- CARTA «B», etapa E3 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN, base por base, con respaldo y ensayo en una rama de Neon; el dueño la autorizó como REVERSIBLE el 2026-11-03):
-- «descripción de la opción» (docs/diseno-descripcion-de-opciones-y-carta-b-2026-11-04.md, §6).
-- `OpcionDeGrupo.descripcionEnCarta`: un texto corto, de UNA línea, OPCIONAL, que escribe el dueño y que lee SOLO la carta (pública, impresa, vista previa del producto y «Va a mostrar»): «lechuga, tomate, cebolla».
-- NULL (default) = sin descripción. No entra al precio, al stock, al ticket, a la comanda, al POS ni a los reportes, y la foto de la venta (`OpcionElegidaEnLinea`) no la copia. Vive en la opción y no en
-- su versión: igual que el nombre, no tiene versión propia (`VersionDeOpcion` solo guarda precio y consumos).
-- CHECK `OpcionDeGrupo_descripcion_en_carta_chk`: NULL, o de 1 a 120 caracteres, que empiezan y terminan con un carácter visible (sin espacios a los costados) y sin saltos de línea.
-- ADITIVA: el código anterior no lee ni escribe la columna (sus `data` son explícitos y los INSERT toman NULL). Sin políticas nuevas: `aislamiento_empresa` es por fila y cubre la columna.
-- GRANT: `OpcionDeGrupo` tiene privilegios de UPDATE POR COLUMNA para `motor2_app` (GO-1b): la columna nueva necesita el suyo (sin él, editar la descripción da 42501). Condicional al rol, como GO-1b.
-- ADD COLUMN sin default solo toca el catálogo; validar el CHECK recorre las filas de `OpcionDeGrupo` (todas en NULL).
-- Reversa: down.sql (a mano, como dueño; ABORTA si alguna opción tiene una descripción cargada; después marcar la migración como revertida).

ALTER TABLE "OpcionDeGrupo" ADD COLUMN "descripcionEnCarta" TEXT;

-- `^\S(.*\S)?$`: empieza y termina con un carácter visible (rechaza vacío, solo espacios y cualquier espacio —también un tabulador o un salto— a los costados). `[\r\n]`: ningún salto de línea adentro
-- (en el punto de una expresión regular de Postgres cabe el salto, por eso se pide aparte).
ALTER TABLE "OpcionDeGrupo" ADD CONSTRAINT "OpcionDeGrupo_descripcion_en_carta_chk"
  CHECK ("descripcionEnCarta" IS NULL OR ("descripcionEnCarta" ~ '^\S(.*\S)?$' AND "descripcionEnCarta" !~ '[\r\n]' AND char_length("descripcionEnCarta") <= 120));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT UPDATE ("descripcionEnCarta") ON "OpcionDeGrupo" TO motor2_app;
  END IF;
END
$$;
