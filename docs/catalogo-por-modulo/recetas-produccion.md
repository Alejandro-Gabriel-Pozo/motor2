# Catálogo del módulo RECETAS Y PRODUCCIÓN (costo, food cost, márgenes objetivo) — 2026-11-06

**Estado:** inventario de SOLO LECTURA (orden del dueño: sin implementar nada). Rama `alegp/catalogo-recetas-produccion`, base `main` al 2026-11-06. Diseño de partida: `docs/diseno-flujos-y-pasos-2026-11-06.md` (rama `alegp/diseno-flujos-y-pasos`). Los flujos y pasos son PROPUESTA; lo que dependa del dueño, PENDIENTE. No se corrió ningún test ni el gate.

**Nota de nombres:** NO existe un modelo `Receta`: la receta es `RecetaVersion` (+ `RecetaIngrediente`, `RecetaPaso`, `RecetaPasoIngrediente`, `SustitutoRecetaIngrediente`, `RecetaSucursal`, `RendimientoLocalIngrediente`; `prisma/schema.prisma:778-935,1541`). **No existe un modelo de «producción»**: producir es el proceso `PRODUCCION` del Kardex (`Operacion`/`MovimientoStock`, módulo Stock) que expande la receta (`src/core/movimientos/transiciones.ts:73`, `armar-linea-de-movimiento.ts:calcularConsumosProduccion`). «Rendimiento conciliado» y «costos» son cálculos puros sobre esas tablas, sin tabla propia. `MargenObjetivo` (`schema.prisma:576`) es la única tabla de márgenes.

## 1. FLUJOS (PROPUESTA; nombres de flujo PENDIENTE de que el dueño los nombre)

| Flujo | Finalidad | Pasos (columnas) y para qué |
|---|---|---|
| F1 «Receta central de un plato/subreceta» | Saber qué insumos y cuánto consume un producto, para descontar stock al vender/producir y costearlo | **P1 Ingredientes**: `RecetaVersion.productoId/version`, `RecetaIngrediente.insumoProductoId/cantidad/unidadId/mermaPorcentaje` (qué se descuenta y cuánto). **P2 Sustitutos**: `SustitutoRecetaIngrediente.insumoSustitutoId/orden` (con qué se reemplaza si se agota). **P3 Procedimiento**: `RecetaPaso.orden/nombre/instruccion/minutos`, `RecetaPasoIngrediente.*` (cocina). **P4 Ficha técnica**: `rendimientoCantidad/UnidadId`, `racionesCantidad`, `racionTamano/UnidadId`, `tiempoPreparacionMinutos`, `tiempoCoccionMinutos`, `presentacionEmplatado`, `comentarios`, `notasAdicionales`, `equipamientoNecesario`, `RecetaIngrediente.observaciones` (informativo; todo opcional, `schema.prisma:803-818`). Cada guardado crea una versión nueva (append-only). |
| F2 «Receta propia de una sucursal» | Que una sucursal cocine distinto del central | **P1 Habilitar**: `RecetaSucursal.habilitada`. **P2 Versiones propias**: `RecetaVersion.sucursalId/basadaEnVersionId` + P1–P4 de F1. **Salida**: `habilitada=false` (vuelve al central; versiones propias quedan de historial). |
| F3 «Calibración local de rendimiento» | Corregir cantidad/merma de UNA línea en UNA sucursal sin tocar el central | **P1 Fijar**: `RendimientoLocalIngrediente.cantidad/mermaPorcentaje` (NULL = rige el central). **Salida**: «volver al central» (`volver-al-rendimiento-central.ts`). |
| F4 «Producción» (stock) | Convertir insumos en una subreceta/MP producida | Sin tabla propia: `Operacion.proceso=PRODUCCION` → consumo por receta vigente + hermanos. Los pasos pertenecen al módulo Stock (interfaz). PENDIENTE nombrar pasos. |
| F5 «Costo y food cost» | Saber cuánto cuesta un plato y si supera el objetivo | Sin tabla: P1 receta vigente + P2 costo de compra por MP (otro módulo) + P3 objetivo (`MargenObjetivo.foodCostObjetivoPct`, por categoría o empresa) → estado (`EstadoCosto`, `costos.ts:12`). |
| F6 «Rendimiento conciliado» | Comparar consumo teórico vs observado (ancla de conteo o compras) | Sin tabla: lee Kardex+conteos; `rendimiento-conciliado.ts` (anclas, tramos). |
| F7 «Combinaciones de producto» (RETIRADA) | — | Ver §2.4 y §7. |

