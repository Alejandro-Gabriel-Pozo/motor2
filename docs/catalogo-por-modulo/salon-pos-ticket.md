# Catálogo del módulo SALÓN · POS · CUENTAS · VENTA · TICKET · COMANDA (2026-11-06)

**Solo lectura.** Inventario sin cambios de código, tests ni migraciones. Base: rama `alegp/diseno-flujos-y-pasos` (`docs/diseno-flujos-y-pasos-2026-11-06.md`; nombra el flujo «cuenta del salón», PENDIENTE de que lo confirme el dueño). Todo es PROPUESTA salvo lo que cita archivo. Lo que no se comprobó va como NO VERIFICADO. Guardián: `test/arquitectura/guardas/columnas-de-significado.ts` (solo mira Boolean, fechas de estado, enums y columnas con CHECK de modelos en alcance), deuda en `cercos/linea-de-base/columnas-de-significado.json` (`total: 82`, tipo `sin-declarar`; no trae vencimiento).

## 1. FLUJOS

| Flujo | Finalidad | Pasos (columnas) | Para qué sirve el paso |
|---|---|---|---|
| **Puesto** (Mesa) | Tener dónde sentar o despachar | P1 `Mesa.sucursalId, numero, tipo` (`persistencia/pos/mesas.ts:17,25`) | Que exista la mesa (SALON) o el mostrador (`numero 0`, `tipo MOSTRADOR`, ADR-039) |
| **Cuenta del salón** (nombre PENDIENTE) | Atender una mesa, cobrar y dejar la venta y el ticket | P1 Abierta: `Cuenta.mesaId, tipoMesa, abiertaPorId, abiertaEn, comensales` (`persistencia/pos/cuenta.ts:16,24`) | Saber quién atiende y cuántos se sentaron (métrica de rotación) |
| | | P2 Cliente: `Cuenta.clienteId, descuentoPorcentaje` (`cuenta.ts:42`, snapshot D7) | Aplicar el descuento del cliente al cierre |
| | | P3 Pedido: `PromoCuenta.*`, `CuentaItem.productoId, cantidad, precioUnitario, precioCartaUnitario, nombreEnTicket, huellaOpciones, lineaPadreId, promoCuentaId, creadoPorId`, `OpcionElegidaEnLinea.*` (`pedido.ts:19,28,78,96,103`), `AgregadoDeCuenta.*` (`pedido.ts:126`) | Congelar lo vendido (precio, nombre, opciones) y no duplicar al reintentar |
| | | P4 Enviada a cocina: `CuentaItem.numeroEnvio` (`pedido.ts:166`) | Comanda/KOT derivada (no hay tabla de comanda) |
| | | P5 Cerrada: `Cuenta.cerradaEn, cerradaPorId`, `CuentaItem.operacionId`, `EjemplarTicket.numero, ejemplar=1, emitidoEn, emitidoPorId` (`cerrar-cuenta.ts:20,48,68`) más las `Operacion` VENTA (`registrarVentaEnTx`, ajeno) | Registrar la venta/stock y el ticket numerado |
| | | Salida A: liberada sin ítems (`liberar-mesa.ts`) · Salida B: ítem espejo `CuentaItem.anulaAItemId, motivoAnulacion` (`escribir-espejo-de-item.ts:44`) · Salida C: ticket corregido `EjemplarTicket.corrigeAId, motivo, ejemplar>1` (`escribir-ejemplar-corregido.ts:19`) | Anular sin borrar (trazabilidad) |
| **Mostrador** | Vender sin mesa | Igual a la cuenta (P1 con `Cuenta.tipoMesa=MOSTRADOR`, sin comensales: CHECK `Cuenta_comensales_segun_tipo_chk`) | Mismo cierre, otro puesto (`habilitar-mostrador.ts`, `abrir-cuenta-de-mostrador.ts`) |
| **Cabecera de venta** | Agrupar las Operaciones de una venta | `Venta.*` | **Sin escritor en `src/`** (ver §2) → el flujo no tiene pasos hoy |
| **Combinación vendida** | Foto de la combinación de un producto | `CombinacionEnLinea.*` | **Sin escritor en `src/`** (ver §2) |

## 2. COLUMNAS (solo las con observación o con clase; llaves, `empresaId`, `creadoEn` excluidas por el guardián)

