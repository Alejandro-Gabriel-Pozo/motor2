-- INFORME DE SOLO LECTURA (frente 2, etapa A1): unidades de medida de cada empresa contra las 14 de Pedernal.
-- NO escribe nada, NO es una migración, NO cambia ningún dato. Crea 4 objetos TEMPORALES (la lista de las 14, la regla y los productos comparables), pasa la transacción a SOLO LECTURA ANTES de leer ninguna tabla del negocio (escribir en una temporal está permitido en solo lectura) y termina con ROLLBACK: no deja nada.
-- Diseño: docs/diseno-unidades-de-medida-como-pedernal-2026-11-15.md (§6.2 regla de equivalencias, §9 consultas) y
--         docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16.md (etapa A1).
--
-- Qué mide (cinco bloques; cada uno dice arriba qué muestra):
--   1. Una fila por unidad: qué equivalente de las 14 PROPONE la regla y cuántas filas dependen de ella.
--   2. Resumen por empresa: cuántas unidades tienen propuesta exacta, cuántas son envases (→ UNIDAD, con el nombre original visible) y cuántas quedan «pendiente de completar».
--   3. Las unidades de las 14 que ninguna unidad de la empresa cubre (lo que agregaría la etapa U3).
--   4. Coherencia del factor (I8): productos cuya unidad de compra y de stock son comparables y cuyo factor NO coincide con el cociente de la tabla.
--   5. Suma de control (I10): conteos y totales que tienen que dar IGUAL antes y después de rellenar las equivalencias.
--
-- La PROPUESTA es solo una lectura de este informe: el dueño revisa la lista de cada base. Nadie adivina nada en el sistema (todo nace cerrado):
-- una unidad sin regla exacta sale «PENDIENTE». Una equivalencia solo se propone entre unidades de la MISMA dimensión y de relación 1 a 1.
--
-- Uso (la URL por entorno, nunca en el repo). Correr SIEMPRE como DUEÑO de la base (ve todas las empresas). Con el rol de la aplicación el aislamiento por empresa y por sucursal (RLS) recorta lo que ve y los conteos dan MENOS: no sirve para este informe.
--
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/operaciones/informe-unidades-equivalencias.sql
-- Variable opcional:  -v slug=<slug>  (limita el informe a una empresa).
-- La salida lleva nombres de unidades y de productos de la empresa: es PRIVADA, no se pega en el repositorio.

\set ON_ERROR_STOP on
\pset null '·'
\pset footer off
BEGIN;
SET LOCAL statement_timeout = '60s';

-- Filtro opcional por empresa: sin `-v slug=…` queda vacío y no filtra.
\if :{?slug}
\else
  \set slug ''
\endif
SELECT set_config('informe.slug', :'slug', true) AS filtro_de_empresa \gset

-- Las 14 de Pedernal (copia exacta de src/core/catalogo/unidades-de-medida.ts): código, dimensión, factor entero a la base, y la magnitud de Motor2 que le corresponde.
CREATE TEMP TABLE catorce (codigo text PRIMARY KEY, dimension text NOT NULL, factor bigint NOT NULL, magnitud_motor2 text) ON COMMIT DROP;
INSERT INTO catorce VALUES
  ('UNIDAD','CONTEO',1,'CANTIDAD'),
  ('GRAMO','MASA',1,'PESO'), ('KILOGRAMO','MASA',1000,'PESO'), ('TONELADA','MASA',1000000,'PESO'),
  ('MILILITRO','VOLUMEN',1,'VOLUMEN'), ('LITRO','VOLUMEN',1000,'VOLUMEN'), ('METRO_CUBICO','VOLUMEN',1000000,'VOLUMEN'),
  ('MILIMETRO','LONGITUD',1,NULL), ('CENTIMETRO','LONGITUD',10,NULL), ('METRO','LONGITUD',1000,NULL),
  ('CENTIMETRO_CUADRADO','SUPERFICIE',1,NULL), ('METRO_CUADRADO','SUPERFICIE',10000,NULL),
  ('MINUTO','TIEMPO',1,NULL), ('HORA','TIEMPO',60,NULL);