## 2. COLUMNAS

Clase del guardián: el guardián (`test/arquitectura/cerco-columnas-de-significado.test.ts`) solo mira modelos de `MODELOS_EN_ALCANCE` (`guardas/columnas-de-significado.ts:30-57`). En mi módulo está en alcance (grupo «stock», línea 56): `RecetaSucursal`, `RecetaVersion`, `RecetaDeCombinacionVersion`. **FUERA de alcance** (no figuran en ninguna lista de `MODELOS_EN_ALCANCE`, verificado con grep): `RecetaIngrediente`, `RecetaPaso`, `RecetaPasoIngrediente`, `SustitutoRecetaIngrediente`, `RendimientoLocalIngrediente`, `MargenObjetivo`. Qué columnas de `RecetaVersion` cuenta como «de significado» el lector del esquema: NO VERIFICADO (no está en la línea de base ni en las declaraciones salvo lo citado).

### 2.1 Receta (F1/F2)
| modelo.columna | flujo/paso | para qué | escritor | lectores | clase | observación |
|---|---|---|---|---|---|---|
| RecetaVersion.productoId, .version | F1 P1 | identidad de la versión; vigente = mayor `version` | `persistencia/catalogo/guardar-version-de-receta.ts:115` | `core/catalogo/recetas-vigentes.ts` (embudo, guardián `lectores-de-receta.test.ts`); lectores: ver `server/lecturas/catalogo/recetas-vigentes.ts` | fuera/ninguna (NO VERIFICADO) | única de la serie: 2 índices únicos parciales solo en migración (`schema.prisma:831`) |
| RecetaVersion.sucursalId | F2 P2 | NULL = central | idem :115 | recetas-vigentes | stock (modelo en alcance; columna NO VERIFICADO) | doble sentido: NULL = «empresa» y valor = «sucursal» (por diseño ADR-009) |
| RecetaVersion.basadaEnVersionId | F2 P2 | avisar «la central cambió» | idem :115 | 3 archivos más (grep) | — | dato derivado sin FK (a propósito) |
| RecetaVersion.rendimientoCantidad/UnidadId, racionesCantidad, racionTamano/UnidadId, tiempo*Minutos, presentacionEmplatado, comentarios, notasAdicionales, equipamientoNecesario | F1 P4 | ficha informativa | idem :115-:130 | `receta-a-input.ts:84`, pantalla `catalogo/recetas/[productoId]` | ninguna (NO VERIFICADO) | informativos; ninguno entra en costo ni en descuento de stock (verificado: `costos.ts` no los lee). Candidatos a «paso P4 opcional» |
| RecetaIngrediente.insumoProductoId, .cantidad, .unidadId, .mermaPorcentaje | F1 P1 | qué y cuánto se descuenta/costea | idem :124 (nested create) | `armar-linea-de-movimiento.ts:66`, `linea-de-venta.ts:95`, `costos.ts`, rendimiento*, `consumo-de-linea-configurada.ts` | FUERA del guardián (mueven stock Y dinero) | **hueco**: columnas que cambian stock y costo no están en el guardián |
| RecetaIngrediente.observaciones | F1 P4 | nota por línea | :124 | pantalla receta | fuera | informativa |
| SustitutoRecetaIngrediente.insumoSustitutoId, .orden | F1 P2 | reemplazo al agotarse | :127 (create) y **`persistencia/catalogo/insumos.ts:93-110` (update/delete in situ al fusionar insumos)** | `receta-validacion.ts:107`, `lecturas/movimientos/receta-para-vender.ts` | fuera (stock) | el esquema dice «viaja con la versión (append-only)» (`schema.prisma:874`) pero la fusión de insumos MUTA versiones viejas |
| RecetaPaso.orden/nombre/instruccion/minutos | F1 P3 | procedimiento | :135 | pantalla receta, `pasos-receta.ts` | ninguna | `minutos` aparte de `tiempoPreparacionMinutos`: dos fuentes de tiempo (informativas) |
| RecetaPasoIngrediente.recetaPasoId/recetaIngredienteId | F1 P3 | qué ingrediente va en qué paso | :165 | `receta-a-input.ts:12,80` (include anidado) | fuera | sin consumidor de negocio más que la pantalla |
| RecetaSucursal.habilitada | F2 P1 | rige propia o central | `guardar-version-de-receta.ts:92` (upsert true), `persistencia/catalogo/receta-sucursal.ts:14` (false) | `cargarHabilitadaDeRecetaPropia`, `recetas-vigentes` | **stock** (declarada, línea 131) | única declarada del módulo |
| RendimientoLocalIngrediente.cantidad, .mermaPorcentaje | F3 P1 | calibración por sucursal | `persistencia/catalogo/rendimiento-local.ts:17,26`, `guardar-version-de-receta.ts:185` (copia al versionar) | `core/catalogo/rendimiento-local.ts:30`, ventas, producción, reportes | FUERA (mueve stock/costo) | NULL por columna = «hereda»; fila sin ambas = ? NO VERIFICADO |
| RendimientoLocalIngrediente.sucursalId | F3 | alcance | idem | idem | fuera | — |