Clase del guardián: `Venta.importeTotal` y `Cuenta.cerradaEn` = dinero (`guardas/columnas-de-significado.ts:149-150`); `OpcionElegidaEnLinea.tipoDeDiferencia/modoPrecio/precioDeSucursal` = dinero (`:97-99`), `.ocultaEnCarta` = visibilidad (`:100`). `Mesa`, `EjemplarTicket`, `AgregadoDeCuenta` NO están en `MODELOS_EN_ALCANCE` (Mesa excluida a propósito, `:31`).

| modelo.columna | flujo/paso | para qué | escritor | lectores | clase | observación |
|---|---|---|---|---|---|---|
| Mesa.numero, sucursalId, tipo | Puesto P1 | identificar el puesto | `persistencia/pos/mesas.ts:17,25` | `consultas/pos/mesas.ts`, `core/pos/puesto.ts` | fuera | `tipo` duplica a `Cuenta.tipoMesa` a propósito (FK compuesta ADR-039) |
| Cuenta.tipoMesa | Cuenta P1 | que la base garantice el tipo del puesto | `cuenta.ts:16,24` | `core/pos/puesto.ts` | ciega (no es de significado: String) | doble fuente con `Mesa.tipo`, forzada por la base: intencional |
| Cuenta.abiertaEn | P1 | rotación de mesas, orden | default now() | `consultas/pos/*` (NO VERIFICADO el detalle) | deuda (baseline) | |
| Cuenta.cerradaEn / cerradaPorId | P5 | cierre = abierta/cerrada | `cerrar-cuenta.ts:68` | mapa de mesas, tickets | dinero (`cerradaEn`); `cerradaPorId` ciega | estado derivado: `cerradaEn null` = abierta |
| Cuenta.comensales | P1 | rotación | `cuenta.ts:16,30` | reporte rotación | fuera | `null` = cuenta vieja; se corrige solo abierta |
| Cuenta.clienteId + descuentoPorcentaje | P2 | descuento al cierre | `cuenta.ts:42` | `casos-de-uso/cerrar-cuenta.ts:83` | fuera (Decimal) | **copia a propósito**: el % se congela (D7) aunque `Cliente.descuentoPorcentaje` cambie |
| CuentaItem.precioUnitario | P3 | precio de lista congelado | `pedido.ts:28,78` | cierre, tickets, reportes | fuera | congelar al vender: intencional |
| CuentaItem.precioCartaUnitario | P3 | precio antes de prorratear/descuento | `pedido.ts:78` | `reportes/descuentos-productos.ts:13,22`, `margen-promociones.ts:34` | fuera | **doble sentido** (comentario del esquema): componente de promo = precio a la carta; suelto = precio previo al descuento de producto. Además es parte de la clave de enlace (`cerrar-cuenta.ts:55`) |
| CuentaItem.nombreEnTicket | P3 | nombre con que sale el ticket | `pedido.ts:86`, `agregar-items.ts:189,289,302,324,341`, espejo `escribir-espejo-de-item.ts:51` | `core/pos/ticket.ts:181,312`, `consultas/pos/tickets.ts:55`, `consultas/reportes/tickets-emitidos.ts:76,99`, `cargar-cuenta-para-corregir-ticket.ts:53` | fuera | copia a propósito (congelar). El adicional NO la escribe (`pedido.ts:96-99`): cae al nombre interno (NO VERIFICADO si es deseado). El comentario del esquema dice que los reportes no la leen y `tickets-emitidos.ts` sí la lee |
| CuentaItem.huellaOpciones | P3 | distinguir líneas configuradas iguales | `pedido.ts:78` | `cerrar-cuenta.ts:57`, `lineasDeVenta` | deuda (baseline) | clave de agrupación, no dato de negocio |
| CuentaItem.lineaPadreId | P3 | adicional → padre | `pedido.ts:96` | `lineasDeVenta`, `pedido.ts:145` | deuda (baseline) | |
| CuentaItem.numeroEnvio | P4 | comanda | `pedido.ts:166` | `core/pos/comanda.ts` | fuera | `null` = borrador; sin tabla propia de comanda |
| CuentaItem.operacionId | P5 | enlace ítem→Operacion VENTA | `cerrar-cuenta.ts:48,51` | anulaciones, reportes de margen | fuera | **enlace por clave (producto, precio, promo, precioCarta, huella nula) y no por id** salvo líneas configuradas (`itemIds`): doble mecanismo |
| CuentaItem.anulaAItemId / motivoAnulacion / cantidad<0 | Salida B | anular sin borrar | `escribir-espejo-de-item.ts:44` | `lineasDeVenta` | fuera | anular = fila nueva: intencional |
| PromoCuenta.precio, titulo | P3 | congelar la promo vendida | `pedido.ts:19` | ticket, `margen-promociones` | fuera (modelo en alcance dinero; ninguna de estas es «de significado») | copia a propósito |
| OpcionElegidaEnLinea.nombreGrupo, nombreOpcion, importeUnitario, cantidad, tipoGrupo, porcentaje, factorEscala, orden | P3 | foto de lo vendido | `pedido.ts:103` | ticket, `nombre-de-la-linea.ts` | tipoGrupo/cantidad/porcentaje = deuda baseline; resto fuera | copias a propósito (el nombre de grupo/opción se copia además de las FK `grupoId/opcionId/versionDeOpcionId`) |
| OpcionElegidaEnLinea.ocultaEnCarta | P3 | omitir la opción del ticket del cliente | `pedido.ts:103` vía `linea-configurada.ts:197` | `core/opciones/nombre-de-la-linea.ts:25`, ticket | visibilidad | congelada al vender (declarada) |
| EjemplarTicket.numero, ejemplar | P5 | control de comandas, sin huecos | `cerrar-cuenta.ts:20` | `consultas/reportes/tickets-emitidos.ts`, `consultas/pos/tickets.ts` | fuera (modelo fuera de alcance) | `numero` = max+1 en tx SERIALIZABLE + únicos |
| EjemplarTicket.emitidoPorId, emitidoEn, corrigeAId, motivo | Salida C | trazabilidad | `escribir-ejemplar-corregido.ts:19` | idem | fuera | |
| AgregadoDeCuenta.claveIdempotencia, payloadHash, resultadoMensaje | P3 | no duplicar al reintentar | `pedido.ts:126` | `pedido.ts:113-115` | fuera | comprobante de idempotencia; `claveIdempotencia` único GLOBAL (no por empresa) como en `Operacion`: igual criterio que ADR-028 |
| **Venta.\*** (canal, cuentaId, fecha, importeTotal, usuarioId) | Cabecera de venta | agrupar operaciones | **ninguno en `src/`** (búsqueda de `venta.create`, `.venta`: sin resultado; el esquema dice «Nada de src/ la escribe todavía»); `Operacion.ventaId` tampoco se escribe (`git grep ventaId` solo en `src/core/features/ventas/venta.schema.ts:64`, tipo) | ninguno | `importeTotal` = dinero; `canal`, `cuentaId`, `fecha` = deuda baseline | **modelo colgado sin escritor ni lector**; declara dinero sobre un dato que nadie escribe. `importeTotal` sería además copia de lo que ya sale del Kardex |
| **CombinacionEnLinea.\*** | Combinación vendida | foto de combinación | **ninguno en `src/`** (búsqueda `tx.combinacionEnLinea`: sin resultado) | ninguno | `origenPrecio`, `precioDeSucursal` = deuda baseline | **colgado**; el esquema la describe como «la foto de la combinación vendida» (GO-3). NO VERIFICADO que se escriba por SQL o scripts |

