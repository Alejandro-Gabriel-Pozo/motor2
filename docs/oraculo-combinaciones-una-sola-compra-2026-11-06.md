# Oráculo de combinaciones — una sola compra (U0 + U1)

Regla «Combinaciones» del dueño (AGENTS.md, 2026-10-28). Este archivo es la tabla de reglas esperadas, escrita APARTE del código. Lo leen:

- `test/core/combinaciones-una-sola-compra.test.ts`: recorre TODAS las combinaciones de las reglas puras (anular, corregir datos, declarar pago) contra las tablas de abajo (exhaustivo: son pocas).
- `test/movimientos/combinaciones-una-sola-compra-integracion.test.ts`: recorre una selección por pares contra la base real (el resultado del caso de uso, no solo de la regla pura).
- `test/arquitectura/combinaciones-una-sola-compra-declaradas.test.ts`: falla si aparece una columna o un estado nuevo en las tablas de la factura sin declarar si afecta o no.

Diseño de origen: `docs/diseno-una-sola-compra-2026-11-06.md` (§8.2, §8.3, §12). Estado de las reglas: CONFIRMADAS por el diseño salvo lo marcado.

## Dimensiones que cambian el resultado

| Dimensión | Valores | De dónde sale |
|---|---|---|
| **A** anulada | NO, SI | `FacturaProveedor.anuladaEn` |
| **N** notas de crédito de la factura | SIN, SOLO_ANULADAS, VIGENTE | `NotaCreditoProveedor` con `facturaProveedorId` (estado y `anuladaEn`) |
| **S** stock de lo comprado | INTACTO, CONSUMIDO | saldo de cada parte (una venta o una devolución a proveedor lo consumen) |
| **C** condición de pago | CONTADO_PAGADA, PENDIENTE_DE_PAGO | `FacturaProveedor.condicionPago` |
| **P** pago vigente declarado | NO, SI | `PagoDeFacturaProveedor` sin `anuladoEn` |
| **V** el comando cambia el proveedor | NO, SI | `proveedorId` pedido contra el guardado |

## Dimensiones que NO cambian el resultado

| Dimensión | Por qué no afecta |
|---|---|
| Reparto (una parte o varias) | Las reglas puras miran la factura entera; el reparto solo cambia QUÉ partes se revierten (cada una por su stock, dimensión S) y qué sucursales exigen permiso (ver «Partes ajenas»). |
| Partes ajenas (sucursales donde la persona no tiene permiso) | Las reglas puras no la ven: la decide el permiso por sucursal antes de la transacción (`exigirPermisoEnLasSucursalesDeLaFactura`); se prueba en integración. |
| Notas de crédito vigentes al CORREGIR el número o el detalle | Solo cambiar el proveedor choca con la nota (la base ata la nota al proveedor de su factura). |
| Medio de pago, fecha de pago | Solo el rango de fecha rechaza un pago (se prueba aparte, `decidirDeclaracionDePago`); no cambian anular ni corregir. |
| Pagada o pendiente al ANULAR la compra | Anular la compra no toca el pago: el pago declarado queda en su historia. (PROPUESTA del diseño, el dueño la corrige si no es así.) |

## Anular la factura entera

Orden de las razones: ya anulada → nota de crédito vigente → stock consumido. Una nota anulada no impide anular.

| A | N | S | Resultado |
|---|---|---|---|
| NO | SIN | INTACTO | ANULA |
| NO | SIN | CONSUMIDO | RECHAZA_STOCK_CONSUMIDO |
| NO | SOLO_ANULADAS | INTACTO | ANULA |
| NO | SOLO_ANULADAS | CONSUMIDO | RECHAZA_STOCK_CONSUMIDO |
| NO | VIGENTE | INTACTO | RECHAZA_CON_NOTAS_DE_CREDITO |
| NO | VIGENTE | CONSUMIDO | RECHAZA_CON_NOTAS_DE_CREDITO |
| SI | SIN | INTACTO | RECHAZA_YA_ANULADA |
| SI | SIN | CONSUMIDO | RECHAZA_YA_ANULADA |
| SI | SOLO_ANULADAS | INTACTO | RECHAZA_YA_ANULADA |
| SI | SOLO_ANULADAS | CONSUMIDO | RECHAZA_YA_ANULADA |
| SI | VIGENTE | INTACTO | RECHAZA_YA_ANULADA |
| SI | VIGENTE | CONSUMIDO | RECHAZA_YA_ANULADA |

## Corregir los datos de la factura

Una factura anulada no se corrige. Cambiar el proveedor se rechaza si la factura tiene CUALQUIER nota (vigente o anulada): la clave foránea `NotaCreditoProveedor_factura_fkey` es ON UPDATE RESTRICT. (Corrige al diseño, que decía «solo vigente».) El número y el detalle se corrigen igual.

