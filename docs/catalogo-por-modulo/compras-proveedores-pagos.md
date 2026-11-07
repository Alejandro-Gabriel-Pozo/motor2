# Catálogo del módulo COMPRAS · PROVEEDORES · NOTAS DE CRÉDITO · PAGOS (2026-11-06)

**Estado:** inventario de SOLO LECTURA, sin cambios de código, tests ni migraciones. Base: `main` al clonar la sesión + `origin/alegp/diseno-flujos-y-pasos` (diseño de partida). Evidencia `archivo:línea` o `modelo.columna`; «NV» = NO VERIFICADO. Alimenta el catálogo común de la sesión `session_01FWp2khZQzz6smR9NEeR2ww`. Las columnas de las tablas de factura/NC/pago están en `prisma/schema.prisma` (FacturaProveedor :2755, Renglón :2827, Sucursal :2886, Propuesta :2917, PropuestaRenglón :2952, AnulaciónFactura :2977, Pago :2998, AnulaciónPago :3024, Tributo :3044, NotaCrédito :3269, Línea :3330, Imputación :3380, TributoNC :3409; Proveedor :636).

## 0. Lo más grave en una mirada
1. **Medio esquema de «IVA de compras» y de «NC» no tiene escritor ni lector en `src/`**: `FacturaProveedor.{letra,fechaComprobante,condicionIvaEmpresa,importeNeto,importeIva,origen,recibidaEnAdministracionEn,fechaPagoDeclarada,medioPagoDeclarado}`, `FacturaProveedorRenglon.{alicuotaIva,importeNeto,importeIva,importeIvaComputable,conceptoGastoId,tipoDeCosto}`, `Empresa.llevaIvaDeCompras`, `Proveedor.condicionIva` y las 4 tablas `NotaCreditoProveedor*` + `FacturaProveedorTributo` + `PuntoDeVentaDeProveedor` (grep `src/`: 0 escritores; único lector de NC: `cargar-factura-proveedor.ts:127`). Sin embargo el guardián declara varias como «dinero» (`columnas-de-significado.ts:152-170,178-179`): el guardián protege columnas que nadie escribe.
2. **El mismo hecho «el comprobante X ya está cargado» vive en DOS tablas con DOS claves normalizadas**: `FacturaProveedor.nroFacturaNormalizado` (índice `FacturaProveedor_unica_vigente_key`) y `Operacion.nroFactura` (índice `Operacion_factura_unica_vigente_key`, texto tal cual); `hayComprobanteVigenteEnLaEmpresa` (`comprobante-en-la-empresa.ts:26-43`) las reconcilia leyendo ambas y normalizando al vuelo + candado advisory. Además `corregirCompra` reescribe proveedor/nro en `Operacion` (`escribir-correccion-de-compra.ts:11`), que para compras de factura se bloquea solo por la regla pura `rechazoPorCompraDeFactura` (`compra-de-factura.ts`).
3. **Reparto por mayor resto escrito DOS veces** (`repartirEnteros` `core/compras/reparto-de-factura.ts:28`, en centavos enteros / `repartirImporte` `core/moneda.ts:117`, devuelve pesos) y **«a centavos» en CUATRO versiones**: `aCentavos` (reparto-de-factura.ts:23, Decimal, HALF_UP), `aCentavos` privada de `moneda.ts:33` (devuelve PESOS redondeados, mismo nombre, otro significado), `centavosDeImporte` (`core/datos/importe.ts:67`, vía `redondearMoneda`+`Math.round`) y el `centavos = Math.round(n*100)` / `pasos` locales de `verificarSumas` (`registrar-factura-proveedor.ts`, float). `repartirImporte` y `repartirFactura` no se declaran fuente única (ver §3).
4. **`PagoDeFacturaProveedor` y `AnulacionDePagoDeFacturaProveedor` NO están en `MODELOS_EN_ALCANCE`** (`columnas-de-significado.ts:36-43` no los lista): `fechaPago` y `medio` deciden «pagada/pendiente» y no los cubre ningún guardián de columnas. Tampoco hay oráculo de combinaciones de NC (el doc de NC lista D1-D7 pero `test/` no tiene archivo de NC con tabla-oráculo; ver §6).
5. **Doble registro de la anulación**: `anuladaEn/anuladaPorId` en la fila (factura, pago) **y** una fila `Anulacion…` con motivo/clave/huella (`escribirAnulacionDeFactura`/`escribirAnulacionDePago`, `escribir-factura-proveedor.ts`). Intencional (CAS `WHERE anuladaEn IS NULL` + trazabilidad con motivo), pero el **motivo vive solo en la fila hija** y la marca en dos lugares: hay que declararlo como par, hoy no lo declara ningún guardián (NV: `cerco-dueno-unico-por-modelo`).
6. **El pago es binario y sin importe**: `PagoDeFacturaProveedor` no tiene monto (declara pagada la factura entera, `declarar-pago-de-factura-proveedor.ts`); un pago parcial o una NC aplicada no tienen dónde ir (el doc lo marca «fuera», X0).
7. **Proveedor.ofreceProductos/ofreceServicios**: se escriben y leen en catálogo (`persistencia/catalogo/proveedores.ts:32,66`, form, `consultas/catalogo/proveedores.ts:15`) pero ningún camino de compras los lee (grep `src/server/actions/movimientos`, `core/compras`: 0). Conectados a CRUD, no a la decisión que justificó el CHECK.