## 3. FUNCIONES Y PRIMITIVAS

| nombre | archivo | qué hace | copias o variantes | ¿fuente única declarada? |
|---|---|---|---|---|
| `lineasDeVenta`, `claveDeLineaDeVenta` | `src/core/pos/cuenta.ts:97` | líneas netas de una cuenta (clave producto+precio+promo+huella) | el enlace de `cerrar-cuenta.ts:48-62` reimplementa la clave en un `where` | no |
| `importeDeLinea`, `precioConDescuento`, `repartirImporte` | `src/core/moneda.ts:60,96,117` | aritmética de dinero | `repartirEnteros` en `core/compras/reparto-de-factura.ts:28` (variante compras); `precioCobradoConDescuentos` (mayor de dos descuentos) | no declarada (la estudia el diseño de flujos como E5) |
| `nombreDeCarta` | `core/carta/armar-menu.ts:289` | nombre mostrado de un producto | el POS repite `p.nombreEnCarta ?? p.nombre` en `src/app/(pos)/mesas/[mesaId]/selector-carta.tsx:100,138`; y `nombreEnTicket ?? producto.nombre` en `core/pos/ticket.ts:181,312`, `tickets-emitidos.ts:99`, `cargar-cuenta-para-corregir-ticket.ts:53` | no: ≥ 5 copias del mismo `a ?? b` |
| armado de línea de ticket (`productoNombre = nombreEnTicket ?? producto.nombre`) | `core/pos/ticket.ts:283-312` | línea de ticket | otras dos lecturas del mismo dato (`tickets-emitidos.ts`, `cargar-cuenta-para-corregir-ticket.ts`) con su propio `select` | no |
| `huellaDeOpciones` | `core/opciones/huella-de-opciones.ts:26` | SHA-256 de opciones | — | sí (única) |
| `siguienteNumeroTicket`, `formatearNumeroTicket` | `core/pos/numeracion-ticket.ts` | número de ticket por sucursal | — | sí |
| `armarComandas` | `core/pos/comanda.ts` | comanda a partir de `numeroEnvio` | — | sí |
| `armarDetalleDeMesa`, `armarMapaDeMesas` | `core/pos/cuenta.ts`, `core/pos/mesas.ts` | vistas | — | sí |
| `decidirIdempotencia` | `core/movimientos/idempotencia.ts:58` | reintento seguro | usada por POS y otros módulos | sí |
| `formatearMonto`, `formatearCantidad` | `core/pos/formato.ts` | texto de dinero del POS | el diseño cuenta 143 usos de formato de dinero sin fuente única (NO VERIFICADO el detalle en este módulo) | no |
| `registrarVentaEnTx` | `server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts:212` | núcleo de la venta, lo usa el cierre y el mostrador | — (ajeno: movimientos) | sí |

