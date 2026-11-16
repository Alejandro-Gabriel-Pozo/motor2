# E1 · Recuento de nombres y CUIT que romperían la regla nueva (solo lectura)

Etapa E1 del plan de paridad con Pedernal (`motor2-docs/_planes/plan-de-paridad-con-pedernal-2026-11-14.md`, §E1). Pedido del dueño: «Sí, copiar a Pedernal en esas cinco» (2026-11-15, chat con el orquestador, relatado) y «Necesitamos ser iguales en todo…» (2026-11-13).

**Estado de este documento:** la regla existe como código puro (`src/core/datos/texto-de-catalogo.ts`, `fichas-de-texto.ts`, `src/core/fiscal/cuit-estricto.ts`; PR #284, sin conectar). El PR de conexión (§5) la conecta en los puntos donde Pedernal la aplica, según lo aclarado por el dueño el 2026-11-15 («No, lo que quiero es igualar a pedernal acá...», relatado por el orquestador). El recuento de abajo se hizo ANTES de conectar; las consultas son de SOLO LECTURA, las corre el orquestador sobre una copia de la base (nunca escribe) y se repiten en cada base antes del deploy.

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

## 4.1 Recuento sobre la copia del 12/11 (corrido por el orquestador, solo lectura)

Consultas de §2 y §3, sobre UNA copia de la base del 12/11, con un rol sin RLS: 1 empresa y 75 productos. Sin nombres de empresa ni ids.

| Columna | Filas | Pasan | Rompen | Se reescribirían al normalizar |
|---|---|---|---|---|
| `Producto.nombre` | 75 | 75 | 0 | 0 |
| `CategoriaProducto.nombre` | 2 | 2 | 0 | 0 |
| `GrupoDeOpciones.nombre` | 47 | 47 | 0 | 0 |
| `OpcionDeGrupo.nombre` | 126 | 126 | 0 | 3 (espacios o NFC) |
| `SeccionCarta.nombre` | 14 | 14 | 0 | 0 |
| `Proveedor.nombre` | 1 | 1 | 0 | 0 |
| `GeneroCarta.nombre` | 10 | 10 | 0 | 0 |
| `MotivoMerma.nombre` | 6 | 6 | 0 | 0 |
| `DestinoConsumo.nombre` | 5 | 5 | 0 | 0 |
| `Rol.nombre` | 3 | 3 | 0 | 0 |
| `Seccion.nombre` | 2 | 2 | 0 | 0 |
| `Sucursal.nombre` | 6 | 6 | 0 | 0 |
| `Empresa.nombre` | 1 | 1 | 0 | 0 |
| `Insumo`, `Cliente`, `Grupo`, `ItemAgrupadoCarta`, `ConceptoDeGasto` | 0 | – | – | – |

Cero filas con `vacio`, `caracter_prohibido`, `demasiado_largo` o `sin_letras`. CUIT: `Empresa.cuit` 1 de 1 pasa (sin guiones, sin formato ni verificador inválido, sin depender del prefijo); `Proveedor.cuit` e `Invitacion.cuitDeclarado` sin filas con CUIT.

**Límite:** es UNA copia del 12/11. El recuento se repite en cada base antes de conectar y antes del deploy. Este resultado no autoriza conectar: eso lo decide el dueño.

## 5. Puntos de validación de nombres: estado después de conectar

Inventario verificado en el código de Motor2 (2026-11-15). Antes de E1 todos validaban con `validarTextoCatalogo` / `RE_TEXTO_CATALOGO` (`src/core/texto.ts`: cualquier letra o número Unicode, más `- . , ( ) % & / ' _`, 80 caracteres, sin `-` inicial). La tabla de abajo es la que recorre `test/arquitectura/nombres-puntos-de-validacion.test.ts`: si aparece un punto de validación de nombre nuevo sin declarar, falla.

### 5.1 Conectados a la regla de Pedernal (alta estricta; edición estricta SOLO si el nombre cambia)

| Archivo | Ficha | Dato |
|---|---|---|
| `src/core/features/catalogo/productos.guard.ts` | PRODUCTO | nombre de producto (alta rápida y alta/edición completa) |
| `src/server/lecturas/catalogo/datos-de-producto.ts` | PRODUCTO | nombre de producto (estricta en el alta; en la edición solo si cambió) |
| `src/core/features/catalogo/duplicar-producto.guard.ts` | PRODUCTO | nombre del producto duplicado |
| `src/core/features/catalogo/insumos.guard.ts` | PRODUCTO | insumo (conectado); grupo de insumos (viejo) |
| `src/server/actions/catalogo/casos-de-uso/renombrar-o-fusionar-insumo.ts` | PRODUCTO | renombrar un insumo (estricta solo si cambia) |
| `src/core/features/catalogo/categorias-producto.guard.ts` | ELECCION | categoría de producto |
| `src/core/features/catalogo/proveedores.guard.ts` | RAZON_SOCIAL | alta de proveedor |
| `src/server/actions/catalogo/casos-de-uso/actualizar-proveedor.ts` | RAZON_SOCIAL | edición de proveedor (estricta solo si cambia) |
| `src/core/features/clientes/clientes.guard.ts` | RAZON_SOCIAL | alta y edición de cliente |
| `src/server/actions/clientes/casos-de-uso/actualizar-cliente.ts` | RAZON_SOCIAL | edición de cliente (estricta solo si cambia) |
| `src/core/features/carta/secciones.guard.ts` | ELECCION | sección de carta |
| `src/server/actions/carta/casos-de-uso/guardar-seccion-carta.ts` | ELECCION | edición de sección de carta (estricta solo si cambia) |
| `src/core/features/catalogo/opciones-de-venta.guard.ts` | ELECCION | grupo y opción de venta (conectado); descripción y prefijo «se lee en la carta como» (viejo, no son nombres) |
| `src/server/actions/catalogo/casos-de-uso/editar-grupo-de-opciones.ts` | ELECCION | edición de grupo de opciones (estricta solo si cambia) |
| `src/server/actions/catalogo/casos-de-uso/editar-opcion-de-grupo.ts` | ELECCION | edición de opción (estricta solo si cambia) |

Fichas: PRODUCTO (1 a 120, con letra, con `¿ ¡ ? ! % $`), ELECCION (1 a 80, sin exigir letra, con `¿ ¡ ? ! % $`: sección de carta, grupo y opción de venta y categoría de producto), RAZON_SOCIAL (1 a 200, con letra, sin `¿ ¡ ? ! % $`: proveedor y cliente).

En las ediciones el guard solo recorta, exige no vacío y el tope de la ficha; el caso de uso, que lee la fila, aplica la regla estricta solo si el nombre pedido es distinto del guardado (la comparación la hace el servidor). Lo ya guardado que no cumple no se toca ni bloquea lecturas.

### 5.2 Sin regla de Pedernal verificada: siguen con la regla vieja (NO se conectan ni se inventan)

| Archivo | Validador viejo | Dato | Qué hace Pedernal |
|---|---|---|---|
| `src/core/permisos/nombres-de-rol.ts` | nombreDeFicha (NOMBRE_DE_ROL, desde el 2026-11-16; antes validarTextoCatalogo) | nombre de rol | rol: sin regla de Pedernal; decisión pendiente (NO VERIFICADO si Pedernal lo valida; no se encontró) |
| `src/core/features/sucursales/sucursal.guard.ts` | nombreDeFicha (NOMBRE_DE_SUCURSAL, desde el 2026-11-16; antes validarTextoCatalogo) | nombre de sucursal | sucursal: regla propia (NFC, recorte, 1 a 100 caracteres, rechaza controles con una lista de prohibidos; la base no limita): no es la ficha de catálogo y choca con «todo nace cerrado» |
| `src/core/features/carta/contenido-producto.guard.ts` | nombreDeFicha (ELECCION, desde el 2026-11-16) | «Nombre en la carta» del producto | nombre en la carta: sin regla de Pedernal; decisión pendiente (NO VERIFICADO) |
| `src/core/features/catalogo/unidades.guard.ts` | nombreDeCatalogo → ficha ELECCION (desde el 2026-11-16) | nombre de unidad | unidad: catálogo FIJO de 14 unidades (etapa E2, otra decisión) |
| `src/core/features/movimientos/secciones.guard.ts` | nombreDeCatalogo → ficha ELECCION (desde el 2026-11-16) | sección de movimientos | depósito de stock: usa la ficha de elección y la base lo repite; la equivalencia con la «sección» de Motor2 NO está verificada |
| `src/core/features/movimientos/motivos.guard.ts` | nombreDeCatalogo → ficha ELECCION (desde el 2026-11-16) | motivo de merma y destino de consumo | motivos de movimiento: catálogo FIJO sembrado por código (clase cerrada), no texto libre; merma y destino: no encontrado |
| `src/core/carta/validaciones.ts` | nombreDeFicha (ELECCION, desde el 2026-11-16) | ítem agrupado y género de la carta | ítem agrupado y género: sin regla de Pedernal; decisión pendiente (no encontrado en Pedernal) |
| `src/core/features/catalogo/insumos.guard.ts` | nombreDeCatalogo → ficha ELECCION (desde el 2026-11-16) | insumo (conectado); grupo de insumos (viejo) | grupo de insumos: sin regla de Pedernal; decisión pendiente |
| `src/core/features/catalogo/opciones-de-venta.guard.ts` | nombreDeFicha (ELECCION, desde el 2026-11-16) | grupo y opción de venta (conectado); descripción y prefijo «se lee en la carta como» (viejo, no son nombres) | descripción y prefijo en la carta: sin regla de Pedernal; decisión pendiente |

### 5.3 CUIT (fuera de la tabla que recorre el guardián de nombres)

`validarCuit` (`src/core/fiscal/cuit.ts`) ahora delega en la regla estricta de Pedernal (`cuit-estricto.ts`) y lo usan los cuatro puntos: `src/core/features/catalogo/contacto-de-proveedor.ts` (proveedor), `src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente.ts` y `src/app/invitacion/formulario-de-aceptacion.tsx` (invitación y empresa), `plataforma/src/servidor/ciclo-de-vida.ts` (consola de plataforma). Se sigue guardando la forma canónica de 11 dígitos. Los mensajes son los de Pedernal (§6, punto 2). `normalizarCuit` y `esCuitValido` (con la lista de prefijos) quedan SOLO para el diagnóstico de la consola de plataforma (`src/core/fiscal/diagnostico-cuit.ts`) y para comparar el CUIT declarado por el gerente con el escrito en la consola (`plataforma/.../botones.tsx`): leen datos viejos con separadores.

## 6. Qué decide el dueño

1. Los datos «sin regla de Pedernal» (§5.2): con la evidencia de la tabla, si se les aplica una ficha, se dejan como están o se espera a que Pedernal los defina.
2. (RESUELTA, 2026-11-15, chat con el orquestador, relatada) Mensajes: «Como Pedernal: mensaje genérico de dato inválido (Recomendada)» para los nombres que no cumplen (el texto es «Esta acción no está permitida», `ZuluHub-ERP/src/capacidades/vocabulario/catalogo-catalogo.ts:104`, que es el destino de todo error de nombre de catálogo en `src/composicion/errores-de-catalogo.ts`; el nombre vacío conserva el «… no puede estar vacío.» de cada pantalla) y «Como Pedernal (Recomendada)» para el CUIT («El CUIT no tiene un formato válido. Escribilo con 11 números.» y «El CUIT no es válido. Revisá los números.», `apps/plataforma/logica/errores-de-plataforma.ts:84-88`). Los dos goldens de `test/auth/caracterizacion` se regeneraron y cambian solo esas líneas.
3. Si se repite la lista en la base (CHECK por columna): decisión aparte, migración; no está autorizada ni propuesta acá.