### 2.2 Margen objetivo (F5)
| modelo.columna | para qué | escritor | lectores | clase | observación |
|---|---|---|---|---|---|
| MargenObjetivo.categoriaId | NULL = objetivo de la empresa; valor = de la categoría | `persistencia/reportes/margen-objetivo.ts:23` | `consultas/reportes/margen-objetivo-consulta.ts:6` | fuera | índice único parcial solo en migración (`20261001220000_margen_objetivo`) |
| MargenObjetivo.foodCostObjetivoPct | tope de food cost (0<x<100, CHECK) | :18, :23 | consulta → `resolverObjetivoFoodCost` (`core/reportes/margen-objetivo.ts:24`) → reporte Costos, pantalla margen-objetivo | **fuera** (decide el estado «Food cost alto» y el «precio para el objetivo») | se BORRA la fila (`:13`, `delete`), con auditoría; hay un valor por defecto en código (`FOOD_COST_OBJETIVO_PCT = 40`, `margen-objetivo.ts:9`): doble fuente |

### 2.3 Sin tabla
Producción, costos, food cost y rendimiento conciliado no tienen columnas propias (se calculan). Ver §3.

### 2.4 Familia retirada (en esquema SIN lector ni escritor en `src/`; migración de retiro PENDIENTE)
Verificado: `test/arquitectura/go3a-retirado.test.ts` prohíbe sus nombres en `src/`, `plataforma/` y `scripts/` y dice que los 6 modelos siguen hasta «la migración de retiro, que va en un PR aparte»; tablas creadas en `prisma/migrations/20261021110000_go3a_combinaciones` (con `down.sql`) y `…111000_go3a_rls_sucursal_combinaciones`. Sin entrada de vencimiento en ese cerco (NO VERIFICADO si existe fecha en otro doc).
| modelo | columnas | clase guardián | observación |
|---|---|---|---|
| GrupoDePrecio | nombre, precio, activo, version, creadoEn, actualizadoEn | `version` ninguna (declarada); `activo` **sin-declarar** (baseline JSON:106) | tabla con dinero (`precio`) sin escritor |
| CombinacionDeProducto | productoId, opcionEje1Id, opcionEje2Id, activa, precio, grupoDePrecioId, version | `activa` visibilidad, `version` ninguna (declaradas :103,109) | — |
| PrecioLocalDeCombinacion | sucursalId, combinacionId, grupoDePrecioId, precio, habilitado | `precio`/`habilitado` dinero (declaradas :84-85) | — |
| RecetaDeCombinacionVersion | combinacionId, numero, creadoPorId | `numero` **sin-declarar** (baseline:220) | modelo en alcance «stock» |
| RecetaDeCombinacionIngrediente | versionId, insumoProductoId, cantidad, unidadId, mermaPorcentaje, orden | fuera de alcance | copia del esquema de `RecetaIngrediente`: tercera fuente de la fórmula merma si volviera |
| CombinacionEnLinea | cuentaItemId, combinacionId, origenPrecio, precioDeSucursal, grupoDePrecioId, nombreGrupoDePrecio, precio, recetaDeCombinacionVersionId | `origenPrecio`, `precioDeSucursal` **sin-declarar** (baseline:22-27) | cuelga de `CuentaItem` (CASCADE) |
Además `ProductoAdmiteGrupo.ejeDeCombinacion` ya no está en el modelo Prisma pero la base la conserva (`go3a-retirado.test.ts:5`).

