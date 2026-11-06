# Auditoría del módulo Reportes (2026-11-06)

**Estado:** auditoría de SOLO LECTURA sobre `main` (`c7baf36`). No se cambió código, tests, esquema ni migraciones: el único archivo nuevo es este documento. Todo lo que se propone es PROPUESTA; lo decide el dueño.

**Punto de partida:** `docs/catalogo-por-modulo/reportes-fiscal.md` y `docs/auditoria-catalogo-comun-2026-11-06.md` (rama `alegp/catalogo-comun`, PR #166). Todo se volvió a verificar en el código; donde no coincide con esos documentos se dice.

**Marcas:** VERIFICADO = lo leí en el código real (archivo:línea). PROPUESTA = idea mía, sin implementar. NO VERIFICADO = no pude comprobarlo (sección 8). REFUTADO = el código dice otra cosa.

**Qué NO hice:** no corrí el gate (tipos, lint, tests, knip, build, e2e: no hay `node_modules` en esta sesión), no usé datos de producción, no medí tiempos de consulta.

---

## 0. Resumen para el dueño: los 5 hallazgos principales

1. **Las ~14.000 líneas no son, en su mayor parte, «la misma consulta escrita 27 veces».** VERIFICADO.
   - Dos reportes pesan el 36 %: Rendimiento real de recetas (2.441 líneas) y Período (2.148) suman 4.589 de 12.688.
   - La pantalla es el 43 % del total (5.509 líneas en las 27 pantallas), y tiene su propia base compartida (`TablaReporte`, 24 archivos la usan).
   - La repetición real existe: 22 de los 35 archivos de consulta leen el Kardex por su cuenta, hay 31 fórmulas de porcentaje en 15 archivos y 6 formas distintas de excluir anuladas. Pero juntarlas **con poco riesgo ahorra del orden de 280 a 320 líneas (2 a 3 %)**. El motivo para hacerlo es que hoy hay varias respuestas posibles para una misma pregunta, no el tamaño.
2. **La base común ya existe a medias.** VERIFICADO. Catálogo + precio local + receta + costo se leen en un solo lugar (`construirMapaProductos`: 12 archivos; `calcularCostosYMargenes`: 8; el motor `margen-real.ts` lo reutilizan 3 reportes). Lo que falta es **un lector común de líneas del Kardex** (ventas, compras) y tres medidas sueltas: porcentaje, formato de dinero y «día» en la zona de la empresa.
3. **Hay reglas desactualizadas confirmadas, y dos tocan dinero.** VERIFICADO.
   - Una venta con importe $0 se vuelve a valuar al precio de hoy (`core/reportes/periodo-ventas.ts:33-37`), mientras el margen real la excluye (`server/consultas/reportes/margen-real.ts:28,35`; lo declara `core/reportes/margen-real.ts:16`): dos criterios para la misma fila dentro del mismo reporte Período. El módulo de dinero tiene un parche para esquivarlo (`core/moneda.ts:89-103`, piso de $0,01).
   - El costo histórico de un plato se busca por día **UTC** (`core/reportes/costo-historico.ts:19-20`) y el resto del reporte corta el día en la zona de la empresa. Una venta de las 22:00 usa el costo del día siguiente.
   - «Se usa en esta sucursal» (`disponible`) saca productos de 7 reportes, y la pantalla «Hoy» de la carta lo apaga por «sin stock hoy».
4. **El guardián de anuladas no mira donde están los filtros.** VERIFICADO. `test/arquitectura/reportes-compras-anuladas.test.ts:15` revisa solo `src/core/reportes`; los filtros reales están en `src/server/consultas/reportes` (13 filtros de Prisma + 5 de SQL crudo, ninguno cubierto por el test). Además hay 6 mecanismos distintos para «esta venta/compra no cuenta» (sección 3).
5. **«Reportes» contiene cosas que no son reportes, y el costeo está en el lugar equivocado.** VERIFICADO.
   - 5 pantallas de `/reportes` además operan (anular compra y venta, corregir compra, pagar al consignante, calibrar rendimiento): unas 1.060 líneas de pantalla.
   - El costeo (`calcularCostosYMargenes`, `obtenerCostoActualPorMP`) vive en `server/lecturas/reportes` pero lo usan la **escritura de ventas** (`registrar-venta-en-tx.ts:27-29`) y los traspasos. La dependencia está al revés.
   - 23 de los 47 archivos de `core/reportes` (850 líneas) son solo tipos: la lógica de esos reportes está en `server/consultas`, no en `core`.

**Además:** MUERTO confirmado: ninguno (las 27 pantallas tienen ruta, permiso y menú; ver sección 5). «Descuentos de productos» está **oculta del menú por un interruptor** apagado por decisión del dueño (`DESCUENTO_POR_PRODUCTO_VISIBLE = false`, `core/carta/descuento-producto.ts:27`).

---

## 1. Inventario: 27 reportes con sus líneas en las 3 capas (VERIFICADO)

**Cómo se midió:** líneas con `wc -l` (conteo de saltos de línea). «Pantalla» = todos los archivos de la carpeta de la ruta (página, tablas, formularios, gráficos). «Consulta» = el/los archivos de `server/consultas/reportes` (o `server/lecturas/reportes`, o `server/consultas/carta` en el caso de sección) que la pantalla llama. «Core» = los archivos de `src/core/reportes` propios del reporte. Lo compartido entre varios reportes **no** está repartido: va en la tabla de abajo.

Cuentas actuales de `main` (difieren un poco de las que traía el inventario, que medía otra base): `core/reportes` 48 archivos / 4.104 líneas; `server/consultas/reportes` 32 / 4.017; `server/lecturas/reportes` 3 / 325; `app/(app)/reportes` 66 / 5.524. Total **149 archivos / 13.970 líneas**.

| # | Reporte | Ruta | Permiso (`core/permisos/acciones.ts`) | Pantalla | Consulta | Core | Total |
|---|---|---|---|---:|---:|---:|---:|
| 1 | Resumen operativo | `/reportes` | `reporte_resumen` | 206 | 109 | 39 | 354 |
| 2 | Consolidado | `/reportes/consolidado` | `reporte_consolidado` | 94 | 130 | 9 | 233 |
| 3 | Período | `/reportes/periodo` | `reporte_periodo` | 620 | 848 | 680 | 2.148 |
| 4 | Por categoría | `/reportes/categorias` | `reporte_categorias` | 76 | 0 (usa Período) | 0 | 76 |
| 5 | Por sección de carta | `/reportes/ventas-por-seccion` | `reporte_ventas_por_seccion` | 92 | 158 | 0 | 250 |
| 6 | Costos y márgenes | `/reportes/costos` | `reporte_costos` | 152 | 151 | 517 | 820 |
| 7 | Compras registradas | `/reportes/compras` | `reporte_compras` | 472 | 84 | 66 | 622 |
| 8 | Rendimiento real de recetas | `/reportes/rendimiento-recetas` | `reporte_rendimiento_recetas` | 916 | 877 | 648 | 2.441 |
| 9 | Rendimiento por sucursal | `/reportes/rendimiento-recetas/por-sucursal` | `reporte_rendimiento_sucursal` | 169 | 89 | 32 | 290 |
| 10 | Valuación de inventario | `/reportes/valuacion` | `reporte_valuacion` | 136 | 73 | 18 | 227 |
| 11 | Tickets emitidos | `/reportes/tickets` | `reporte_tickets` | 177 | 146 | 128 | 451 |
| 12 | Descuentos por cliente | `/reportes/descuentos-clientes` | `reporte_descuentos_clientes` | 119 | 138 | 49 | 306 |
| 13 | Descuentos de productos | `/reportes/descuentos-productos` | `reporte_descuentos_productos` | 84 | 83 | 36 | 203 |
| 14 | Margen de promociones | `/reportes/margen-promociones` | `reporte_margen_promociones` | 130 | 136 | 80 | 346 |
| 15 | Historial de un producto | `/reportes/historial` | `reporte_historial` (+ `reporte_historial_importes`) | 516 | 198 | 369 | 1.083 |
| 16 | Pérdidas | `/reportes/perdidas` | `reporte_perdidas` | 130 | 99 | 20 | 249 |
| 17 | Devoluciones | `/reportes/devoluciones` | `reporte_devoluciones` | 103 | 105 | 34 | 242 |
| 18 | Diferencias de ajuste | `/reportes/diferencias` | `reporte_diferencias` | 144 | 119 | 48 | 311 |
| 19 | Vencimientos | `/reportes/vencimientos` | `reporte_vencimientos` | 130 | 189 | 22 | 341 |
| 20 | Salud por producto | `/reportes/salud` | `reporte_salud` | 81 | 28 | 78 | 187 |
| 21 | Ventas sin receta | `/reportes/sin-receta` | `reporte_sin_receta` | 69 | 47 | 8 | 124 |
| 22 | Insumos sin receta | `/reportes/insumos-sin-receta` | `reporte_insumos_sin_receta` | 65 | 29 | 7 | 101 |
| 23 | Consignación | `/reportes/consignacion` | `pagar_consignante` (Ver) | 214 | 101 | 20 | 335 |
| 24 | Huecos de catálogo | `/reportes/huecos-catalogo` | `reporte_huecos_catalogo` (empresa) | 59 | 84 | 22 | 165 |
| 25 | Conteos físicos | `/reportes/conteos` | `reporte_conteos` | 213 | 0 (usa `actions/movimientos/lecturas-conteo-fisico`) | 0 | 213 |
| 26 | Trazabilidad por ID | `/reportes/trazabilidad` | `reporte_trazabilidad` | 203 | 86 | 32 | 321 |
| 27 | Rotación de mesas | `/reportes/rotacion-mesas` | `reporte_rotacion_mesas` | 139 | 24 | 129 | 292 |
| | **Suma de lo propio** | | | **5.509** | **4.109** | **3.070** | **12.688** |

**Lo compartido entre reportes (1.455 líneas, no repartido arriba):**

| Archivo | Líneas | Quién lo usa |
|---|---:|---|
| `core/reportes/comun.ts` | 224 | 18 reportes (mapa de productos, índice de recetas) |
| `core/reportes/cotizacion-dolar.ts` | 189 | Período, Valuación, `app-shell` (dólar) |
| `core/reportes/indices-economicos.ts` | 186 | Período (IPC) |
| `core/reportes/public.ts` | 170 | fachada obligatoria (solo reexports) |
| `server/lecturas/reportes/comun.ts` | 189 | 12 archivos de consulta, la venta y los traspasos |
| `core/reportes/rango-por-defecto.ts` | 100 | 13 usos |
| `core/reportes/costo-historico.ts` + `server/consultas/reportes/costo-historico.ts` | 76 + 91 | margen real y 7 reportes |
| `core/reportes/margen-real.ts` (solo tipos) + `server/consultas/reportes/margen-real.ts` | 67 + 69 | Período, Descuentos por cliente, Margen de promociones |
| `server/consultas/reportes/cotizacion-dolar.ts`, `server/lecturas/reportes/serie-ipc.ts`, `core/reportes/dias-atras.ts`, `core/reportes/redondeo.ts`, `loading.tsx` | 29 + 13 + 18 + 4 + 15 | varios |

**Fuera de esta cuenta (también son «Reportes» en el código):** `server/actions/reportes` (6 archivos, 332 líneas: consignación, dólar, IPC, margen objetivo), `server/persistencia/reportes` (4 archivos, 146 líneas), `core/features/reportes` (4 archivos, 142 líneas), y los adaptadores de cotización (`server/adaptadores/cotizaciones/*`). Hay **94 archivos de test** que nombran reportes (grep por ruta; no los corrí).

**Lo que dice el ordenamiento por peso (VERIFICADO):** solo 7 reportes pasan las 600 líneas (Rendimiento 2.441, Período 2.148, Historial 1.083, Costos 820, Compras 622; Período y Rendimiento juntos son el 36 %). Los otros 20 promedian unas 250 líneas, de las cuales más de la mitad es pantalla.

---

## 2. Datos compartidos y consultas repetidas (VERIFICADO)

### 2.1 Las fuentes que casi todos usan

Conteo de llamadas `db.<modelo>.(findMany|findFirst|groupBy|aggregate|count)` y SQL crudo en `server/consultas/reportes`, `server/lecturas/reportes` y `server/consultas/carta/ventas-por-seccion.ts`:

| # | Fuente | Llamadas | Archivos | Cómo se lee |
|---|---|---:|---:|---|
| 1 | **Kardex** (`MovimientoStock` + su `Operacion`) | 32 Prisma + 7 SQL crudo | **22 de 35** | 5 formas: `findMany`, `groupBy`, `aggregate`, `count`, `$queryRaw` |
| 2 | **Producto / catálogo** | 9 + `cargarCatalogoDeProductos` | 12 (vía `construirMapaProductos`) | base compartida, bien |
| 3 | **Receta y costo** (`construirIndiceRecetas`, `obtenerCostoActualPorMP`, `calcularCostosYMargenes`) | — | 10 / 8 / 8 | base compartida, bien |
| 4 | **Precio local vigente** (`preciosLocalesVigentes`) | 1 lectura única | 4 (más 15 fuera de reportes) | fuente única, bien |
| 5 | **Operación** (cabecera: fecha, anulada, cliente, proveedor) | dentro de las del Kardex + 2 directas (`compras-registradas`, `trazabilidad`) | 22 | siempre anidada o con JOIN |
| 6 | **Sección / sucursal** | 4 (`seccion`) + el filtro `seccion: { sucursalId }` en casi todas | ~20 | el filtro de sucursal se escribe a mano cada vez |
| 7 | **Período** (rango de fechas) | 14 `fecha: { gte..lte }` Prisma + 6 SQL | ~16 | `resolverRangoDeReporte` para la URL, pero cada consulta arma su `where` |
| 8 | **Cuenta / CuentaItem** (POS) | 2 + 1 + 1 | 4 (descuentos de productos, margen de promociones, rotación, tickets) | fuente aparte, justificada |

Las fuentes 2, 3 y 4 ya están resueltas de forma compartida (y fijadas por guardianes: `precio-local-en-un-solo-lugar`, `carga-unica-catalogo`). **La que no lo está es la 1, y alrededor de ella la 5, 6 y 7.**

### 2.2 Consultas duplicadas o casi duplicadas sobre el Kardex

**«Las líneas VENTA vigentes de una sucursal en un rango»** (mismo `where`: `proceso: "VENTA"` + operación de la sucursal + `fecha` en el rango + `anuladaEn: null`):

| Dónde | Línea | Diferencia respecto del esqueleto |
|---|---|---|
| `descuentos-clientes.ts` | 19-39 | `+ clienteId: { not: null }`; select propio |
| `margen-promociones.ts` | 17-27 | `+ promoCuentaId: { not: null }`; select propio |
| `rendimiento-recetas.ts` | 257 y 333 | por `seccion.sucursalId`; dos veces en el mismo archivo |
| `huecos-catalogo.ts` | 32-35 | sin rango de fechas (toda la historia) |
| `descuentos-productos.ts` | 31-34 | por `operacionId in [...]` |
| `vencimientos.ts` | 87-95 | rango + `anuladaEn: null`, sin `proceso` en el mismo lugar |
| `periodo.ts` (`cargarLineasDelPeriodo`) | 110-146 | **sin `anuladaEn`**: trae todo y marca `anulada` en memoria (línea 175); lo reutilizan Período, Categorías, Sección, Consolidado y Resumen |
| `periodo-ratio.ts` | 41-47 | `groupBy` del período anterior, con `anuladaEn: null` |
| `ventas-por-opcion.ts` | 41-45 | SQL crudo, `"anuladaEn" IS NULL` |
| `ventas-sin-receta.ts` | 26-31 | SQL crudo |

**Un mismo fragmento de `select` repetido tal cual (la «marca de línea configurada» de GO-2b):** `operacionPadreId` + `cuentaItems: { where: { huellaOpciones: { not: null } }, take: 1, select: { id: true } }` en `periodo.ts:136-141`, `descuentos-clientes.ts:34-38` y `rendimiento-recetas.ts:242` (`MARCA_DE_OPCIONES`). Tres copias de una regla que, si cambia la definición de «línea con opciones», hay que acordarse de tocar tres veces. (Tickets la reconoce por otro camino: `tickets-emitidos.ts:21`, `huellaOpciones || lineaPadreId`.)

**Los saldos** (`groupBy productoId [seccionId] _sum cantidad`): `valuacion.ts:30-34`, `resumen-operativo.ts:64`, `resumen-consolidado.ts:101-107`, `consignacion.ts:86`, `rendimiento-recetas.ts:91-92,165`, `vencimientos.ts:23`. Siete lugares calculan «cuánto hay» con sumas distintas; ninguno llama a otro. (T3 del inventario dice que no hay test de «todas las pantallas dan el mismo saldo»: **VERIFICADO**, no encontré ninguno.)

**Compras vigentes:** `costo-historico.ts:42-50` y `:57-61` (Prisma y SQL en el mismo archivo para lo mismo), `periodo-precios.ts:37-42` (SQL), `rendimiento-recetas.ts:230-232`, `periodo-ratio.ts:41`.

---

## 3. Cálculos repetidos: cuántas implementaciones hay de cada uno (VERIFICADO)

| Cálculo | Implementaciones | Dónde |
|---|---:|---|
| **Corte de día / zona horaria** | 1 librería (`core/tiempo/zona-horaria.ts`) bien hecha, **pero** 12 archivos de consulta tienen `zona = ZONA_ARGENTINA` como valor por defecto; **8 páginas no reciben la zona de la empresa** (`costos`, `diferencias`, `huecos-catalogo`, `insumos-sin-receta`, `por-sucursal`, `salud`, `sin-receta`, `valuacion`); **5 tablas la fijan a Argentina en pantalla** (`const dia = (f) => diaDeCalendario(f, ZONA_ARGENTINA)` en perdidas, diferencias, sin-receta, conteos, trazabilidad) y 3 componentes de Historial y el de Consignación la usan como valor por defecto | ver búsqueda `ZONA_ARGENTINA` |
| **Día para agrupar** | 2 criterios: día de la empresa (`diaDeCalendario`) en casi todo, y **día UTC** (`diaUtc`) en el costo histórico (`core/reportes/costo-historico.ts:19-20`, usado en `costo-historico.ts:27,75,77,86` y `margen-real.ts:48`). Para el IPC, `claveMes` en UTC (`indices-economicos.ts:31-32`) | — |
| **Excluir anuladas** | **6 mecanismos**: (1) `anuladaEn: null` en Prisma, 13 líneas en 9 consultas; (2) `"anuladaEn" IS NULL` en SQL crudo, 5 lugares; (3) marca `anulada` en memoria + `if (r.anulada) continue`, 5 puntos del core (`periodo-ventas.ts:32`, `periodo-compras.ts:42,117`, `historial-vistas.ts:174,297`); (4) por el **texto** «Anulación de la venta/compra…» (`OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION`, `core/movimientos/anulaciones.ts:47`), solo en `diferencias-ajustes.ts:54` y `rendimiento-recetas.ts:326`; (5) por **instante** (`anuladaEn === null \|\| anuladaEn > impresaEn`), 2 copias idénticas: `core/pos/ticket.ts:113` y `tickets-emitidos.ts:17`; (6) **sumar todo** porque el contra-asiento netea (saldos de valuación, consolidado, vencimientos; consignación: el contra-asiento invierte el signo, `anulaciones.ts:177-181`) | ver sección 6 |
| **Valuar a precio vigente** | 1 en reportes: `armarMapaProductos` (`core/reportes/comun.ts:102`: precio local ?? precio de lista, leyendo el lector único `preciosLocalesVigentes`). Pero **5 copias de esa misma regla** en el resto del sistema (carta: `armar-menu.ts:295`, `vista-previa-de-un-producto.ts:30`, `opciones-de-venta.ts:143,299`, `comun.ts:102`) | inventario del 2026-11-06, a1 |
| **Revaluar ventas sin importe a precio de hoy** | 1: `periodo-ventas.ts:33-37` | hallazgo 6.1 |
| **Costo de receta (merma)** | `cantidad × (1 + merma/100)` escrito a mano **8 veces**: `core/reportes/costos.ts:61,158,310`, `rendimiento-recetas-vistas.ts:50,61`, y fuera de reportes `armar-linea-de-movimiento.ts:65`, `core/movimientos/linea-de-venta.ts:95`, `consumo-de-linea-configurada.ts:131` | — |
| **Costo del plato** | 3 funciones con tres bases: costo de reposición de hoy (`calcularCostosYMargenesDesde`, `costos.ts:129`), reconstruido por día (`reconstruirCostosDeVenta`, `costo-historico.ts:13`) y congelado en la venta (`MovimientoStock.costoUnitarioVenta`) | — |
| **Margen** | 4 conceptos legítimos (teórico por producto `costos.ts:202,220`; nominal del período `periodo-margen.ts` core; real `margen-real.ts`; ajustado por IPC `periodo-margen.ts` consulta) + 1 derivado (por promoción). **El motor real está compartido** (`margen-real.ts`: lo usan Período, Descuentos por cliente y Margen de promociones). Lo repetido es el **porcentaje**: ver abajo | — |
| **Porcentaje a 1 decimal** | `Math.round((x / y) * 1000) / 10` escrito **31 veces en 15 archivos**, con guardas de «y = 0» distintas (`> 0`, `!== null`, sin guarda en `periodo-compras.ts:143`) | `costos.ts:221,222,381,382`, `periodo-margen.ts` (core :148, consulta :77,123,130,147,156), `margen-promociones.ts:114-118`, `descuentos-clientes.ts:115-134`, `rendimiento-recetas-vistas.ts:73,90`… |
| **Redondeo de cantidad (3 decimales)** | 4 definiciones: `redondeo.ts:2` (la «oficial») y 3 copias privadas idénticas en `historial-vistas.ts:12`, `rendimiento-conciliado.ts:32`, `rendimiento-recetas-vistas.ts:19` (más 2 en `core/pos` con 4 decimales) | — |
| **Redondeo de dinero** | **Bien:** 108 usos de `redondearMoneda`; en reportes no hay `Math.round(x*100)/100` suelto | — |
| **Formato de dinero en pantalla** | **89** `toLocaleString("es-AR")` en 32 archivos de `app/(app)/reportes` (48 con `$` delante); 2 constantes locales (`plata` en `compras/page.tsx:23`, `pesos` en `periodo/tabla-periodo.tsx:80`, esta última divide por 100 porque ese bloque trabaja en centavos mientras el resto del mismo reporte trabaja en pesos con decimales). El formateador único `formatearMonto` (`core/pos/formato.ts`) lo usa solo `tickets/page.tsx` | — |

---

## 4. Capas: qué es pantalla, qué es consulta, qué es lógica de negocio (VERIFICADO)

### 4.1 Pantalla (5.524 líneas = 40 % del total; 43 % de lo asignado)

| Tipo de archivo | Archivos | Líneas |
|---|---:|---:|
| `page.tsx` (carga, permiso, armado de la página) | 27 | 2.468 |
| `tabla-*.tsx` (columnas, orden, exportación) | 22 | 1.567 |
| Otros componentes (formularios, filas, gráficos, filtros, botones) | 16 | 1.474 |
| `loading.tsx` | 1 | 15 |

- **La tabla con orden y exportación a Excel ya es una sola:** `components/tabla-reporte.tsx` (170 líneas) la usan 24 archivos, y es el único consumidor de `generarExcel`. Esa parte «pantalla casi idéntica» **ya está resuelta**.
- **Lo que sí está repetido en las 27 páginas es el preámbulo:** `obtenerContextoUsuario` → `irAlLogin` → `lecturaSinCupo` → `requierePermisoVer` → mensaje de error. Las 27 páginas lo escriben a mano (276 líneas en total entre imports y cuerpo, ≈10 por página).
- **Filtros:** 10 pantallas usan `SelectorRango`, 3 tienen un formulario «días atrás» propio (Pérdidas, Devoluciones, Vencimientos, el mismo `<form>` con `Campo` + `BotonDeServidor`), 3 tienen filtro por `desde`/`hasta` propio.
- **Pantallas casi idénticas (tabla simple sin filtros):** Ventas sin receta (69), Insumos sin receta (65), Salud (81), Descuentos de productos (84), Consolidado (94), Categorías (76), Por sección (92). Ninguna merece una pantalla «configurable» propia: ya reutilizan `TablaReporte` y su costo es el `page.tsx` (≈30 líneas) más las columnas (≈20-40).
- **Pantallas que operan, no solo muestran (≈1.060 líneas):**

| Pantalla | Qué escribe | Líneas |
|---|---|---:|
| Compras registradas | anular compra, anular factura, corregir compra, pago de factura | 309 de las 472 |
| Consignación | registrar pago al consignante (`registrar-pago-consignante.tsx`) | 76 |
| Rendimiento real de recetas | calibrar y volver a central (`fila-simple.tsx`, `fila-compartida.tsx`) | 605 |
| Trazabilidad | anular venta (`boton-anular-venta.tsx`) | 68 |

  Son acciones de otros módulos (compras, stock, recetas, salón) que viven dentro de un reporte porque el reporte era el lugar donde se las encontraba. Esto explica en buena parte por qué «reportes» crece cuando cambian otros módulos.

### 4.2 Consulta (4.342 líneas) y lógica de negocio (4.104 líneas en `core`)

- **`core` no es donde está la lógica de cálculo de la mitad de los reportes.** 23 de los 47 archivos de `core/reportes` (sin contar `public.ts`) **no tienen ni una función ni una constante exportada: son solo tipos** (850 líneas, 21 % de `core/reportes`). Ejemplos: `margen-real.ts` (67), `rendimiento-recetas.ts` (180), `margen-promociones.ts` (79), `historial-producto.ts` (56), `descuentos-clientes.ts` (48). Su cálculo está en `server/consultas`.
- Resultado: **lógica de negocio dentro de las consultas**. Porcentajes y márgenes se calculan en `server/consultas/reportes/periodo-margen.ts:77,123-156`, `margen-promociones.ts:103-118`, `descuentos-clientes.ts:115-134`, `margen-real.ts:67`. No hay una regla pareja («lo puro va en `core`»): el margen nominal está en `core/reportes/periodo-margen.ts` y el real en `server/consultas/reportes/periodo-margen.ts`.
- **`core/reportes/public.ts` (170 líneas)** es una lista de reexports exigida por dependency-cruiser (`publico-puro`). No es duplicación, pero es un costo fijo de la arquitectura.
- **Dependencia al revés (VERIFICADO):** `registrar-venta-en-tx.ts:27-29` (la escritura de la venta) importa `calcularCostosYMargenes`, `construirIndiceRecetas`, `construirMapaProductos`, `obtenerCostoActualPorMP` y `costoUnitarioDeInsumoDesde` desde «reportes». Los traspasos (`aprobar-y-enviar-traspaso.ts:9`, `crear-envio-directo-de-traspaso.ts:10`) importan `obtenerCostoActualDeProducto`. El costo es un concepto de dominio que alimenta el Kardex; hoy se llama «reporte».

---

## 5. Clasificación de cada reporte (VERIFICADO salvo lo marcado)

**Criterio:** VIGENTE = no encontré una regla vieja leyendo el código (no es lo mismo que «da el número correcto»: no corrí nada contra datos). DESACTUALIZADO = alcanzable, pero lee algo que cambió o aplica una regla que ya no coincide con el resto. MUERTO = sin ruta, sin permiso o sin escritor.

**MUERTO: ninguno.** Las 27 rutas tienen `page.tsx`, el gate `requierePermisoVer` (o `...DeEmpresa`), una clave en `acciones.ts` (27 claves `reporte_*` + `pagar_consignante`; ninguna sin uso) y un ítem de menú, salvo Descuentos de productos (abajo). **Columnas sin escritor:** ningún reporte lee `Venta`, `NotaCreditoProveedor*`, `alicuotaIva*`, `importeNeto/Iva`, `ProveedorPorProducto` ni `FacturaProveedor.importeTotal` (grep sin resultados en `consultas/reportes`, `lecturas/reportes`, `core/reportes` ni `app/(app)/reportes`). Compras registradas suma las líneas del Kardex (`compras-registradas.ts:72`). Esos hallazgos del inventario **no afectan a Reportes**. Los procesos que leen (`DEVOLUCION_*`, `LIQUIDACION_CONSIGNACION`, `MERMA`, `PRODUCCION`, `CONTROL`, `AJUSTE`) tienen escritor (`ui-config.ts:60-62`, `registrar-venta-en-tx.ts:328`, etc.).

| # | Reporte | Clase | Evidencia |
|---|---|---|---|
| 1 | Resumen operativo | DESACTUALIZADO (parcial) | Usa `obtenerReportePorPeriodo` entero (`reportes/page.tsx:25-27`, `resumen-operativo.ts:16`): hereda el revalúo de $0 de Período (6.1) |
| 2 | Consolidado | DESACTUALIZADO (parcial) | `resumen-consolidado.ts:87` llama a `calcularVentasDelPeriodo`: mismo revalúo. **No** filtra por `disponible` (REFUTADO el hallazgo de la nota) |
| 3 | Período | DESACTUALIZADO | Revalúo de $0 (`periodo-ventas.ts:33-37`); costo histórico por día UTC (`core/reportes/costo-historico.ts:19-20`); lista «PV sin categoría» filtra por `disponible` (`periodo-categorias.ts:43`). Los datos de dólar, IPC, margen, alertas y compras están al día |
| 4 | Por categoría | DESACTUALIZADO (parcial) | Misma base que Período (`generarReporteVentasPorCategoria`, `periodo.ts:256`) y `periodo-categorias.ts:43` |
| 5 | Por sección de carta | DESACTUALIZADO | «Está en la carta» con otro criterio que la carta (6.2) + revalúo de $0 heredado |
| 6 | Costos y márgenes | VIGENTE | Usa `esBase` (ola precio y carta, `costos.ts:201,205`), precio local único, costo con merma. Tocado el 2026-10-22 |
| 7 | Compras registradas | VIGENTE | Lee Operación COMPRA con anuladas marcadas, zona de la empresa (`compras-registradas.ts:13`), 2026-10-28 |
| 8 | Rendimiento real de recetas | DESACTUALIZADO (parcial) | `whereDisponibleEn` en `rendimiento-recetas.ts:408,468`. Reconoce líneas con opciones (GO-2b) y es lo más reciente del módulo (2026-11-03) |
| 9 | Rendimiento por sucursal | VIGENTE | Lee calibraciones locales; `sucursalesVisiblesPara` |
| 10 | Valuación | DESACTUALIZADO | `whereDisponibleEn` en `valuacion.ts:22,32`: un producto apagado en «Hoy» sale del valor del inventario |
| 11 | Tickets emitidos | VIGENTE | Reimprime el nombre congelado (`nombreEnTicket`, `tickets-emitidos.ts:76,99`) y la regla de anulación posterior; 2026-10-30. Copia el filtro de líneas vivas (6.3) |
| 12 | Descuentos por cliente | VIGENTE | Usa `margen-real.ts`, `anuladaEn: null`, líneas configuradas |
| 13 | Descuentos de productos | **OCULTO** (no MUERTO) | Existe por URL y con permiso; el menú lo esconde porque `DESCUENTO_POR_PRODUCTO_VISIBLE = false` (`core/carta/descuento-producto.ts:27`, decisión del dueño 2026-10-29, `navegacion/estructura.ts:127,163`). Lee `CuentaItem.precioCartaUnitario`. Candidato a poda **si el dueño confirma** que no se usa |
| 14 | Margen de promociones | VIGENTE | Usa `margen-real.ts` + `PromoCuenta`; `anuladaEn: null` (`:18`) |
| 15 | Historial de un producto | VIGENTE | Anuladas marcadas, dinero oculto según permiso (`quitarDineroDeEventos`) |
| 16 | Pérdidas | VIGENTE | Motivos como catálogo (P4), `anuladaEn: null` (`perdidas.ts:47`). La tabla fija la zona (3) |
| 17 | Devoluciones | VIGENTE | No necesita filtro de anuladas (solo se anulan VENTA y COMPRA). No incluye `DEVOLUCION_CONSIGNACION` (decisión de alcance, NO VERIFICADO si es intencional) |
| 18 | Diferencias de ajuste | VIGENTE | Excluye reversiones por texto (`diferencias-ajustes.ts:54`). La tabla fija la zona |
| 19 | Vencimientos | VIGENTE | `anuladaEn: null` en ventas (`vencimientos.ts:93`), saldos por lote |
| 20 | Salud por producto | DESACTUALIZADO (parcial) | Hereda `disponible` vía `insumos-sin-receta` (`salud-por-producto.ts` importa `insumos-sin-receta` y `diferencias-ajustes`) |
| 21 | Ventas sin receta | VIGENTE | SQL crudo con `"anuladaEn" IS NULL` (`ventas-sin-receta.ts:30`) |
| 22 | Insumos sin receta | DESACTUALIZADO (parcial) | `info.disponible` (`insumos-sin-receta.ts:26`) |
| 23 | Consignación | DESACTUALIZADO (parcial) | `p.disponible && p.esConsignacion` (`consignacion.ts:90`): un producto apagado «sin stock hoy» deja de aparecer en «stock sin vender». Los importes liquidados netean bien las anulaciones |
| 24 | Huecos de catálogo | DESACTUALIZADO (parcial) | `info.disponible` (`huecos-catalogo.ts:44,49`); «tiene proveedor» sale del Kardex vigente (`:40`), no de `ProveedorPorProducto` (correcto) |
| 25 | Conteos físicos | VIGENTE | Sin consulta propia (usa la acción de lectura de conteos) |
| 26 | Trazabilidad | VIGENTE | Muestra anuladas marcadas (`trazabilidad.ts:29,54`) |
| 27 | Rotación de mesas | VIGENTE | Lee `Cuenta`; 2026-10-26 |

**Contexto de «dejado de atender» (VERIFICADO con reserva):** 69 de los 149 archivos de reportes (46 %) no se tocaron desde el 2026-10-14. La historia de git empieza ese día (226 commits), así que «sin cambios desde el 10-14» significa «sin cambios en toda la historia disponible». Mientras tanto, el 10-19 cambió precio y carta, el 10-29 las ventas con opciones y el 11-04 el ticket. Los reportes que no cambiaron desde el 10-14 y leen algo que después cambió son los de la lista de arriba marcados parcial: consignación, huecos, insumos, salud, valuación (tocada el 10-27 solo en el costo) y el núcleo de Período.

**Resultado para la pregunta «¿uso todos?»:** los 27 son alcanzables y ninguno es código muerto. Cuenta: 15 VIGENTES, 11 DESACTUALIZADOS (total o parcial: números 1, 2, 3, 4, 5, 8, 10, 20, 22, 23 y 24), 1 OCULTO (13). Los 11 dependen de una regla que hoy pide una decisión (6.1 y 6.4).

---

## 6. Reglas cruzadas: confirmo o refuto cada hallazgo conocido

### 6.1 `precioTotal = 0` se revalúa a precio de hoy: **CONFIRMADO**
- `core/reportes/periodo-ventas.ts:33`: `esReal = r.precioTotal > 0`; `:35-37`: si no es real, `importe = importeDeLinea(cantidad, precioVentaVigente)`. La línea queda marcada `estimado` y el aviso lo dice (`:55-57`). La intención original era cubrir «ventas viejas sin precio por línea».
- **Hoy una venta nueva puede tener `precioTotal = 0` de verdad:** `filas-de-venta.ts:91` calcula `importeVenta = importeDeLinea(cantidadVendida, precioVenta)`, que da 0 si el precio de la línea es 0. Después de cambiar el precio del producto, ese reporte la informa a precio de hoy. La frecuencia real: NO VERIFICADO (sin datos).
- **Prueba de que la regla pesa:** `core/moneda.ts:89-103` (`precioConDescuento`) tiene un piso de $0,01 «para que el reporte no lo lea como venta vieja sin precio». Es un parche en el módulo de dinero para esquivar una regla de reporte.
- **Contradicción interna:** `margen-real.ts` excluye `precioTotal <= 0` y cuenta `ventasSinPrecioExcluidas`. Período muestra la venta valuada en «Ventas» pero fuera del «Margen real».
- Consecuencia práctica: es una PROPUESTA de dinero que necesita la decisión del dueño (ver pregunta al final).

### 6.2 «Está en la carta» con criterios distintos: **CONFIRMADO**

| Dónde | Criterio |
|---|---|
| `lecturas/carta/menu.ts:60` (lo que ve el cliente) | PV **disponible** en la sucursal (`whereDisponibleEn`) + `visibleEnCarta` + **no** es opción de un ítem agrupado; sección `activa: true` (`:73`) |
| `consultas/carta/admin.ts:380-398` (`estadoDelProductoEnLaCarta`) | disponible + (ítem agrupado **activo** y su sección activa) o (contenido visible y sección **activa**) |
| `consultas/carta/ventas-por-seccion.ts:113-124` (reporte) | **sin** `whereDisponibleEn`, **sin** mirar si la sección o el ítem agrupado están activos; basta `visibleEnCarta` + `seccionCartaId` o ser opción de un ítem |

Efecto: un producto en una sección apagada, o apagado por «sin stock hoy», aparece en el reporte bajo la sección en la que «el cliente lo ve», cuando el cliente ya no lo ve. Los totales siguen cerrando con Categorías (el reparto no pierde plata): lo que cambia es la etiqueta de sección.

### 6.3 Filtro de líneas vivas del ticket, copiado: **CONFIRMADO**
`core/pos/ticket.ts:113` (`armarTicketImpresoEn`) y `consultas/reportes/tickets-emitidos.ts:17` tienen el mismo predicado `i.anuladaEn === null || i.anuladaEn > impresaEn`. La razón del segundo es que `lineasConOperacion` necesita los mismos ítems que usa `armarTicketImpresoEn` para alinear por posición con las líneas (`:36`). Si una de las dos copias cambia sola, las líneas y las operaciones enlazadas se desalinean sin error. `estadoDeTicket` (`ticket.ts:128`) usa la misma cuenta por un tercer camino.

### 6.4 `disponible` saca productos de `valuacion.ts` y `consolidado.ts`: **CONFIRMADO en Valuación, REFUTADO en Consolidado, y se extiende a otros 5**
- Valuación: `valuacion.ts:22` (productos) y `:32` (saldos) con `whereDisponibleEn`. La escritura que lo apaga: `fijar-disponibilidad-de-hoy.ts`.
- Consolidado: `resumen-consolidado.ts` no filtra por `disponible` (grep sin resultados); las alertas usan todo el catálogo (`:47`, `armarAlertasStock`).
- Otros con el mismo filtro: Rendimiento de recetas, Huecos de catálogo, Insumos sin receta, Consignación, y la lista «PV sin categoría» de Período y de Por categoría (sección 5). Con Salud (que hereda de Insumos) son 7 reportes.
- Hallazgo ya anotado por la auditoría del catálogo común (#1): la misma marca significa «sin stock hoy» y «se usa en esta sucursal». Para Reportes, la decisión es de modelo de datos (¿una segunda marca?) y no la tomo yo.

### 6.5 «14 archivos fuera de reportes que importan `core/reportes`»: **REFUTADO en el número, CONFIRMADO en el fondo**
Importaciones reales (`from "@/core/reportes/..."`) desde fuera de los directorios de reportes: **8 archivos** (`components/en-dolares.tsx`, `components/selector-rango.tsx`, `components/app-shell.tsx`, `registrar-venta-en-tx.ts`, `consultas/carta/ventas-por-seccion.ts`, `api/cron/sincronizar-dolar/route.ts`, `catalogo/margen-objetivo/page.tsx`, `stock/conteo-frecuencia/page.tsx`). Si se suman los que importan `server/lecturas/reportes` o `server/consultas/reportes`: +2 (`aprobar-y-enviar-traspaso.ts`, `crear-envio-directo-de-traspaso.ts`) → **10**. Si se cuentan también las carpetas llamadas «reportes» en otras capas (`server/actions/reportes`, `server/persistencia/reportes`, `core/features/reportes`) y los adaptadores de cotización, se llega a 14 o más: probablemente de ahí sale la cifra, pero no pude reproducirla exacta. **Lo que importa:** tres de esos 10 son escritura (venta, traspaso) o infraestructura (cotización del dólar en el shell), no reportes.

### 6.6 Hallazgos de la nota que **no** afectan a Reportes
- `Producto.alicuotaIvaVenta`, `FacturaProveedor.importeNeto`, `Venta`, las 4 tablas de notas de crédito: ningún reporte las lee (sección 5).
- Guardián de anuladas que mira `core` y no `server/consultas`: **CONFIRMADO** (`reportes-compras-anuladas.test.ts:15`, `RAIZ = src/core/reportes`).

### 6.7 Otros hallazgos nuevos
- **Costo histórico por día UTC:** `diaUtc` agrupa por día UTC; el resto del reporte corta por zona de empresa. Una venta a las 22:00 en Buenos Aires (01:00 UTC del día siguiente) busca el costo «hasta el día siguiente». Efecto: pequeño, sin error visible. VERIFICADO el código, magnitud NO VERIFICADA.
- **`Empresa.zonaHoraria` es una columna obligatoria** (`schema.prisma:2475`, `String` sin `?`; no verifiqué si tiene `@default` en otra línea), pero 8 páginas de reportes no la reciben y 5 tablas la ignoran. Hoy es indiferente si todas las empresas están en Argentina; deja de serlo con la primera que no.
- **Dos representaciones de dinero dentro de Período:** pesos con decimales en `core/reportes/periodo-*.ts` y centavos enteros en el bloque «impacto de recetas» (`importeCentavos`, `ventas-por-opcion.ts`).

---

## 7. PROPUESTA (sin implementar): una base común mínima

**Regla del dueño aplicada: «primero la opción más barata».** Eso lleva a no proponer una capa nueva grande ni una pantalla «configurable». El tamaño del módulo no se explica por la duplicación (sección 0, punto 1): reducirlo exigiría borrar reportes, y eso es del dueño. Lo que sí se puede hacer barato es **que cada pregunta tenga una sola respuesta**.

### 7.1 Forma mínima: tres piezas chicas, ninguna reescribe un reporte
1. **Medidas puras en `core/reportes` (≈60 líneas nuevas):** `porcentaje1Decimal(parte, total)` con una única guarda definida, y que `redondearCantidad` se importe de `redondeo.ts` en las 3 copias. *(PROPUESTA)*
2. **Un lector de líneas de venta y compra vigentes (`server/lecturas/reportes/lineas-vigentes.ts`, ≈80 líneas nuevas):** recibe `{ sucursalId, desde, hasta, proceso }` y devuelve el `where` base más el fragmento `MARCA_DE_OPCIONES`, ambos hoy repetidos. Las consultas siguen armando su `select` y sus filtros extra. Es una función que devuelve un `where`, no un ORM nuevo. *(PROPUESTA)*
3. **Un guardián que mire `server/consultas/reportes` (≈40 líneas de test):** la misma heurística que ya existe para `core`, apuntada a donde están los filtros. Hoy 18 filtros de anuladas no tienen red. *(PROPUESTA)*

### 7.2 Qué consolidar primero, de menor a mayor riesgo, con estimación de líneas evitadas

| Orden | Qué | Dónde | Líneas evitadas (estimación) | Riesgo |
|---:|---|---|---:|---|
| 1 | Guardián de anuladas extendido a `server/consultas/reportes` | 1 test | 0 (suma ≈40 de test) | Nulo: no cambia producción; puede revelar un filtro faltante |
| 2 | Preámbulo de página (`obtenerContexto` → login → cupo → gate) en un helper | 27 `page.tsx` | **≈190** (276 líneas hoy → ≈3 por página) | Bajo: es mecánico, pero toca las 27 páginas y el cupo de lecturas (`lecturaSinCupo`) |
| 3 | `porcentaje1Decimal` único | 31 fórmulas en 15 archivos | ≈25 | Bajo-medio: las guardas de «y = 0» hoy difieren; hace falta test de paridad por reporte antes |
| 4 | `redondearCantidad` único (3 copias) y filtro de ticket único (`core/pos/ticket.ts:113` exportado, usado por `tickets-emitidos.ts:17`) | 4 archivos | ≈15 | Bajo |
| 5 | Marca de línea configurada (`MARCA_DE_OPCIONES`) y `where` de ventas vigentes en un solo lugar | `periodo.ts`, `descuentos-clientes.ts`, `margen-promociones.ts`, `rendimiento-recetas.ts`, `huecos-catalogo.ts` | ≈50-70 | Medio: Período alimenta 5 reportes; cualquier diferencia mueve totales |
| 6 | La zona de la empresa llega a las 8 páginas y 5 tablas que hoy la ignoran | 13 archivos | ≈0 (corrige un riesgo, no suma ni resta) | Bajo |
| 7 | `formatearMonto` en las 48 apariciones de `$${n.toLocaleString("es-AR")}` | 32 archivos | ≈0-20 | Medio-bajo: el formateador de POS (`core/pos/formato.ts`) puede mostrar decimales distintos; NO VERIFICADA la equivalencia |
| | **Total de 1 a 7** | | **≈280 a 320 líneas (2 a 3 % de 12.688)** | |

Mover las acciones fuera de las pantallas (7.4) cambia dónde viven ≈1.060 líneas, no cuántas hay. **No hay camino honesto a «la mitad de las líneas» sin sacar funciones.**

### 7.3 Lo que NO tocar (PROPUESTA)
- **`rendimiento-recetas.ts` (877 líneas de consulta + 648 de core + 916 de pantalla):** es el reporte más grande, el más reciente (2026-11-03) y el que hace cálculo propio (conciliación, regresión por mínimos cuadrados). Tocarlo no se justifica por duplicación.
- **`cargarLineasDelPeriodo` / `calcularVentasDelPeriodo`:** alimentan 5 reportes. Cualquier cambio sin la decisión de la pregunta 6.1 mueve cifras que el dueño ve.
- **`costo-historico`:** es plata. Cambiar el día UTC por el día de la empresa es una decisión aparte, con prueba de antes y después.
- **Los permisos:** 27 claves, una por reporte, decisión del dueño del 2026-09-30. No unificar.
- **El camino de escritura de la venta y los traspasos.** Mover el costeo a un dominio propio (`costeo`, sin «reportes» en el nombre) es lo correcto a largo plazo, pero se hace en una etapa propia, con el gate completo.
- **Una pantalla «configurable» que reemplace las tablas.** `TablaReporte` ya hace el trabajo; la abstracción nueva costaría más líneas de las que ahorra para 6 pantallas simples.

### 7.4 Etapas posteriores con nombre (no ahora)
- **Etapa «Costeo»:** sacar `calcularCostosYMargenes` y `obtenerCostoActual*` de `lecturas/reportes` a un dominio propio.
- **Etapa «Pantallas que operan»:** pasar las acciones de compras, consignación, calibración y anulación de venta a las pantallas de su módulo y dejar en el reporte solo un enlace. Evita que Reportes crezca cada vez que cambia compras o stock (≈1.060 líneas).
- **Etapa «Poda»:** decidir sobre Descuentos de productos (203 líneas, oculto) con el dueño. Es la única reducción grande que está al alcance sin tocar lógica.

### 7.5 Combinaciones (regla del 2026-10-28)
Las dimensiones cuyas combinaciones cambian dinero, permisos o visibilidad en Reportes son: **anulada/vigente × proceso (VENTA, COMPRA) × con/sin importe × con/sin costo congelado × línea configurada/suelta × disponible/no × zona de la empresa**. No hay hoy una tabla de reglas escrita aparte del código (oráculo) que las recorra. Antes de tocar nada de la sección 7.2, el punto 1 de la tabla debería ir acompañado de esa tabla para Período. *(PROPUESTA)*

---

## 8. NO VERIFICADO

- **El gate completo** (`tsc`, `lint`, `arquitectura`, `analizar:muerto`, tests, build, e2e): no hay `node_modules` en esta sesión. Por eso «MUERTO: ninguno» se apoya en rutas/permisos/menú/escritores, no en el resultado de `knip`.
- **Datos de producción:** no se usaron. No sé cuántas ventas tienen `precioTotal = 0`, cuántos productos están hoy apagados en «Hoy», ni si alguna empresa tiene una zona horaria distinta de Argentina.
- **Tiempos de consulta** y el costo real de que Resumen operativo corra la consulta entera de Período.
- **Si un reporte «da el número correcto».** Clasifiqué por reglas, no por resultados.
- **Equivalencia de `formatearMonto` con los 89 `toLocaleString`** (decimales, signo, espacio).
- **Los tests de las 94 referencias** (no los corrí ni los leí); sí leí la cabecera y `RAIZ` del guardián de anuladas.
- **La cifra «14 archivos»** (sección 6.5): obtuve 8 / 10 con las importaciones reales; no pude reproducir 14 exacto.
- **Si es intencional que Devoluciones omita `DEVOLUCION_CONSIGNACION`** (`devoluciones.ts:31`).
- **Fechas de cambio:** la historia de git empieza el 2026-10-14; «sin cambios desde entonces» no dice nada sobre antes.
- **Frecuencia con que un ajuste manual con detalle «Anulación de…» se cuela en Diferencias:** 2 de 6 validaciones lo rechazan, según el inventario; no lo recorrí.

---

## Pregunta abierta para el dueño (una sola; cambia dinero)

Una venta con **importe $0** (precio de la línea 0, o producto regalado) hoy se informa en Período, Categorías, Sección, Consolidado y Resumen **a precio de lista de hoy** y se excluye del margen real. ¿Qué querés que muestren los reportes: **(a)** $0, lo que se cobró de verdad, o **(b)** la estimación a precio de hoy solo para las ventas anteriores a que el sistema guardara el importe por línea?

Mientras no se responda, no se toca `periodo-ventas.ts` ni el piso de $0,01 de `moneda.ts`.

**Queda pendiente (modelo de datos, no se pregunta ahora):** separar «sin stock hoy» de «se usa en esta sucursal» (`DisponibilidadProducto.disponible`), que afecta a 7 reportes.
