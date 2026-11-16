# Compras: paridad con Pedernal — auditoría (Fase 1, solo documentos)

Fecha: 2026-11-16. Frente 5 (COMPRAS) del programa de paridad. Contrato: `_coordinacion/mapa-de-carriles-2026-11-16.md` (motor2-docs). Este archivo es la parte (a) del pedido; el diseño está en `diseno-compras-paridad-pedernal-2026-11-16.md` (índice, carril, etapas, preguntas) y `diseno-compras-paridad-escalera-2026-11-16.md` (niveles 1 a 10 y «¿qué pasa si…?»).

Cómo se verificó: Motor2 contra el código real (`src/`, `prisma/schema.prisma`, `prisma/migrations`, HEAD `903c0f6d`), no contra documentos; los puntos que más pesan los releí yo a mano (ver §1.4). Pedernal contra `ZuluHub-ERP` `main` (`ad4a9a4`, 2026-11-16 11:36 -03, clon `--depth 1`) y `ZuluHub-docs`; las ramas pendientes (0058, 0060) con `git ls-remote`/`fetch`. Lo que no se leyó va como **NO VERIFICADO**. Los números `DDD:n` son la línea de `ZuluHub-docs/11-especificaciones/decisiones-del-dueno-2026-11.md` (no coinciden con la «fila» de `novedades-para-motor2.md`: la fila 194 de novedades es `DDD:199`).

## 1. Motor2 hoy (código real)

### 1.1 Lo que existe y se usa

