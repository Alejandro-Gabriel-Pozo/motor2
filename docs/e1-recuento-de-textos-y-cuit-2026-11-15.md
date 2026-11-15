# E1 · Recuento de nombres y CUIT que romperían la regla nueva (solo lectura)

Etapa E1 del plan de paridad con Pedernal (`motor2-docs/_planes/plan-de-paridad-con-pedernal-2026-11-14.md`, §E1). Pedido del dueño: «Sí, copiar a Pedernal en esas cinco» (2026-11-15, chat con el orquestador, relatado) y «Necesitamos ser iguales en todo…» (2026-11-13).

**Estado de este documento: la regla ya existe como código puro (`src/core/datos/texto-de-catalogo.ts`, `fichas-de-texto.ts`, `src/core/fiscal/cuit-estricto.ts`) y NO está conectada a ninguna pantalla ni acción.** Antes de conectarla hay que contar cuántos datos ya cargados la romperían. La consulta de abajo es de SOLO LECTURA; la corre el orquestador sobre una copia de la base (nunca escribe, nunca sobre producción en caliente). Quien la corre decide después, con el dueño, qué conectar.

## 1. Qué mide

Para cada columna de nombre, aplica a lo guardado la misma normalización y la misma lista de permitidos que el código (recortar extremos, NFC, colapsar espacios; lista de letras latinas, dígitos y signos; sin `+`/`-` al principio; largo por ficha; letra obligatoria según la ficha) y cuenta, por columna y motivo, las filas que serían rechazadas. Las filas que solo cambian al normalizar (espacios dobles, NFC) se cuentan aparte: NO romperían, se reescribirían.

| Ficha (largo · letra · signos de catálogo `¿ ¡ ? ! % $`) | Columnas de Motor2 medidas |
|---|---|
| PRODUCTO (120 · sí · sí) | `Producto.nombre`, `Insumo.nombre` |
| ELECCION (80 · no · sí) | `SeccionCarta.nombre`, `GrupoDeOpciones.nombre`, `OpcionDeGrupo.nombre`, `CategoriaProducto.nombre` (el nodo de la clasificación comercial de Pedernal usa esta ficha) |
| RAZON_SOCIAL (200 · sí · no) | `Proveedor.nombre`, `Cliente.nombre` |
| REFERENCIA (se mide con ELECCION, 80 · no · sí) — **Pedernal no tiene una ficha verificada para estos datos** (NO VERIFICADO); la medición solo dice cuántos romperían si se les aplicara la de la sección | `Grupo.nombre`, `Seccion.nombre`, `Sucursal.nombre`, `Rol.nombre`, `MotivoMerma.nombre`, `DestinoConsumo.nombre`, `ConceptoDeGasto.nombre`, `ItemAgrupadoCarta.nombre`, `GeneroCarta.nombre`, `PlanDeCostos.nombre`, `CentroDeCostos.nombre`, `Empresa.nombre` |

`Unidad.nombre` no se mide: las unidades pasan a ser las 14 fijas de Pedernal (etapa E2, otra decisión). Los CUIT (`Proveedor.cuit`, `Empresa.cuit`, `Invitacion.cuitDeclarado`) se miden aparte con la regla estricta (§3).

Se miden TODAS las filas, activas o no, de todas las empresas (la unicidad de Pedernal también cuenta los desactivados). La consulta necesita un rol que no esté sujeto a RLS (el dueño de las tablas o un superusuario sobre la copia); con el rol de la aplicación solo vería una empresa.

## 2. Consulta de nombres (copiar y pegar; solo `SELECT`)

```sql
-- E1 · recuento de nombres que romperían la regla de texto de catálogo. SOLO LECTURA.
-- Equivalencias con el código: trim de JavaScript (espacios, saltos, BOM) → primer regexp_replace; NFC → normalize; colapso de Zs → segundo regexp_replace.
-- Aproximación declarada: el barrido de caracteres de Postgres es el de su librería regex; la fuente de verdad sigue siendo el código (los casos límite se revisan a mano).
WITH fichas(ficha, maximo, exigir_letra, con_signos_de_catalogo) AS (
  VALUES ('PRODUCTO', 120, true, true),
         ('ELECCION', 80, false, true),
         ('RAZON_SOCIAL', 200, true, false),
         ('REFERENCIA', 80, false, true)
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
  UNION ALL SELECT 'Sucursal', 'nombre', 'REFERENCIA', id, nombre FROM "Sucursal"
  UNION ALL SELECT 'Rol', 'nombre', 'REFERENCIA', id, nombre FROM "Rol"
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
-- (a) Resumen: por columna, cuántas filas hay, cuántas romperían y por qué motivo.
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
```

