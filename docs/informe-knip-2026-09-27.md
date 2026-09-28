# Informe knip — código y dependencias sin uso (Task #41, Fase K1) — 2026-09-27

> **Refrescado el 2026-09-27 (tarde) tras Fase C y Fase M8-M12d — la clasificación original quedó desactualizada por los
> refactors del mismo día.** Las tablas de MUERTO REAL / FALSO POSITIVO / RESERVADO de este documento son las **actuales**
> (código de `main` en `8aac182`). La lista de trabajo **vigente para K2 es la de 50 hallazgos** de la sección
> [MUERTO REAL (50)](#muerto-real-50--lista-de-trabajo-vigente-para-k2); la lista original de 34 queda reemplazada (los 34
> siguen todos adentro, más 16 nuevos). Ver [Refresco](#refresco-2026-09-27-tarde--qué-cambió-respecto-de-la-clasificación-original)
> para el detalle de qué cambió y por qué.

Corrida de [knip](https://knip.dev) (v6.38.0) sobre `motor2`. Se corre con:

```sh
npm run analizar:muerto   # = knip --no-exit-code  (INFORMATIVO: siempre sale con 0, no bloquea nada todavía)
```

La configuración vive en `knip.jsonc`, con el motivo de cada exclusión anotado al lado. Esta tarea **no borra nada**: lo
que acá figura como MUERTO REAL es la lista de trabajo de la **Task K2** (todavía sin aprobar por el dueño).

## Cómo se clasificó

Cada hallazgo de la corrida con config mínima (solo las entradas pedidas + `project` = `src`, `test`, `scripts`,
`prisma`) quedó en una de tres categorías:

| Categoría | Qué es | Qué se hizo en `knip.jsonc` |
|---|---|---|
| **MUERTO REAL** | Candidato genuino a borrar/corregir en K2. | Nada: **sigue apareciendo** en `npm run analizar:muerto` hasta que K2 lo resuelva. |
| **FALSO POSITIVO** | knip lo marcaba mal por cómo estaba configurado. | Se corrigió la config (entrada o `project` que faltaba) con el motivo. |
| **RESERVADO** | Es intencional. | Se ignora (`ignoreDependencies` / `ignoreExportsUsedInFile`) con un comentario del porqué. |

Para separar "símbolo muerto" de "`export` sobrante" se revisó, para cada export sin uso, si el símbolo se usa en código
(no en comentarios) dentro de su propio archivo y si aparece en algún otro archivo de `src/`, `test/`, `scripts/` o
`prisma/`. Una **reexportación** sin consumidor (el símbolo vive y se usa en otro archivo; lo que sobra es solo el
`export { X } from` / `export type { X } from`) se cuenta aparte, como "reexportación sobrante".

## Refresco 2026-09-27 (tarde) — qué cambió respecto de la clasificación original

### Cómo se rehizo

1. Se reprodujo la corrida original: `knip` sobre el commit de K1 (`c6c7a94`), con su propio `knip.jsonc`, da
   **exactamente** los 34 del informe original (31 exports + `ProcesoSlug` + las 2 dependencias). Así la comparación es
   contra una base verificada, no contra la memoria del informe.
2. Se corrió `npm run analizar:muerto` sobre `main` actual (`8aac182`, después de B1, B2, C1-C3, D1-D9 y M1-M12d): **50**
   hallazgos (1 devDependency, 1 unlisted, 38 exports, 10 tipos) y ningún hint de configuración.
3. Cada uno de los 50 se verificó de nuevo con `grep` sobre `src/`, `test/`, `scripts/` y `prisma/` (uso en su archivo /
   uso en otros), incluidos los 34 que se repiten — no se dio por buena la clasificación anterior.
4. Para recontar RESERVADO se corrió knip con `ignoreExportsUsedInFile` apagado (`--include types`): 111 tipos, de los
   cuales 101 son los que oculta la regla y 10 son los que siguen apareciendo.
5. Para confirmar que las 5 correcciones de FALSO POSITIVO siguen haciendo falta se corrió knip sin ellas (vuelven a salir
   los 2 archivos, `cookies`/`headers`, `tailwindcss` y el hint de `.css`), y sin `ignoreDependencies` (vuelven `pg` y
   `@types/pg`).

### Resultado del refresco

- **Ningún hallazgo del informe original desapareció**: los 34 siguen siendo MUERTO REAL con la misma explicación. Solo
  cambió la línea de `resumenPeriodicoPorProceso` (`periodo.ts:1132` → `periodo.ts:187`, por la división de B1).
- **16 hallazgos nuevos**, todos MUERTO REAL. Ninguno es falso positivo de configuración ni amerita una entrada nueva de
  RESERVADO; cada uno tiene su causa concreta:

| Nuevo hallazgo | Categoría | Por qué aparece ahora |
|---|---|---|
| 9 tipos de `src/core/reportes/periodo.ts` (`ItemPeriodo`, `RatioGastoVentas`, `ComprasDelPeriodo`, `FilaCompraPorProveedorProducto`, `GastoPorInsumoDelPeriodo`, `FilaVentaProducto`, `VentasDelPeriodo`, `MargenDelPeriodo`, `VentaConCategoria`) | Reexportación sobrante | **B1** (`bb0157c`) dividió `periodo.ts` en `periodo-*.ts` y lo dejó como fachada que reexporta con nombre "todo lo que este archivo exportaba antes, para que ningún importador cambie". Antes de B1 estos tipos se *declaraban* en `periodo.ts`: 3 (`ItemPeriodo`, `FilaCompraPorProveedorProducto`, `FilaVentaProducto`) estaban en RESERVADO por usarse en su archivo, y los otros 6 ni aparecían porque knip los contaba como usados al estar en la firma de funciones exportadas que sí se consumían (`isReferencedInUsedExport`). Ahora en `periodo.ts` son solo `export type { X } from "./periodo-*"`: la declaración (y su uso) vive en el `periodo-*.ts`, y **nadie importa esos 9 nombres desde `periodo.ts`** (sí se importan desde ahí `FiltrosPeriodo`, `FilaAlertaDigest`, `FilaCompraPorProveedor`, `FilaGastoPorGrupo`, `FilaGastoPorInsumo`, `ComparativaPreciosDelPeriodo`, `FilaPrecioInsumo`, `FilaMargenProducto`, `FilaCategoriaVenta`, que no aparecen). Mismo caso que `CANTIDAD_MAXIMA_POR_ITEM` en `pos/cuenta.ts`: una reexportación "de compatibilidad" sin nadie a quien darle compatibilidad. |
| `detalleReversionDeVenta` en `src/core/movimientos/public.ts:27` | Reexportación sobrante | **C2** (`1dc0ff0`) creó la fachada y pasó el import de la Server Action `venta.ts` a `@/core/movimientos/public`. En paralelo **M8** (`a54ae71`) movió el cuerpo de `anularVenta` a `server/actions/movimientos/casos-de-uso/anular-venta.ts`, que importa `detalleReversionDeVenta` (junto con `evaluarAnulacionDeVenta`, `construirReversionDeVenta`, etc.) **directo del interno** `@/core/movimientos/anulaciones`. Al mergear, `venta.ts` ya no lo usaba y la reexportación quedó huérfana. El test `test/casos-de-uso/anular-venta.test.ts` también lo importa del interno. Ver nota en la tabla de MUERTO REAL: en K2 la acción probablemente no es borrar sino alinear el import. |
| `ETIQUETA_CAMPO` en `src/core/compras/correccion.ts:97` | `export` sobrante | Existía desde antes (lo consumía la Server Action `server/actions/movimientos/compras.ts` para armar "Compra corregida: …" y la descripción de auditoría). **M6** (`6d56fa3`) movió esos textos a armadores puros dentro del mismo `correccion.ts`; la Server Action, único consumidor externo, dejó de usarlo. |
| `MENSAJE_CLAVE_REINTENTO_INVALIDA` en `src/core/features/compras/compra.guard.ts:48` | `export` sobrante | Nació exportado en **M2** (`b291175`). Solo lo usa el propio guard (rechazo de formato antes de abrir la transacción). Su test (`test/core/features/compras/compra-guard.test.ts`) afirma el texto literal `"Clave de reintento inválida."` en vez de importar la constante, así que no hay consumidor. |
| `MENSAJE_CLAVE_REINTENTO_INVALIDA` en `src/core/features/traspasos/traspaso-comandos.guard.ts:73` | `export` sobrante | Nació en **M11b** (`6e7a7e2`), **duplicado** del de `compra.guard.ts` (mismo nombre, mismo texto). Mismo patrón: lo usa solo `claveI3` del propio guard; el test afirma el literal. El mismo literal además está repetido a mano en 3 Server Actions (`movimientos/movimientos.ts`, `movimientos/venta.ts`, `stock/reclasificacion.ts`): candidato a unificar en K2, más allá del `export`. |
| `MENSAJE_FALTA_TRASPASO` en `traspaso-comandos.guard.ts:25` | `export` sobrante | Nació en **M11a** (`9ae7a05`). Lo usa solo `idDeTraspaso` del propio guard; el test (`test/core/features/traspasos/traspaso-comandos-guard.test.ts`) afirma el literal. Sus hermanos del mismo archivo (`MENSAJE_TRASPASO_NO_ENCONTRADO`, `MENSAJE_SECCION_ORIGEN_NO_PROPIA`, `MENSAJE_SUCURSAL_NO_DISPONIBLE`, …) **no** aparecen porque los casos de uso los importan para devolver `fracaso(...)` desde adentro de la transacción; éste solo se rechaza en el guard. |
| `MENSAJE_FALTA_SUCURSAL_ORIGEN` / `MENSAJE_FALTA_SUCURSAL_DESTINO` en `traspaso-comandos.guard.ts:131/134` | `export` sobrante | Nacieron en **M11c** (`0e9a7cd`). Mismo patrón que `MENSAJE_FALTA_TRASPASO`: los usa solo el guard de creación (sucursal vacía), el test afirma el literal. |

`TRANSICIONES_TRASPASO` y `PREFIJO_REVERSION_VENTA`/`PREFIJO_REVERSION_COMPRA` **no son nuevos**: ya estaban en la lista
original como "export sobrante" y se re-verificó que siguen igual (solo se usan en su archivo).

**Actualización 2026-09-27 (noche) — `detalleReversionDeVenta` YA RESUELTO, MUERTO REAL pasa de 50 a 49:**
`anular-venta.ts` y `registrar-venta.ts` (casos de uso de M8/M9) pasaron a importar `evaluarAnulacionDeVenta`,
`construirReversionDeVenta`, `mensajeVentaAnulada`, `descripcionAuditoriaAnulacionDeVenta` y `detalleReversionDeVenta` de
`@/core/movimientos/public.ts` (que ahora los reexporta) en vez de `@/core/movimientos/anulaciones` directo; y
`conTransaccionSerializable`/`calcularPayloadHash`/`chequearIdempotencia`/`MENSAJE_CONFLICTO_IDEMPOTENCIA`/
`registrarVentaEnTx` de `@/core/movimientos/public-servidor.ts` en vez de `con-reintento`/`idempotencia`/`registrar-venta`
directo. Gate completo verificado limpio antes de mergear. La reexportación de `detalleReversionDeVenta` ya no aparece en
`npm run analizar:muerto` — ver la tabla de MUERTO REAL actualizada más abajo.

**`server/actions/movimientos/venta.ts` (la Server Action, no el caso de uso) queda TAL CUAL, a propósito — no es un
descuido:** sigue importando `obtenerSeccionPropia` directo de `@/core/movimientos/stock`. Se intentó pasarlo por
`public-servidor.ts` y **`npm run arquitectura` lo rechazó**: `venta.ts` está en `ACCIONES_CON_CASO_DE_USO`, y la regla
`accion-migrada-sin-orquestacion` prohíbe que un archivo de esa lista importe `public-servidor.ts` — el archivo ENTERO
está vedado (no solo los símbolos de reintento/idempotencia que la regla busca frenar), justamente para que la regla no se
pueda esquivar coincidencia de un import inocente en el mismo archivo que uno prohibido. Como la regla
`sin-internals-de-otro-dominio` tampoco cubre `server/actions/` (por diseño, en los tres dominios con fachada), el import
directo del interno es hoy la ÚNICA opción compatible con las reglas vigentes para este caso puntual. Ver E1 para si en
algún momento se decide extender el guard a `server/actions/` — mientras tanto, este import se queda.

## Resumen

**Nota:** la tabla de abajo es la foto del refresco de la tarde (antes de resolver `detalleReversionDeVenta`); el número
vigente de MUERTO REAL para K2 es **49**, no el 50 que muestra esta tabla — ver "MUERTO REAL (49)" y la "Actualización"
del Refresco más arriba.

Clasificación actual, contada sobre la corrida con config mínima (sin las correcciones ni las exclusiones de
`knip.jsonc`):

| Tipo de hallazgo | Total | MUERTO REAL | FALSO POSITIVO | RESERVADO | (original K1: total / MR / FP / RES) |
|---|---:|---:|---:|---:|---|
| Archivos sin uso | 2 | 0 | 2 | 0 | 2 / 0 / 2 / 0 |
| Dependencias sin uso (`dependencies`) | 1 | 0 | 0 | 1 | 1 / 0 / 0 / 1 |
| Dependencias sin uso (`devDependencies`) | 3 | 1 | 1 | 1 | 3 / 1 / 1 / 1 |
| Dependencias no declaradas (unlisted) | 1 | 1 | 0 | 0 | 1 / 1 / 0 / 0 |
| Exports sin uso (valores) | 40 | 38 | 2 | 0 | 33 / 31 / 2 / 0 |
| Tipos exportados sin uso | 111 | 10 | 0 | 101 | 72 / 1 / 0 / 71 |
| **Total** | **158** | **50** | **5** | **103** | **112 / 34 / 5 / 73** |

Estado con el `knip.jsonc` actual: `npm run analizar:muerto` muestra **exactamente los 50 MUERTO REAL** y ningún hint de
configuración.

## MUERTO REAL (49) — lista de trabajo VIGENTE para K2

Reemplaza a la lista original de 34. Marcados con **(nuevo)** los 16 que no estaban.

### Dependencias (2)

| Hallazgo | Detalle | Acción sugerida en K2 |
|---|---|---|
| `@vitejs/plugin-react` (devDependency sin uso) | Ninguna config de Vitest lo carga (todas corren con `environment: "node"`, sin plugin de React) y nadie lo importa. | Desinstalar. |
| `fflate` (dependencia **no declarada**) | `test/core/excel.test.ts` lo importa (`unzipSync`, `strFromU8`) para abrir el `.xlsx` generado, pero no está en `package.json`: llega transitivo por `write-excel-file`. No es código muerto; es un hallazgo real del mismo informe. | Declararlo como devDependency (si `write-excel-file` lo suelta, el test se rompe sin aviso). |

### Símbolos muertos (7) — no se usan en ningún lado, ni en su propio archivo

| Símbolo | Archivo | Nota |
|---|---|---|
| `usoDeTipo` (function) | `src/core/catalogo/producto.ts:11` | Solo se menciona en comentarios de `src/core/movimientos/transiciones.ts` y en docs históricos. |
| `TIPO_MIME_XLSX` (const) | `src/core/excel.ts:18` | |
| `resumenPeriodicoPorProceso` (function) | `src/core/reportes/periodo.ts:187` | Port de `Reportes.js` que ninguna pantalla consume. B1 lo dejó en la fachada (antes estaba en la línea 1132). |
| `obtenerStockMinimoDetalleProducto` (function) | `src/core/stock/stock-minimo.ts:23` | |
| `textoUpper` (function) | `src/core/texto.ts:9` | Port de `Core.js` sin consumidores. |
| `mismoTexto` (function) | `src/core/texto.ts:14` | Port de `Core.js` sin consumidores. |
| `ProcesoSlug` (type) | `src/core/movimientos/ui-config.ts:73` | Único tipo *declarado* que no se usa ni en su archivo. |

### Reexportaciones sobrantes (10) — el símbolo vive y se usa en otro archivo; sobra solo la reexportación

`detalleReversionDeVenta` (`core/movimientos/public.ts:27`) estaba acá — **RESUELTO** (ver "Actualización 2026-09-27
(noche)" en el Refresco): `anular-venta.ts` ya importa de `public.ts`, la reexportación tiene consumidor real y dejó de
aparecer.

| Símbolo | Archivo | Nota / acción sugerida en K2 |
|---|---|---|
| `CANTIDAD_MAXIMA_POR_ITEM` | `src/core/pos/cuenta.ts:11` (`export { CANTIDAD_MAXIMA_POR_ITEM, validarCantidadPedido }`) | Re-export "de compatibilidad" (vive en `cantidad-pedido.ts`). `validarCantidadPedido` sí se sigue importando desde `cuenta.ts`; `CANTIDAD_MAXIMA_POR_ITEM` ya no — todos lo importan de `cantidad-pedido.ts`. El `import` en `cuenta.ts` existe solo para re-exportarlo. |
| `ItemPeriodo` (type) **(nuevo)** | `src/core/reportes/periodo.ts:20` | Declarado en `periodo-tipos.ts` (usado por `periodo.ts` y 4 `periodo-*.ts` importándolo de ahí). Nadie lo importa desde `periodo.ts`. |
| `RatioGastoVentas` (type) **(nuevo)** | `src/core/reportes/periodo.ts:22` | Declarado y usado en `periodo-ratio.ts` / `periodo-alertas.ts`. |
| `ComprasDelPeriodo` (type) **(nuevo)** | `src/core/reportes/periodo.ts:24` | Declarado y usado en `periodo-compras.ts`. |
| `FilaCompraPorProveedorProducto` (type) **(nuevo)** | `src/core/reportes/periodo.ts:26` | Declarado y usado en `periodo-compras.ts` (ahí queda en RESERVADO, como antes lo estaba en `periodo.ts`). |
| `GastoPorInsumoDelPeriodo` (type) **(nuevo)** | `src/core/reportes/periodo.ts:29` | Declarado en `periodo-compras.ts`, usado también por `periodo-alertas.ts`. |
| `FilaVentaProducto` (type) **(nuevo)** | `src/core/reportes/periodo.ts:32` | Declarado en `periodo-ventas.ts`, usado también por `periodo-precios.ts`. |
| `VentasDelPeriodo` (type) **(nuevo)** | `src/core/reportes/periodo.ts:32` | Declarado en `periodo-ventas.ts`, usado también por `periodo-margen.ts`. |
| `MargenDelPeriodo` (type) **(nuevo)** | `src/core/reportes/periodo.ts:33` | Declarado y usado en `periodo-margen.ts` (en `resumen-operativo.ts` solo aparece en comentarios). |
| `VentaConCategoria` (type) **(nuevo)** | `src/core/reportes/periodo.ts:34` | Declarado y usado en `periodo-categorias.ts`. |

Para los 9 de `periodo.ts` la acción sugerida es sacar esos nombres de las líneas `export type { … } from "./periodo-*"`
(los tipos siguen exportados en su `periodo-*.ts`; no se borra ninguna declaración). Afuera del dominio la puerta de
entrada ya no es `periodo.ts` sino `core/reportes/public.ts` / `public-servidor.ts` (C3), que reexportan "solo lo que hoy
se usa desde afuera".

### `export` sobrante (30) — el símbolo se usa, pero solo dentro de su propio archivo

Acá no hay nada para borrar: solo sobra la palabra `export` (achica la superficie pública del módulo). En K2 conviene
decidir caso por caso si alguno se exportó a propósito para un consumidor futuro — en ese caso pasa a RESERVADO con su
motivo en `knip.jsonc`.

| Símbolo | Archivo |
|---|---|
| `ventasDelDia` | `scripts/demo-seed/guion-la-cuadra.ts:121` (el `ventasDelDia` de `scripts/seed-demo-pizzeria.ts` es otra función local, homónima) |
| `valoresEfectivos` | `src/components/carta/vista-previa-tema.tsx:48` |
| `textoCotizacion` | `src/components/en-dolares.tsx:6` |
| `definicionClaveTema` | `src/core/carta/tema.ts:196` |
| `MAXIMO_TAGS_CARTA` | `src/core/carta/validaciones.ts:13` |
| `LARGO_MAXIMO_TAG_CARTA` | `src/core/carta/validaciones.ts:14` |
| `LARGO_MAXIMO_TAB_SHEET` | `src/core/carta/validaciones.ts:130` |
| `cadenaDeGrupos` | `src/core/catalogo/grupo.ts:13` |
| `NOMBRE_GRUPO_NO_COMESTIBLES` | `src/core/catalogo/no-comestibles.ts:12` |
| `describirOrigen` | `src/core/catalogo/origen-cambio-receta.ts:69` |
| `ETIQUETA_CAMPO` **(nuevo)** | `src/core/compras/correccion.ts:97` (M6 movió sus usos de la Server Action a este archivo) |
| `MENSAJE_NUMERO_INVALIDO` | `src/core/datos/numero-tecleado.ts:19` |
| `MENSAJE_CLAVE_REINTENTO_INVALIDA` **(nuevo)** | `src/core/features/compras/compra.guard.ts:48` (M2; el test afirma el literal) |
| `MENSAJE_FALTA_TRASPASO` **(nuevo)** | `src/core/features/traspasos/traspaso-comandos.guard.ts:25` (M11a; el test afirma el literal) |
| `MENSAJE_CLAVE_REINTENTO_INVALIDA` **(nuevo)** | `src/core/features/traspasos/traspaso-comandos.guard.ts:73` (M11b; duplicado del de `compra.guard.ts`) |
| `MENSAJE_FALTA_SUCURSAL_ORIGEN` **(nuevo)** | `src/core/features/traspasos/traspaso-comandos.guard.ts:131` (M11c; el test afirma el literal) |
| `MENSAJE_FALTA_SUCURSAL_DESTINO` **(nuevo)** | `src/core/features/traspasos/traspaso-comandos.guard.ts:134` (M11c; el test afirma el literal) |
| `TRANSICIONES_TRASPASO` | `src/core/features/traspasos/traspaso.guard.ts:34` |
| `PREFIJO_REVERSION_VENTA` | `src/core/movimientos/anulaciones.ts:14` |
| `PREFIJO_REVERSION_COMPRA` | `src/core/movimientos/anulaciones.ts:15` |
| `NOMBRE_INDICE_FACTURA_UNICA` | `src/core/movimientos/factura-unica.ts:18` |
| `MENSAJE_SIN_SECCIONES_ACTIVAS` | `src/core/movimientos/origen-venta-datos.ts:21` |
| `ESPERA_BASE_MS` | `src/core/movimientos/reintentar.ts:24` |
| `ESPERA_TOPE_MS` | `src/core/movimientos/reintentar.ts:25` |
| `LIMITE_MUTACIONES_POR_MINUTO` | `src/core/permisos/limitador-tasa.ts:37` |
| `COMENSALES_MAXIMO` | `src/core/pos/cuenta.ts:115` |
| `ESTADOS_MESA` | `src/core/pos/mesas.ts:19` |
| `MAXIMO_LIMITE_MESAS_ABIERTAS` | `src/core/pos/mesas.ts:103` |
| `obtenerResumenFinancieroDelRango` | `src/core/reportes/resumen-operativo.ts:44` |
| `contarFilasPorTabla` | `test/e2e/fixtures/base-e2e.ts:90` (helper de E2E: lo usa `verificarBaseIntacta`, en el mismo archivo) |

Nota para K2 sobre los 4 `MENSAJE_*` nuevos de guards: el patrón de la Fase M es que el guard exporta sus mensajes y los
tests afirman el **texto literal** (para detectar que cambió un texto visible), así que el `export` solo tiene consumidor
cuando un caso de uso devuelve ese mismo mensaje desde adentro de la transacción. Si en K2 se decide que los mensajes de
guard se exportan por convención (aunque hoy nadie los importe), pasan a RESERVADO con ese motivo; si no, se les saca el
`export`.

## FALSO POSITIVO (5) — corregidos en `knip.jsonc`

Sin cambios respecto del informe original: el refresco no encontró falsos positivos nuevos, y se verificó que las 5
correcciones siguen haciendo falta (quitándolas vuelven a aparecer exactamente estos 5 hallazgos más el hint de `.css`).

| Hallazgo | Por qué era falso | Corrección |
|---|---|---|
| `test/setup/server-only-stub.ts` (archivo sin uso) | Lo usan las 5 configs de Vitest vía `resolve.alias` con `path.resolve(__dirname, "test/setup/...")`: es un string, no un import, así que knip no ve el uso. | Agregado a `entry`. |
| `cookies` en `test/setup/next-headers-stub.ts` (export sin uso) | Mismo alias: reemplaza a `next/headers` bajo Vitest; lo consumen `src/core/auth/contexto.ts`, `src/server/actions/auth/sucursal-activa.ts`, etc. | Agregado a `entry` (los exports de una entrada no se reportan). |
| `headers` en `test/setup/next-headers-stub.ts` (export sin uso) | Ídem: lo consumen las rutas de `src/app/api/**`, `src/proxy.ts`, etc. | Ídem. |
| `test/e2e-demo/global-setup-demo.ts` (archivo sin uso) | Es el `globalSetup` de `playwright.demo.config.ts` (un string con la ruta). Esa config se declara como entrada a secas y no como config del plugin de Playwright porque knip, para leer una config, la **ejecuta**, y ésta corre al cargarse la guarda de destino de `scripts/demo-seed/guardas-destino.ts` (tira si falta `MOTOR2_SEED_DATABASE_URL`). Lo mismo pasa con las 4 configs de Vitest de seed/demo. | Agregado a `entry`, con el motivo. |
| `tailwindcss` (devDependency sin uso) | Se usa desde `src/app/globals.css` (`@import "tailwindcss"`), pero `.css` no estaba en `project`. | `project` incluye `src/**/*.{ts,tsx,css}` (y `prisma/**/*.{ts,prisma}`, por el mismo motivo). |

## RESERVADO (103) — intencionales, ignorados con motivo

### Dependencias (2) — `ignoreDependencies`

Sin cambios (se verificó que sin la exclusión vuelven a aparecer los dos, y que `src/lib/db.ts` sigue usando `PrismaPg`).

| Dependencia | Motivo |
|---|---|
| `pg` | Driver de Postgres de `@prisma/adapter-pg`. `src/lib/db.ts` usa `PrismaPg` para todo host que no sea Neon (local, docker compose, E2E). Nadie hace `import "pg"`: lo carga el adapter. Se declaró a propósito junto con el adapter (`docs/plan-migracion.md`, "Bugs de infraestructura encontrados y arreglados") para fijar la versión del driver en vez de heredarla transitivamente. |
| `@types/pg` | Agregado en el mismo cambio y por el mismo motivo que `pg`. Nota para K2: hoy ningún archivo nombra tipos de `pg` y `@prisma/adapter-pg` ya trae `@types/pg` propio; si se decide soltar la declaración explícita de `pg`, este va con él. |

### Tipos exportados usados en su propio archivo (101) — `ignoreExportsUsedInFile: { interface, type }`

Todos son tipos/interfaces que describen la forma de lo que recibe o devuelve una función exportada del mismo módulo
(filas de reportes, entradas de `armarMenu`, eventos del guion de la demo, piezas del `Resultado*` de cada caso de uso,
etc.): son parte de la firma pública y un consumidor puede necesitar nombrarlos. Quitarles el `export` no borra nada. La
regla solo cubre tipos que se usan en su propio archivo: un tipo que no se usa ni ahí (como `ProcesoSlug`) sigue
apareciendo como MUERTO REAL, y tampoco alcanza a las **reexportaciones** de tipo sin consumidor (los 9 de la fachada
`periodo.ts`), que no describen ninguna firma del archivo que las reexporta. Los **valores** exportados usados solo en su
archivo **no** se ignoran (son los 30 "export sobrante" de arriba).

Pasaron de 71 a 101: **+32** de las Fases M (schemas de comandos y cargas de `server/persistencia/pos/`), **−3** de
`periodo.ts` y **+1** de `periodo-compras.ts` (B1: `ItemPeriodo` y `FilaVentaProducto` ahora se usan desde otros
`periodo-*.ts`, así que ya no son "solo en su archivo"; `FilaCompraPorProveedorProducto` se mudó a `periodo-compras.ts` y
sigue usándose solo ahí). El resto (68) no cambió.

| Archivo | Cant. | Tipos |
|---|---:|---|
| `scripts/demo-seed/guion.ts` | 12 | `MotivoMermaGuion`, `EventoCompra`, `ItemVenta`, `EventoVenta`, `EventoProduccion`, `EventoConteoFisico`, `EventoMerma`, `EventoCrearReceta`, `EventoAnularCompra`, `EventoCorregirCompra`, `TotalesDeCompras`, `TotalesDeVentas` |
| `src/core/carta/admin-consulta.ts` | 6 | `SeccionCartaAdmin`, `GeneroCartaAdmin`, `CupoPromoCartaAdmin`, `PromoCartaAdmin`, `OpcionItemAgrupadoAdmin`, `RegistroPublicoAdmin` |
| `src/core/carta/armar-menu.ts` | 8 | `OpcionItemCartaV1`, `PromoCartaV1`, `SeccionCartaEntrada`, `PrecioLocalEntrada`, `PromoCartaEntrada`, `OpcionAgrupadoEntrada`, `AgrupadoSinSeccion`, `AgrupadoConPreciosDistintos` |
| `src/core/carta/grupo-producto-consulta.ts` | 1 | `HermanoDeGrupo` |
| `src/core/carta/registro-tenants.ts` | 1 | `PosicionPortalV1` |
| `src/core/carta/reporte-secciones.ts` | 3 | `ReporteVentasPorCategoria`, `VentaParaSeccion`, `FilaSeccionVenta` |
| `src/core/carta/tema.ts` | 3 | `TipoValorTema`, `BloqueTema`, `ZonaTema` |
| `src/core/catalogo/origen-cambio-receta.ts` | 1 | `OrigenCalibracion` |
| `src/core/compras/anulacion.ts` | 1 | `LineaFaltante` |
| `src/core/features/compras/compra.schema.ts` **(nuevo, M2/M6)** | 5 | `MotivoAnulacionRechazada`, `CodigoAnularCompra`, `DatosAnularCompra`, `CodigoCorregirCompra`, `DatosCorregirCompra` |
| `src/core/features/cuentas/cuenta-anulacion.schema.ts` **(nuevo, M12c/M12d)** | 3 | `CodigoAnularItemEnviado`, `DatosAnularItemEnviado`, `CodigoAnularPromoEnviada` |
| `src/core/features/cuentas/cuenta.schema.ts` **(nuevo, M12a/M12b)** | 5 | `CodigoCerrarCuenta`, `DesenlaceCierreDeCuenta`, `DatosCerrarCuenta`, `CodigoEmitirBoletaCorregida`, `DatosEmitirBoletaCorregida` |
| `src/core/features/traspasos/traspaso.schema.ts` **(nuevo, M11a-c)** | 11 | `CodigoTransicionTraspaso`, `CodigoAprobarYEnviarTraspaso`, `DatosAprobarYEnviarTraspaso`, `DatosCierreDeSolicitudTraspaso`, `DatosEntradaDeTraspaso`, `CodigoAceptarTraspaso`, `DatosRechazoDeEnvioTraspaso`, `CodigoConfirmarReingresoTraspaso`, `CodigoCrearTraspaso`, `DatosCreacionDeTraspaso`, `DatosEnvioDirectoDeTraspaso` |
| `src/core/features/ventas/venta.schema.ts` **(nuevo, M8)** | 5 | `CodigoRegistrarVenta`, `DatosRegistrarVenta`, `MotivoAnulacionDeVentaRechazada`, `CodigoAnularVenta`, `DatosAnularVenta` |
| `src/core/movimientos/arrastre-redondeo.ts` | 1 | `ResultadoArrastre` |
| `src/core/movimientos/registrar-venta.ts` | 1 | `LineaVentaEnTx` |
| `src/core/movimientos/reintentar.ts` | 1 | `InfoReintento` |
| `src/core/pos/agregar-lista-estado.ts` | 1 | `LineaPorAgregar` |
| `src/core/pos/armar-promo-estado.ts` | 1 | `EleccionCupoEstado` |
| `src/core/pos/comanda.ts` | 1 | `LineaDeComanda` |
| `src/core/pos/cuenta.ts` | 1 | `DetalleDeCuenta` |
| `src/core/pos/selector-carta.ts` | 5 | `EntradaProductoSelectorCarta`, `EntradaAgrupadoSelectorCarta`, `EntradaCarpetaGeneroSelectorCarta`, `SeccionSelectorCarta`, `GeneroCartaPos` |
| `src/core/reportes/boletas-emitidas.ts` | 2 | `LineaBoletaEmitida`, `FilaBoletaEmitida` |
| `src/core/reportes/compras-registradas.ts` | 2 | `RenglonCompra`, `CompraRegistrada` |
| `src/core/reportes/devoluciones.ts` | 1 | `FilaDevolucionProveedor` |
| `src/core/reportes/diferencias-ajustes.ts` | 2 | `EstadoDiferencia`, `RecetaQueUsaInsumo` |
| `src/core/reportes/huecos-catalogo.ts` | 2 | `FilaPvSinVenta`, `FilaInsumoConRecetaSinProveedor` |
| `src/core/reportes/indices-economicos.ts` | 1 | `EstadoSerieIPC` |
| `src/core/reportes/margen-real.ts` | 1 | `FilaMargenRealProducto` |
| `src/core/reportes/periodo-compras.ts` **(movido desde `periodo.ts`, B1)** | 1 | `FilaCompraPorProveedorProducto` |
| `src/core/reportes/promociones.ts` | 1 | `ComponentePromocion` |
| `src/core/reportes/rendimiento-por-sucursal.ts` | 1 | `ValorPorSucursal` |
| `src/core/reportes/resumen-operativo.ts` | 1 | `ResumenFinanciero` |
| `src/core/reportes/rotacion-mesas.ts` | 2 | `FranjaHorariaRotacion`, `GrupoTamanoRotacion` |
| `src/core/stock/alertas.ts` | 1 | `EstadoAlerta` |
| `src/server/actions/movimientos/movimientos.ts` | 1 | `ProcesoGenerico` |
| `src/server/persistencia/pos/cargar-cuenta-para-cerrar.ts` **(nuevo, M12a)** | 1 | `ItemParaCerrar` |
| `src/server/persistencia/pos/cargar-cuenta-para-corregir-boleta.ts` **(nuevo, M12b)** | 1 | `EjemplarDeBoletaEmitido` |
| `src/server/persistencia/pos/cargar-promo-para-anular.ts` **(nuevo, M12d)** | 1 | `ComponenteDePromoParaAnular` |
| `test/arquitectura/guardas/analizador.ts` | 2 | `EstadoFuncion`, `FuncionAnalizada` |

Ya **no** están en esta lista (respecto del original): `ItemPeriodo`, `FilaCompraPorProveedorProducto` y
`FilaVentaProducto` de `src/core/reportes/periodo.ts` — sus declaraciones se mudaron a `periodo-*.ts` en B1 (ver arriba).

## Falsos positivos que se esperaban y NO aparecieron

| Esperado | Resultado |
|---|---|
| Exports que solo usan los tests | No aparecen: el plugin de Vitest toma `test/**/*.test.ts` como entradas, así que un export importado solo desde un test cuenta como usado (se corre sin `--production`). Nada que ignorar. |
| Re-exportaciones de algún `public.ts` sin consumidores | En la corrida original no existía ningún `public.ts`. Tras C1-C3 existen `core/{catalogo,movimientos,reportes}/public.ts` y `public-servidor.ts`, y **una** reexportación salió sin consumidor: `detalleReversionDeVenta` en `core/movimientos/public.ts`. No se reservó: la regla de las fachadas es "solo lo que hoy se usa desde afuera", y el consumidor real existe pero importa el interno (ver MUERTO REAL). |
| `server-only` | No aparece: lo importa código de `src/`. |
| `dotenv` | No aparece: lo importan `prisma/seed.ts`, `test/setup/test-db.ts`, los `scripts/*.ts` y las configs de Playwright/Prisma. |
| `@types/*` | `@types/node`, `@types/react`, `@types/react-dom` no aparecen (knip los asocia a su paquete). Solo apareció `@types/pg` — ver RESERVADO. |

## Hints de configuración (8) — resueltos

La primera corrida, con las entradas explícitas pedidas para K1, avisó (en el refresco no apareció ninguno):

- **6 × "Remove redundant entry pattern"** para `src/proxy.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts`,
  `prisma/seed.ts`, `vitest.config.ts` y `playwright.config.ts`: knip ya los descubre solo con sus plugins de Next.js,
  Prisma, Vitest y Playwright. Se sacaron de `entry` (con un comentario que dice que se verificó que los detecta) para que
  el informe no arrastre ruido. Las entradas que knip de verdad no adivina se mantuvieron: `scripts/*.ts`, las 4 configs
  `vitest.*.config.ts` que no son la principal y `playwright.demo.config.ts` — para esas no hubo hint.
- **2 × "Compiled extension excluded by project"** (`.css`, `.prisma`): resuelto agregando esas extensiones a `project`
  (es lo que hizo desaparecer el falso positivo de `tailwindcss`).

## Salida actual de `npm run analizar:muerto`

**Actualizada 2026-09-27 (noche) tras resolver `detalleReversionDeVenta`** (ver "Actualización" en el Refresco): 49 en
total ahora, no 50.

```
Unused devDependencies (1)
@vitejs/plugin-react  package.json:49:6
Unlisted dependencies (1)
fflate  test/core/excel.test.ts:1:38
Unused exports (37)
  (los 6 símbolos muertos que son valores, la reexportación de valor CANTIDAD_MAXIMA_POR_ITEM,
   y los 30 "export sobrante" de arriba)
Unused exported types (10)
ProcesoSlug                     type  src/core/movimientos/ui-config.ts:73:13
ItemPeriodo                     type  src/core/reportes/periodo.ts:20:31
RatioGastoVentas                type  src/core/reportes/periodo.ts:22:15
ComprasDelPeriodo               type  src/core/reportes/periodo.ts:24:3
FilaCompraPorProveedorProducto  type  src/core/reportes/periodo.ts:26:3
GastoPorInsumoDelPeriodo        type  src/core/reportes/periodo.ts:29:3
FilaVentaProducto               type  src/core/reportes/periodo.ts:32:15
VentasDelPeriodo                type  src/core/reportes/periodo.ts:32:34
MargenDelPeriodo                type  src/core/reportes/periodo.ts:33:35
VentaConCategoria               type  src/core/reportes/periodo.ts:34:35
```

La línea `[e2e] Servidor: build (...)` que aparece antes es el `console.log` de `playwright.config.ts`, que knip carga
para leer la config; no es un hallazgo.
