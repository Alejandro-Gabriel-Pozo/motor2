-- Verificación previa de 20261115140000_parte_ficha_unica_p1. SOLO LEE (transacción de solo lectura). Se corre con el rol dueño en CADA base real ANTES de aprobar la migración (y de nuevo DESPUÉS, para comparar):
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261115140000_parte_ficha_unica_p1/verificacion-previa.sql
-- Devuelve SOLO cuentas e identificadores internos (nunca nombres, documentos ni contactos): la salida se puede pegar en un chat.
-- Cómo leerla:
--   1. «invalidos» tiene que dar 0: es la cantidad de proveedores cuyo nombre la regla de la ficha no acepta; si no es 0 la migración se detiene y lista esos ids (corregirlos antes).
--   2. «con_ficha_despues» debe igualar a «proveedores» una vez aplicada la migración; «pendientes_de_completar» es cuántos quedan sin naturaleza (CUIT vacío, inválido o de prefijo desconocido).
BEGIN READ ONLY;

WITH p AS (
  SELECT pr.*, (pr."cuit" ~ '^[0-9]{11}$') AS forma_cuit,
         CASE WHEN pr."cuit" ~ '^[0-9]{11}$' THEN
           (SELECT CASE r WHEN 11 THEN 0 WHEN 10 THEN -1 ELSE r END
              FROM (SELECT 11 - (sum(substr(pr."cuit", i, 1)::int * (ARRAY[5,4,3,2,7,6,5,4,3,2])[i]) % 11) AS r FROM generate_series(1, 10) AS i) c) = substr(pr."cuit", 11, 1)::int
         END AS cuit_ok
  FROM "Proveedor" pr
)
SELECT e."slug" AS empresa,
       count(p."id") AS proveedores,
       count(p."id") FILTER (WHERE p."cuit" IS NOT NULL) AS con_cuit,
       count(p."id") FILTER (WHERE p.cuit_ok) AS con_cuit_valido,
       count(p."id") FILTER (WHERE p.cuit_ok AND left(p."cuit", 2) IN ('20', '23', '24', '27', '30', '33', '34')) AS naturaleza_deducible,
       count(p."id") FILTER (WHERE p."cuit" IS NOT NULL AND NOT coalesce(p.cuit_ok, false)) AS cuit_que_no_pasa,
       count(p."id") FILTER (WHERE NOT (char_length(p."nombre") BETWEEN 1 AND 200 AND p."nombre" = btrim(p."nombre")
           AND p."nombre" ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°:;"#ºª’“”–—«»®™''][A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°+:;"#ºª’“”–—«»®™'' -]*$'
           AND p."nombre" ~ '[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ]')) AS invalidos,
       count(p."id") FILTER (WHERE p."telefono" IS NOT NULL AND NOT (btrim(p."telefono") ~ '^[[:print:]]+$' AND char_length(btrim(p."telefono")) BETWEEN 1 AND 40)) AS telefonos_que_no_pasan,
       count(p."id") FILTER (WHERE p."email" IS NOT NULL AND NOT (lower(btrim(p."email")) ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND lower(btrim(p."email")) ~ '^[[:graph:]]+$' AND char_length(lower(btrim(p."email"))) <= 254)) AS correos_que_no_pasan,
       (SELECT count(*) FROM "Cliente" c WHERE c."empresaId" = e."id") AS clientes_no_se_tocan
  FROM "Empresa" e LEFT JOIN p ON p."empresaId" = e."id"
 GROUP BY e."id", e."slug"
 ORDER BY 1;

-- DESPUÉS de aplicar (descomentar; antes de la migración la columna "parteId" no existe y la consulta falla): proveedores vs fichas; tiene que dar los mismos totales y 0 sin ficha.
-- SELECT (SELECT count(*) FROM "Proveedor") AS proveedores,
--        (SELECT count(*) FROM "Proveedor" WHERE "parteId" IS NOT NULL) AS con_ficha_despues,
--        (SELECT count(*) FROM "Parte" WHERE "naturaleza" IS NULL) AS pendientes_de_completar
--  WHERE to_regclass('public."Parte"') IS NOT NULL;
--

ROLLBACK;