## 4. FUENTES DE VERDAD

| hecho | lugares | quién manda | intencional/accidental |
|---|---|---|---|
| Precio cobrado de la línea | `Producto.precioVenta` / precio local (sucursal) → `CuentaItem.precioUnitario` → `Operacion.precioTotal` (venta) | `CuentaItem.precioUnitario` al vender | intencional (congelar), pero `Operacion` es una tercera copia derivada con descuento |
| Nombre en el ticket | `Producto.nombre`, `ContenidoCartaProducto.nombreEnCarta`, `CuentaItem.nombreEnTicket` | la copia de la línea | intencional (congelar); adicionales sin copia (ver §2) |
| Opciones vendidas | `OpcionElegidaEnLinea` (nombres + importes + FKs) y `CuentaItem.huellaOpciones` y nombre compuesto (`nombre-de-la-linea.ts`) | la foto | intencional; la huella es derivada |
| Descuento de cliente | `Cliente.descuentoPorcentaje` → `Cuenta.descuentoPorcentaje` | snapshot | intencional |
| Tipo de puesto | `Mesa.tipo` y `Cuenta.tipoMesa` | la base (FK compuesta) | intencional |
| Total de la venta | Kardex (`MovimientoStock`) / `Operacion` / `Venta.importeTotal` (sin escritor) | Kardex (el esquema lo dice) | `Venta.importeTotal` es copia sin uso: accidental/pendiente |
| Estado de la cuenta | `Cuenta.cerradaEn` (+ existencia de `Venta`, hoy no escrita; + `EjemplarTicket` A) | `cerradaEn` | intencional |
| Total mostrado de la mesa | calculado de ítems (`armarDetalleDeMesa`) | cálculo | no guardado: bien |
| Qué ítems pertenecen a qué Operacion | `CuentaItem.operacionId` + clave de línea | `operacionId` | doble mecanismo (clave vs `itemIds`): accidental, nace de que las líneas sin opciones se agregan por clave |
| Cupos de promo vendida | `PromoCuenta` (título, precio) vs `PromoCarta` | `PromoCuenta` | intencional |

## 5. ESCRITURAS (casos de uso en `src/server/actions/pos/casos-de-uso/`)