### 2.1 Ejemplos de lo que rompería (pegar a continuación, mismo `WITH`; cambiar solo el `SELECT` final)

```sql
-- Reemplaza el SELECT final del bloque anterior. Hasta 5 ejemplos por columna y motivo; `id` permite ubicar la fila sin copiar el dato.
SELECT tabla, columna, ficha, motivo, id, valor
FROM (SELECT v.*, row_number() OVER (PARTITION BY tabla, columna, motivo ORDER BY id) AS n FROM veredicto v WHERE motivo <> 'OK') x
WHERE n <= 5
ORDER BY ficha, tabla, motivo, n;
```

Para ver QUÉ carácter rompe, `SELECT DISTINCT ch FROM veredicto, regexp_split_to_table(c, '') AS ch WHERE motivo = 'CARACTER_PROHIBIDO' AND ch !~ '[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&()°:;"#ºª’“”–—«»®™''/+¿¡?!%$-]'` (mismo `WITH`).

## 3. Consulta de CUIT (regla estricta de `cuit-estricto.ts`)

La regla estricta NO limpia: acepta solo 11 dígitos o `XX-XXXXXXXX-X` con el dígito verificador correcto, y no filtra prefijos. Hoy `Empresa.cuit` y `Proveedor.cuit` se guardan en 11 dígitos (`validarCuit` devuelve la forma canónica) pero las migraciones dicen que seeds y pruebas lo escribieron a veces con guiones (`20261112160000_checks_de_datos_basicos`): la consulta lo dice.

```sql
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
```

Nota: la regla vieja (`esCuitValido`) también rechazaba el dígito verificador equivocado; lo que cambia es el prefijo (se deja pasar) y que la nueva no limpia espacios, puntos ni guiones sueltos antes de validar.

## 4. Cómo leer el resultado

- `pasan` = no pasa nada al conectar. `pasan_reescritas` = al guardar de nuevo quedarían normalizadas (espacios dobles, NFC); no rompe.
- `caracter_prohibido`, `demasiado_largo`, `sin_letras`, `vacio` = filas ya guardadas que **dejarían de poder editarse sin corregir el nombre**, y los comandos que las vuelvan a validar (por ejemplo una edición del mismo producto sin cambiar el nombre) las rechazarían. Qué hacer con esas filas (corregirlas a mano, una excepción por fila existente, o dejarlas) es decisión del dueño DESPUÉS del recuento; este documento no propone reescribir datos. Cualquier corrección masiva es una migración de datos y necesita su propio diseño y autorización expresa.
- Una cifra del recuento no autoriza endurecer: el dueño decide con el número en la mano.

## 5. Puntos de validación que existen hoy y a qué ficha corresponderían

Inventario verificado en el código de Motor2 (rama `main`, 2026-11-15). **Ninguno se cambió.** Hoy todos validan con `validarTextoCatalogo` / `RE_TEXTO_CATALOGO` (`src/core/texto.ts`: cualquier letra o número Unicode, más `- . , ( ) % & / ' _`, 80 caracteres, sin `-` inicial), que acepta alfabetos no latinos y `_` y no admite `+ : ; " # ¿ ¡ ? ! $ ° ª º « » ® ™`.

