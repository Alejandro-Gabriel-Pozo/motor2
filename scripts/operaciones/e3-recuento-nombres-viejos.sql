-- E-3 (frente 3, datos): recuento de SOLO LECTURA de los nombres y CUIT ya guardados que NO cumplen la lista de permitidos nueva (la de Pedernal), para decidir cómo limpiarlos ANTES de poner el CHECK en la base.
-- NO escribe nada: son tres SELECT. Correr sobre una COPIA de producción (o en lectura sobre la real) con un rol que no esté sujeto a RLS (el dueño de las tablas o un superusuario sobre la copia):
--   psql "$URL_DE_LA_COPIA" -v ON_ERROR_STOP=1 -f scripts/operaciones/e3-recuento-nombres-viejos.sql
-- Salida: (1) resumen por columna; (2) hasta 5 ejemplos por columna y motivo (con el `id` de la fila; el valor es dato de la empresa: no pegarlo en canales públicos); (3) CUIT que no pasan la regla estricta.
-- Fichas: PRODUCTO, ELECCION (carta y catálogo), RAZON_SOCIAL, NOMBRE_DE_SUCURSAL y NOMBRE_DE_ROL (las dos últimas, como el código desde E-1 c/d); REFERENCIA = columnas sin ficha verificada en Pedernal (se miden con la de ELECCION, NO VERIFICADO).
-- La regla de verdad es el código (`src/core/datos/fichas-de-texto.ts`); acá es una aproximación en SQL: los casos límite se revisan a mano. Detalle y motivos: docs/e1-recuento-de-textos-y-cuit-2026-11-15.md.