## 1. FLUJOS del módulo
**Verificación del ejemplo de partida (flujo «compra de mercadería», 4 pasos).** No coincide con el código en tres cosas: (a) el paso P1 lista `letra`, `fechaComprobante`, `condicionIvaEmpresa`, `importeNeto`, `importeIva`, `origen`: **ninguna se escribe** (`escribirCabeceraDeFactura`, escribir-factura-proveedor.ts:33-50, escribe solo proveedorId, nroFactura, nroFacturaNormalizado, fecha, importeTotal, estado, confirmadaEn/PorId, detalleLibre, clave, huella, condicionPago, creadoPorId); (b) P2 «Repartida y confirmada»: `estado=CONFIRMADA` y `confirmadaEn/PorId` se escriben **al crear** la cabecera, no al repartir; la compra se carga ya repartida (la propuesta pendiente es por *sucursal*, `FacturaProveedorPropuesta.estado`, y la parte propia nace `RECIBIDA`); `PENDIENTE_DE_REPARTO` **no aparece en `src/` (grep: 0)**; solo existe en schema/CHECK (el default de columna es `CONFIRMADA`); (c) P3 `recibidaEnAdministracionEn`: sin escritor; la recepción real es `FacturaProveedorSucursal.estadoRecepcion/recibidaEn/recibidaPorId`. Faltan además: el paso «aceptar mi parte» (otra sucursal) y las **compras simples** (no son `FacturaProveedor`). Pasos propuestos abajo.

| Flujo | Finalidad (PROPUESTA) | Estado |
|---|---|---|
| **F1 Compra simple de una sucursal** (`Operacion` COMPRA + Kardex) | Que entró mercadería de un proveedor a UNA sucursal, con stock y costo | PROPUESTA; el dueño lo nombra: PENDIENTE |
| **F2 Factura de proveedor repartida** (`FacturaProveedor` + partes/propuestas) | Documento de la empresa cuya mercadería se reparte entre sucursales, con costo por sucursal | PROPUESTA (ADR-029/041) |
| **F3 Pago de factura (X0)** | Confirmar cuándo y cómo se pagó una factura cargada «pendiente de pago» | PROPUESTA |
| **F4 Nota de crédito de proveedor** | Acreditar dinero (y a futuro mercadería devuelta) contra una factura o suelta | Solo esquema+diseño NC0; sin código |
| **F5 Alta de proveedor** | Tener a quién comprarle, con qué ofrece y cómo se identifica | PROPUESTA |

| Paso | Qué se completa | Columnas | Para qué (PROPUESTA) | Evidencia |
|---|---|---|---|---|
| F1-P1 Cabecera | proveedor + n.º de comprobante + fecha | `Operacion.{proveedorId,nroFactura,fecha,proceso=COMPRA}` | Saber de quién y qué comprobante (único en la empresa) | registrar-movimiento.ts:96-98,135 |
| F1-P2 Líneas | qué se compró y cuánto | `MovimientoStock.{productoId,seccionId,cantidad,precioTotal,precioPorUnidadStock,loteVencimiento}` | Stock y costo | escribirLineasDeMovimientoStock |
| F1-P2b Unidad comprada | en qué unidad y cuántas | `MovimientoStock.{unidadCompraId,cantidadCompra}` (juntas, CHECK) | Conversión a unidad de stock; `NULL`=«pendiente de completar» (schema :1421) | armar-linea-de-movimiento.ts |
| F1-P3 Vínculo | referencia del proveedor | `ProveedorPorProducto.{precioPorUnidadStock,referenciaProveedor,ultimaCompra}` | Comparativa de precios | registrar-vinculo-de-compra-en-tx.ts |
| F1-Salida | anulada / corregida | `Operacion.{anuladaEn,anuladaPorId}`, contra-asiento AJUSTE; corrección: `proveedorId,nroFactura,detalleLibre` | Deshacer sin borrar | anular-compra.ts, corregir-compra.ts |
| F2-P1 Cargada y repartida | comprobante + renglones + reparto | `FacturaProveedor.*` (ver §2), `FacturaProveedorRenglon.*`, `FacturaProveedorSucursal.{porcentajeDeclaradoBp,operacionId,estadoRecepcion=RECIBIDA}` (propia), `FacturaProveedorPropuesta(+Renglon)` (ajenas) | Deuda con el proveedor + stock/costo de la sucursal que carga + oferta a las demás | registrar-factura-proveedor.ts |
| F2-P2 Aceptación por sucursal | cada otra sucursal acepta su parte | `FacturaProveedorPropuesta.{estado→ACEPTADA,aceptadaEn,aceptadaPorId,parteId}`, `FacturaProveedorSucursal` nueva, `Operacion`+Kardex | Que el stock/gasto de esa sucursal recién cuente al aceptar (ADR-041) | aceptar-propuesta-de-factura.ts |
| F2-P3 Recepción en administración | «papel recibido» | `recibidaEnAdministracionEn` | **Sin escritor ni lector: paso huérfano** | grep `src/` = 0 |
| F2-Salida | factura anulada entera | `anuladaEn,anuladaPorId` + `AnulacionDeFacturaProveedor` + contra-asientos de cada parte | Quita stock y deuda; libera el n.º | anular-factura-proveedor.ts |
| F3-P1 Condición | contado o pendiente (inmutable) | `FacturaProveedor.condicionPago` | Saber si hay deuda abierta | registrar-factura-proveedor.ts:141 |
| F3-P2 Pago declarado | fecha y medio, una sola vez | `PagoDeFacturaProveedor.{fechaPago,medio,creadoPorId,claveIdempotencia,payloadHash,resultadoMensaje}` | Saldar | declarar-pago-de-factura-proveedor.ts |
| F3-Salida | pago anulado | `anuladoEn,anuladoPorId` + `AnulacionDePagoDeFacturaProveedor.motivo` | Corregir error de tipeo | anular-pago-de-factura-proveedor.ts |
| F4 (todos) | tipo, número, líneas, imputaciones | `NotaCreditoProveedor*` | **Sin pasos en código**: solo `tieneNotasDeCreditoVigentes` | cargar-factura-proveedor.ts:127 |
| F5-P1/P2 | identidad / oferta | `Proveedor.{codigo,nombre,cuit}` / `{ofreceProductos,ofreceServicios}` | Poder elegirlo; lo que se le compra | persistencia/catalogo/proveedores.ts |
| F5-P3 | datos fiscales | `Proveedor.condicionIva`, `PuntoDeVentaDeProveedor` | Cálculo de IVA/letra (I4) | **sin escritor** |
La UI tiene SU lista de pasos de compra: `core/compras/carga-por-pasos.ts:10-17` (FACTURA, LINEAS, DONDE, PAGO, REVISAR): es una cuarta enumeración de «pasos» distinta de las de arriba (los pasos de pantalla no coinciden con los de dato; a unificar al declarar flujos).