-- La regla de equivalencias (UN §6.2) sobre el nombre normalizado (minúsculas, sin puntos ni espacios de los bordes) y la magnitud. Una sola vista temporal: la usan los bloques 1 a 4.
CREATE TEMP VIEW propuesta AS
WITH base AS (
  SELECT u."empresaId", u.id, u.nombre, u.magnitud::text AS magnitud, u.decimales, u.activa,
         lower(btrim(replace(u.nombre, '.', ''))) AS n
    FROM "Unidad" u
   WHERE current_setting('informe.slug') = '' OR u."empresaId" IN (SELECT id FROM "Empresa" WHERE slug = current_setting('informe.slug'))
), regla AS (
  SELECT b.*,
    CASE
      WHEN b.n IN ('kg','kilo','kilos','kilogramo','kilogramos')            THEN ARRAY['KILOGRAMO','PESO']
      WHEN b.n IN ('g','gr','grs','gramo','gramos')                          THEN ARRAY['GRAMO','PESO']
      WHEN b.n IN ('l','lt','lts','litro','litros')                          THEN ARRAY['LITRO','VOLUMEN']
      WHEN b.n IN ('ml','cc','mililitro','mililitros')                       THEN ARRAY['MILILITRO','VOLUMEN']
      WHEN b.n IN ('unidad','unidades','un','u','unid')                      THEN ARRAY['UNIDAD','CANTIDAD']
      WHEN b.n IN ('caja','cajas','pack','packs','bolsa','bolsas','botella','botellas','lata','latas','paquete','paquetes','bandeja','bandejas','atado','atados')
                                                                             THEN ARRAY['UNIDAD','CANTIDAD']   -- envase: Q-U2 (2026-11-15) «A UNIDAD, con el nombre original visible»
    END AS r
  FROM base b
)
SELECT g."empresaId", g.id, g.nombre, g.magnitud, g.decimales, g.activa,
  CASE WHEN g.r IS NOT NULL AND g.r[2] = g.magnitud THEN g.r[1] END AS codigo_propuesto,
  CASE
    WHEN g.r IS NOT NULL AND g.r[2] = g.magnitud AND g.n IN ('caja','cajas','pack','packs','bolsa','bolsas','botella','botellas','lata','latas','paquete','paquetes','bandeja','bandejas','atado','atados')
         THEN 'ENVASE → UNIDAD (nombre original visible)'
    WHEN g.r IS NOT NULL AND g.r[2] = g.magnitud THEN 'EXACTA'
    WHEN g.r IS NOT NULL                          THEN 'PENDIENTE (la magnitud no calza con el nombre)'
    WHEN g.magnitud = 'CANTIDAD' AND (g.n LIKE '%docena%' OR g.n IN ('par','pares','media docena','mitad','trio','trío','cuarto'))
                                                  THEN 'PENDIENTE (no es 1 a 1)'
    ELSE 'PENDIENTE (sin regla)'
  END AS situacion
FROM regla g;

-- Productos con compra y stock comparables (bloque 4), también temporal: se CREA vacía acá (DDL) y se LLENA después de pasar a solo lectura (escribir una temporal está permitido en solo lectura).
CREATE TEMP TABLE comparables ("empresaId" text, producto text, unidad_compra text, unidad_stock text, factor_cargado numeric, factor_segun_tabla numeric) ON COMMIT DROP;

-- A partir de acá la transacción es SOLO LECTURA: las tablas y la vista de arriba son temporales (viven solo en esta transacción); cualquier INSERT/UPDATE/DELETE/CREATE posterior falla.
SET TRANSACTION READ ONLY;

