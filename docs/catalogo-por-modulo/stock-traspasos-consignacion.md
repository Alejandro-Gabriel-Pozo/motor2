# Catálogo del módulo STOCK, MOVIMIENTOS, TRASPASOS Y CONSIGNACIÓN (2026-11-06)

**Estado:** inventario de SOLO LECTURA. No se tocó código, tests ni migraciones. Rama `alegp/catalogo-stock-traspasos-consignacion`. Todo es PROPUESTA salvo lo marcado; lo no comprobado va como NO VERIFICADO. Alcance: `Operacion`, `MovimientoStock`, `Seccion`, `ConteoFisico`, `StockMinimoProducto`, `FrecuenciaConteoProducto`, `SeccionHabitualProducto`, `TraspasoSucursal`, `PagoConsignante` (+ columnas de consignación de `Producto`), reclasificación y las lecturas de saldo. La compra (`FacturaProveedor*`) la cubre otro módulo.

## 1. Flujos

| Flujo | Finalidad | Pasos (columnas) | Para qué sirve el paso |
|---|---|---|---|
| **Kardex / movimiento de stock** (`registrar-movimiento.ts`, `escribir-movimiento-de-stock.ts`) | Dejar asentado que una cantidad entró, salió o cambió de lugar, para saber cuánto hay y a qué costo | P1 Encabezado: `Operacion.proceso/fecha/sucursalId/usuarioId/claveIdempotencia/payloadHash` — P2 Líneas: `MovimientoStock.productoId/seccionId/proceso/cantidad/detalle/loteVencimiento` — P3 Valor: `precioTotal/precioPorUnidadStock` — P4 Motivo/destino: `Operacion.motivoId/destinoId/detalleLibre/seccionDestinoId/proveedorId` — P5 Resultado idempotente: `resultadoMensaje` — Salida: anulada (`anuladaEn/anuladaPorId`) con contra-asiento AJUSTE | P1 no duplicar y saber quién; P2 mover el saldo; P3 costear; P4 explicar el porqué; P5 que el reintento devuelva lo mismo |
| **Conteo físico** | Corregir el saldo del sistema con lo contado | P1 Contado: `ConteoFisico.productoId/seccionId/loteVencimiento/saldoSistema/conteoReal/diferencia/fecha/usuarioId` — P2 Decidido: `accion/estado` (+ línea AJUSTE con `MovimientoStock.conteoFisicoId`) — Salida: cancelado (`estado=CANCELADO`, `motivoCancelacion`) | P1 registrar que se contó; P2 aplicar o no la diferencia al stock |
| **Traspaso entre sucursales** | Mover mercadería entre sucursales con aprobación de las dos puntas | P1 Solicitada/envío directo: `origen/destinoSucursalId, productoId, cantidad, iniciadoPor, creadoPorId, detalle` — P2 Aprobada y enviada por Origen: `seccionOrigenId, fechaDecisionOrigen, decididoPorOrigenId, costoUnitarioOrigen` (+ SALIDA en Kardex) — P3 Aceptada por Destino: `seccionDestinoId, fechaDecisionDestino, decididoPorDestinoId` (+ ENTRADA) — Salidas: rechazo origen/destino (`motivoRechazo*`), reingreso (`fechaCierre, cerradoPorId`, REINGRESO), cancelada | P1 pedir/enviar; P2 sacar del origen y congelar el costo; P3 sumar al destino |
| **Consignación** (sin modelo de flujo propio; vive en la venta y en un reporte) | Pagar al consignante solo lo que se vendió de su mercadería | P1 Producto marcado: `Producto.esConsignacion/proveedorConsignacionId/precioConsignacion` — P2 Venta liquida: líneas `LIQUIDACION_CONSIGNACION` (`MovimientoStock.precioTotal`) — P3 Pago: `PagoConsignante.proveedorId/importe/fecha/notas/claveIdempotencia/payloadHash/resultadoMensaje` — Salida: no existe anulación del pago | P2 generar la deuda; P3 saldar |
| **Reclasificación** (`reclasificar-stock.ts`) | Repartir el saldo de una sección/lote en otros destinos sin cambiar el total | Un solo paso: una `Operacion` RECLASIFICACION con 1 origen y N destinos (`MovimientoStock.*`) | Reubicar stock |
| **Parámetros de stock por sucursal** | Que el sistema avise y sepa de dónde descontar | `StockMinimoProducto.minimo/seccionId` (alerta) — `FrecuenciaConteoProducto.frecuenciaDias` (cada cuánto contar) — `SeccionHabitualProducto.seccionId` (de dónde descuenta la venta) — `Seccion.sirveDeRespaldoEnVentas` | Alertas, calendario de conteo, descuento automático en venta |