## 2. COLUMNAS (clase del guardián: dinero/visibilidad/stock/ninguna/ciega/deuda/fuera)
Regla del guardián (`cerco-columnas-de-significado.test.ts:140`): solo cuenta Boolean, fecha de estado, enum/CHECK; no el Decimal, el texto, la auditoría técnica ni la relación → eso es «ciega» salvo declaración explícita. «deuda» = en `columnas-de-significado.json` (`sin-declarar`). Lectores solo donde se verificó; «NV» = no busqué lectores a fondo.

| Modelo.columna | Flujo/paso | Para qué | Escritor | Lectores | Clase | Observación |
|---|---|---|---|---|---|---|
| FacturaProveedor.proveedorId,nroFactura | F2-P1 | Quién y qué comprobante | `escribirCabeceraDeFactura` | consultas/reportes/compras-registradas.ts, comprobante-en-la-empresa.ts | deuda (nroFactura) | Duplica a `Operacion.proveedorId/nroFactura` (F1) |
| FacturaProveedor.nroFacturaNormalizado | F2-P1 | Clave del índice único | ídem | comprobante-en-la-empresa.ts:35 | ciega (texto) | Normalizador distinto del de `Operacion` (§3) |
| FacturaProveedor.letra | F2-P1 | Letra del comprobante | **ninguno** | **ninguno** | ciega | La letra solo viaja como prefijo del normalizado (`A:1-77`); doble sentido con NC (`letra`+normalizado) |
| FacturaProveedor.fecha | F2-P1 | Día del stock/período | cabecera | reportes | deuda | Convive con `fechaComprobante` |
| FacturaProveedor.fechaComprobante | F2-P1 | Fecha impresa en el papel | **ninguno** | **ninguno** | deuda | Colgada |
| FacturaProveedor.importeTotal | F2-P1 | Total con IVA | cabecera (`reparto.total`) | reportes, NC (tope) | dinero | = Σ renglones.precioTotal = Σ celdas (verificarSumas) |
| FacturaProveedor.importeNeto/importeIva/condicionIvaEmpresa | F2-P1 | IVA computable (ADR-029) | **ninguno** | **ninguno** | dinero (decl. :153-154) / ciega | Declarada «dinero» sin escritor |
| FacturaProveedor.estado | F2 | PENDIENTE_DE_REPARTO/CONFIRMADA | cabecera (siempre CONFIRMADA) | NV | stock (decl. :156) | `PENDIENTE_DE_REPARTO` sin escritor |
| FacturaProveedor.confirmadaEn/PorId | F2-P1 | Quién confirmó | cabecera | NV | deuda / ciega | Se escriben al crear: copia de `creadoEn/creadoPorId` (doble) |
| FacturaProveedor.origen | F2 | CARGA (único valor CHECK) | default | ninguno | ciega | Dimensión de un solo valor |
| FacturaProveedor.condicionPago | F3-P1 | Contado/pendiente | cabecera | declarar-pago, compras-registradas.ts:58 | dinero (decl. :155) | Comentario del guardián dice «hoy solo CONTADO_PAGADA»: **desactualizado** (X0 amplió el CHECK) |
| FacturaProveedor.recibidaEnAdministracionEn | F2-P3 | Papel recibido | **ninguno** | **ninguno** | deuda | Colgada |
| FacturaProveedor.fechaPagoDeclarada/medioPagoDeclarado | — | Pago antes de X0 | **ninguno** | **ninguno** | deuda / ciega | Doble sentido con `PagoDeFacturaProveedor.fechaPago/medio` (dos fuentes del «cuándo/cómo se pagó»); poda anunciada X3 (pagos-x0.md:20) |
| FacturaProveedor.detalleLibre | F2-P1 | Nota | cabecera | NV | ciega | |
| FacturaProveedor.claveIdempotencia/payloadHash/resultadoMensaje | F2 | I3 | cabecera + `registrarResultadoDeFactura` | `cargarFacturaPorClaveIdempotencia` | deuda (clave) | Idempotencia por fila (intencional) |
| FacturaProveedor.anuladaEn/anuladaPorId | F2-Salida | Anulación | `escribirAnulacionDeFactura` | consultas | dinero (decl. :157) | Par con `AnulacionDeFacturaProveedor` |
| FacturaProveedorRenglon.{productoId,cantidadStock,precioPorUnidadStock,precioTotal,detalle,loteVencimiento,orden} | F2-P1 | Línea de la factura | `escribirRenglonesDeFactura` | reparto, NC (tope) | precioTotal dinero; lote deuda | Duplican en parte `MovimientoStock` de la parte propia (precio/cantidad por celda) |
| FacturaProveedorRenglon.naturaleza | F2-P1 | MERCADERIA/SIN_STOCK | **fijo "MERCADERIA"** (`escribirRenglonesDeFactura`) | NC (FK) | ciega | `SIN_STOCK` no tiene escritor; es la única naturaleza que entra |
| FacturaProveedorRenglon.unidadCompraId/cantidadCompra | F1/F2-P1 | Unidad comprada | cabecera de renglón | consultas | ninguna (decl. :79) | Equivale a `MovimientoStock.unidadCompraId/cantidadCompra` de la compra simple: dos lugares; en partes de factura el movimiento queda NULL (schema :1422) — intencional |
| FacturaProveedorRenglon.{alicuotaIva,importeNeto,importeIva,importeIvaComputable,conceptoGastoId,tipoDeCosto} | (IVA/costos) | IVA computable y gasto | **ninguno** | **ninguno** | dinero (alicuotaIva decl. :160) / deuda (conceptoGastoId) | Colgadas |
| FacturaProveedorSucursal.estadoRecepcion | F2-P1/P2 | RECIBIDA/PENDIENTE | `escribirParteRecibida` (solo RECIBIDA) | stock | stock (decl. :158) | `PENDIENTE` sin escritor (la pendiente es la propuesta) |
| FacturaProveedorSucursal.porcentajeDeclaradoBp | F2 | Intención del reparto | ídem | NV | ciega | Cuarta forma de guardar el reparto (ver §4) |
| FacturaProveedorSucursal.recibidaEn/recibidaPorId | F2 | Quién y cuándo | ídem | NV | deuda | |
| FacturaProveedorPropuesta.{estado,aceptadaEn,aceptadaPorId,parteId,porcentajeDeclaradoBp} | F2-P2 | Oferta a sucursal | `escribirPropuesta`, `marcarPropuestaAceptada` | consultas/movimientos/facturas-proveedor.ts:24 | aceptadaEn deuda | `estado` solo PENDIENTE→ACEPTADA; **no hay RECHAZADA** (el rechazo I9 está en el diseño, sin código: NV) |
| FacturaProveedorPropuestaRenglon.{cantidadStock,precioTotal} | F2 | Celda destino | `escribirPropuesta` | aceptar-propuesta | ciega | Copia de la matriz que ya se calculó |
| FacturaProveedorTributo.* | — | Percepciones | **ninguno** | ninguno | ciega | Sin uso (NC3) |
| AnulacionDeFacturaProveedor.* | F2-Salida | Motivo + I3 | `escribirAnulacionDeFactura` | NV | ciega | Ver §0.5 |
| PagoDeFacturaProveedor.{fechaPago,medio} | F3-P2 | Cuándo/cómo se pagó | `escribirPagoDeFactura` | compras-registradas.ts:58, estadoDePago | **fuera** | Decide «pagada»; sin importe |
| PagoDeFacturaProveedor.anuladoEn/anuladoPorId + AnulacionDePago.* | F3-Salida | Anular | `escribirAnulacionDePago` | NV | **fuera** | ídem §0.5 |
| NotaCreditoProveedor.* (todas) | F4 | NC | **ninguno en src** | `tieneNotasDeCreditoVigentes` (solo count) | dinero (decl. importeTotal,fecha,tipo,anuladaEn) / deuda (condicionIvaEmpresa, estado, fechaComprobante, motivo, nroComprobante, origen, recibidaEnAdministracionEn) | Tabla sin escritor |
| NotaCreditoProveedorLinea.* / Imputacion.* / Tributo.* | F4 | Líneas, imputación por sucursal | **ninguno** | ninguno | dinero/stock decl. :165-170; deuda: alicuotaIva, conceptoGastoId, naturaleza, origenImporte, operacionDevolucionId | `lineaAdmiteDevolucion` y `admiteDevolucion` son copia (FK de 3 columnas, intencional) |
| Proveedor.{codigo,nombre,cuit,contacto,telefono,email,notas,condicionesPago} | F5-P1 | Identidad/contacto | alta/actualizar-proveedor.ts | ficha, form | ciega | `condicionesPago` (texto libre) vs `FacturaProveedor.condicionPago` (enum): mismo nombre casi, dos cosas distintas |
| Proveedor.activo | F5 | Se puede comprar | actualizar-activa-proveedor.ts | registrar-factura (`PROVEEDOR_NO_DISPONIBLE`) | deuda | |
| Proveedor.ofreceProductos/ofreceServicios | F5-P2 | Qué se le compra | alta/actualizar | solo catálogo (ver §0.7) | deuda | PR #155 los conectó al CRUD |
| Proveedor.condicionIva | F5-P3 | IVA | **ninguno en src** (`core/fiscal/iva.ts` solo lista) | ninguno | dinero (decl. :178) | Colgada |
| PuntoDeVentaDeProveedor.{numero,activo} | F5-P3 | Puntos de venta | **ninguno** | ninguno | deuda (activo) | Colgada |
| ProveedorPorProducto.{ultimaCompra,referenciaProveedor,unidadCompraId,precioPorUnidadStock} | F1-P3 | Comparativa | registrar-vinculo-de-compra-en-tx.ts | catálogo | deuda (ultimaCompra) | Escrito por F1 y F2 (comando de Catálogo) |
| Operacion.{proveedorId,nroFactura,anuladaEn,motivo anul.} / MovimientoStock.{unidadCompraId,cantidadCompra,facturaProveedorRenglonId} | F1 | ver F1 | escribir-movimiento-de-stock.ts | NV | facturaProveedorRenglonId deuda; unidadCompraId ninguna (decl. :78) | Pertenecen al módulo Stock (ver §8) |