| caso de uso | qué escribe | ¿de más? | intencional/accidental |
|---|---|---|---|
| `crear-mesa`, `habilitar-mostrador` | `Mesa` | no | — |
| `abrir-cuenta`, `abrir-cuenta-de-mostrador` | `Cuenta` | no (abre dentro de la tx, test `pos-abrir-cuenta-en-la-transaccion`) | — |
| `corregir-comensales`, `asignar-cliente-a-cuenta` | `Cuenta.comensales` / `clienteId + descuentoPorcentaje` | no | — |
| `agregar-items` | `PromoCuenta`, `CuentaItem` (padre + adicionales), `OpcionElegidaEnLinea`, `AgregadoDeCuenta` | una fila por adicional con su propia foto (`pedido.ts:96-103`); `AgregadoDeCuenta` solo con clave | intencional |
| `quitar-item-sin-enviar`, `quitar-promo-sin-enviar` | **borra** `CuentaItem` y `PromoCuenta` (`pedido.ts:134-157`) | no, pero el borrado de borradores rompe «no se borra, se anula» solo para filas sin enviar | intencional (borrador) |
| `enviar-a-cocina` | `CuentaItem.numeroEnvio` (`pedido.ts:166`) | no | — |
| `anular-item-enviado`, `anular-promo-enviada` | fila espejo `CuentaItem` negativa (`escribir-espejo-de-item.ts:44`) | copia `nombreEnTicket`; NO VERIFICADO si copia `precioCartaUnitario`/opciones | intencional |
| `cerrar-cuenta` | `Operacion`+`MovimientoStock` (ajeno), `EjemplarTicket` A, `CuentaItem.operacionId`, `Cuenta.cerradaEn/cerradaPorId` | **no escribe `Venta`** pese a que el esquema la diseñó para esto | pendiente (modelo adelantado a su escritor) |
| `emitir-ticket-corregido` | `EjemplarTicket` (ejemplar+1) | no | intencional |
| `liberar-mesa` | `Cuenta.cerradaEn` sin venta | no | — |

## 6. INVARIANTES

| regla | documento | test |
|---|---|---|
| A lo sumo una cuenta abierta por mesa | `schema.prisma` (índice único parcial manual) | `test/pos/cuenta-una-abierta-por-mesa.test.ts` |
| Mostrador no lleva comensales; tipo de puesto = tipo de mesa | ADR-039, `Cuenta_comensales_segun_tipo_chk` | `test/aislamiento/mostrador-rls.test.ts`, `test/pos/mostrador-cuenta.test.ts` |
| Ticket numerado sin huecos por sucursal; corrección = fila nueva | comentario `EjemplarTicket` | `test/pos/numeracion-ticket.test.ts`, `test/pos/ejemplar-ticket-esquema.test.ts`, `test/casos-de-uso/emitir-ticket-corregido.test.ts` |
| Cierre atómico y repetible | `casos-de-uso/cerrar-cuenta.ts` | `test/casos-de-uso/cerrar-cuenta.test.ts`, `test/pos/cuenta-concurrencia.test.ts` |
| Agregar con reintento no duplica | `agregar-items.ts:74` | `test/pos/cuenta-concurrencia.test.ts` (NO VERIFICADO que cubra la clave de agregado) |
| La venta exige opciones obligatorias | — | `test/arquitectura/venta-exige-opciones-obligatorias.test.ts` |
| La línea congela precio/nombre/opciones | esquema | `test/pos/cuenta-item-esquema.test.ts`, `test/pos/nombre-de-la-linea.test.ts`, `test/pos/migracion-ticket-nombre-y-oculto-en-carta.test.ts` |
| Líneas con adicionales y opciones | GO-1/2 | `test/pos/lineas-con-adicionales.test.ts`, `test/pos/lineas-de-venta-opciones.propiedades.test.ts`, `test/core/linea-de-venta.propiedades.test.ts` |
| Descuentos (cliente/producto, mayor de los dos) | D7 | `test/pos/descuento-producto-pos.test.ts` |
| POS sin permiso → denegado | — | `test/aislamiento/denegacion-por-defecto-pos.test.ts` |
| Comanda a partir de envíos | — | `test/pos/comanda.test.ts` |
| `Venta` solo se agrega (sin UPDATE/DELETE) y `canal=MESA` ⇔ hay cuenta | comentario `Venta` | `test/aislamiento/m2-venta-subir-bajar-subir.test.ts` (prueba la migración, no un escritor) |
| `CombinacionEnLinea` único por línea; CHECK de coherencia de origen de precio | esquema | sin test de uso (no tiene escritor) |
| Una columna de significado nueva se declara | guardián | `test/arquitectura/cerco-columnas-de-significado.test.ts` |
| Lectores del ticket usan la misma regla de nombre | — | **sin test** (tres lecturas independientes) |
| `Venta.importeTotal` = suma de líneas | comentario `Venta` | **sin test** (nadie la escribe) |