## 3. FUNCIONES Y PRIMITIVAS
| nombre | archivo | qué hace | copias/variantes | ¿fuente única declarada? |
|---|---|---|---|---|
| consumo bruto `cantidad × (1+merma/100)` | `core/reportes/costos.ts:61,158,310` (number); `core/movimientos/linea-de-venta.ts:95` (number); `server/actions/movimientos/casos-de-uso/armar-linea-de-movimiento.ts:68` (number); `core/reportes/rendimiento-recetas-vistas.ts:50` (number + redondeo 3 dec); `core/movimientos/consumo-de-linea-configurada.ts:133,147` (decimal.js, precisión 40, HALF_UP) | descuento de stock y costo | **8 sitios** (6 coma flotante, 2 decimal exacto); `rendimiento-recetas-vistas.ts:61` hace la inversa | **NO**. Hay comentario «misma fórmula» (`rendimiento-recetas-vistas.ts:48`) y de «textualmente igual» (`linea-de-venta.ts:87`) pero ningún guardián. Costo y descuento de stock pueden diferir en los últimos bits |
| `redondearCantidad` | `core/reportes/redondeo.ts:2` (3 dec, exportada); locales: `rendimiento-conciliado.ts:32`, `historial-vistas.ts:12`, `rendimiento-recetas-vistas.ts:19` (3 dec); `core/pos/cuenta.ts:27`, `core/pos/comanda.ts:17` (4 dec); `test/pos/lineas-de-venta-opciones.propiedades.test.ts:17` | redondear cantidades de stock | 6 en `src` (+1 test): 4 de 3 decimales (una exportada y 3 duplicadas «a propósito» por no arrastrar Prisma al bundle cliente), 2 de 4 decimales (POS, ajenas) | NO. `redondeo.ts` ya es puro (su docstring dice que no arrastra la base), así que el motivo «no importar Prisma» de las 3 copias parece obsoleto: NO VERIFICADO que el bundle cliente lo admita |
| `rendimientoEfectivo` | `core/catalogo/rendimiento-local.ts:30` | cantidad/merma efectivas (central vs override de sucursal) | — | SÍ (uso en producción, ventas, 3 reportes) |
| `resolverCostoUnitario` / `calcularCostosYMargenesDesde` / `costoUnitarioDeInsumoDesde` / `resolverCostoRecetaCompleta` | `core/reportes/costos.ts:32,129,279,289` | costo recursivo de receta | `resolverCostoRecetaCompleta` repite el bucle de `calcularCostosYMargenesDesde` y `resolverCostoUnitario` (3 bucles de costo) | parcial: un resolutor interno, tres bucles |
| `quedarseConLaVigente`, `whereConReceta`, `incluirRecetaVigente` | `core/catalogo/recetas-vigentes.ts:43,53,62` | «receta vigente» | — | SÍ, con guardián `lectores-de-receta.test.ts` |
| `resolverObjetivoFoodCost`, `superaFoodCostObjetivo`, `precioParaObjetivo`, `FOOD_COST_OBJETIVO_PCT` | `core/reportes/margen-objetivo.ts:9-40` | objetivo y umbral | — | SÍ, guardián `food-cost-objetivo-en-un-solo-lugar.test.ts` |
| validadores de receta | `core/catalogo/receta-validacion.ts` (298 líneas) y `core/features/catalogo/receta-version.guard.ts` | validar ingredientes/pasos/cabecera | tope de merma 0–100 repetido en `consumo-de-linea-configurada.ts:121` y CHECK de combinaciones | NO VERIFICADO |
| `calcularConsumosProduccion` | `armar-linea-de-movimiento.ts:50` | expande receta al producir | variante de `pedidoDeIngrediente` (ventas) | no: dos expansiones de receta (venta y producción) con fórmula propia cada una |
| `cuentaComoConsumoDeReceta` | `core/reportes/rendimiento-conciliado.ts:91` | qué procesos cuentan como consumo | — | NO VERIFICADO |
| `guardar-version`: lectura MAX+1 | `casos-de-uso/guardar-version-de-receta.ts` | versión siguiente | patrón «versión+1» repetido en opciones de venta (`opciones-de-venta-en-tx.ts`, ajeno) | no |