| A | V | N | Resultado |
|---|---|---|---|
| NO | NO | SIN | CORRIGE |
| NO | NO | SOLO_ANULADAS | CORRIGE |
| NO | NO | VIGENTE | CORRIGE |
| NO | SI | SIN | CORRIGE |
| NO | SI | SOLO_ANULADAS | RECHAZA_CON_NOTAS_DE_CREDITO |
| NO | SI | VIGENTE | RECHAZA_CON_NOTAS_DE_CREDITO |
| SI | NO | SIN | RECHAZA_YA_ANULADA |
| SI | NO | SOLO_ANULADAS | RECHAZA_YA_ANULADA |
| SI | NO | VIGENTE | RECHAZA_YA_ANULADA |
| SI | SI | SIN | RECHAZA_YA_ANULADA |
| SI | SI | SOLO_ANULADAS | RECHAZA_YA_ANULADA |
| SI | SI | VIGENTE | RECHAZA_YA_ANULADA |

## Declarar el pago de la factura

Con la fecha del pago dentro del rango (la fuera de rango se prueba en `test/core/pago-de-factura.test.ts`). Orden: anulada → se cargó pagada → ya tiene pago.

| A | C | P | Resultado |
|---|---|---|---|
| NO | PENDIENTE_DE_PAGO | NO | DECLARA |
| NO | PENDIENTE_DE_PAGO | SI | RECHAZA_YA_TIENE_PAGO |
| NO | CONTADO_PAGADA | NO | RECHAZA_NO_ADMITE_PAGO |
| NO | CONTADO_PAGADA | SI | RECHAZA_NO_ADMITE_PAGO |
| SI | PENDIENTE_DE_PAGO | NO | RECHAZA_FACTURA_ANULADA |
| SI | PENDIENTE_DE_PAGO | SI | RECHAZA_FACTURA_ANULADA |
| SI | CONTADO_PAGADA | NO | RECHAZA_FACTURA_ANULADA |
| SI | CONTADO_PAGADA | SI | RECHAZA_FACTURA_ANULADA |

## Columnas de la factura y su efecto

Cada columna de `FacturaProveedor`, `FacturaProveedorSucursal`, `PagoDeFacturaProveedor` y `NotaCreditoProveedor` tiene que figurar acá, con la dimensión a la que responde o `no afecta` con su motivo. Una columna nueva sin declarar deja en rojo el guardián.