## 2. Columnas (solo las con observación o significado; el resto: ver esquema)

| modelo.columna | flujo / paso | para qué | escritor | lectores | clase guardián | observación |
|---|---|---|---|---|---|---|
| MovimientoStock.cantidad (schema:1302) | Kardex P2 | saldo = SUM(cantidad) | `escribir-movimiento-de-stock.ts:40`, `escribir-venta.ts`, `escribir-contra-asiento.ts:53`, `escribir-movimiento-de-traspaso.ts:49` | 19 archivos (§3) | sin declarar (fuera de lista de 82) | cuatro escritores del mismo modelo; sin función única |
| MovimientoStock.proceso | Kardex P2 | signo y clase | mismos | reportes, `historial-vistas.ts` | stock | duplica `Operacion.proceso` (§4) |
| MovimientoStock.loteVencimiento | Kardex P2 | FEFO | idem | `saldos.ts:35,107`, `vencimientos.ts` | stock | — |
| MovimientoStock.precioTotal/precioPorUnidadStock | Kardex P3 | costo/valuación | idem | `valuacion.ts`, `consignacion.ts:46` | ninguna/NO VERIFICADO | en LIQUIDACION es la deuda; en traspaso copia del costo origen |
| MovimientoStock.cantidadExacta | Venta (redondeo) | arrastre | `escribir-venta.ts`, `escribir-contra-asiento.ts` | `deuda-de-redondeo.ts:20`, `costo-historico.ts` | ver baseline | — |
| MovimientoStock.facturaProveedorRenglonId | Compra | vínculo al renglón | compras | compras | **deuda** (baseline) | schema dice «nada de src/ la escribe todavía» (Etapa C): contradice los 28 usos de compras NO VERIFICADO |
| MovimientoStock.devuelveAMovimientoId | Devolución a proveedor | origen de la devolución | **sin escritor** (0 archivos en `src/`) | **sin lector** | stock | colgada: declarada «stock» pero nadie la escribe |
| MovimientoStock.sustituyeAProductoId | Venta | sustituto de receta | `registrar-venta-en-tx.ts` | `historial-producto.ts` | — | OK |
| Operacion.revierteAOperacionId (schema ~1170, UNIQUE) | Anulación | enlazar contra-asiento con lo anulado | **sin escritor**: `escribir-contra-asiento.ts:41-55` crea el AJUSTE sin ese campo y marca `anuladaEn` | **sin lector** | stock | colgada; el vínculo anulada↔reversión no existe como FK (solo `anuladaPorId`) |
| Operacion.mermaPorAnulacionDeId, reemplazaAOperacionId, motivoAnulacion | Anulación / corrección | trazabilidad | **sin escritor** en `src/` (grep: 0 archivos / solo CuentaItem) | sin lector | stock (las dos primeras) | colgadas |
| Operacion.operacionPadreId, ventaId, fecha | Venta | encadenar | `registrar-venta-en-tx.ts` | `periodo.ts` | **deuda** (baseline) | — |
| Operacion.fecha vs creadoEn | Kardex P1 | «cuándo» | idem | reportes usan `operacion.fecha` (`historial-producto.ts:77`), alertas/consolidado usan `creadoEn` (`alertas.ts:23`, `consolidado.ts:56`) | deuda (fecha) | **doble sentido de tiempo** |
| Operacion.proveedorId / clienteId / promoCuentaId / seccionDestinoId | P4 | contraparte | `registrar-movimiento.ts`, venta | reportes | — | `proveedorId` para Venta «nunca se usó» (schema) |
| Operacion.claveIdempotencia + payloadHash + resultadoMensaje | P1/P5 | I3 | `idempotencia.ts:51` (update posterior) | `chequearIdempotencia` | ninguna | mecanismo repetido en 4 modelos (§3) |
| Seccion.activa | Parámetros | dar de baja | `actualizar-activa-seccion.ts` | traspasos, conteo, venta | **deuda** (baseline) | decide dónde puede entrar stock |
| Seccion.sirveDeRespaldoEnVentas | Parámetros | respaldo en venta | `actualizar-respaldo-seccion.ts` | `registrar-venta-en-tx.ts` | stock | OK |
| ConteoFisico.saldoSistema/diferencia | Conteo P1 | foto histórica | `escribir-conteo-fisico.ts:44` | `consolidado.ts:41` | — | copia intencional (histórico) |
| ConteoFisico.fecha | Conteo P1 | cuándo | idem | `consolidado.ts` | **deuda** (baseline) | otra vez fecha vs `creadoEn` de las líneas |
| ConteoFisico.estado/accion | Conteo P2 | si tocó stock | `escribir-conteo-fisico.ts:60` | consolidado, `aplicado-por-conteo.ts` | stock | — |
| TraspasoSucursal.iniciadoPor | Traspaso P1 | quién pidió | `escribir-creacion-de-traspaso.ts` | `lecturas.ts` | **deuda** (baseline) | solo lo lee la bandeja |
| TraspasoSucursal.decididoPorDestinoId, cerradoPorId | P3/Salida | quién | persistencia traspasos | **sin lector fuera de la escritura** (2 archivos, ambos escritores) | ninguna (fechas) | colgadas de lectura |
| TraspasoSucursal.cantidad/productoId | P1 | pedido | creación | bandeja, `en-transito.ts` | — | duplican las líneas de Kardex (§4) |
| TraspasoSucursal.estado | todos | transición | persistencia traspasos | todo | stock | OK |
| TraspasoSucursal.costoUnitarioOrigen | P2 | costo congelado | `escribir-aprobacion...`, `escribir-creacion...` | `costo-del-traspaso.ts` | dinero | intencional (ADR-040) |
| StockMinimoProducto.minimo/seccionId | Parámetros | alerta | `persistencia/stock/stock-minimo.ts:27-47,70` | `alertas.ts:31`, `resumen-*.ts`, `consultas/stock/stock-minimo.ts:11-12` | ninguna/NO VERIFICADO | `seccionId` NULL = global: el `@@unique` no cubre NULL; depende de un índice parcial manual (migración 20260915084615:30) |
| StockMinimoProducto.sucursalId | idem | alcance | idem | idem | — | redundante con `seccion.sucursalId` cuando hay sección |
| FrecuenciaConteoProducto.frecuenciaDias | Parámetros | calendario de conteo | `persistencia/stock/frecuencia-conteo.ts:13` | `diferencias-ajustes.ts:36`, pantalla | ninguna | un solo lector de negocio |
| SeccionHabitualProducto.seccionId | Parámetros | de dónde descuenta la venta | `persistencia/stock/seccion-habitual.ts:13` | `cargar-origen-de-venta.ts:103`, `consultas/catalogo/productos.ts:48` | ninguna/NO VERIFICADO | afecta qué se descuenta: declarada «ninguna» o no declarada, NO VERIFICADO |
| PagoConsignante.importe/fecha | Consignación P3 | deuda saldada | `persistencia/reportes/pago-consignante.ts` | `consignacion.ts:66-70` | dinero / fecha en **deuda** | **sin anulación** (no hay `anuladaEn`), sin vínculo a liquidaciones |
| Producto.precioConsignacion | Consignación P1 | costo al consignante | `actualizar-producto.ts` | `armar-linea-de-movimiento.ts:80` | NO VERIFICADO | ver §4 |