## 3. FUNCIONES Y PRIMITIVAS
| Nombre | Archivo | Qué hace | Copias/variantes | ¿Fuente única declarada? |
|---|---|---|---|---|
| `repartirEnteros` | core/compras/reparto-de-factura.ts:28 | Mayor resto sobre enteros | `repartirImporte` core/moneda.ts:117 (idem, en pesos) | NO (ni `cerco-primitivas-de-dominio` ni otro lo declaran: ese cerco solo cuenta topes 1e12/validadores) |
| `repartirMatriz`, `repartirCantidad`, `repartirFactura` | reparto-de-factura.ts:44,54,95 | Matriz renglón×sucursal con presupuesto remanente | — | Único en repo (única re-exportada en public.ts:32); la UI recalcula con la MISMA función (vista previa) |
| `aCentavos` / `centavosDeImporte` / `centavos` local | reparto-de-factura.ts:23 / datos/importe.ts:67 / moneda.ts:33 (privada, otro significado) / registrar-factura-proveedor.ts (verificarSumas) | Pasar pesos a entero | 4 variantes | NO |
| `normalizarNumeroDeComprobante` | core/compras/numero-de-comprobante.ts | Clave de unicidad (empresa+proveedor+letra+n.º) | `validarNroFactura` core/datos/nro-factura.ts (solo trim; es la clave del índice de `Operacion`), `leerNumeroComprobante`/`formatearNumeroComprobante` core/datos/numero-comprobante.ts (texto canónico) | NO: tres lectores del «mismo» número con reglas distintas |
| `hayComprobanteVigenteEnLaEmpresa` | persistencia/compras/comprobante-en-la-empresa.ts | ¿Existe vigente? (2 tablas) | índices únicos de cada tabla (2ª barrera) | Sí, único camino I2 (registrar-movimiento, corregir, registrar-factura, aceptar) |
| `decidirDeclaracionDePago`, `estadoDePago`, `MEDIOS_DE_PAGO`, `CONDICIONES_DE_PAGO` | core/compras/pago-de-factura.ts | Reglas puras del pago | CHECKs de la base repiten las listas (`PagoDeFacturaProveedor_medio_chk`, `FacturaProveedor_condicion_pago_chk`) | Sí en código (oráculo `test/pagos/oraculo-declarar-pago.ts`); lista duplicada en CHECK: intencional |
| `evaluarAnulacion` (anulación de compra) | core/compras/anulacion.ts | Revierte líneas, rechaza si hay conteo posterior | `anularFacturaProveedorCasoDeUso` reevalúa cada parte con las mismas reglas | Sí |
| `rechazoPorCompraDeFactura` | core/compras/compra-de-factura.ts | Frena anular/corregir una parte suelta | — | Sí |
| `detectarPosibleDuplicado` (C25, ±7 días) | core/compras/posible-duplicado.ts | Aviso | `DIAS_DE_VENTANA_DE_DUPLICADO=7` | Sí; NC lo repite en diseño (N16 aviso) sin código |
| `chequearIdempotencia`/`decidirIdempotencia` | persistencia/movimientos/idempotencia.ts, core/movimientos | I3 | Una copia de `cargar…PorClaveIdempotencia` por tabla (factura, anulación factura, pago, anulación pago) | Mecanismo común; `idempotencia-i3-cobertura-concurrente.test.ts` lo cubre |
| `bloquearFactura` (candado de factura) | persistencia/compras/cargar-factura-proveedor.ts:38 | `FOR UPDATE` | `bloquearFacturaParaPago` :149 (otra consulta SQL del mismo candado, otro SELECT) | NO: dos funciones para la misma fila |
| `armarLineaMovimiento` | actions/movimientos/casos-de-uso/armar-linea-de-movimiento.ts | Línea de compra (conversión, precio, referencia) | La usa F2 por renglón (`comoCompra`) | Sí |