## 7. DEUDA

| ítem | ¿vencimiento? | dónde |
|---|---|---|
| 11 columnas del módulo `sin-declarar` en el guardián: `CombinacionEnLinea.origenPrecio, .precioDeSucursal`, `Cuenta.abiertaEn`, `CuentaItem.huellaOpciones, .lineaPadreId`, `OpcionElegidaEnLinea.cantidad, .porcentaje, .tipoGrupo`, `Venta.canal, .cuentaId, .fecha` | no (el JSON solo tiene `meta` y `total`) | `cercos/linea-de-base/columnas-de-significado.json` |
| `Venta` y `CombinacionEnLinea` declaradas sin escritor | no (comentarios «Etapa C» / «todavía») | `prisma/schema.prisma:2724`, `:3797` vecinos |
| Doble sentido de `CuentaItem.precioCartaUnitario` | no | comentario del esquema |
| Comentario desactualizado de `nombreEnTicket` (dice que reportes no la leen) | no | `prisma/schema.prisma` en `CuentaItem.nombreEnTicket` vs `tickets-emitidos.ts:76` |
| Copias de `nombreDeCarta` / `repartirImporte` | no (el diseño las propone como deuda con fecha, E5) | ver §3 |

## 8. INTERFACES con otros módulos

| lee/escribe | detalle |
|---|---|
| Escribe `Operacion`, `MovimientoStock` (venta, stock) | `registrarVentaEnTx` en el cierre y el mostrador |
| Lee carta | `ContenidoCartaProducto.nombreEnCarta`, secciones, `PromoCarta`, grupos de opciones, `Disponibilidad`, precio local (`lecturas/carta/nombres-para-el-ticket.ts`, `lecturas/pos/*`) |
| Lee `Cliente` | descuento al asignar (`cuenta.ts:42`) |
| Lee recetas/stock | `insumos-de-las-opciones.ts`, sección de respaldo (`Seccion.sirveDeRespaldoEnVentas`) |
| Lo leen Reportes | `tickets-emitidos.ts`, `descuentos-productos.ts`, `margen-promociones.ts`, rotación de mesas |
| Módulos del POS | `lecturas/pos/modulos-del-pos.ts` (módulos apagados) |

## 9. NO VERIFICADO

- Si hay escritores de `Venta`, `Operacion.ventaId` o `CombinacionEnLinea` fuera de `src/` (scripts, SQL, seeds): solo se buscó en `src/`.
- Si el espejo de anulación copia `precioCartaUnitario` y las opciones, y qué pasa con `nombreEnTicket` del adicional.
- Lectores exactos de `Cuenta.abiertaEn` y `Cuenta.cerradaPorId`.
- Detalle de pantallas `src/app/(pos)` y componentes (solo se vio la lista y el selector: `selector-carta.tsx`).
- Cobertura real de idempotencia de `agregar-items` en `cuenta-concurrencia.test.ts`.
- Que el mostrador (`registrarVenta`) comparta el mismo camino de cierre; no se leyó `registrar-venta.ts` completo.
- Cantidad de usos de formato de dinero dentro del módulo.

## 10. TAMAÑO Y SUBMÓDULOS CON IDENTIDAD PROPIA (agregado pedido por otra sesión de coordinación, 2026-11-06; PROPUESTA, sin cambios)

**Tamaño medido** (`git ls-files`, columnas escalares contadas sobre `prisma/schema.prisma`; las FK y relaciones no entran):