## 3. Funciones y primitivas

| Nombre | Archivo | Qué hace | Copias / variantes | ¿Fuente única declarada? |
|---|---|---|---|---|
| `calcularSaldoTotal`, `calcularSaldoPorLote` | `src/server/lecturas/movimientos/saldos.ts:29,35` | SUM(cantidad) con sucursal en el `where` | **19 archivos con `movimientoStock.groupBy/aggregate`**: `consultas/stock/{alertas:19,consolidado:28,por-familia:11}`, `consultas/movimientos/stock-para-conteo.ts:22`, `consultas/reportes/{vencimientos:23,consignacion:86,valuacion:30,resumen-consolidado:101,resumen-operativo:64,rendimiento-recetas:91,historial-producto:77}`, `lecturas/catalogo/dependencias-para-desactivar.ts:37`, `lecturas/movimientos/{saldos:196,aplicado-por-conteo:12,deuda-de-redondeo:20}`, `persistencia/compras/cargar-compra-para-anular.ts:53`, `persistencia/movimientos/cargar-origen-de-venta.ts:63` | **No**: ninguna regla ni guardián lo declara |
| Filtro de disponibilidad en el saldo | `whereDisponibleEn` (`core/catalogo/`), `disponibilidadDeProductos` | «¿está en la sucursal?» | **Filtran el producto**: `consolidado.ts:28-33`, `valuacion.ts:32`, `stock-para-conteo.ts:36` (en memoria), `rendimiento-recetas.ts` (pool). **No filtran**: `alertas.ts:19`, `por-familia.ts:11`, `resumen-operativo.ts:64`, `vencimientos.ts:23`, `saldos.ts:196` (`saldosTeoricosEnSucursal`), `historial-producto.ts:77`, `dependencias-para-desactivar.ts:37`, `consignacion.ts:86` (filtra solo la lista de salida). `resumen-consolidado.ts:101`: NO VERIFICADO | El **filtro** sí: `test/arquitectura/disponibilidad-en-un-solo-lugar.test.ts`. **Aplicarlo al saldo, no** |
| `validarStockSuficiente`, `obtenerSeccionPropia`, `seccionesConStock` | `saldos.ts:47,91,63` | validar/propiedad de sección | `obtenerSeccionPropia` repetido en `aceptar-traspaso.ts`, `reclasificar-stock.ts` (importan; no copian) | sí (importado) |
| `chequearIdempotencia`/`registrarResultadoIdempotente` + `calcularPayloadHash` | `persistencia/movimientos/idempotencia.ts`, `core/movimientos/public-servidor` | I3 | mismo trío de columnas (`claveIdempotencia/payloadHash/resultadoMensaje`) en `Operacion`, `ConteoFisico`, `PagoConsignante`, `ReclasificacionRenglon` y facturas; `PagoConsignante` lo hace en un solo `create` (variante) | parcial (`test/auditoria/idempotencia-i3-mecanismo.test.ts`) |
| `escribirMovimientoDeTraspaso` | `persistencia/traspasos/escribir-movimiento-de-traspaso.ts:39-49` | `operacion.create` + `movimientoStock.create` de un paso de traspaso | otros 3 `operacion.create`: `escribir-movimiento-de-stock.ts:32`, `escribir-venta.ts:31`, `escribir-contra-asiento.ts:41` | no |
| `escribirContraAsiento` | `escribir-contra-asiento.ts:36` | anula con AJUSTE | compra tiene `escribir-anulacion-de-compra.ts`, venta `escribir-anulacion-de-venta.ts` | no |
| `elegirMinimo` / `guardarMinimoGlobal` / `guardarMinimoDeSeccion` | `core/stock/stock-minimo.ts`, `persistencia/stock/stock-minimo.ts:22,41` | mínimo por sección o global | upsert vs find+create (misma clave, dos mecánicas) | no |
| `valorizarLineaDeTraspaso` | `core/stock/costo-del-traspaso.ts` | valoriza salida/entrada/reingreso | — | sí (ADR-040) |
| Importe de consignación | `consignacion.ts:60-80` | Σliquidado − Σpagado en `Number` + `redondearMoneda` | ver §4 | no |