| Capacidad | Dónde | Notas |
|---|---|---|
| Compra única = factura de proveedor (`FacturaProveedor`), de 1 o N partes por sucursal, con `Operacion` COMPRA y `MovimientoStock` | `src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor.ts` | Decisión «una sola compra» 2026-11-06 (`docs/diseno-una-sola-compra-2026-11-06.md`; cita literal no releída en esta pasada). Transacción SERIALIZABLE con reintento; idempotencia I3 (`claveIdempotencia` única + `payloadHash`); auditoría `registrarCambioAuditado`. |
| Reparto entre sucursales por propuesta y aceptación | `aceptar-propuesta-de-factura.ts` | Quien acepta elige sección y fecha de stock; `FOR UPDATE` sobre la cabecera. Es el único «recibir» que existe hoy. |
| Número de comprobante único por empresa | índice parcial `FacturaProveedor_unica_vigente_key` | |
| Unidad de compra y cantidad real | `armar-linea-de-movimiento.ts` | Presentación resuelta por unidad; `PRESENTACION_AMBIGUA` si hay dos activas. |
| Anular factura entera | `anular-factura-proveedor.ts` | Contra-asiento AJUSTE con el costo original; bloqueos: stock ya consumido, conteo posterior, notas vigentes. |
| Corregir **solo la cabecera** (proveedor, N.º, detalle) | `corregir-factura-proveedor.ts` | `FOR UPDATE` + guarda optimista. |
| Declarar y anular pago (fecha y medio; **sin importe**, paga la factura entera; un pago vigente por factura) | `declarar-pago-de-factura-proveedor.ts`, `anular-pago-de-factura-proveedor.ts` | Índice parcial `PagoDeFacturaProveedor_vigente_key`. |
| Devolución a proveedor (motor genérico, proceso `DEVOLUCION_PROVEEDOR`) | `registrar-movimiento.ts` | Sin auditoría administrativa propia (NO VERIFICADO si hay otra). |
| Oferta vigente derivada del Kardex (no hay tabla con precio) | `src/server/lecturas/catalogo/ofertas-de-proveedor.ts:59-66` | Filtra `anuladaEn IS NULL`. |
| Costo = último precio de compra por producto y sucursal (no hay promedio ponderado) | `src/server/lecturas/reportes/comun.ts:153-179` | `valuacion.ts` lo declara: «No es un método de costeo nuevo (PMP/FIFO)». |
| Presentaciones de compra (#304/#309) | `Presentacion` (schema:654), `armar-linea-de-movimiento.ts` | Apagadas por la **constante** `PRESENTACIONES_VISIBLES = false` (`src/core/catalogo/presentaciones-visibles.ts:13`), no por perilla de plan. Números de PR NO VERIFICADOS contra GitHub. |
| Permisos | `acciones.ts`: `proceso_compra`, `proceso_devolucion_proveedor`, `anular_compra` y `corregir_compra` (piso administrador), `compra_repartir` y `declarar_pago_compra` (empresa), `reporte_compras` | `compra_recibir` existe pero está `reservada: true` y sin uso (`acciones.ts:263`). |
| Tests | concurrencia (`factura-corregir-concurrencia`, `factura-unica-concurrencia`, …), idempotencia (`idempotencia-i3-*`), oráculos de combinaciones (`combinaciones-una-sola-compra*`, `declarar-pago-oraculo`) y sus guardianes de dimensiones | Solo por nombre; contenido NO VERIFICADO salvo los guardianes. |

### 1.2 Tablas que existen pero ningún código escribe

`NotaCreditoProveedor` (+ `Linea`, `Imputacion`, `Tributo`; migraciones `20261018100000…103000`), `FacturaProveedorTributo`, `PuntoDeVentaDeProveedor`, `ConceptoDeGasto`, `ImputacionDeGasto`, `ReclasificacionRenglon`, planes y centros de costos, y `Empresa.llevaIvaDeCompras` (0 usos en `src/`). Hay claves de permiso de notas de crédito **solo en la base** (migración `20261018103000`), no en `ACCIONES`. Esto es «tablas a ciegas» en el sentido de AGENTS.md: cualquier diseño nuevo debe **reutilizarlas o retirarlas explícitamente**, no sumar otras con otro nombre (ver §3, fila de notas de crédito).

### 1.3 Lo que NO existe (verificado por búsqueda en `src/` y en el schema)

Orden de compra; tres vías, tolerancias y diferencias (las únicas «tolerancias» son otro asunto: `TOLERANCIA = 0.0005` en `src/core/compras/anulacion.ts:154` y la del dólar); notas de crédito cargables (ni caso de uso, ni acción, ni pantalla); saldo a favor, crédito, reintegro y cuenta corriente del proveedor; **caja** (no hay modelo de caja, arqueo ni turno; `medio = "EFECTIVO"` es una etiqueta y el pago «no toca el dinero ni el stock»); pago con importe o parcial; corregir precio o cantidad de una línea (solo existe anular y recargar); rechazar una parte propuesta (no hay estado `RECHAZADA`); pantallas de recepción, órdenes o notas; bienes de uso (solo en papel); perillas de plan de compras (Motor2 no tiene planes con perillas: `docs/plan-roles-y-permisos-como-pedernal-2026-11-16.md`, fila 4 de diferencias; es el frente 4).

### 1.4 Hallazgos propios (verificados a mano)

1. **Recepción separada: la base ya la prevé, el código no.** `FacturaProveedorSucursal.estadoRecepcion` nace `'PENDIENTE'`, `operacionId` es **opcional**, `recibidaEn`/`recibidaPorId` existen, el CHECK `recepcion_coherente_chk` fija `RECIBIDA ⇔ recibidaEn IS NOT NULL` y un disparador permite solo PENDIENTE→RECIBIDA una vez (migración `20261016101500_factura_proveedor_recepcion`). El comentario del schema registra «cambio del dueño, 2026-10-12: el stock de una factura entra recién cuando la factura está repartida y la parte RECIBIDA» (cita literal NO releída). Pero `src/` solo escribe partes ya `RECIBIDA` (`escribirParteRecibida`) y la acción `compra_recibir` está reservada «hasta la Etapa C (la bandeja “mercadería por recibir”)». Es decir: **N3 es, en Motor2, activar algo ya diseñado a medias**, no inventarlo.
2. **Riesgo existente (no pedido, se avisa): anular una factura con pago vigente no tiene bloqueo ni baja del pago.** `anular-factura-proveedor.ts` no menciona pagos (grep vacío; `decidirAnulacionDeFactura` solo mira `anulada` y `notasVigentes`). Pedernal lo cerró en #319 (D5: `COMPROBANTE_YA_PAGADO{pagoId}`; primero se anula el pago). Hoy en Motor2 un pago puede quedar vigente sobre una factura anulada. Tests por nombre: no hay «anular con pago vigente» (contenido NO VERIFICADO). Es un arreglo chico de integridad (regla del usuario: avisar aunque no sea lo pedido); se propone como etapa C0 (§ etapas) y NO se toca en Fase 1.
3. **Pago en efectivo sin caja:** `declararPago` no mueve dinero. El dueño de Pedernal decidió (`DDD:188`, 16/11) que el efectivo sale siempre de una caja abierta. En Motor2 depende por completo del frente 1 (CAJA): no hay nada contra qué conectar.
4. **Costo sin promedio:** «último precio» (no PMP). La valorización «opción A» de Pedernal (corregir cantidad) habla de «costo con que entró esa línea»; en Motor2 el costo de cada línea queda en `MovimientoStock.precioPorUnidadStock` (por línea), así que A es representable sin PMP (ver diseño, nivel 5).
5. `Operacion_factura_unica_vigente_key`: no se verificó si sigue vivo tras `…factura_unica_drop_viejo`. No bloquea nada de este diseño.

## 2. Pedernal vigente (`ad4a9a4`)

**Construido en `main` (N1/N2):** 19 tablas de `0037_compras.sql` (recepción, línea de recepción, comprobante del proveedor, conciliación atajo 1 a 1, pago, corrección de compra, configuración por nivel), `0053`/`0054` (costo cero conocido; línea de factura nunca con precio cero), `0058` (**mergeada**: al anular una compra la oferta del proveedor se recalcula desde la última compra vigente o queda `vigente=false`; `novedades-para-motor2.md` dice «no mergeada», está desactualizado), D5 (`COMPROBANTE_YA_PAGADO`), D6 (solo facturas en «Comprar y recibir»), D11 (la oferta sigue a la corrección), IVA como costo o crédito fiscal. Módulo `compras` «disponible».

**Aprobado y sin mergear:** `0060` (rama `orq/plan10-corregir-ampliada`, PR #356): completar «Sin precio» con «precio por»; **cantidad o peso real responde `CORRECCION_DE_CANTIDAD_NO_DISPONIBLE`: la valorización «opción A» no está construida**. `0059` no existe en ninguna rama (reservada a medios de pago). `0063` (N3), `0064` (afloja `renglon_de_movimiento_validar` para entradas de compra a cuarentena/rechazo), `0065` (`linea_de_comprobante.producto_id` opcional): aprobadas por el dueño pero **sin rastro en origin: su SQL real NO VERIFICADO**; solo se conoce su descripción en `DDD:198, 202, 208, 214`.

**Solo diseño:** N3 completo; N4 (orden de compra, tres vías, tolerancias, diferencias, notas de crédito, devolución, saldo a favor, reintegro). Las perillas `recepcion_separada` y `conciliacion_de_tres_vias` **no están declaradas** en `src/capacidades/planes/perillas.ts`; hoy `configurarCompras` responde `FUNCION_NO_INCLUIDA{perilla}` para N3/N4 sin consultar plan. Los saldos de N4 **ya no serán tablas propias**: `DDD:210/216` los pasan a un «libro común de saldos por parte» (`primitiva-de-libro-diseno.md` §3.2-3.5; **NO leído a fondo**, ver preguntas).

**Contradicción interna de Pedernal (declarada):** `DDD:121` (14/11) decía siete resoluciones de la diferencia; `DDD:197` (16/11, «2A») las dejó en **cuatro**: «Dejar abierta», «Pedir nota de crédito», «Aceptar la diferencia», «Devolver al proveedor». Vale la posterior.

## 3. Tabla de paridad

Clasificación: **IGUAL** · **DIFIERE-RESULTADO** · **DIFIERE-FORMA** · **FALTA-MOTOR2** · **FALTA-PEDERNAL** · **NO VERIFICADO**.

| # | Tema | Pedernal (vigente) | Motor2 (código real) | Clase | Motivo / nota |
|---|---|---|---|---|---|
| 1 | Compra con factura, número único por empresa, idempotente, auditada | `registrarCompraConFactura`, `cp_duplicado_uk`, clave + huella | `registrar-factura-proveedor.ts`, índice parcial, `claveIdempotencia`+`payloadHash` | DIFIERE-FORMA | Mismo resultado; tablas distintas (Pedernal: recepción + comprobante separados; Motor2: factura-con-partes). Impone el modelo existente de Motor2. |
| 2 | Comprar **sin** factura (N1 `COMPRA_SIMPLE`) | Existe | No: toda compra es factura (decisión 2026-11-06) | DIFIERE-RESULTADO | **Pregunta 1 al dueño** (cambia el modelo). |
| 3 | Configuración por nivel (`COMPRA_SIMPLE`…`TRES_VIAS`) | `configuracion_de_compras.nivel` + perilla | No hay; frente 4 aporta perillas | FALTA-MOTOR2 | Depende del frente 4. |
| 4 | N3: recepción nace pendiente; confirma gerente/administrador; stock entra al depósito que elige quien recibe | Aprobada (0063), sin código verificable | Columnas ya en la base, sin código; `compra_recibir` reservada | FALTA-MOTOR2 (base lista) | Ver hallazgo 1; Pedernal: NO VERIFICADO su SQL. |
| 5 | N3: control por línea conforme / con observaciones / rechazada; observación obligatoria si no es conforme | Aprobado (0063); diseño viejo `inspeccion_de_linea_de_recepcion` | No existe | FALTA-MOTOR2 | Requiere tabla nueva de solo inserción. |
| 6 | Recibir a cuarentena/rechazo | 0064 aprobada | No existe | FALTA-MOTOR2 | Toca stock (frente 2/stock); etapa posterior. |
| 7 | Orden de compra sin aprobación (`BORRADOR→PEDIDA→CERRADA\|ANULADA`; crea/pide gerente o administrador) | Diseño (E9 D127), sin DDL decidido | No existe | FALTA-MOTOR2 y FALTA-PEDERNAL (no construido) | Pedernal tampoco lo tiene en código. |
| 8 | Tres vías con tolerancias (sin tolerancia por defecto; las configura el gerente) | Diseño; contradicción de ubicación de la tabla | No existe | FALTA-MOTOR2 / FALTA-PEDERNAL | |
| 9 | Diferencias con 4 resoluciones | Diseño | No existe | FALTA-MOTOR2 / FALTA-PEDERNAL | Vale `DDD:197`, no `DDD:121`. |
| 10 | Notas de crédito del proveedor | Diseño N4; la nota es un comprobante clase `NOTA_DE_CREDITO` con factura asociada | **4 tablas propias sin escritor** + permisos solo en la base | DIFIERE-FORMA y FALTA-MOTOR2 | Reutilizar `NotaCreditoProveedor` (ya trae FK de 3 columnas misma factura/proveedor, único parcial, `operacionDevolucionId`) antes de inventar otra; ver diseño nivel 4. |
| 11 | Devolución al proveedor (hecho separado: no mueve dinero, no crea nota) | Diseño (H1) | Existe el proceso `DEVOLUCION_PROVEEDOR` en el motor de stock | DIFIERE-RESULTADO (parcial) | Motor2 ya devuelve stock; falta el vínculo con nota/pedido y la anulación en cadena. |
| 12 | Saldo a favor, aplicación a factura, reintegro, cuenta corriente | Diseño; ahora «libro común de saldos» | No existe (grep 0) | FALTA-MOTOR2 / FALTA-PEDERNAL | Libro: NO VERIFICADO. |
| 13 | Corregir precio de una línea (fórmula A del costo) y oferta que sigue | **Construido** (#263, D11) | No existe corregir líneas | FALTA-MOTOR2 | |
| 14 | Corregir cantidad / peso real; valorización «opción A» | Decidida, **no construida** (0060 no la trae) | No existe | FALTA-MOTOR2 y FALTA-PEDERNAL | Motor2 puede igualar el resultado sin PMP (hallazgo 4). |
| 15 | Completar precio de una compra «Sin precio» | 0060 (rama, sin mergear) | No existe «Sin precio» | FALTA-MOTOR2 | |
| 16 | Anular con oferta vigente | 0058 mergeada (`vigente=false` si no queda compra) | La oferta se **deriva** del Kardex filtrando anuladas: ya es automático; `ProveedorPorProducto` no guarda precio | IGUAL (resultado) / DIFIERE-FORMA | No hace falta columna `vigente`; verificar que la comparativa ignore la anulada (lo hace, `ofertas-de-proveedor.ts:59-66`). |
| 17 | Anular con pago vigente | D5: `COMPROBANTE_YA_PAGADO`, primero se anula el pago | **Sin bloqueo** | FALTA-MOTOR2 (riesgo existente) | Hallazgo 2; etapa C0. |
| 18 | Pago de la factura: importe | `declararPago` importe = total; N4 cambia a `total − total_aplicado` | No guarda importe | DIFIERE-FORMA | Importe llega con N4 (nota aplicada). |
| 19 | Pago en efectivo siempre desde caja abierta | Decidido 16/11, **no construido** (hoy `salidaDeCaja` opcional) | Sin caja | FALTA-MOTOR2 / FALTA-PEDERNAL | Depende del frente 1. |
| 20 | Anulación en cadena (reintegro→pago→nota→factura) y errores `COMPROBANTE_CON_NOTA_DE_CREDITO`, `COMPRA_CON_DEVOLUCION` | Diseño | Bloquea por notas vigentes, no por pagos ni devoluciones | DIFIERE-RESULTADO | |
| 21 | Presentaciones de compra | Presentación por producto | Existe, detrás de constante | DIFIERE-FORMA | Es del frente 2; compras solo la consume. |
| 22 | Costo | (NO VERIFICADO si PMP o último) | Último precio, sin PMP | NO VERIFICADO | Pedernal: no leí su valorización en esta pasada. |
| 23 | Perillas `recepcion_separada` y `conciliacion_de_tres_vias` | Nombradas, no declaradas en código | No existen | FALTA-MOTOR2 / FALTA-PEDERNAL | Frente 4. |
| 24 | Rechazar una parte propuesta (E3a) | — | No existe | FALTA-MOTOR2 (propio) | Es del módulo de reparto, no de paridad; **no se incluye** salvo pedido. |
| 25 | Pantallas de compras | Maquetas aceptadas por delegación (`DDD:187`) | Alta por pasos y «Compras registradas» | DIFIERE-FORMA | Frente 6; se acuerda por mensaje. |

## 4. Fuentes no leídas (para cerrar antes de Fase 2)

`primitiva-de-libro-diseno.md` y su efecto en notas/saldos; SQL real de 0063/0064/0065 (hoy sin rama; pedirlo al orquestador de Pedernal); contenido de los tests de compras de Motor2; `panel-compra-por-pasos.tsx` y `pago-de-factura.tsx`; textos de compras en `src/core/textos`; qué hace el menú con `compra_recibir`; las citas literales del dueño de Motor2 del 2026-10-12, 2026-11-03 y 2026-11-06 (se las cita por el documento que las registra).