## 4. FUENTES DE VERDAD
| Hecho | Lugares | Quién manda | Intencional/accidental |
|---|---|---|---|
| Comprobante X del proveedor ya existe | `FacturaProveedor.nroFacturaNormalizado` + `Operacion.nroFactura` (2 índices únicos parciales + advisory lock) | `hayComprobanteVigenteEnLaEmpresa` | Accidental/histórico (ADR-029: facturas nuevas vs. compras simples I15); deuda |
| Proveedor de una compra | `Operacion.proveedorId` y `FacturaProveedor.proveedorId` (+ `NotaCredito.proveedorId` con FK compuesta) | La cabecera de la factura; la `Operacion` de una parte repite | Intencional (cada compra por sucursal es un movimiento) pero `corregirCompra` puede divergir si no fuera por `rechazoPorCompraDeFactura` |
| Reparto de la factura | `FacturaProveedorSucursal.porcentajeDeclaradoBp` + `FacturaProveedorPropuesta.porcentajeDeclaradoBp` + `PropuestaRenglon.{cantidadStock,precioTotal}` + `MovimientoStock.{cantidad,precioTotal}` de la parte aceptada | Propuesta = oferta; Kardex = verdad una vez aceptada | Intencional (oferta vs hecho); la propuesta no se limpia al aceptar |
| Cuándo/cómo se pagó | `PagoDeFacturaProveedor.{fechaPago,medio}` + `FacturaProveedor.{fechaPagoDeclarada,medioPagoDeclarado}` + `condicionPago` | Pago (X0) | Accidental: columnas viejas sin uso |
| Estado del dinero de la factura | Derivado: `condicionPago` + pago vigente (`estadoDePago`) | Función pura | Intencional (no se guarda) |
| Anulada | `anuladaEn`/`anuladaPorId` en fila + `Anulacion…` hija | CAS sobre la fila; la hija guarda motivo | Intencional (trazabilidad), sin guardián de par |
| Quién creó/confirmó la factura | `creadoPorId/creadoEn` y `confirmadaPorId/confirmadaEn` (mismos valores al crear) | — | Accidental (columnas de un `PENDIENTE_DE_REPARTO` que no existe) |
| Unidad y cantidad comprada | `MovimientoStock.{unidadCompraId,cantidadCompra}` (compra simple) y `FacturaProveedorRenglon.{…}` (factura) | La que corresponda al flujo | Intencional (schema :1421-1422) |
| Condición IVA del proveedor / de la empresa / de la factura | `Proveedor.condicionIva`, `Empresa.condicionIva`, `FacturaProveedor.condicionIvaEmpresa` (copia al cargar) | Sin escritor en compras | Intencional (congelar) pero sin uso hoy |
| Total de la factura | `importeTotal` ≟ Σ `renglon.precioTotal` ≟ Σ celdas | `repartirFactura` + `verificarSumas` (lanza error, sin test propio: NV) | Intencional; guarda en código, CHECK de base NV |
| Lista de medios/condiciones de pago | `core/compras/pago-de-factura.ts` + CHECK SQL | Código | Intencional (doble barrera) |

## 5. ESCRITURAS (por caso de uso)
| Caso de uso | Qué escribe | ¿De más? | Intencional/accidental |
|---|---|---|---|
| `registrarFacturaProveedorCasoDeUso` | cabecera (+ `registrarResultadoDeFactura` = 2.º UPDATE de la misma fila), N renglones (un `create` por renglón), `Operacion`+Kardex propios, parte, propuestas(+renglones), `ProveedorPorProducto` por renglón, auditoría | Sí: `resultadoMensaje` en un UPDATE aparte (podría ir en el create: ya se conoce al final, no antes); `confirmadaEn/PorId` repetidos | Accidental (1) / accidental (2) |
| `aceptarPropuestaDeFactura` | `Operacion`+Kardex, parte, marca propuesta, resultado idempotente | No | — |
| `anularFacturaProveedor` | contra-asiento por parte, marca + fila `Anulacion`, auditoría | La marca y la fila hija (ver §4) | Intencional |
| `declararPagoDeFactura` | pago, auditoría | No | — |
| `anularPagoDeFactura` | marca + fila hija, auditoría | ídem | Intencional |
| registrar compra simple (`registrar-movimiento.ts`) | `Operacion`+Kardex, vínculo ProveedorPorProducto | NV | — |
| `corregirCompra` | `Operacion.{proveedorId,nroFactura,detalleLibre}` + auditoría por campo | No | — |
| `anularCompra` | contra-asiento AJUSTE + marca | No | — |
| NC | — | No hay caso de uso | — |
| Alta/actualizar proveedor | `Proveedor` (+ ofrece*) | NV | — |