## 4. Fuentes de verdad

| Hecho | Dónde se guarda o decide | Quién manda | Intencional |
|---|---|---|---|
| Saldo de un producto | SUM(`MovimientoStock.cantidad`) en ~25 sitios; `ConteoFisico.saldoSistema` (foto) | el Kardex | la foto, sí; los ~25 cálculos, **accidental** (criterio de disponibilidad y de tiempo distinto, §3) |
| «Disponible en sucursal» para el saldo | `DisponibilidadProducto` (filtra 4 sitios) vs sin filtro (8 sitios) | nadie | **accidental** |
| Clase de proceso | `Operacion.proceso` y `MovimientoStock.proceso` | la línea | el encabezado es «el iniciado», la línea el real (schema 1085-1093): sí; pero guardián los declara dos veces |
| Stock en tránsito | `TraspasoSucursal.estado` (`en-transito.ts:13`) vs líneas SALIDA/ENTRADA del Kardex | la tabla de traspasos | accidental: dos lecturas del mismo hecho; test `test/stock/en-transito.test.ts`, `test/auditoria/traspasos-en-transito.test.ts` |
| Cantidad traspasada | `TraspasoSucursal.cantidad` y `MovimientoStock.cantidad` (±) | el Kardex para saldo | trazabilidad (copia) |
| Costo del traspaso | `costoUnitarioOrigen` copiado + líneas valorizadas | la copia | intencional (ADR-040) |
| Anulación | `Operacion.anuladaEn/anuladaPorId` + AJUSTE sin `revierteAOperacionId` | `anuladaEn` | **accidental**: el enlace FK previsto no se escribe |
| Deuda con el consignante | Σ`LIQUIDACION_CONSIGNACION.precioTotal` agrupado por `Producto.proveedorConsignacionId` actual, menos Σ`PagoConsignante.importe` | cálculo en vivo (`consignacion.ts:46-80`) | **accidental**: no hay saldo guardado ni imputación pago↔liquidación; precio de liquidación nace de `Producto.precioConsignacion` al vender (`armar-linea-de-movimiento.ts:80`) y se copia en la línea (congelar: intencional) |
| Mínimo de stock | fila por sección y fila global (`seccionId` NULL) | `elegirMinimo` (sección gana) | intencional, pero con dos mecánicas de escritura |
| Fecha de un movimiento | `Operacion.fecha` / `MovimientoStock.creadoEn` / `ConteoFisico.fecha` | no declarado | **accidental** (3 relojes) |