| parte | cantidad |
|---|---|
| Modelos | 9 (`Mesa` 6 col., `Cuenta` 11, `PromoCuenta` 8, `CuentaItem` 17, `EjemplarTicket` 10, `AgregadoDeCuenta` 8, `Venta` 9, `OpcionElegidaEnLinea` 19, `CombinacionEnLinea` 11 = 99 columnas) |
| `src/core/pos` | 29 archivos, 3.665 líneas |
| `src/server/actions/pos` | 21 archivos, 1.855 líneas (15 casos de uso) |
| `consultas/pos` + `lecturas/pos` + `persistencia/pos` | 5+5+11 archivos, 304+542+851 líneas |
| `src/app/(pos)` | 31 archivos, 3.410 líneas (pantalla de mesa: 25 componentes en `mesas/[mesaId]`) |
| Tests | 91 archivos en `test/pos`; ~98 archivos de test nombran «ticket» y ~240 «promo» (conteo por texto, incluye otros módulos) |
| Total en `src/` del módulo | ≈ 104 archivos, ≈ 10.600 líneas |
| Permisos del POS (`pos_*` en acciones) | 9: `abrir_cuenta` 13 usos, `tomar_pedido` 14, `alta_mesa` 9, `anular_item` 7, `asignar_cliente` 5, `enviar_a_cocina` 4, `liberar_mesa` 4, `cerrar_cuenta` 3, `emitir_ticket_corregido` 3 |
| Módulo vendible (`core/modulos/catalogo.ts`) | uno solo, `salon` (requiere stock, clientes_basico, recetas); `carta` y `promociones` son vendibles aparte y lo «usan si existe». No hay entrada de catálogo propia para mostrador, ticket ni comanda |

**Criterio (d) para todos:** ninguno de los candidatos tiene hoy su propia entrada en `catalogo.ts` (solo `salon`); los permisos `pos_*` son por acción, no por candidato (salvo el ticket, abajo).