## 6. INVARIANTES
| Regla | Documento | Test |
|---|---|---|
| Número de comprobante único por empresa+proveedor (I2) | diseno-compras-factura-unica…:100 | test/movimientos/combinaciones-comprobante-unico.test.ts, test/persistencia/comprobante-unico-en-la-empresa.test.ts, test/arquitectura/combinaciones-comprobante-unico-declaradas.test.ts |
| Unidad de compra / conversión exacta | …§14.2 | test/movimientos/combinaciones-unidad-de-compra.test.ts, compra-conversion-exacta.test.ts, test/arquitectura/combinaciones-unidad-de-compra-declaradas.test.ts |
| Factura repartida: Σ renglones = Σ celdas, Σ bp = 10000 | e3a D2-D3, ADR-041 | test/core/reparto-de-factura.test.ts, test/movimientos/factura-proveedor-repartida.test.ts, test/persistencia/factura-proveedor-dinero.test.ts |
| Aceptar una propuesta una sola vez / concurrencia | ADR-041 | test/persistencia/factura-proveedor-concurrencia.test.ts |
| Anular factura entera, atómica | e3a D8 | test/persistencia/factura-proveedor-reglas.test.ts (NV el cubrimiento de «con NC vigente») |
| Pago: una sola declaración vigente, idempotente, concurrencia | pagos-x0 P1-P… | test/pagos/declarar-pago.test.ts (:205,:226,:242,:270), declarar-pago-oraculo.test.ts |
| Aislamiento por empresa | ADR-029 | test/aislamiento/{factura-proveedor-rls,nota-credito-proveedor-rls,x0-pago-de-factura-subir-bajar-subir}.test.ts |
| NC: tope por renglón/sucursal/factura, número único, I3 (N1-N9) | diseno-notas-de-credito:91-107 | test/persistencia/nota-credito-proveedor-{dinero,concurrencia}.test.ts, migracion-nota-credito-proveedor.test.ts (contra la base; **sin caso de uso**) |
| NC: oráculo de combinaciones D1-D7 | diseno-notas-de-credito:178-184 | **sin test** (no existe oráculo de NC) |
| Aviso posible duplicado ±7 días (C25) | …:107 | test/movimientos/registrar-compra-aviso-duplicado.test.ts |
| Fecha de compra ≤ hoy (I13) | …:111 (PROPUESTA) | **sin test** (NV; el doc dice que hoy admite «mañana») |
| Primera compra exige referencia del proveedor (I12) | …:110 | test/movimientos/referencia-del-proveedor-primera-compra.test.ts |
| Proveedor ofrece productos o servicios (CHECK) | schema :645 | test/persistencia/proveedor-ofrece-productos-o-servicios.test.ts |
| Anular/corregir parte suelta de factura rechazado | e3a D8 | test/movimientos/compra-de-parte-de-factura.test.ts |
| Normalización del número de comprobante | numero-de-comprobante.ts | test/core/numero-comprobante.propiedades.test.ts, numero-comprobante-estructurado.test.ts |
| Todo caso de uso declara permisos/ficha | AGENTS.md | test/arquitectura/cerco-casos-de-uso-en-guardianes.test.ts (NV: incluye los de pago y factura) |
| Reglas CHECK de FacturaProveedor (neto+IVA, `pago_declarado_solo_contado`) | migración 20261016101000 | test/persistencia/factura-proveedor-reglas.test.ts, factura-proveedor-iva.test.ts (prueban CHECKs que ningún código escribe) |

## 7. DEUDA
| Ítem | ¿Vencimiento? | Dónde |
|---|---|---|
| 29 columnas del módulo en `sin-declarar` (FacturaProveedor ×7, Renglón :conceptoGastoId,loteVencimiento, Sucursal.recibidaEn, Propuesta.aceptadaEn, NC ×7, Línea ×4, Imputación.operacionDevolucionId, Proveedor.{activo,ofrece*}, ProveedorPorProducto.ultimaCompra, PuntoDeVenta.activo, MovimientoStock.facturaProveedorRenglonId) | Meta del lote: ver `meta` del JSON (las de «Fase 6»/«lote 6.33» ya vencidas, diseño-flujos §1) | test/arquitectura/cercos/linea-de-base/columnas-de-significado.json |
| Poda `fechaPagoDeclarada/medioPagoDeclarado` | «X3» sin fecha | pagos-x0.md:20; migración 20261104110000 |
| Tablas NC/Tributo/PuntoDeVenta sin escritor | NC0 «propuesta», sin fecha | diseno-notas-de-credito §0 |
| `PagoDeFacturaProveedor` fuera del guardián | no | columnas-de-significado.ts:36-43 |
| Comentario desactualizado de `condicionPago` («hoy solo CONTADO_PAGADA») | no | columnas-de-significado.ts:155 |
| I13 fecha ≤ hoy, I10 permiso de activar al aceptar | PROPUESTA/PENDIENTE | diseno-compras-factura-unica:108,111 |
| Pago parcial, retenciones, conciliación N a N | «fuera de X0» | pagos-x0.md:19 |