-- (1) RESUMEN POR COLUMNA
-- E1 · recuento de nombres que romperían la regla de texto de catálogo. SOLO LECTURA.
-- Equivalencias con el código: trim de JavaScript (espacios, saltos, BOM) → primer regexp_replace; NFC → normalize; colapso de Zs → segundo regexp_replace.
-- Aproximación declarada: el barrido de caracteres de Postgres es el de su librería regex; la fuente de verdad sigue siendo el código (los casos límite se revisan a mano).
WITH fichas(ficha, maximo, exigir_letra, con_signos_de_catalogo) AS (
  VALUES ('PRODUCTO', 120, true, true),
         ('ELECCION', 80, false, true),
         ('RAZON_SOCIAL', 200, true, false),
         ('REFERENCIA', 80, false, true),
         ('NOMBRE_DE_SUCURSAL', 80, true, false),
         ('NOMBRE_DE_ROL', 80, true, false)
),
datos(tabla, columna, ficha, id, valor) AS (
  SELECT 'Producto', 'nombre', 'PRODUCTO', id, nombre FROM "Producto"
  UNION ALL SELECT 'Insumo', 'nombre', 'PRODUCTO', id, nombre FROM "Insumo"
  UNION ALL SELECT 'SeccionCarta', 'nombre', 'ELECCION', id, nombre FROM "SeccionCarta"
  UNION ALL SELECT 'GrupoDeOpciones', 'nombre', 'ELECCION', id, nombre FROM "GrupoDeOpciones"
  UNION ALL SELECT 'OpcionDeGrupo', 'nombre', 'ELECCION', id, nombre FROM "OpcionDeGrupo"
  UNION ALL SELECT 'CategoriaProducto', 'nombre', 'ELECCION', id, nombre FROM "CategoriaProducto"
  UNION ALL SELECT 'Proveedor', 'nombre', 'RAZON_SOCIAL', id, nombre FROM "Proveedor"
  UNION ALL SELECT 'Cliente', 'nombre', 'RAZON_SOCIAL', id, nombre FROM "Cliente"
  UNION ALL SELECT 'Grupo', 'nombre', 'REFERENCIA', id, nombre FROM "Grupo"
  UNION ALL SELECT 'Seccion', 'nombre', 'REFERENCIA', id, nombre FROM "Seccion"
  UNION ALL SELECT 'Sucursal', 'nombre', 'NOMBRE_DE_SUCURSAL', id, nombre FROM "Sucursal"
  UNION ALL SELECT 'Rol', 'nombre', 'NOMBRE_DE_ROL', id, nombre FROM "Rol"
  UNION ALL SELECT 'MotivoMerma', 'nombre', 'REFERENCIA', id, nombre FROM "MotivoMerma"
  UNION ALL SELECT 'DestinoConsumo', 'nombre', 'REFERENCIA', id, nombre FROM "DestinoConsumo"
  UNION ALL SELECT 'ConceptoDeGasto', 'nombre', 'REFERENCIA', id, nombre FROM "ConceptoDeGasto"
  UNION ALL SELECT 'ItemAgrupadoCarta', 'nombre', 'REFERENCIA', id, nombre FROM "ItemAgrupadoCarta"
  UNION ALL SELECT 'GeneroCarta', 'nombre', 'REFERENCIA', id, nombre FROM "GeneroCarta"
  UNION ALL SELECT 'PlanDeCostos', 'nombre', 'REFERENCIA', id, nombre FROM "PlanDeCostos"
  UNION ALL SELECT 'CentroDeCostos', 'nombre', 'REFERENCIA', id, nombre FROM "CentroDeCostos"
  UNION ALL SELECT 'Empresa', 'nombre', 'REFERENCIA', id, nombre FROM "Empresa"
),
canonico AS (
  SELECT d.*, f.maximo, f.exigir_letra, f.con_signos_de_catalogo,
         regexp_replace(
           regexp_replace(normalize(d.valor, NFC), '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g'),
           '[    -   　]+', ' ', 'g') AS c
  FROM datos d JOIN fichas f USING (ficha)
),
veredicto AS (
  SELECT tabla, columna, ficha, id, valor, c,
    CASE
      WHEN c IS NULL OR c = '' THEN 'VACIO'
      WHEN NOT (CASE WHEN con_signos_de_catalogo
                     THEN c ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&()°:;"#ºª’“”–—«»®™''/+¿¡?!%$-]+$'
                     ELSE c ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&()°:;"#ºª’“”–—«»®™''/+-]+$' END) THEN 'CARACTER_PROHIBIDO'
      WHEN c ~ '^[+-]' THEN 'CARACTER_PROHIBIDO'
      WHEN char_length(c) > maximo THEN 'DEMASIADO_LARGO'
      WHEN exigir_letra AND c !~ '[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ]' THEN 'SIN_LETRAS'
      ELSE 'OK'
    END AS motivo,
    (c IS DISTINCT FROM valor) AS se_reescribiria
  FROM canonico
)
SELECT tabla, columna, ficha,
       count(*)                                                AS filas,
       count(*) FILTER (WHERE motivo = 'OK')                   AS pasan,
       count(*) FILTER (WHERE motivo = 'OK' AND se_reescribiria) AS pasan_reescritas,
       count(*) FILTER (WHERE motivo = 'VACIO')                AS vacio,
       count(*) FILTER (WHERE motivo = 'CARACTER_PROHIBIDO')   AS caracter_prohibido,
       count(*) FILTER (WHERE motivo = 'DEMASIADO_LARGO')      AS demasiado_largo,
       count(*) FILTER (WHERE motivo = 'SIN_LETRAS')           AS sin_letras
FROM veredicto
GROUP BY tabla, columna, ficha
ORDER BY ficha, tabla;

-- (2) EJEMPLOS (hasta 5 por columna y motivo)
-- E1 · recuento de nombres que romperían la regla de texto de catálogo. SOLO LECTURA.
-- Equivalencias con el código: trim de JavaScript (espacios, saltos, BOM) → primer regexp_replace; NFC → normalize; colapso de Zs → segundo regexp_replace.
-- Aproximación declarada: el barrido de caracteres de Postgres es el de su librería regex; la fuente de verdad sigue siendo el código (los casos límite se revisan a mano).
WITH fichas(ficha, maximo, exigir_letra, con_signos_de_catalogo) AS (
  VALUES ('PRODUCTO', 120, true, true),
         ('ELECCION', 80, false, true),
         ('RAZON_SOCIAL', 200, true, false),
         ('REFERENCIA', 80, false, true),
         ('NOMBRE_DE_SUCURSAL', 80, true, false),
         ('NOMBRE_DE_ROL', 80, true, false)
),
datos(tabla, columna, ficha, id, valor) AS (
  SELECT 'Producto', 'nombre', 'PRODUCTO', id, nombre FROM "Producto"
  UNION ALL SELECT 'Insumo', 'nombre', 'PRODUCTO', id, nombre FROM "Insumo"
  UNION ALL SELECT 'SeccionCarta', 'nombre', 'ELECCION', id, nombre FROM "SeccionCarta"
  UNION ALL SELECT 'GrupoDeOpciones', 'nombre', 'ELECCION', id, nombre FROM "GrupoDeOpciones"
  UNION ALL SELECT 'OpcionDeGrupo', 'nombre', 'ELECCION', id, nombre FROM "OpcionDeGrupo"
  UNION ALL SELECT 'CategoriaProducto', 'nombre', 'ELECCION', id, nombre FROM "CategoriaProducto"
  UNION ALL SELECT 'Proveedor', 'nombre', 'RAZON_SOCIAL', id, nombre FROM "Proveedor"
  UNION ALL SELECT 'Cliente', 'nombre', 'RAZON_SOCIAL', id, nombre FROM "Cliente"
  UNION ALL SELECT 'Grupo', 'nombre', 'REFERENCIA', id, nombre FROM "Grupo"
  UNION ALL SELECT 'Seccion', 'nombre', 'REFERENCIA', id, nombre FROM "Seccion"
  UNION ALL SELECT 'Sucursal', 'nombre', 'NOMBRE_DE_SUCURSAL', id, nombre FROM "Sucursal"
  UNION ALL SELECT 'Rol', 'nombre', 'NOMBRE_DE_ROL', id, nombre FROM "Rol"
  UNION ALL SELECT 'MotivoMerma', 'nombre', 'REFERENCIA', id, nombre FROM "MotivoMerma"
  UNION ALL SELECT 'DestinoConsumo', 'nombre', 'REFERENCIA', id, nombre FROM "DestinoConsumo"
  UNION ALL SELECT 'ConceptoDeGasto', 'nombre', 'REFERENCIA', id, nombre FROM "ConceptoDeGasto"
  UNION ALL SELECT 'ItemAgrupadoCarta', 'nombre', 'REFERENCIA', id, nombre FROM "ItemAgrupadoCarta"
  UNION ALL SELECT 'GeneroCarta', 'nombre', 'REFERENCIA', id, nombre FROM "GeneroCarta"
  UNION ALL SELECT 'PlanDeCostos', 'nombre', 'REFERENCIA', id, nombre FROM "PlanDeCostos"
  UNION ALL SELECT 'CentroDeCostos', 'nombre', 'REFERENCIA', id, nombre FROM "CentroDeCostos"
  UNION ALL SELECT 'Empresa', 'nombre', 'REFERENCIA', id, nombre FROM "Empresa"
),
canonico AS (
  SELECT d.*, f.maximo, f.exigir_letra, f.con_signos_de_catalogo,
         regexp_replace(
           regexp_replace(normalize(d.valor, NFC), '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g'),
           '[    -   　]+', ' ', 'g') AS c
  FROM datos d JOIN fichas f USING (ficha)
),
veredicto AS (
  SELECT tabla, columna, ficha, id, valor, c,
    CASE
      WHEN c IS NULL OR c = '' THEN 'VACIO'
      WHEN NOT (CASE WHEN con_signos_de_catalogo
                     THEN c ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&()°:;"#ºª’“”–—«»®™''/+¿¡?!%$-]+$'
                     ELSE c ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&()°:;"#ºª’“”–—«»®™''/+-]+$' END) THEN 'CARACTER_PROHIBIDO'
      WHEN c ~ '^[+-]' THEN 'CARACTER_PROHIBIDO'
      WHEN char_length(c) > maximo THEN 'DEMASIADO_LARGO'
      WHEN exigir_letra AND c !~ '[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ]' THEN 'SIN_LETRAS'
      ELSE 'OK'
    END AS motivo,
    (c IS DISTINCT FROM valor) AS se_reescribiria
  FROM canonico
)
SELECT tabla, columna, ficha, motivo, id, valor
FROM (SELECT v.*, row_number() OVER (PARTITION BY tabla, columna, motivo ORDER BY id) AS n FROM veredicto v WHERE motivo <> 'OK') x
WHERE n <= 5
ORDER BY ficha, tabla, motivo, n;

-- (3) CUIT
-- E1 · recuento de CUIT que romperían la regla estricta. SOLO LECTURA.
WITH cuits(tabla, columna, id, valor) AS (
  SELECT 'Proveedor', 'cuit', id, cuit FROM "Proveedor" WHERE cuit IS NOT NULL
  UNION ALL SELECT 'Empresa', 'cuit', id, cuit FROM "Empresa" WHERE cuit IS NOT NULL
  UNION ALL SELECT 'Invitacion', 'cuitDeclarado', id, "cuitDeclarado" FROM "Invitacion" WHERE "cuitDeclarado" IS NOT NULL
),
digitos AS (
  SELECT c.*,
    CASE WHEN valor ~ '^[0-9]{11}$' THEN valor
         WHEN valor ~ '^[0-9]{2}-[0-9]{8}-[0-9]$' THEN replace(valor, '-', '')
    END AS d
  FROM cuits c
),
veredicto AS (
  SELECT tabla, columna, id, valor, d,
    CASE
      WHEN d IS NULL THEN 'CUIT_FORMATO_INVALIDO'
      WHEN (SELECT CASE r WHEN 11 THEN 0 WHEN 10 THEN -1 ELSE r END
            FROM (SELECT 11 - (sum(substr(d, i, 1)::int * (ARRAY[5,4,3,2,7,6,5,4,3,2])[i]) % 11) AS r FROM generate_series(1, 10) AS i) q)
           IS DISTINCT FROM substr(d, 11, 1)::int THEN 'CUIT_DIGITO_VERIFICADOR_INVALIDO'
      ELSE 'OK'
    END AS motivo,
    (d IS NOT NULL AND valor <> d) AS viene_con_guiones,
    (d IS NOT NULL AND substr(d, 1, 2) NOT IN ('20','23','24','27','30','33','34')) AS prefijo_fuera_de_la_lista_vieja
  FROM digitos
)
SELECT tabla, columna,
       count(*) AS filas,
       count(*) FILTER (WHERE motivo = 'OK') AS pasan,
       count(*) FILTER (WHERE motivo = 'OK' AND viene_con_guiones) AS pasan_pero_vienen_con_guiones,
       count(*) FILTER (WHERE motivo = 'CUIT_FORMATO_INVALIDO') AS formato_invalido,
       count(*) FILTER (WHERE motivo = 'CUIT_DIGITO_VERIFICADOR_INVALIDO') AS verificador_invalido,
       count(*) FILTER (WHERE motivo = 'OK' AND prefijo_fuera_de_la_lista_vieja) AS pasan_ahora_y_antes_no
FROM veredicto
GROUP BY tabla, columna
ORDER BY tabla;
-- Ejemplos: reemplazar el SELECT final por
-- SELECT tabla, columna, motivo, id, valor FROM veredicto WHERE motivo <> 'OK' ORDER BY tabla, motivo LIMIT 50;