| Candidato (nombre propuesto) | Qué lo compone | Cohesión (números) | Qué lo ata al resto | Veredicto PROPUESTA |
|---|---|---|---|---|
| **Ticket y comanda** («Comprobantes de mesa») | `EjemplarTicket`; `core/pos/ticket.ts` (338), `impresion.ts` (93), `numeracion-ticket.ts` (31), `comanda.ts` (111); `consultas/pos/tickets.ts`; `persistencia/pos/escribir-ejemplar-corregido.ts`, `cargar-cuenta-para-corregir-ticket.ts`; caso `emitir-ticket-corregido`; app: `imprimir`, `ticket-cocina`, `ticket-cuenta`, `emitir-ticket-corregido`, `cuentas-cerradas`; reporte `reportes/tickets-emitidos.ts` | Quien importa esos 4 archivos de `core/pos` fuera de él: 10 archivos (4 de `(pos)/mesas/[mesaId]`, 2 casos de uso, 1 consulta, 2 persistencia, 1 reporte); importadores directos: `ticket` 9, `comanda` 7, `numeracion` 6, `impresion` 3. Tiene permiso propio (`pos_emitir_ticket_corregido`, `pos_emitir_boleta_corregida` aparece en el catálogo de permisos). Vocabulario propio (ejemplar A/B, corrige, numeración por sucursal sin huecos). | Lee de `Cuenta`/`CuentaItem`/`OpcionElegidaEnLinea` (las líneas congeladas) y de `Producto` para el nombre; el número se asigna dentro de la transacción de `cerrar-cuenta` (`cerrar-cuenta.ts:20`); la comanda depende de `CuentaItem.numeroEnvio`. | **Es parte de este módulo, con costura clara**: finalidad y vocabulario propios, pero su única escritura (A) vive dentro del cierre atómico y todo su insumo es la cuenta. Podría separarse como «lectura/emisión» sin tablas nuevas; no hay evidencia de que se venda aparte. |
| **Cobro y cierre de cuenta** | `cerrar-cuenta.ts` (caso de uso, acción, persistencia `cerrar-cuenta.ts`, `cargar-cuenta-para-cerrar.ts`), `Cuenta.cerradaEn`, `Venta` (sin escritor), descuentos (`moneda.ts`) | Permiso propio `pos_cerrar_cuenta` (3 usos). Pero **escribe tablas ajenas** (`Operacion`, `MovimientoStock` vía `registrarVentaEnTx`) y comparte ese núcleo con el mostrador. | Stock, Kardex, clientes (descuento), ticket. | **No concluyente → parte de este módulo**: es el punto donde el POS se une con Movimientos; el diseño de dueño marca «Venta» como cabecera pendiente. No se aísla sin definir antes qué es la Venta (hoy sin escritor). |
| **Mostrador** | `Mesa.tipo=MOSTRADOR`, `Cuenta.tipoMesa`, `core/pos/puesto.ts` (48), casos `habilitar-mostrador`, `abrir-cuenta-de-mostrador`; app `(pos)/mesas/mostrador` (2 archivos) y 5 en `mesas/[mesaId]`; `registrarVenta` de movimientos | Nombrado en 40 archivos de `src/`; 8 de ellos en `core/movimientos`, 6 casos de uso del POS, 5 pantallas. `puesto.ts` lo importan 16 archivos (es vocabulario de todo el POS). | Reusa la misma cuenta, ítems, cierre y ticket (mismo flujo con `tipoMesa` distinto); CHECK de la base lo trata como variante de `Mesa`/`Cuenta` (ADR-039). | **Es parte de este módulo (variante del puesto)**: no tiene tablas propias ni flujo distinto, solo un tipo de puesto; en `catalogo.ts` no se vende aparte. |
| **Mapa de mesas** | `core/pos/mesas.ts` (151), `consultas/pos/mesas.ts`, `components/mesas/mesa-card.tsx`, `app/(pos)/mesas/page` | Solo 5 archivos lo referencian (2 en core, 1 consulta, 1 componente, 1 página): muy poco ligado hacia afuera, pero también es solo una vista. | Lee `Mesa`, `Cuenta`, `CuentaItem` (total por mesa) y usuario (mozo). | **Es parte de este módulo**: es una pantalla/lectura, no tiene finalidad de producto propia ni escritura. |
| **Armar promo (venta)** | `PromoCuenta`; `core/pos/promo-combo.ts` (424), `armar-promo-estado.ts` (193), `alicuotas-de-combo.ts` (54), `componente-de-combo.ts` (64); `lecturas/pos/promo-para-agregar.ts`, `entradas-de-promo-para-vender.ts`; casos `anular-promo-enviada`, `quitar-promo-sin-enviar`; app `armar-promo*.tsx` (8 archivos en `(pos)/mesas/[mesaId]` referencian promo) | Referencias a `promo`/`PromoCuenta` en `src/`: ~66 archivos repartidos en 20+ carpetas (carta, reportes, movimientos, features/cuentas, features/ventas): **muy esparcido**; `promo-combo.ts` lo importan 17 archivos. Permiso: usa `pos_tomar_pedido`, sin permiso propio. Módulo vendible propio ya existente: `promociones` (catálogo), no la parte de venta. | La definición vive en Carta (`PromoCarta`, cupos); el prorrateo entra en el precio de cada `CuentaItem` y en `registrarVentaEnTx`; los reportes (`margen-promociones`) leen `PromoCuenta`. | **No concluyente (inclinado a «parte de Carta/Promociones + este módulo»)**: la cohesión interna es alta en `core/pos`, pero los ~66 archivos y las 20 carpetas muestran que cruza carta, venta y reportes; no se puede probar ni vender solo. |
| **Línea configurada / opciones vendidas** | `OpcionElegidaEnLinea`, `CombinacionEnLinea` (sin escritor), `core/pos/linea-configurada.ts`, `lineas-con-adicionales.ts`, `elegir-opciones-estado.ts`, `configuracion-de-entrada-a-elegir.ts`, `opciones-permitidas-de-entrada.ts`, `precio-de-configuracion.ts`; `core/opciones/*` (ajeno) | `OpcionElegidaEnLinea` es el modelo más ancho (19 columnas); la lógica de opciones vive mayormente en `core/opciones` y `core/catalogo`, no en `core/pos`. | Depende del catálogo de opciones (`GrupoDeOpciones`, `OpcionDeGrupo`, `VersionDeOpcion`). | **No concluyente**: la identidad (opciones configurables) pertenece más al catálogo/carta que al POS; el POS solo congela la foto. Corresponde mirarlo desde el inventario de Carta y Catálogo. |

**Conclusión (PROPUESTA):** no se encuentra, con estos números, un submódulo que (a)–(e) cumpla completo. El mejor candidato a «identidad propia» es **Ticket y comanda** (finalidad, vocabulario, actores y permiso propios, tabla propia), pero queda atado al cierre atómico. El candidato a «es otro módulo» es **Armar promo** hacia Carta/Promociones, y **Línea configurada** hacia Catálogo/Carta. Lo que no se pudo medir: referencias internas vs. externas por candidato con un script (solo conteo con `git grep -l`, que mezcla nombres homónimos); NO VERIFICADO que `pos_emitir_boleta_corregida` esté en uso real (apareció en el catálogo de permisos, no en `src/server/actions/pos`).