## 8. INTERFACES con otros módulos
- **Stock/Kardex**: escribe `Operacion` (COMPRA, AJUSTE de anulación), `MovimientoStock` (incl. `facturaProveedorRenglonId`, `unidadCompraId`, `cantidadCompra`) vía `escribirOperacionDeStock`/`escribirLineasDeMovimientoStock`/`escribirContraAsiento`; lee conteos posteriores (`cargarReconciliacionesPosteriores`) para decidir la anulación.
- **Catálogo**: escribe `ProveedorPorProducto` (comando `registrarVinculoDeCompraEnTx`); lee `Producto`/`Unidad` (decimales, unidad de stock); las pantallas de proveedor viven en `app/(app)/catalogo/proveedores`.
- **Costos/gasto**: `ImputacionDeGasto`, `ReclasificacionRenglon`, `ConceptoDeGasto` cuelgan de `FacturaProveedorRenglon` (relaciones en schema :2866-2869); sin escritor desde compras.
- **Consignación**: `PagoConsignante` (reportes/consignacion) usa `Proveedor`; fuera de este inventario.
- **Auditoría / permisos / tiempo**: `registrarCambioAuditado`; permisos `proceso_compra`, `compra_repartir`, `anular_compra`, `declarar_pago_compra` (empresa), `corregir_compra`; zona `ZONA_ARGENTINA` para el día del pago.
- **Reportes**: `compras-registradas.ts`, `compras-anuladas`, `periodo-compras.ts` leen factura/pago.

## 9. NO VERIFICADO
- Lectores de la mayoría de las columnas «ciega» (solo greps de nombre en `src/`; no busqué SQL crudo ni `select` anidados).
- Si algún script/seed/migración de datos escribe las columnas «colgadas» (solo `src/`; la migración 20261016101000:213 copia columnas al backfillear facturas desde `Operacion`).
- Si `PENDIENTE_DE_REPARTO` lo escribe algún script o migración de datos (en `src/` no aparece).
- Por qué `cerco-dueno-unico-por-modelo` no declara el par (marca, hija).
- Rechazo de propuesta (I9): no encontré caso de uso; el schema no tiene estado RECHAZADA.
- Conteos del baseline por flujo (los 29 de §7 salen de un grep de nombres de modelo del JSON, no de recorrer cada columna).
- Los 5 hallazgos del mensaje final son los de §0 (1-3, 4, 5).

## 10. ¿Esconde un módulo con identidad propia? (escrita por la sesión AUDITORA COMÚN, 2026-11-07, con autorización del dueño vía la sesión coordinadora; la sesión de compras no la publicó. PROPUESTA, sin cambios)

**Fuente:** secciones 1-9 de este archivo + mediciones propias sobre main `50c11538` (`ls`/`wc`/`grep -rl` en `src/`; los conteos son por archivo y por nombre, orden de magnitud, no grafo de imports). Mismo molde y mismos cinco criterios que las demás secciones 10: (a) finalidad o flujo propio, (b) vocabulario y actores propios, (c) cohesión interna contra referencias externas, (d) permisos o habilitación propios en `src/core/modulos/catalogo.ts` y `src/core/permisos/acciones.ts`, (e) si podría vivir y probarse solo.

**Tamaño medido:** `src/core/compras` 10 archivos / 1.014 líneas; `src/server/persistencia/compras` 7 / 594; `src/core/features/compras` 4; 7 casos de uso de compra, factura y pago en `src/server/actions/movimientos/casos-de-uso/` (937 líneas); 13 modelos de factura, NC y pago más `Proveedor`, `ProveedorPorProducto` y `PuntoDeVentaDeProveedor` (encabezado de este archivo). **Hallazgo de ubicación:** los casos de uso de factura y pago viven en `actions/movimientos/`, no en una carpeta de compras; el módulo no tiene carpeta propia en `server/actions` (VERIFICADO con `ls`). `core/compras` importa solo primitivas (`tiempo`, `datos`, `moneda`, `guia-de-ajuste`) más `core/features/compras`: núcleo puro (VERIFICADO). Lo importan 20 archivos de fuera de `core/compras`, y 11 de ellos son `actions/movimientos` y `persistencia/compras` (VERIFICADO).

**Registro y permisos (criterio d, VERIFICADO):** `compras` es módulo vendible (`catalogo.ts:27`, requiere `proveedores_basico` y `stock`); `proveedores_basico` es de soporte (`:24`). Los permisos `proceso_compra`, `anular_compra`, `corregir_compra`, `compra_repartir` y `declarar_pago_compra` cuelgan TODOS de `modulo: "compras"` (`acciones.ts:107,131,133,240,243`); `proveedor_alta` cuelga de `proveedores_basico` (`:224`). `gastos` está «en desarrollo» y requiere `proveedores_basico` (`catalogo.ts:37`).