## 5. Escrituras

| Caso de uso | Qué escribe | ¿De más? | Intencional |
|---|---|---|---|
| `registrar-movimiento` | `Operacion` + N `MovimientoStock` + update `resultadoMensaje` (segundo write, `idempotencia.ts:51`) | el update posterior | accidental menor (PagoConsignante lo resolvió en un solo create) |
| `registrar-venta-en-tx` | `Operacion` por línea + VENTA + CONSUMO + LIQUIDACION (+ `cantidadExacta`, `costoUnitarioVenta`, `precioListaUnitario`) | congela costo/precio | intencional |
| `anular-venta` / `escribir-contra-asiento` | `Operacion` AJUSTE + líneas + `anuladaEn` | no escribe `revierteAOperacionId`, `motivoAnulacion` | **faltan** |
| `registrar-conteo-fisico` | `ConteoFisico` + (si AJUSTAR) `Operacion` AJUSTE + línea | `saldoSistema` y `diferencia` guardados | intencional |
| `cancelar-conteo-fisico` | update de estado + contra-línea | — | intencional |
| `crear-solicitud` / `crear-envio-directo` | `TraspasoSucursal` (+ SALIDA si directo) | — | intencional |
| `aprobar-y-enviar` | SALIDA + update traspaso (sin I3 propia: serializable + transición de estado) | — | intencional |
| `aceptar-traspaso` | ENTRADA + update traspaso | — | intencional |
| `rechazar-envio` / `confirmar-reingreso` | REINGRESO + cierre | — | intencional |
| `reclasificar-stock` | `Operacion` RECLASIFICACION + origen negativo + N destinos | — | intencional |
| `registrar-pago-consignante` | `PagoConsignante` | no imputa a liquidaciones | faltante |
| `set-stock-minimo-producto` | upsert o find+create/update | — | ver §4 |