## 4. FUENTES DE VERDAD
| hecho | lugares | manda | tipo |
|---|---|---|---|
| Consumo bruto de un ingrediente | los 8 sitios de §3 | ninguno declarado; lo ejecutado en Kardex = `linea-de-venta.ts`/`armar-linea…` | **accidental** (float vs decimal) |
| Receta vigente de un producto | `recetas-vigentes.ts` + `RecetaSucursal.habilitada` + `RecetaVersion.sucursalId` | `recetas-vigentes.ts` (guardián) | intencional |
| Cantidad/merma efectiva | `RecetaIngrediente` + `RendimientoLocalIngrediente` (override) | `rendimientoEfectivo` | intencional (ADR-009) |
| Food cost objetivo | `MargenObjetivo` (categoría) → `MargenObjetivo` (empresa) → `FOOD_COST_OBJETIVO_PCT` (código, 40) | `resolverObjetivoFoodCost` | intencional; el 40 vive en código, no en la empresa |
| Tiempo de la receta | `RecetaVersion.tiempoPreparacionMinutos/tiempoCoccionMinutos` y `Σ RecetaPaso.minutos` | ninguno | accidental (informativo) |
| Unidad de la receta vs unidad de stock | `RecetaIngrediente.unidadId` vs `Producto.unidadStock` | validación al guardar (`validarUnidadDeIngredientes`); el stock no convierte | NO VERIFICADO en el descuento |
| Sustitutos de una línea | `SustitutoRecetaIngrediente` (por línea) y familia «hermanos» del Insumo (`resolverConsumoPorFamilia`) | NO VERIFICADO | posible doble fuente |
| Costo de un plato | `costos.ts` (reposición, compra más reciente) vs `costo-historico`/`valuacion`/`margen-real` (otros reportes, interfaz) | NO VERIFICADO | — |