INSERT INTO comparables
SELECT pr."empresaId", pr.nombre, uc.nombre, us.nombre, pr."factorConversion", round(cc.factor::numeric / cs.factor::numeric, 4)
  FROM "Producto" pr
  JOIN propuesta pc ON pc."empresaId" = pr."empresaId" AND pc.id = pr."unidadCompraId" AND pc.situacion = 'EXACTA'
  JOIN propuesta ps ON ps."empresaId" = pr."empresaId" AND ps.id = pr."unidadStockId"  AND ps.situacion = 'EXACTA'
  JOIN catorce cc ON cc.codigo = pc.codigo_propuesto
  JOIN catorce cs ON cs.codigo = ps.codigo_propuesto AND cs.dimension = cc.dimension
  JOIN "Unidad" uc ON uc."empresaId" = pr."empresaId" AND uc.id = pr."unidadCompraId"
  JOIN "Unidad" us ON us."empresaId" = pr."empresaId" AND us.id = pr."unidadStockId";

\echo
\echo '=== 1. UNIDADES: qué equivalente de las 14 propondría la regla y cuántas filas dependen de cada una ==='
SELECT e.slug AS empresa, p.nombre AS unidad, p.magnitud, p.decimales, CASE WHEN p.activa THEN 'sí' ELSE 'no' END AS activa,
       p.codigo_propuesto AS equivalente_propuesto, p.situacion,
       (SELECT count(*) FROM "Producto"                       x WHERE x."empresaId"=p."empresaId" AND x."unidadStockId"  = p.id) AS prod_stock,
       (SELECT count(*) FROM "Producto"                       x WHERE x."empresaId"=p."empresaId" AND x."unidadCompraId" = p.id) AS prod_compra,
       (SELECT count(*) FROM "Presentacion"                   x WHERE x."empresaId"=p."empresaId" AND x."unidadCompraId" = p.id) AS presentaciones,
       (SELECT count(*) FROM "ProveedorPorProducto"           x WHERE x."empresaId"=p."empresaId" AND x."unidadCompraId" = p.id) AS prov_x_prod,
       (SELECT count(*) FROM "RecetaIngrediente"              x WHERE x."empresaId"=p."empresaId" AND x."unidadId"       = p.id) AS receta_lineas,
       (SELECT count(*) FROM "RecetaVersion"                  x WHERE x."empresaId"=p."empresaId" AND (x."rendimientoUnidadId"=p.id OR x."racionUnidadId"=p.id)) AS receta_cabecera,
       (SELECT count(*) FROM "ConsumoDeOpcion"                x WHERE x."empresaId"=p."empresaId" AND x."unidadId"       = p.id) AS consumo_opcion,
       (SELECT count(*) FROM "MovimientoStock"                x WHERE x."empresaId"=p."empresaId" AND x."unidadCompraId" = p.id) AS movimientos,
       (SELECT count(*) FROM "FacturaProveedorRenglon"        x WHERE x."empresaId"=p."empresaId" AND x."unidadCompraId" = p.id) AS renglones_factura
  FROM propuesta p JOIN "Empresa" e ON e.id = p."empresaId"
 ORDER BY e.slug, p.magnitud, p.nombre;

\echo
\echo '=== 2. RESUMEN POR EMPRESA: cuántas unidades se rellenarían solas y cuántas quedan pendientes ==='
SELECT e.slug AS empresa, count(*) AS unidades,
       count(*) FILTER (WHERE p.situacion = 'EXACTA')                         AS exactas,
       count(*) FILTER (WHERE p.situacion LIKE 'ENVASE%')                     AS envases_a_unidad,
       count(*) FILTER (WHERE p.situacion LIKE 'PENDIENTE%')                  AS pendientes,
       count(*) FILTER (WHERE p.situacion = 'PENDIENTE (no es 1 a 1)')        AS pendientes_no_1_a_1,
       count(*) FILTER (WHERE p.situacion = 'PENDIENTE (la magnitud no calza con el nombre)') AS pendientes_magnitud
  FROM propuesta p JOIN "Empresa" e ON e.id = p."empresaId"
 GROUP BY e.slug ORDER BY e.slug;