## 6. Invariantes

| Regla | Documento | Test | 
|---|---|---|
| Saldo = SUM(cantidad); el sistema avisa y no bloquea (GO-2d) | `transiciones.ts:14`, `saldos.ts:187` | `test/stock/saldos-por-sucursal.test.ts`, `test/auditoria/precision-numerica-y-saldo.test.ts` |
| Saldo falla cerrado por sucursal | `saldos.ts` (T15) | `test/stock/saldos-por-sucursal.test.ts` |
| «Disponible» se escribe en un solo lugar | plan-disponibilidad §3 P12 | `test/arquitectura/disponibilidad-en-un-solo-lugar.test.ts` |
| El mismo saldo da lo mismo en alertas, consolidado, valuación y resumen | — | **sin test** |
| Idempotencia (clave repetida no duplica) | I3 | `test/auditoria/idempotencia-i3-mecanismo.test.ts`, `idempotencia-resto-de-procesos.test.ts`, `test/movimientos/idempotencia.propiedades.test.ts` |
| Concurrencia en movimiento / conteo / reclasificación / mínimo / envío | — | `test/movimientos/registrar-movimiento.test.ts`, `conteo-fisico.test.ts`, `test/stock/reclasificacion.test.ts`, `stock-minimo-cambiar-con-valor-visto.test.ts`, `test/traspasos/envio-vs-apagar-sucursal.test.ts`, `test/auditoria/concurrencia-*.test.ts` |
| Transiciones del traspaso | `traspaso.guard` | `test/traspasos/traspasos.test.ts`, `test/casos-de-uso/traspasos-*.test.ts` |
| Costo viaja con el traspaso | ADR-040 | `test/traspasos/costo-en-el-traspaso.test.ts` |
| Conteo cancelar / por lote / frecuencia | — | `test/movimientos/conteo-*.test.ts`, `test/stock/frecuencia-conteo*.test.ts` |
| Sección desactivada no recibe stock | P17 | `test/movimientos/seccion-desactivada*.test.ts`, `test/casos-de-uso/traspasos-seccion-desactivada.test.ts` |
| Arrastre de redondeo | Task #27 | `test/movimientos/arrastre-redondeo*.test.ts`, `test/auditoria/concurrencia-arrastre-redondeo.test.ts` |
| Un solo mínimo global por (sucursal, producto) | índice parcial manual | **sin test** que lo pruebe contra la base (NO VERIFICADO) |
| Pago de consignante idempotente / concurrente | I3 M14 | **sin test dedicado** (grep `consignaci` en `test/`: solo precisión, auth y guardianes) |
| Anulación enlaza la reversión (`revierteAOperacionId`) | schema | **sin test** (y sin escritor) |
| Consignación: deuda = liquidado − pagado | `consignacion.ts` | **sin test** hallado |

## 7. Deuda