| Candidato | Lo componen | Cohesión (números) | Qué lo ata al resto | Veredicto PROPUESTA |
|---|---|---|---|---|
| **A. Factura de proveedor repartida** (F2) | `FacturaProveedor`, `…Renglon`, `…Sucursal`, `…Propuesta(+Renglon)`, `AnulacionDeFacturaProveedor`; `core/compras/reparto-de-factura.ts`, `carga-por-pasos.ts`; `persistencia/compras/*` (7); casos `registrar-factura-proveedor`, `aceptar-propuesta-de-factura`, `anular-factura-proveedor`; pantallas `movimientos/[proceso]` (bloque de reparto) y `reportes/compras` | 28 archivos de `src/` nombran la factura: 7 `server/actions`, 6 `server/persistencia`, 5 `app/(app)`, 3 `core/compras`, 2 consultas, 2 features, 1 reporte y 1 permisos. Vocabulario propio (reparto en bp, parte, propuesta, aceptar mi parte) y actor propio (la sucursal que acepta, ADR-041). Permiso propio `compra_repartir` | Escribe el Kardex por cada parte (`escribirOperacionDeStock`, contra-asiento); comparte con F1 el número de comprobante (`hayComprobanteVigenteEnLaEmpresa`, doble fuente: §4) y el vínculo con el proveedor | **Es parte de este módulo** (es la forma «empresa» de la compra; F1 es la forma «sucursal»). No se vende ni se habilita aparte, y su número de comprobante comparte unicidad con F1, así que separarla partiría una invariante (I2). Lo que sí conviene es una carpeta `compras` propia en `server/actions` (hoy está en `movimientos/`) |
| **B. Pagos a proveedores / cuentas por pagar** (F3 X0) | `PagoDeFacturaProveedor`, `AnulacionDePagoDeFacturaProveedor`, `FacturaProveedor.condicionPago`; casos `declarar-pago-de-factura-proveedor`, `anular-pago-de-factura-proveedor` | 12 archivos de `src/` (3 actions, 2 persistencia, 2 features, 2 `core/compras`, 2 pantallas, 1 movimientos). Permiso propio `declarar_pago_compra` (contexto **empresa**, no sucursal) y actor distinto (administración, no el que recibe mercadería). Finalidad propia (saldar la deuda) | Solo lee la factura (no toca stock); su futuro declarado (pago parcial, retenciones, conciliación N a N, NC aplicada: «fuera de X0», §7) es tesorería | **No concluyente → hoy parte de este módulo; candidato a módulo propio («cuentas por pagar / tesorería») cuando exista el pago con importe.** Hoy es binario, sin importe, y no se puede probar sin la factura. Pregunta para el dueño: ¿los pagos (y a futuro los de gastos y servicios) se venden aparte de compras? |
| **C. Notas de crédito de proveedor** (F4) | 4 tablas `NotaCreditoProveedor*` y `…TributoNC`; diseño NC0 | **0 archivos de `src/` las escriben** (VERIFICADO: el único uso es `tieneNotasDeCreditoVigentes`, `persistencia/compras/cargar-factura-proveedor.ts:126`, que llama `anular-factura-proveedor.ts:80`). Tiene tests contra la base pero no tiene caso de uso | La imputación contra la factura y, a futuro, la devolución de mercadería (`operacionDevolucionId`, stock) | **Es parte de este módulo, pero hoy solo existe en el esquema.** No es un módulo escondido: es una etapa sin construir. Por la regla de poda va «pendiente de completar» con fecha, o se oculta |
| **D. IVA de compras** (fiscal) | `FacturaProveedor.{letra,fechaComprobante,condicionIvaEmpresa,importeNeto,importeIva}`, IVA de renglones, `FacturaProveedorTributo`, `Empresa.llevaIvaDeCompras`, `Proveedor.condicionIva`, `PuntoDeVentaDeProveedor` | **0 escritores en `src/`** (§0.1; VERIFICADO por muestreo `importeNeto`) | `core/fiscal` (reportes-fiscal §10: «fiscal» no concluyente, «se vuelve módulo si el dueño confirma IVA computable, Etapa C») | **No concluyente**: si se construye, su lugar es el **fiscal**, transversal a compra y venta (lo comparte con `Producto.alicuotaIvaVenta`), no un submódulo de compras. Hoy es esquema sin flujo |
| **E. Proveedores y vínculo proveedor-producto** (F5) | `Proveedor`, `ProveedorPorProducto`, `PuntoDeVentaDeProveedor`; pantallas en `app/(app)/catalogo/proveedores`; comando `registrarVinculoDeCompraEnTx` | Catálogo §10 (candidato C) midió 24 archivos / 1.692 líneas; `grep -rli proveedor src` da 194 archivos (sobrecuenta: la palabra está en todo el sistema) | Compras escribe `ProveedorPorProducto` en cada línea (T2-2, columna sin lector de precio); consignación (`Producto.proveedorConsignacionId`, `PagoConsignante`) y gastos (`requiere: proveedores_basico`) también dependen de él | **Ya es módulo** (`proveedores_basico`, soporte) y **no es de compras**: lo requieren compras, consignación y gastos. Esto resuelve la duda de catálogo §10: Proveedores es de soporte compartido, no de compras ni de catálogo; solo su carpeta está en `catalogo/`. El vínculo `ProveedorPorProducto` sí es de compras (lo escribe la compra) |
| **F. Compra simple de una sucursal** (F1) | `Operacion` COMPRA y Kardex; `registrar-movimiento.ts` (proceso COMPRA), `anular-compra`, `corregir-compra` | Comparte el caso de uso genérico de movimientos (`registrar-movimiento.ts`) con el resto de los procesos de stock | Kardex, número de comprobante (con A) | **Es el núcleo del módulo.** Su costura con Stock es el caso de uso compartido `registrar-movimiento`: dependencia a declarar, no a cortar |
| **G. Gastos imputados al renglón** | `ImputacionDeGasto`, `ReclasificacionRenglon`, `ConceptoDeGasto` (cuelgan de `FacturaProveedorRenglon`, §8) | **0 archivos de `src/` los nombran** (VERIFICADO con `grep -rlE`) | Módulo `gastos` en desarrollo (`catalogo.ts:37`) | **Ya tiene módulo propio en el registro (`gastos`)**, todavía sin código; no es de compras. Ojo con el homónimo `ReclasificacionRenglon` (reclasifica costo) y la reclasificación de stock (auditoría §c10) |

**Qué depende de qué (PROPUESTA):** `compras` → `proveedores_basico` (proveedor) y `stock` (Kardex); A y F comparten la unicidad del comprobante (I2); B depende de A; C depende de A (y a futuro de stock por la devolución); D sería de `fiscal` y lo usarían A, C y la venta; G (`gastos`) → `proveedores_basico` y usa A si existe (`usaSiExiste: ["compras"]`).

**Conclusión (PROPUESTA):** compras **no esconde un módulo grande ya construido**. Lo que sí esconde son **tres etapas sin construir** con identidad propia (cuentas por pagar con importe, notas de crédito, IVA de compras), con tablas ya migradas y sin escritor: por la regla de poda van «pendiente de completar» con fecha, o se ocultan. Hallazgos de ubicación: (1) los casos de uso de compra, factura y pago viven en `actions/movimientos/`, no tienen carpeta propia; (2) Proveedores es soporte compartido (lo requieren compras, consignación y gastos), no parte de compras ni de catálogo; (3) el mejor candidato futuro a módulo es **B, cuentas por pagar**, que también serviría a `gastos`. **Pregunta para el dueño (1):** ¿pagos a proveedores, de compras y de gastos, se venden como un módulo aparte?

**NO VERIFICADO:** referencias internas y externas con una herramienta de grafo (se contó con `grep -rl` por nombre); si algún script, siembra o migración de datos escribe las tablas sin escritor (solo se miró `src/`); qué pantallas habría que ocultar si se apaga B; el cubrimiento real de los tests de NC (existen contra la base y no se leyeron); que `registrar-movimiento.ts` sea el único camino de la compra simple.