| Columna | Efecto |
|---|---|
| FacturaProveedor.anuladaEn | A |
| FacturaProveedor.anuladaPorId | no afecta: quién anuló (trazabilidad) |
| FacturaProveedor.condicionPago | C |
| FacturaProveedor.fechaPagoDeclarada | no afecta: copia informativa del pago; manda `PagoDeFacturaProveedor` (P) |
| FacturaProveedor.medioPagoDeclarado | no afecta: copia informativa del pago; manda `PagoDeFacturaProveedor` (P) |
| FacturaProveedor.proveedorId | V |
| FacturaProveedor.nroFactura | no afecta: cambiarlo se corrige siempre; su unicidad la prueba el oráculo del comprobante único |
| FacturaProveedor.nroFacturaNormalizado | no afecta: derivada de nroFactura |
| FacturaProveedor.letra | no afecta: derivada de nroFactura |
| FacturaProveedor.detalleLibre | no afecta: texto libre, se corrige siempre |
| FacturaProveedor.estado | no afecta: constante CONFIRMADA (guardián U-I6) |
| FacturaProveedor.origen | no afecta: constante CARGA (guardián U-I6) |
| FacturaProveedor.id | no afecta: identidad |
| FacturaProveedor.empresaId | no afecta: aislamiento por empresa (RLS) |
| FacturaProveedor.fecha | no afecta: el rango de la fecha del pago se prueba aparte |
| FacturaProveedor.fechaComprobante | no afecta: dato del comprobante |
| FacturaProveedor.importeTotal | no afecta: dinero, no habilita ni bloquea |
| FacturaProveedor.condicionIvaEmpresa | no afecta: dato fiscal |
| FacturaProveedor.importeNeto | no afecta: dato fiscal |
| FacturaProveedor.importeIva | no afecta: dato fiscal |
| FacturaProveedor.confirmadaEn | no afecta: constante al cargar |
| FacturaProveedor.confirmadaPorId | no afecta: trazabilidad |
| FacturaProveedor.recibidaEnAdministracionEn | no afecta: dato de administración |
| FacturaProveedor.claveIdempotencia | no afecta: idempotencia de la carga (I3) |
| FacturaProveedor.payloadHash | no afecta: idempotencia de la carga (I3) |
| FacturaProveedor.resultadoMensaje | no afecta: idempotencia de la carga (I3) |
| FacturaProveedor.creadoPorId | no afecta: trazabilidad |
| FacturaProveedor.creadoEn | no afecta: trazabilidad |
| FacturaProveedorSucursal.operacionId | S |
| FacturaProveedorSucursal.sucursalId | no afecta: ver «Partes ajenas» |
| FacturaProveedorSucursal.estadoRecepcion | no afecta: constante RECIBIDA (guardián U-I6) |
| FacturaProveedorSucursal.id | no afecta: identidad |
| FacturaProveedorSucursal.empresaId | no afecta: aislamiento por empresa (RLS) |
| FacturaProveedorSucursal.facturaProveedorId | no afecta: la relación con la cabecera |
| FacturaProveedorSucursal.porcentajeDeclaradoBp | no afecta: el reparto no cambia la regla |
| FacturaProveedorSucursal.recibidaEn | no afecta: trazabilidad |
| FacturaProveedorSucursal.recibidaPorId | no afecta: trazabilidad |
| FacturaProveedorSucursal.creadoEn | no afecta: trazabilidad |
| PagoDeFacturaProveedor.anuladoEn | P |
| PagoDeFacturaProveedor.anuladoPorId | no afecta: trazabilidad |
| PagoDeFacturaProveedor.facturaProveedorId | no afecta: la relación con la cabecera |
| PagoDeFacturaProveedor.fechaPago | no afecta: el rango se prueba aparte |
| PagoDeFacturaProveedor.medio | no afecta: medio de pago |
| PagoDeFacturaProveedor.id | no afecta: identidad |
| PagoDeFacturaProveedor.empresaId | no afecta: aislamiento por empresa (RLS) |
| PagoDeFacturaProveedor.claveIdempotencia | no afecta: idempotencia (I3) |
| PagoDeFacturaProveedor.payloadHash | no afecta: idempotencia (I3) |
| PagoDeFacturaProveedor.resultadoMensaje | no afecta: idempotencia (I3) |
| PagoDeFacturaProveedor.creadoPorId | no afecta: trazabilidad |
| PagoDeFacturaProveedor.creadoEn | no afecta: trazabilidad |
| NotaCreditoProveedor.anuladaEn | N |
| NotaCreditoProveedor.facturaProveedorId | N |
| NotaCreditoProveedor.estado | no afecta: la vigencia de la nota la decide `anuladaEn` |
| NotaCreditoProveedor.anuladaPorId | no afecta: trazabilidad |
| NotaCreditoProveedor.motivoAnulacion | no afecta: texto |
| NotaCreditoProveedor.id | no afecta: identidad |
| NotaCreditoProveedor.empresaId | no afecta: aislamiento por empresa (RLS) |
| NotaCreditoProveedor.proveedorId | no afecta: la nota va con el proveedor de su factura (misma regla N) |
| NotaCreditoProveedor.tipo | no afecta: tipo de nota |
| NotaCreditoProveedor.nroComprobante | no afecta: número propio de la nota |
| NotaCreditoProveedor.nroComprobanteNormalizado | no afecta: derivada del número de la nota |
| NotaCreditoProveedor.letra | no afecta: derivada del número de la nota |
| NotaCreditoProveedor.fecha | no afecta: dato de la nota |
| NotaCreditoProveedor.fechaComprobante | no afecta: dato de la nota |
| NotaCreditoProveedor.importeTotal | no afecta: dinero de la nota |
| NotaCreditoProveedor.condicionIvaEmpresa | no afecta: dato fiscal |
| NotaCreditoProveedor.importeNeto | no afecta: dato fiscal |
| NotaCreditoProveedor.importeIva | no afecta: dato fiscal |
| NotaCreditoProveedor.motivo | no afecta: texto |
| NotaCreditoProveedor.origen | no afecta: constante de la nota |
| NotaCreditoProveedor.recibidaEnAdministracionEn | no afecta: dato de administración |
| NotaCreditoProveedor.claveIdempotencia | no afecta: idempotencia (I3) |
| NotaCreditoProveedor.payloadHash | no afecta: idempotencia (I3) |
| NotaCreditoProveedor.resultadoMensaje | no afecta: idempotencia (I3) |
| NotaCreditoProveedor.creadoPorId | no afecta: trazabilidad |
| NotaCreditoProveedor.creadoEn | no afecta: trazabilidad |

## Partes ajenas (solo integración)

Anular y corregir exigen el permiso (`anular_compra` / `corregir_compra`) en la sucursal que cargó la factura y en cada sucursal donde ya entró una parte. Sin el permiso en alguna → `SIN_PERMISO_EN_SUCURSAL` y no se escribe nada. Con el permiso en todas → la regla de las tablas de arriba.

| Reparto | Permiso | Resultado |
|---|---|---|
| UNA_PARTE | en la sucursal | la regla de las tablas |
| REPARTIDA | en todas las sucursales con parte | la regla de las tablas |
| REPARTIDA | falta en una sucursal con parte | RECHAZA_SIN_PERMISO_EN_SUCURSAL |