| Ítem | ¿Vencimiento? | Dónde |
|---|---|---|
| `columnas-de-significado`: 82 entradas «sin-declarar»; de este módulo: `ConteoFisico.fecha`, `MovimientoStock.facturaProveedorRenglonId`, `Operacion.fecha/operacionPadreId/ventaId`, `PagoConsignante.fecha`, `Seccion.activa`, `TraspasoSucursal.iniciadoPor` | **No** (la `meta` del JSON dice «bajar a 0», sin fecha ni responsable) | `test/arquitectura/cercos/linea-de-base/columnas-de-significado.json` |
| Dueño único por modelo: `MovimientoStock` 2+1 dominios, `Operacion` 4+1+1, `PagoConsignante` 1 | NO VERIFICADO (el JSON no lo muestra en mi lectura) | `cercos/linea-de-base/dueno-unico-por-modelo.json` |
| Columnas sin escritor/lector (§2): `devuelveAMovimientoId`, `revierteAOperacionId`, `mermaPorAnulacionDeId`, `reemplazaAOperacionId`, `motivoAnulacion`; `decididoPorDestinoId`/`cerradoPorId` sin lector | No | esquema |
| Comentarios del esquema desactualizados («nada de src/ la escribe todavía») | No | `MovimientoStock.facturaProveedorRenglonId`, `devuelveAMovimientoId` |

## 8. Interfaces con otros módulos

- **Catálogo:** lee `Producto` (`esConsignacion`, `precioConsignacion`, `proveedorConsignacionId`, unidad de stock), `DisponibilidadProducto` (`disponibilidad.ts`), `Insumo` (familia FEFO). Escribe `Producto.*` solo vía catálogo.
- **Compras:** escribe `Operacion` COMPRA/`MovimientoStock.facturaProveedorRenglonId/unidadCompraId/cantidadCompra` (`registrar-factura-proveedor.ts`, `aceptar-propuesta-de-factura.ts`, `escribir-correccion-de-compra.ts`); lee `FacturaProveedorRenglon` para reclasificación. Anula compras con `escribir-anulacion-de-compra.ts`.
- **POS / ventas:** `registrar-venta-en-tx.ts` escribe `Operacion` VENTA/CONSUMO/LIQUIDACION con `ventaId`, `promoCuentaId`, `clienteId`; `cerrar-cuenta.ts` escribe `operacionPadreId`.
- **Reportes:** 12 consultas leen el Kardex (§3); `reportes/consignacion.ts` y `registrar-pago-consignante.ts` viven en el módulo reportes pero escriben `PagoConsignante`.
- **Recetas:** `cargar-origen-de-venta.ts`, `resolverConsumoPorFamilia` leen recetas y `SeccionHabitualProducto`.
- **Auditoría/permisos:** `registrarCambioAuditado` (stock mínimo, producto), permisos `stock_reclasificar`, `traspaso_aceptar`.

## 9. NO VERIFICADO

- Si `resumen-consolidado.ts:101` filtra el saldo por disponibilidad (usa `disponibilidadDeProductosEnSucursales` para otra parte).
- Clase de guardián de `SeccionHabitualProducto.seccionId`, `StockMinimoProducto.*`, `FrecuenciaConteoProducto.*` (no figuran en las listas del guardián que leí: no están en los modelos de alcance «stock»).
- Si un choque en el índice parcial del mínimo global se traduce en mensaje o en error 500 (`guardarMinimoGlobal` es leer-decidir-escribir; el índice lo arbitra).
- Quién escribe `DEVOLUCION_CONSIGNACION` (solo aparece en guard y tipos).
- Si la reversión de una anulación se enlaza por otro medio (p. ej. texto en `detalleLibre`).
- Cobertura de tests de pantallas (Playwright) del módulo; no corrí tests ni el gate.
- Conteo exacto de «~25 sitios»: verifiqué 19 archivos con `groupBy/aggregate` (varios con 2-3 consultas).