\echo
\echo '=== 3. LAS DE LAS 14 QUE NINGUNA UNIDAD DE LA EMPRESA CUBRE (lo que agregaría la etapa U3) ==='
SELECT e.slug AS empresa,
       14 - count(DISTINCT p.codigo_propuesto)                                AS faltan_de_las_14,
       (SELECT string_agg(c.codigo, ', ' ORDER BY c.codigo) FROM catorce c
         WHERE c.codigo NOT IN (SELECT q.codigo_propuesto FROM propuesta q WHERE q."empresaId" = e.id AND q.codigo_propuesto IS NOT NULL)) AS cuales
  FROM "Empresa" e LEFT JOIN propuesta p ON p."empresaId" = e.id
 WHERE current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug')
 GROUP BY e.id, e.slug ORDER BY e.slug;

\echo
\echo '=== 4. COHERENCIA DEL FACTOR (I8): productos con compra y stock comparables (misma dimensión, equivalencia exacta) y su factor contra el cociente de la tabla ==='
-- Se listan SOLO los que no coinciden (no se corrigen solos: quedan «pendiente de revisar»); la fila de totales dice cuántos se compararon.
SELECT e.slug AS empresa, count(c.producto) AS productos_comparados,
       count(c.producto) FILTER (WHERE c.factor_cargado = c.factor_segun_tabla)  AS coherentes,
       count(c.producto) FILTER (WHERE c.factor_cargado <> c.factor_segun_tabla) AS a_revisar
  FROM "Empresa" e LEFT JOIN comparables c ON c."empresaId" = e.id
 WHERE current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug')
 GROUP BY e.slug ORDER BY e.slug;
SELECT e.slug AS empresa, c.producto, c.unidad_compra, c.unidad_stock, c.factor_cargado, c.factor_segun_tabla, 'PENDIENTE DE REVISAR' AS resultado
  FROM comparables c JOIN "Empresa" e ON e.id = c."empresaId"
 WHERE c.factor_cargado <> c.factor_segun_tabla
 ORDER BY e.slug, c.producto;
-- Los envases (caja, pack…) no se comparan acá: su contenido vive en el factor de cada producto y no tiene cociente en la tabla.

\echo
\echo '=== 5. SUMA DE CONTROL (I10): estos números tienen que dar EXACTAMENTE IGUAL antes y después de rellenar las equivalencias ==='
SELECT e.slug AS empresa,
       (SELECT count(*)                         FROM "MovimientoStock"    m WHERE m."empresaId" = e.id) AS movimientos,
       (SELECT coalesce(sum(m.cantidad), 0)     FROM "MovimientoStock"    m WHERE m."empresaId" = e.id) AS suma_cantidad,
       (SELECT coalesce(sum(m."precioTotal"), 0) FROM "MovimientoStock"   m WHERE m."empresaId" = e.id) AS suma_precio_total,
       (SELECT coalesce(sum(x."factorConversion"), 0) FROM "Presentacion" x WHERE x."empresaId" = e.id) AS suma_factor_presentaciones,
       (SELECT coalesce(sum(x."factorConversion"), 0) FROM "Producto"     x WHERE x."empresaId" = e.id) AS suma_factor_productos,
       (SELECT count(*)                         FROM "RecetaIngrediente"  x WHERE x."empresaId" = e.id) AS lineas_de_receta,
       (SELECT count(*)                         FROM "Unidad"             x WHERE x."empresaId" = e.id) AS unidades
  FROM "Empresa" e
 WHERE current_setting('informe.slug') = '' OR e.slug = current_setting('informe.slug')
 ORDER BY e.slug;

ROLLBACK;