## 5. ESCRITURAS
| caso de uso | escribe | ¿de más? | tipo |
|---|---|---|---|
| guardar-version-de-receta (`casos-de-uso/guardar-version-de-receta.ts`) | `RecetaVersion` + ingredientes + sustitutos + pasos + `RecetaPasoIngrediente` (un `create` por fila, `:165`, bucle N+1) + `RecetaSucursal` upsert + copia de `RendimientoLocalIngrediente` + auditoría (SERIALIZABLE, reintento 5, `versionEsperada`) | versión nueva aunque no cambie nada? NO VERIFICADO; copia las calibraciones (`createMany`) en cada versión: filas duplicadas por versión | intencional (foto) |
| fijar-rendimiento-local | upsert `RendimientoLocalIngrediente` + 2 auditorías | no | intencional |
| volver-al-rendimiento-central | `update` de `RendimientoLocalIngrediente` (`persistencia/catalogo/rendimiento-local.ts:26`, no borra la fila) | NO VERIFICADO qué campos deja | NO VERIFICADO |
| volver-a-la-receta-central | `RecetaSucursal.habilitada=false` | no | intencional |
| renombrar-o-fusionar-insumo | `SustitutoRecetaIngrediente` update/delete en versiones históricas (`insumos.ts:93-110`) | **sí: reescribe historia «append-only»** | accidental/contradice el esquema |
| guardar-margen-objetivo | crea/cambia/**borra** `MargenObjetivo` + auditoría (ok sin cambio no escribe) | borra fila (no «anula con registro nuevo»); queda la auditoría | intencional |
| PRODUCCION (Stock) | `Operacion`+`MovimientoStock` consumo y entrada | interfaz | — |
| receta-a-ciegas (`actions/catalogo/receta-a-ciegas.ts`, 30 líneas) | NO VERIFICADO (no leído) | solo desde scripts y tests (guardián `receta-a-ciegas-solo-desde-scripts-y-tests.test.ts`) | NO VERIFICADO |

## 6. INVARIANTES
| regla | documento | test | 
|---|---|---|
| Elegir «receta vigente» solo por `recetas-vigentes.ts` | `plan-rendimiento-receta-por-sucursal-2026-09-26.md` | `test/arquitectura/lectores-de-receta.test.ts`; `test/recetas/caracterizacion-vigente-por-lector.test.ts` |
| Food cost objetivo en un solo lugar | docstring del test | `food-cost-objetivo-en-un-solo-lugar.test.ts`; `test/reportes/margen-objetivo*.test.ts` |
| Orden en rendimiento de recetas | `plan-rendimiento-recetas-2026-09-22.md` | `orden-en-rendimiento-recetas.test.ts` |
| Producción redondea el consumo a la unidad | `docs/auditoria-motor2-pivotes-2026-09-16.md` §11 | `test/auditoria/precision-produccion-sin-redondeo.test.ts` |
| Versión de receta no se pisa (optimista + UNIQUE) | docstring caso de uso `:58-67` | pruebas de concurrencia: NO VERIFICADO (existe `test/auditoria/concurrencia-casos-2-3.test.ts`, no leído) |
| Consumo y costo de receta | — | `test/recetas/caracterizacion-consumo-y-costo.test.ts`, `test/reportes/costos.test.ts` |
| Una receta de MP solo si `seProduce` | `receta-validacion.ts:138` | NO VERIFICADO (test) |
| Combinaciones retiradas no vuelven | AGENTS/DEC-02, DEC-16 | `test/arquitectura/go3a-retirado.test.ts` |
| Mismo cálculo `cantidad×(1+merma)` en costo y en Kardex | comentarios (`linea-de-venta.ts:87`) | **sin test** (solo caracterización) |
| Un solo objetivo de empresa (categoriaId NULL) | migración (índice parcial) | NO VERIFICADO (test) |
| Sustitutos/pasos de versiones viejas no cambian | `schema.prisma:874` | **sin test** (y `insumos.ts` lo viola) |
| Combinaciones de dimensiones (oráculo) del módulo | regla «Combinaciones» | sin oráculo propio de receta×sucursal×calibración (NO VERIFICADO; mapa en `docs/mapa-cobertura-de-combinaciones-2026-10-28.md`) |

## 7. DEUDA
| ítem | ¿vencimiento? | dónde |
|---|---|---|
| Migración de retiro de los 6 modelos GO-3a + columna `ejeDeCombinacion` | no hallado (dice «PR aparte») | `test/arquitectura/go3a-retirado.test.ts:5-8` |
| Columnas sin declarar de la familia retirada: `GrupoDePrecio.activo`, `RecetaDeCombinacionVersion.numero`, `CombinacionEnLinea.origenPrecio/precioDeSucursal` | no (conteo sin fecha) | `cercos/linea-de-base/columnas-de-significado.json:22,25,106,220` |
| Modelos de receta fuera del guardián (`RecetaIngrediente`, `RendimientoLocalIngrediente`, `SustitutoRecetaIngrediente`, `MargenObjetivo`) | no declarado | `guardas/columnas-de-significado.ts:30-57` |
| `redondearCantidad` duplicada ×3 (3 dec) y ×2 (4 dec, POS) | no | comentarios «duplicado a propósito» en cada archivo |
| Fórmula de merma en 8 sitios | no | §3 |
| `insumos.ts` muta sustitutos históricos | no | `persistencia/catalogo/insumos.ts:93-110` |
| `cerco-numero-de-formulario`: meta 0 alcanzada en recetas (lote 6.33), sin deuda abierta del módulo | cerrada | `cerco-numero-de-formulario.test.ts:11` |

## 8. INTERFACES (no inventariadas aquí)
- Stock/Kardex: `PRODUCCION` y ventas escriben `Operacion/MovimientoStock` usando la receta (`armar-linea-de-movimiento.ts`, `registrar-venta-en-tx.ts`, `lecturas/movimientos/receta-para-vender.ts`); conteo físico alimenta el rendimiento conciliado.
- Catálogo: `Producto.seProduce/tipo/esNoComestible`, `Insumo` (sustitutos, fusión en `insumos.ts`), `Unidad`, `CategoriaProducto` (objetivo por categoría).
- Compras: costo de compra más reciente por MP (`obtenerCostoActualPorMP`, `lecturas/reportes/costos.ts:58`).
- Precios/POS/Carta: `Producto.precioVenta` y opciones de venta (`consumo-de-linea-configurada.ts`, `ConsumoDeOpcion`) usan la misma fórmula de merma; `CuentaItem` (cuelga `CombinacionEnLinea`).
- Permisos/auditoría: `margen_objetivo_editar`, permisos de receta/calibración (`20261002140000_permisos_receta_sucursal`, `20260926012600_…`), `registrarCambioAuditado`.
- Reportes: `rendimiento-recetas`, `rendimiento-por-sucursal`, `costos`, `margen-real`, `insumos-sin-receta`, `ventas-sin-receta`, `huecos-catalogo` (pantallas `src/app/(app)/reportes/*`).

## 9. NO VERIFICADO
- Qué columnas de `RecetaVersion` el guardián considera «de significado» y su clase (solo se leyó la lista de modelos y la línea de base).
- Si `volver-al-rendimiento-central` borra o anula; si el guardado de versión idéntica crea versión igual.
- Si el descuento de stock convierte unidades receta→stock (solo se verificó la validación al guardar).
- Contenido de las pruebas de concurrencia/idempotencia de `guardar-version-de-receta` y de los reportes (no leídos).
- Si hay fecha de retiro de GO-3a fuera de lo leído; datos reales de producción (cero lecturas).
- Cobertura exacta de lectores de las columnas informativas de ficha (solo conteo por grep de nombre, que mezcla homónimos).
- `core/features/catalogo/receta-version.guard.ts` y `receta-validacion.ts`: no leídos completos; el listado de validaciones es parcial.