| Dato | Dónde se valida hoy (archivo:línea) | Ficha de Pedernal | Riesgo de conectar |
|---|---|---|---|
| Nombre de producto | `src/core/features/catalogo/productos.guard.ts:101` (`validarTextoCatalogo`); `:46`/`duplicar-producto.guard.ts:34` (`nombreDeCatalogo`) | PRODUCTO (120, letra) | Sube el largo de 80 a 120 (más permisivo) y exige letra; rechaza alfabeto no latino y `_`. Las columnas de base pueden tener tope propio: NO VERIFICADO si hay CHECK de 80 en `Producto.nombre`. Único por empresa sin mayúsculas: no cambia. |
| Nombre de insumo y de grupo de insumos | `src/core/features/catalogo/insumos.guard.ts:21,28,35` | PRODUCTO (insumo) · REFERENCIA (grupo) | Igual; el grupo de insumos no tiene ficha verificada en Pedernal. |
| Categoría de producto | `src/core/features/catalogo/categorias-producto.guard.ts:19` | ELECCION (nodo) | Baja de 80 a 80 (igual); admite `¿¡?!%$`; rechaza `_` y no latinos. Depende de E4. |
| Proveedor | `src/core/features/catalogo/proveedores.guard.ts:24`; `src/server/actions/catalogo/casos-de-uso/actualizar-proveedor.ts:52` | RAZON_SOCIAL (200, letra, sin `¿¡?!%$`) | Sube a 200; **deja de admitir `%`**; exige letra (un nombre solo de dígitos se rechaza). |
| Cliente | `src/core/features/clientes/clientes.guard.ts:17` | RAZON_SOCIAL | Igual que proveedor. |
| Unidad | `src/core/features/catalogo/unidades.guard.ts:31` | (E2: 14 unidades fijas) | No se toca en E1. |
| Sección de carta, ítem agrupado, género | `src/core/carta/validaciones.ts:85,94,103`; `src/core/features/carta/secciones.guard.ts` | ELECCION (sección) · REFERENCIA (ítem agrupado, género) | Mismo largo; cambia el conjunto de signos. |
| Grupo y opción de venta (opciones de un producto) | `src/core/features/catalogo/opciones-de-venta.guard.ts:96` (`validarNombreCatalogo`), `:194`, `:258` (`RE_TEXTO_CATALOGO`) | ELECCION (grupo, opción) | `validarNombreCatalogo` hoy exige letra O número; ELECCION no exige letra. Más permisivo en eso, más estricto en alfabetos. |
| «Nombre en la carta» del producto | `src/core/features/carta/contenido-producto.guard.ts:29` (CHECK `ContenidoCartaProducto_nombre_en_carta_chk`) | ELECCION | No se comparó con Pedernal en esta etapa (NO VERIFICADO si Pedernal tiene la misma columna). |
| Sucursal, rol | `src/core/features/sucursales/sucursal.guard.ts:22,38`; `src/core/permisos/nombres-de-rol.ts:27` | sin ficha verificada | Pedernal puede tratarlos distinto (los roles son de plataforma): preguntar antes de conectar. |
| Motivos y secciones de movimientos | `src/core/features/movimientos/secciones.guard.ts:15`; `motivos.guard.ts:22` | sin ficha verificada | Idem. `motivos.guard.ts:15` ya tiene su propio charset para `descripcion`. |
| CUIT (empresa, proveedor, invitación, consola de plataforma) | `src/core/fiscal/cuit.ts` (`validarCuit`, `normalizarCuit`, `esCuitValido`) usado en `src/core/features/catalogo/contacto-de-proveedor.ts:21`, `src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente.ts:91`, `src/app/invitacion/formulario-de-aceptacion.tsx:24`, `plataforma/src/servidor/ciclo-de-vida.ts:93,165`, `src/core/fiscal/diagnostico-cuit.ts:51,62` | `cuitDesdeTexto` (estricto) | Quitar la lista de prefijos: más permisivo. No limpiar espacios/puntos: es más estricto con lo que escribe una persona; hay que decidir dónde se recorta antes de validar (formulario y servidor). Es el punto de mayor riesgo para el alta de empresas. |
| Otros usos de `esTextoDeUnaLinea` (no son nombres) | `src/core/seguridad/ruta-servible.ts:25`, `src/core/carta/tema.ts:273` | — | Fuera de alcance. |

Lo que NO se cambia en la base: los CHECK de las columnas de nombre de hoy son de largo y «no solo espacios»; Pedernal repite la lista de permitidos en la base (`texto_de_catalogo_valido`, migración 0025 y 0043 de Pedernal). Repetirla en Motor2 es una migración (aditiva y reversible si se hace por columna, con las filas que no cumplen resueltas antes); **no está autorizada ni propuesta acá**.

## 6. Qué decide el dueño después del recuento

1. Por cada columna con filas que rompen: corregir a mano, aceptar que queden como están (solo se rechazan al editar el nombre) o no conectar esa columna.
2. Qué fichas usan los datos sin ficha verificada (grupo de insumos, sucursal, rol, motivos, secciones de movimientos, ítem agrupado, género).
3. Dónde se recorta lo que escribe una persona en el CUIT (la regla nueva no lo hace).
4. Si se repite la lista en la base (migración): decisión aparte.
