# Informe knip — código y dependencias sin uso (Task #41, Fase K1) — 2026-09-27

Primera corrida de [knip](https://knip.dev) (v6.38.0) sobre `motor2`. Se corre con:

```sh
npm run analizar:muerto   # = knip --no-exit-code  (INFORMATIVO: siempre sale con 0, no bloquea nada todavía)
```

La configuración vive en `knip.jsonc`, con el motivo de cada exclusión anotado al lado. Esta tarea **no borra nada**: lo
que acá figura como MUERTO REAL es la lista de trabajo de la **Task K2**.

## Cómo se clasificó

Cada hallazgo de la primera corrida (config mínima: solo las entradas pedidas + `project` = `src`, `test`, `scripts`,
`prisma`) quedó en una de tres categorías:

| Categoría | Qué es | Qué se hizo en `knip.jsonc` |
|---|---|---|
| **MUERTO REAL** | Candidato genuino a borrar/corregir en K2. | Nada: **sigue apareciendo** en `npm run analizar:muerto` hasta que K2 lo resuelva. |
| **FALSO POSITIVO** | knip lo marcaba mal por cómo estaba configurado. | Se corrigió la config (entrada o `project` que faltaba) con el motivo. |
| **RESERVADO** | Es intencional. | Se ignora (`ignoreDependencies` / `ignoreExportsUsedInFile`) con un comentario del porqué. |

Para separar "símbolo muerto" de "`export` sobrante" se revisó, para cada export sin uso, si el símbolo se usa en código
(no en comentarios) dentro de su propio archivo y si aparece en algún otro archivo de `src/`, `test/`, `scripts/` o
`prisma/`.

## Resumen

| Tipo de hallazgo (primera corrida) | Total | MUERTO REAL | FALSO POSITIVO | RESERVADO |
|---|---:|---:|---:|---:|
| Archivos sin uso | 2 | 0 | 2 | 0 |
| Dependencias sin uso (`dependencies`) | 1 | 0 | 0 | 1 |
| Dependencias sin uso (`devDependencies`) | 3 | 1 | 1 | 1 |
| Dependencias no declaradas (unlisted) | 1 | 1 | 0 | 0 |
| Exports sin uso (valores) | 33 | 31 | 2 | 0 |
| Tipos exportados sin uso | 72 | 1 | 0 | 71 |
| **Total** | **112** | **34** | **5** | **73** |

Además la primera corrida dio 8 *configuration hints* (no son hallazgos sobre el código, son sobre la config) — ver
[Hints de configuración](#hints-de-configuración-8--resueltos).

Estado después de ajustar `knip.jsonc`: `npm run analizar:muerto` muestra **exactamente los 34 MUERTO REAL** y ningún
hint de configuración.

## MUERTO REAL (34) — lista de trabajo para K2

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
| `resumenPeriodicoPorProceso` (function) | `src/core/reportes/periodo.ts:1132` | Port de `Reportes.js` que ninguna pantalla consume. |
| `obtenerStockMinimoDetalleProducto` (function) | `src/core/stock/stock-minimo.ts:23` | |
| `textoUpper` (function) | `src/core/texto.ts:9` | Port de `Core.js` sin consumidores. |
| `mismoTexto` (function) | `src/core/texto.ts:14` | Port de `Core.js` sin consumidores. |
| `ProcesoSlug` (type) | `src/core/movimientos/ui-config.ts:73` | Único tipo exportado que no se usa ni en su archivo. |

### Re-export sobrante (1)

| Símbolo | Archivo | Nota |
|---|---|---|
| `CANTIDAD_MAXIMA_POR_ITEM` | `src/core/pos/cuenta.ts:11` (`export { CANTIDAD_MAXIMA_POR_ITEM, validarCantidadPedido }`) | Re-export "de compatibilidad" (vive en `cantidad-pedido.ts`). `validarCantidadPedido` sí se sigue importando desde `cuenta.ts`; `CANTIDAD_MAXIMA_POR_ITEM` ya no — todos lo importan de `cantidad-pedido.ts`. El `import` en `cuenta.ts` existe solo para re-exportarlo. |

### `export` sobrante (24) — el símbolo se usa, pero solo dentro de su propio archivo

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
| `MENSAJE_NUMERO_INVALIDO` | `src/core/datos/numero-tecleado.ts:19` |
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

## FALSO POSITIVO (5) — corregidos en `knip.jsonc`

| Hallazgo | Por qué era falso | Corrección |
|---|---|---|
| `test/setup/server-only-stub.ts` (archivo sin uso) | Lo usan las 5 configs de Vitest vía `resolve.alias` con `path.resolve(__dirname, "test/setup/...")`: es un string, no un import, así que knip no ve el uso. | Agregado a `entry`. |
| `cookies` en `test/setup/next-headers-stub.ts` (export sin uso) | Mismo alias: reemplaza a `next/headers` bajo Vitest; lo consumen `src/core/auth/contexto.ts`, `src/server/actions/auth/sucursal-activa.ts`, etc. | Agregado a `entry` (los exports de una entrada no se reportan). |
| `headers` en `test/setup/next-headers-stub.ts` (export sin uso) | Ídem: lo consumen las rutas de `src/app/api/**`, `src/proxy.ts`, etc. | Ídem. |
| `test/e2e-demo/global-setup-demo.ts` (archivo sin uso) | Es el `globalSetup` de `playwright.demo.config.ts` (un string con la ruta). Esa config se declara como entrada a secas y no como config del plugin de Playwright porque knip, para leer una config, la **ejecuta**, y ésta corre al cargarse la guarda de destino de `scripts/demo-seed/guardas-destino.ts` (tira si falta `MOTOR2_SEED_DATABASE_URL`). Lo mismo pasa con las 4 configs de Vitest de seed/demo. | Agregado a `entry`, con el motivo. |
| `tailwindcss` (devDependency sin uso) | Se usa desde `src/app/globals.css` (`@import "tailwindcss"`), pero `.css` no estaba en `project`. | `project` incluye `src/**/*.{ts,tsx,css}` (y `prisma/**/*.{ts,prisma}`, por el mismo motivo). |

## RESERVADO (73) — intencionales, ignorados con motivo

### Dependencias (2) — `ignoreDependencies`

| Dependencia | Motivo |
|---|---|
| `pg` | Driver de Postgres de `@prisma/adapter-pg`. `src/lib/db.ts` usa `PrismaPg` para todo host que no sea Neon (local, docker compose, E2E). Nadie hace `import "pg"`: lo carga el adapter. Se declaró a propósito junto con el adapter (`docs/plan-migracion.md`, "Bugs de infraestructura encontrados y arreglados") para fijar la versión del driver en vez de heredarla transitivamente. |
| `@types/pg` | Agregado en el mismo cambio y por el mismo motivo que `pg`. Nota para K2: hoy ningún archivo nombra tipos de `pg` y `@prisma/adapter-pg` ya trae `@types/pg` propio; si se decide soltar la declaración explícita de `pg`, este va con él. |

### Tipos exportados usados en su propio archivo (71) — `ignoreExportsUsedInFile: { interface, type }`

Todos son tipos/interfaces que describen la forma de lo que recibe o devuelve una función exportada del mismo módulo
(filas de reportes, entradas de `armarMenu`, eventos del guion de la demo, etc.): son parte de la firma pública y un
consumidor puede necesitar nombrarlos. Quitarles el `export` no borra nada. La regla solo cubre tipos que se usan en su
propio archivo: un tipo que no se usa ni ahí (como `ProcesoSlug`) sigue apareciendo como MUERTO REAL. Los **valores**
exportados usados solo en su archivo **no** se ignoran (son los 24 "export sobrante" de arriba).

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
| `src/core/reportes/periodo.ts` | 3 | `ItemPeriodo`, `FilaCompraPorProveedorProducto`, `FilaVentaProducto` |
| `src/core/reportes/promociones.ts` | 1 | `ComponentePromocion` |
| `src/core/reportes/rendimiento-por-sucursal.ts` | 1 | `ValorPorSucursal` |
| `src/core/reportes/resumen-operativo.ts` | 1 | `ResumenFinanciero` |
| `src/core/reportes/rotacion-mesas.ts` | 2 | `FranjaHorariaRotacion`, `GrupoTamanoRotacion` |
| `src/core/stock/alertas.ts` | 1 | `EstadoAlerta` |
| `src/server/actions/movimientos/movimientos.ts` | 1 | `ProcesoGenerico` |
| `test/arquitectura/guardas/analizador.ts` | 2 | `EstadoFuncion`, `FuncionAnalizada` |

## Falsos positivos que se esperaban y NO aparecieron

| Esperado | Resultado |
|---|---|
| Exports que solo usan los tests | No aparecen: el plugin de Vitest toma `test/**/*.test.ts` como entradas, así que un export importado solo desde un test cuenta como usado (se corre sin `--production`). Nada que ignorar. |
| Re-exportaciones de algún `public.ts` sin consumidores | No existe ningún `public.ts` todavía en `src/` (la Fase C los va a ir creando). Cuando aparezcan, sus re-exports sin consumidor van a salir como "Unused exports" y habrá que decidir si se reservan. |
| `server-only` | No aparece: lo importa código de `src/`. |
| `dotenv` | No aparece: lo importan `prisma/seed.ts`, `test/setup/test-db.ts`, los `scripts/*.ts` y las configs de Playwright/Prisma. |
| `@types/*` | `@types/node`, `@types/react`, `@types/react-dom` no aparecen (knip los asocia a su paquete). Solo apareció `@types/pg` — ver RESERVADO. |

## Hints de configuración (8) — resueltos

La primera corrida, con las entradas explícitas pedidas para K1, avisó:

- **6 × "Remove redundant entry pattern"** para `src/proxy.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts`,
  `prisma/seed.ts`, `vitest.config.ts` y `playwright.config.ts`: knip ya los descubre solo con sus plugins de Next.js,
  Prisma, Vitest y Playwright. Se sacaron de `entry` (con un comentario que dice que se verificó que los detecta) para que
  el informe no arrastre ruido. Las entradas que knip de verdad no adivina se mantuvieron: `scripts/*.ts`, las 4 configs
  `vitest.*.config.ts` que no son la principal y `playwright.demo.config.ts` — para esas no hubo hint.
- **2 × "Compiled extension excluded by project"** (`.css`, `.prisma`): resuelto agregando esas extensiones a `project`
  (es lo que hizo desaparecer el falso positivo de `tailwindcss`).

## Salida actual de `npm run analizar:muerto`

```
Unused devDependencies (1)
@vitejs/plugin-react  package.json
Unlisted dependencies (1)
fflate  test/core/excel.test.ts:1:38
Unused exports (31)
  (los 7 símbolos muertos salvo ProcesoSlug, el re-export y los 24 "export sobrante" de arriba)
Unused exported types (1)
ProcesoSlug  type  src/core/movimientos/ui-config.ts:73:13
```

La línea `[e2e] Servidor: build (...)` que aparece antes es el `console.log` de `playwright.config.ts`, que knip carga
para leer la config; no es un hallazgo.
