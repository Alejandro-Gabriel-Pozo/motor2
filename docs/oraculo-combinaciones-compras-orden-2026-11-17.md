# Oráculo de combinaciones — orden de compra (Compras, etapa OC)

Regla «Combinaciones» del dueño (AGENTS.md, 2026-10-28). Este archivo es la tabla de reglas esperadas, escrita APARTE del código. La leen:

- `test/core/combinaciones-compras-orden.test.ts`: recorre TODAS las combinaciones de las reglas puras de la orden (datos de una orden nueva, pedir, anular, cerrar, vincular un renglón y control de exceso) y la puerta de acceso (acción × módulo × rol) contra las tablas de abajo (exhaustivo: son pocas).
- `test/movimientos/combinaciones-compras-orden-integracion.test.ts`: recorre contra la base real (el resultado del caso de uso, no solo de la regla pura) pedir, anular y cerrar por estado, y el control de exceso al confirmar la recepción por nivel.
- `test/arquitectura/combinaciones-compras-orden-declaradas.test.ts`: falla si aparece un estado, un nivel, un motivo, una entrada de las reglas, una columna de las tablas de la orden, un módulo o una acción nuevos sin declarar si afectan o no.

Diseño de origen: `docs/diseno-compras-n3b-n4-etapas-2026-11-16.md` (§«Etapa OC») corregido por `docs/diseno-compras-contraste-sql-pedernal-2026-11-16.md` (SQL 0066 de Pedernal: sucursal destino opcional, sin reemplazo de orden, sin cierre automático, saldo y vínculo por renglón). Necesidad: «una orden de compra NO necesita aprobación de una segunda persona» y «crear y pedir una orden de compra lo hace quien administra o gerencia, no el operador» (Pedernal `DDD:197`, 1A y 5A, 2026-11-16). Estado de las reglas: PROPUESTAS por el diseño; el dueño las corrige si no son así.

## Dimensiones que cambian el resultado

| Dimensión | Valores | De dónde sale |
|---|---|---|
| **A** acción de la orden | GESTIONAR, CONFIGURAR, VER | `orden_de_compra_gestionar` (crear, pedir, anular, cerrar), `compras_configurar` (el nivel del control), `orden_de_compra_ver` |
| **M** módulo `ordenes_de_compra` de la empresa | APAGADO, ENCENDIDO | Registro `ModuloEmpresa` (lo enciende la plataforma por empresa; nace apagado; requiere `recepcion_de_compras`) |
| **O** rol de quien actúa | OPERADOR, ADMINISTRADOR, GERENTE | Nivel de la persona (`nivelDe`) frente al piso de la acción |
| **P** proveedor de la orden | CON_PROVEEDOR, SIN_PROVEEDOR | Dato obligatorio de la orden |
| **I** líneas de la orden | VALIDAS, SIN_LINEAS, CANTIDAD_CERO, PRECIO_NEGATIVO, PRECIO_CERO, SIN_PRECIO, PRODUCTO_REPETIDO | Cantidad mayor que cero; precio vacío o mayor o igual que cero; un producto una sola vez |
| **F** entrega prevista al crear | SIN_ENTREGA, ENTREGA_VALIDA, ENTREGA_ANTERIOR, ENTREGA_INVALIDA | Vacía, un día real no anterior a hoy, anterior a hoy, o no es un día |
| **E** estado de la orden | BORRADOR, PEDIDA, CERRADA, ANULADA | `OrdenDeCompra.estado` (CHECK de la base y `ESTADOS_DE_ORDEN`) |
| **L** líneas que no se retiraron | CON_LINEAS, SIN_LINEAS | Cantidad de líneas vigentes de la orden al pedir |
| **D** entrega prevista al pedir | SIN_ENTREGA, ENTREGA_HOY_O_FUTURA, ENTREGA_ANTERIOR | Contra el día del pedido (hora argentina) |
| **V** compras vigentes contra la orden | SIN_COMPRAS_VIGENTES, CON_COMPRAS_VIGENTES | Facturas no anuladas con renglones vinculados a la orden |
| **T** motivo de la anulación | MOTIVO_VALIDO, MOTIVO_VACIO, MOTIVO_INVALIDO | Lista de caracteres permitidos, una línea, hasta 500 |
| **W** compras pendientes de recibir contra la orden | SIN_COMPRAS_PENDIENTES, CON_COMPRAS_PENDIENTES | Partes en estado PENDIENTE con renglones vinculados |
| **Y** proveedor de la compra frente a la orden | MISMO_PROVEEDOR, PROVEEDOR_DISTINTO | Proveedor de la factura contra el de la orden |
| **G** línea de la orden | LINEA_VIGENTE, LINEA_RETIRADA | `LineaDeOrdenDeCompra.retirada` |
| **H** producto del renglón frente a la línea | MISMO_PRODUCTO, PRODUCTO_DISTINTO | Producto del renglón contra el de la línea |
| **N** nivel del control de exceso | SIN_FILA, PERMITIR, AVISAR, BLOQUEAR | `NivelDeControl.nivel` (CHECK de la base); sin fila vale PERMITIR |
| **X** confirmación del exceso | CONFIRMO_EXCESO, NO_CONFIRMO | `VinculoDeRenglonConOrden.confirmoExceso` |
| **Z** cantidad frente a lo pedido | DENTRO_DE_LO_PEDIDO, EXCEDE_LO_PEDIDO | Lo ya recibido más lo de este renglón contra lo pedido en la línea |
| **K** renglón frente al control de la recepción | RENGLON_ACEPTADO, RENGLON_RECHAZADO | Condición del control por línea (N3-b): RECHAZADA no suma a la orden |

## Dimensiones que NO cambian el resultado

| Dimensión | Por qué no afecta |
|---|---|
| Sucursal destino de la orden | Es opcional e informativa (como Pedernal): no cambia ninguna regla de pedir, anular, cerrar ni recibir. |
| Precio de la línea | Solo se guarda (no hay tres vías en esta etapa): cambia lo que se muestra, no si se puede pedir, anular, cerrar o recibir. |
| Cantidad de líneas (más de una) | Cada línea se valida igual; el resultado depende de si hay al menos una (L) y de cada regla por línea (I). |
| Quién crea o pide la orden | Mientras alcance el piso (A × O), el resultado no depende de la persona; sí queda su nombre en el registro. |
| Reparto de la compra o condición de pago | Se carga contra una orden solo una compra de una parte propia pendiente de recibir; el pago no participa. |
## Puerta de las acciones de la orden

Quién puede qué. Orden de las razones: módulo `ordenes_de_compra` apagado → el rol no llega al piso de la acción. `GESTIONAR` (`orden_de_compra_gestionar`: crear, pedir, anular y cerrar) y `CONFIGURAR` (`compras_configurar`) son de piso administrador: el operador queda rechazado en el servidor. `VER` (`orden_de_compra_ver`) es de piso operario (solo lectura).

| A | M | O | Resultado |
|---|---|---|---|
| GESTIONAR | APAGADO | OPERADOR | RECHAZA_MODULO_NO_ACTIVO |
| GESTIONAR | APAGADO | ADMINISTRADOR | RECHAZA_MODULO_NO_ACTIVO |
| GESTIONAR | APAGADO | GERENTE | RECHAZA_MODULO_NO_ACTIVO |
| GESTIONAR | ENCENDIDO | OPERADOR | RECHAZA_SIN_PERMISO |
| GESTIONAR | ENCENDIDO | ADMINISTRADOR | PERMITE |
| GESTIONAR | ENCENDIDO | GERENTE | PERMITE |
| CONFIGURAR | APAGADO | OPERADOR | RECHAZA_MODULO_NO_ACTIVO |
| CONFIGURAR | APAGADO | ADMINISTRADOR | RECHAZA_MODULO_NO_ACTIVO |
| CONFIGURAR | APAGADO | GERENTE | RECHAZA_MODULO_NO_ACTIVO |
| CONFIGURAR | ENCENDIDO | OPERADOR | RECHAZA_SIN_PERMISO |
| CONFIGURAR | ENCENDIDO | ADMINISTRADOR | PERMITE |
| CONFIGURAR | ENCENDIDO | GERENTE | PERMITE |
| VER | APAGADO | OPERADOR | RECHAZA_MODULO_NO_ACTIVO |
| VER | APAGADO | ADMINISTRADOR | RECHAZA_MODULO_NO_ACTIVO |
| VER | APAGADO | GERENTE | RECHAZA_MODULO_NO_ACTIVO |
| VER | ENCENDIDO | OPERADOR | PERMITE |
| VER | ENCENDIDO | ADMINISTRADOR | PERMITE |
| VER | ENCENDIDO | GERENTE | PERMITE |

## Datos de una orden nueva

Qué datos sirven para crear la orden (BORRADOR). Orden de las razones: proveedor → al menos una línea → cada línea (producto, cantidad mayor que cero, precio vacío o mayor o igual que cero, producto no repetido) → entrega prevista (vacía, o un día real no anterior a hoy). La sucursal destino es OPCIONAL y no cambia el resultado. «Precio cero» es un precio (como Pedernal 0066).

| P | I | F | Resultado |
|---|---|---|---|
| CON_PROVEEDOR | VALIDAS | SIN_ENTREGA | ACEPTA |
| CON_PROVEEDOR | VALIDAS | ENTREGA_VALIDA | ACEPTA |
| CON_PROVEEDOR | VALIDAS | ENTREGA_ANTERIOR | RECHAZA_ENTREGA_ANTERIOR_A_HOY |
| CON_PROVEEDOR | VALIDAS | ENTREGA_INVALIDA | RECHAZA_ENTREGA_INVALIDA |
| CON_PROVEEDOR | SIN_LINEAS | SIN_ENTREGA | RECHAZA_SIN_LINEAS |
| CON_PROVEEDOR | SIN_LINEAS | ENTREGA_VALIDA | RECHAZA_SIN_LINEAS |
| CON_PROVEEDOR | SIN_LINEAS | ENTREGA_ANTERIOR | RECHAZA_SIN_LINEAS |
| CON_PROVEEDOR | SIN_LINEAS | ENTREGA_INVALIDA | RECHAZA_SIN_LINEAS |
| CON_PROVEEDOR | CANTIDAD_CERO | SIN_ENTREGA | RECHAZA_CANTIDAD_INVALIDA |
| CON_PROVEEDOR | CANTIDAD_CERO | ENTREGA_VALIDA | RECHAZA_CANTIDAD_INVALIDA |
| CON_PROVEEDOR | CANTIDAD_CERO | ENTREGA_ANTERIOR | RECHAZA_CANTIDAD_INVALIDA |
| CON_PROVEEDOR | CANTIDAD_CERO | ENTREGA_INVALIDA | RECHAZA_CANTIDAD_INVALIDA |
| CON_PROVEEDOR | PRECIO_NEGATIVO | SIN_ENTREGA | RECHAZA_PRECIO_INVALIDO |
| CON_PROVEEDOR | PRECIO_NEGATIVO | ENTREGA_VALIDA | RECHAZA_PRECIO_INVALIDO |
| CON_PROVEEDOR | PRECIO_NEGATIVO | ENTREGA_ANTERIOR | RECHAZA_PRECIO_INVALIDO |
| CON_PROVEEDOR | PRECIO_NEGATIVO | ENTREGA_INVALIDA | RECHAZA_PRECIO_INVALIDO |
| CON_PROVEEDOR | PRECIO_CERO | SIN_ENTREGA | ACEPTA |
| CON_PROVEEDOR | PRECIO_CERO | ENTREGA_VALIDA | ACEPTA |
| CON_PROVEEDOR | PRECIO_CERO | ENTREGA_ANTERIOR | RECHAZA_ENTREGA_ANTERIOR_A_HOY |
| CON_PROVEEDOR | PRECIO_CERO | ENTREGA_INVALIDA | RECHAZA_ENTREGA_INVALIDA |
| CON_PROVEEDOR | SIN_PRECIO | SIN_ENTREGA | ACEPTA |
| CON_PROVEEDOR | SIN_PRECIO | ENTREGA_VALIDA | ACEPTA |
| CON_PROVEEDOR | SIN_PRECIO | ENTREGA_ANTERIOR | RECHAZA_ENTREGA_ANTERIOR_A_HOY |
| CON_PROVEEDOR | SIN_PRECIO | ENTREGA_INVALIDA | RECHAZA_ENTREGA_INVALIDA |
| CON_PROVEEDOR | PRODUCTO_REPETIDO | SIN_ENTREGA | RECHAZA_PRODUCTO_REPETIDO |
| CON_PROVEEDOR | PRODUCTO_REPETIDO | ENTREGA_VALIDA | RECHAZA_PRODUCTO_REPETIDO |
| CON_PROVEEDOR | PRODUCTO_REPETIDO | ENTREGA_ANTERIOR | RECHAZA_PRODUCTO_REPETIDO |
| CON_PROVEEDOR | PRODUCTO_REPETIDO | ENTREGA_INVALIDA | RECHAZA_PRODUCTO_REPETIDO |
| SIN_PROVEEDOR | VALIDAS | SIN_ENTREGA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | VALIDAS | ENTREGA_VALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | VALIDAS | ENTREGA_ANTERIOR | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | VALIDAS | ENTREGA_INVALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | SIN_LINEAS | SIN_ENTREGA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | SIN_LINEAS | ENTREGA_VALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | SIN_LINEAS | ENTREGA_ANTERIOR | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | SIN_LINEAS | ENTREGA_INVALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | CANTIDAD_CERO | SIN_ENTREGA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | CANTIDAD_CERO | ENTREGA_VALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | CANTIDAD_CERO | ENTREGA_ANTERIOR | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | CANTIDAD_CERO | ENTREGA_INVALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRECIO_NEGATIVO | SIN_ENTREGA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRECIO_NEGATIVO | ENTREGA_VALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRECIO_NEGATIVO | ENTREGA_ANTERIOR | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRECIO_NEGATIVO | ENTREGA_INVALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRECIO_CERO | SIN_ENTREGA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRECIO_CERO | ENTREGA_VALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRECIO_CERO | ENTREGA_ANTERIOR | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRECIO_CERO | ENTREGA_INVALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | SIN_PRECIO | SIN_ENTREGA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | SIN_PRECIO | ENTREGA_VALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | SIN_PRECIO | ENTREGA_ANTERIOR | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | SIN_PRECIO | ENTREGA_INVALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRODUCTO_REPETIDO | SIN_ENTREGA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRODUCTO_REPETIDO | ENTREGA_VALIDA | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRODUCTO_REPETIDO | ENTREGA_ANTERIOR | RECHAZA_SIN_PROVEEDOR |
| SIN_PROVEEDOR | PRODUCTO_REPETIDO | ENTREGA_INVALIDA | RECHAZA_SIN_PROVEEDOR |

## Pedir la orden

Pedir pasa BORRADOR a PEDIDA (con su número). Orden de las razones: ya pedida → anulada → cerrada → sin líneas que no se retiraron → entrega prevista anterior al día del pedido. Pedir dos veces da «ya pedida», sin otro número.

| E | L | D | Resultado |
|---|---|---|---|
| BORRADOR | CON_LINEAS | SIN_ENTREGA | PIDE |
| BORRADOR | CON_LINEAS | ENTREGA_HOY_O_FUTURA | PIDE |
| BORRADOR | CON_LINEAS | ENTREGA_ANTERIOR | RECHAZA_ENTREGA_ANTERIOR_AL_PEDIDO |
| BORRADOR | SIN_LINEAS | SIN_ENTREGA | RECHAZA_SIN_LINEAS |
| BORRADOR | SIN_LINEAS | ENTREGA_HOY_O_FUTURA | RECHAZA_SIN_LINEAS |
| BORRADOR | SIN_LINEAS | ENTREGA_ANTERIOR | RECHAZA_SIN_LINEAS |
| PEDIDA | CON_LINEAS | SIN_ENTREGA | RECHAZA_YA_PEDIDA |
| PEDIDA | CON_LINEAS | ENTREGA_HOY_O_FUTURA | RECHAZA_YA_PEDIDA |
| PEDIDA | CON_LINEAS | ENTREGA_ANTERIOR | RECHAZA_YA_PEDIDA |
| PEDIDA | SIN_LINEAS | SIN_ENTREGA | RECHAZA_YA_PEDIDA |
| PEDIDA | SIN_LINEAS | ENTREGA_HOY_O_FUTURA | RECHAZA_YA_PEDIDA |
| PEDIDA | SIN_LINEAS | ENTREGA_ANTERIOR | RECHAZA_YA_PEDIDA |
| CERRADA | CON_LINEAS | SIN_ENTREGA | RECHAZA_ORDEN_CERRADA |
| CERRADA | CON_LINEAS | ENTREGA_HOY_O_FUTURA | RECHAZA_ORDEN_CERRADA |
| CERRADA | CON_LINEAS | ENTREGA_ANTERIOR | RECHAZA_ORDEN_CERRADA |
| CERRADA | SIN_LINEAS | SIN_ENTREGA | RECHAZA_ORDEN_CERRADA |
| CERRADA | SIN_LINEAS | ENTREGA_HOY_O_FUTURA | RECHAZA_ORDEN_CERRADA |
| CERRADA | SIN_LINEAS | ENTREGA_ANTERIOR | RECHAZA_ORDEN_CERRADA |
| ANULADA | CON_LINEAS | SIN_ENTREGA | RECHAZA_ORDEN_ANULADA |
| ANULADA | CON_LINEAS | ENTREGA_HOY_O_FUTURA | RECHAZA_ORDEN_ANULADA |
| ANULADA | CON_LINEAS | ENTREGA_ANTERIOR | RECHAZA_ORDEN_ANULADA |
| ANULADA | SIN_LINEAS | SIN_ENTREGA | RECHAZA_ORDEN_ANULADA |
| ANULADA | SIN_LINEAS | ENTREGA_HOY_O_FUTURA | RECHAZA_ORDEN_ANULADA |
| ANULADA | SIN_LINEAS | ENTREGA_ANTERIOR | RECHAZA_ORDEN_ANULADA |

## Anular la orden

Anular (BORRADOR o PEDIDA) con motivo. Orden de las razones: ya anulada → cerrada (es final) → hay compras vigentes (pendientes o recibidas, de facturas no anuladas) cargadas contra ella → motivo vacío → motivo con caracteres no permitidos. Anular dos veces da «ya anulada».

| E | V | T | Resultado |
|---|---|---|---|
| BORRADOR | SIN_COMPRAS_VIGENTES | MOTIVO_VALIDO | ANULA |
| BORRADOR | SIN_COMPRAS_VIGENTES | MOTIVO_VACIO | RECHAZA_MOTIVO_OBLIGATORIO |
| BORRADOR | SIN_COMPRAS_VIGENTES | MOTIVO_INVALIDO | RECHAZA_MOTIVO_INVALIDO |
| BORRADOR | CON_COMPRAS_VIGENTES | MOTIVO_VALIDO | RECHAZA_CON_RECEPCIONES |
| BORRADOR | CON_COMPRAS_VIGENTES | MOTIVO_VACIO | RECHAZA_CON_RECEPCIONES |
| BORRADOR | CON_COMPRAS_VIGENTES | MOTIVO_INVALIDO | RECHAZA_CON_RECEPCIONES |
| PEDIDA | SIN_COMPRAS_VIGENTES | MOTIVO_VALIDO | ANULA |
| PEDIDA | SIN_COMPRAS_VIGENTES | MOTIVO_VACIO | RECHAZA_MOTIVO_OBLIGATORIO |
| PEDIDA | SIN_COMPRAS_VIGENTES | MOTIVO_INVALIDO | RECHAZA_MOTIVO_INVALIDO |
| PEDIDA | CON_COMPRAS_VIGENTES | MOTIVO_VALIDO | RECHAZA_CON_RECEPCIONES |
| PEDIDA | CON_COMPRAS_VIGENTES | MOTIVO_VACIO | RECHAZA_CON_RECEPCIONES |
| PEDIDA | CON_COMPRAS_VIGENTES | MOTIVO_INVALIDO | RECHAZA_CON_RECEPCIONES |
| CERRADA | SIN_COMPRAS_VIGENTES | MOTIVO_VALIDO | RECHAZA_ORDEN_CERRADA |
| CERRADA | SIN_COMPRAS_VIGENTES | MOTIVO_VACIO | RECHAZA_ORDEN_CERRADA |
| CERRADA | SIN_COMPRAS_VIGENTES | MOTIVO_INVALIDO | RECHAZA_ORDEN_CERRADA |
| CERRADA | CON_COMPRAS_VIGENTES | MOTIVO_VALIDO | RECHAZA_ORDEN_CERRADA |
| CERRADA | CON_COMPRAS_VIGENTES | MOTIVO_VACIO | RECHAZA_ORDEN_CERRADA |
| CERRADA | CON_COMPRAS_VIGENTES | MOTIVO_INVALIDO | RECHAZA_ORDEN_CERRADA |
| ANULADA | SIN_COMPRAS_VIGENTES | MOTIVO_VALIDO | RECHAZA_ORDEN_ANULADA |
| ANULADA | SIN_COMPRAS_VIGENTES | MOTIVO_VACIO | RECHAZA_ORDEN_ANULADA |
| ANULADA | SIN_COMPRAS_VIGENTES | MOTIVO_INVALIDO | RECHAZA_ORDEN_ANULADA |
| ANULADA | CON_COMPRAS_VIGENTES | MOTIVO_VALIDO | RECHAZA_ORDEN_ANULADA |
| ANULADA | CON_COMPRAS_VIGENTES | MOTIVO_VACIO | RECHAZA_ORDEN_ANULADA |
| ANULADA | CON_COMPRAS_VIGENTES | MOTIVO_INVALIDO | RECHAZA_ORDEN_ANULADA |

## Cerrar la orden

Cerrar es siempre a mano (no hay cierre automático, como Pedernal) y solo una orden PEDIDA sin compras pendientes de recibir contra ella. Orden de las razones: ya cerrada → anulada → no está pedida (un borrador se anula) → compras pendientes de recibir.

| E | W | Resultado |
|---|---|---|
| BORRADOR | SIN_COMPRAS_PENDIENTES | RECHAZA_NO_ESTA_PEDIDA |
| BORRADOR | CON_COMPRAS_PENDIENTES | RECHAZA_NO_ESTA_PEDIDA |
| PEDIDA | SIN_COMPRAS_PENDIENTES | CIERRA |
| PEDIDA | CON_COMPRAS_PENDIENTES | RECHAZA_CON_RECEPCIONES_PENDIENTES |
| CERRADA | SIN_COMPRAS_PENDIENTES | RECHAZA_ORDEN_CERRADA |
| CERRADA | CON_COMPRAS_PENDIENTES | RECHAZA_ORDEN_CERRADA |
| ANULADA | SIN_COMPRAS_PENDIENTES | RECHAZA_ORDEN_ANULADA |
| ANULADA | CON_COMPRAS_PENDIENTES | RECHAZA_ORDEN_ANULADA |

## Vincular un renglón con una línea de la orden

Al cargar una compra contra una orden. Orden de las razones: la orden no está pedida → proveedor distinto → línea retirada → producto distinto. El exceso se decide en la tabla siguiente (acá la cantidad está dentro de lo pedido).

| E | Y | G | H | Resultado |
|---|---|---|---|---|
| BORRADOR | MISMO_PROVEEDOR | LINEA_VIGENTE | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| BORRADOR | MISMO_PROVEEDOR | LINEA_VIGENTE | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |
| BORRADOR | MISMO_PROVEEDOR | LINEA_RETIRADA | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| BORRADOR | MISMO_PROVEEDOR | LINEA_RETIRADA | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |
| BORRADOR | PROVEEDOR_DISTINTO | LINEA_VIGENTE | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| BORRADOR | PROVEEDOR_DISTINTO | LINEA_VIGENTE | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |
| BORRADOR | PROVEEDOR_DISTINTO | LINEA_RETIRADA | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| BORRADOR | PROVEEDOR_DISTINTO | LINEA_RETIRADA | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |
| PEDIDA | MISMO_PROVEEDOR | LINEA_VIGENTE | MISMO_PRODUCTO | VINCULA |
| PEDIDA | MISMO_PROVEEDOR | LINEA_VIGENTE | PRODUCTO_DISTINTO | RECHAZA_PRODUCTO_DISTINTO |
| PEDIDA | MISMO_PROVEEDOR | LINEA_RETIRADA | MISMO_PRODUCTO | RECHAZA_LINEA_RETIRADA |
| PEDIDA | MISMO_PROVEEDOR | LINEA_RETIRADA | PRODUCTO_DISTINTO | RECHAZA_LINEA_RETIRADA |
| PEDIDA | PROVEEDOR_DISTINTO | LINEA_VIGENTE | MISMO_PRODUCTO | RECHAZA_PROVEEDOR_DISTINTO |
| PEDIDA | PROVEEDOR_DISTINTO | LINEA_VIGENTE | PRODUCTO_DISTINTO | RECHAZA_PROVEEDOR_DISTINTO |
| PEDIDA | PROVEEDOR_DISTINTO | LINEA_RETIRADA | MISMO_PRODUCTO | RECHAZA_PROVEEDOR_DISTINTO |
| PEDIDA | PROVEEDOR_DISTINTO | LINEA_RETIRADA | PRODUCTO_DISTINTO | RECHAZA_PROVEEDOR_DISTINTO |
| CERRADA | MISMO_PROVEEDOR | LINEA_VIGENTE | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| CERRADA | MISMO_PROVEEDOR | LINEA_VIGENTE | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |
| CERRADA | MISMO_PROVEEDOR | LINEA_RETIRADA | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| CERRADA | MISMO_PROVEEDOR | LINEA_RETIRADA | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |
| CERRADA | PROVEEDOR_DISTINTO | LINEA_VIGENTE | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| CERRADA | PROVEEDOR_DISTINTO | LINEA_VIGENTE | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |
| CERRADA | PROVEEDOR_DISTINTO | LINEA_RETIRADA | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| CERRADA | PROVEEDOR_DISTINTO | LINEA_RETIRADA | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |
| ANULADA | MISMO_PROVEEDOR | LINEA_VIGENTE | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| ANULADA | MISMO_PROVEEDOR | LINEA_VIGENTE | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |
| ANULADA | MISMO_PROVEEDOR | LINEA_RETIRADA | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| ANULADA | MISMO_PROVEEDOR | LINEA_RETIRADA | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |
| ANULADA | PROVEEDOR_DISTINTO | LINEA_VIGENTE | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| ANULADA | PROVEEDOR_DISTINTO | LINEA_VIGENTE | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |
| ANULADA | PROVEEDOR_DISTINTO | LINEA_RETIRADA | MISMO_PRODUCTO | RECHAZA_ORDEN_NO_PEDIDA |
| ANULADA | PROVEEDOR_DISTINTO | LINEA_RETIRADA | PRODUCTO_DISTINTO | RECHAZA_ORDEN_NO_PEDIDA |

## Control de exceso contra la orden

Control `compras.recepcion_excede_la_orden`, idéntico a Pedernal 0066. SIN_FILA es lo mismo que PERMITIR (el exceso pasa). BLOQUEAR frena todo exceso; AVISAR lo frena salvo que se confirme el exceso; PERMITIR no frena. Un renglón RECHAZADO por el control de la recepción no cuenta contra la orden: no suma al saldo, así que no se le aplica el tope.

| N | X | Z | K | Resultado |
|---|---|---|---|---|
| SIN_FILA | CONFIRMO_EXCESO | DENTRO_DE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| SIN_FILA | CONFIRMO_EXCESO | DENTRO_DE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| SIN_FILA | CONFIRMO_EXCESO | EXCEDE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| SIN_FILA | CONFIRMO_EXCESO | EXCEDE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| SIN_FILA | NO_CONFIRMO | DENTRO_DE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| SIN_FILA | NO_CONFIRMO | DENTRO_DE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| SIN_FILA | NO_CONFIRMO | EXCEDE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| SIN_FILA | NO_CONFIRMO | EXCEDE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| PERMITIR | CONFIRMO_EXCESO | DENTRO_DE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| PERMITIR | CONFIRMO_EXCESO | DENTRO_DE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| PERMITIR | CONFIRMO_EXCESO | EXCEDE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| PERMITIR | CONFIRMO_EXCESO | EXCEDE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| PERMITIR | NO_CONFIRMO | DENTRO_DE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| PERMITIR | NO_CONFIRMO | DENTRO_DE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| PERMITIR | NO_CONFIRMO | EXCEDE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| PERMITIR | NO_CONFIRMO | EXCEDE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| AVISAR | CONFIRMO_EXCESO | DENTRO_DE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| AVISAR | CONFIRMO_EXCESO | DENTRO_DE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| AVISAR | CONFIRMO_EXCESO | EXCEDE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| AVISAR | CONFIRMO_EXCESO | EXCEDE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| AVISAR | NO_CONFIRMO | DENTRO_DE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| AVISAR | NO_CONFIRMO | DENTRO_DE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| AVISAR | NO_CONFIRMO | EXCEDE_LO_PEDIDO | RENGLON_ACEPTADO | SIN_CONFIRMAR |
| AVISAR | NO_CONFIRMO | EXCEDE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| BLOQUEAR | CONFIRMO_EXCESO | DENTRO_DE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| BLOQUEAR | CONFIRMO_EXCESO | DENTRO_DE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| BLOQUEAR | CONFIRMO_EXCESO | EXCEDE_LO_PEDIDO | RENGLON_ACEPTADO | BLOQUEADA |
| BLOQUEAR | CONFIRMO_EXCESO | EXCEDE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| BLOQUEAR | NO_CONFIRMO | DENTRO_DE_LO_PEDIDO | RENGLON_ACEPTADO | PASA |
| BLOQUEAR | NO_CONFIRMO | DENTRO_DE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |
| BLOQUEAR | NO_CONFIRMO | EXCEDE_LO_PEDIDO | RENGLON_ACEPTADO | BLOQUEADA |
| BLOQUEAR | NO_CONFIRMO | EXCEDE_LO_PEDIDO | RENGLON_RECHAZADO | PASA |

## Entradas de las reglas y su efecto

Cada entrada de las reglas puras declara la dimensión a la que responde o «no afecta» con su motivo. Una entrada nueva obliga a decidir acá si cambia el resultado.

| Regla | Entrada | Efecto |
|---|---|---|
| validarDatosDeOrden | proveedorId | P |
| validarDatosDeOrden | sucursalId | no afecta: la sucursal destino es opcional e informativa |
| validarDatosDeOrden | fechaDeEntregaPrevista | F |
| validarDatosDeOrden | lineas | I |
| validarDatosDeOrden | hoy | F |
| decidirPedirOrden | estado | E |
| decidirPedirOrden | lineasNoRetiradas | L |
| decidirPedirOrden | fechaDeEntregaPrevista | D |
| decidirPedirOrden | hoy | D |
| decidirAnularOrden | estado | E |
| decidirAnularOrden | hayRecepcionesVigentes | V |
| decidirAnularOrden | motivo | T |
| decidirCerrarOrden | estado | E |
| decidirCerrarOrden | hayRecepcionesPendientes | W |
| decidirVinculoConOrden | estadoDeLaOrden | E |
| decidirVinculoConOrden | mismoProveedor | Y |
| decidirVinculoConOrden | lineaRetirada | G |
| decidirVinculoConOrden | mismoProducto | H |
| decidirVinculoConOrden | nivel | N |
| decidirVinculoConOrden | confirmoExceso | X |
| decidirVinculoConOrden | recibidaHasta | Z |
| decidirVinculoConOrden | cantidad | Z |
| decidirVinculoConOrden | pedida | Z |
| decidirExcesoContraLaOrden | nivel | N |
| decidirExcesoContraLaOrden | confirmoExceso | X |
| decidirExcesoContraLaOrden | recibidaHasta | Z |
| decidirExcesoContraLaOrden | cantidad | Z |
| decidirExcesoContraLaOrden | pedida | Z |
| decidirExcesoContraLaOrden | rechazadoPorElControl | K |

## Columnas de las tablas de la orden y su efecto

Cada columna (no relación) de `OrdenDeCompra`, `LineaDeOrdenDeCompra`, `SaldoDeLineaDeOrden`, `VinculoDeRenglonConOrden` y `NivelDeControl` declara la dimensión a la que responde o «no afecta» con su motivo. Una columna nueva obliga a decidir acá si cambia el resultado.

| Columna | Efecto |
|---|---|
| OrdenDeCompra.id | no afecta: identificador |
| OrdenDeCompra.empresaId | no afecta: aislamiento por empresa (RLS), no una regla de negocio |
| OrdenDeCompra.numero | no afecta: lo asigna la base al pedir (correlativo por empresa), no decide ninguna regla |
| OrdenDeCompra.proveedorId | Y |
| OrdenDeCompra.sucursalId | no afecta: sucursal destino opcional e informativa |
| OrdenDeCompra.fechaDeEntregaPrevista | D |
| OrdenDeCompra.estado | E |
| OrdenDeCompra.cierreMotivo | no afecta: lo calcula la base al cerrar y solo informa (COMPLETA o CON_SALDO) |
| OrdenDeCompra.claveIdempotencia | no afecta: reintento seguro, no una regla |
| OrdenDeCompra.payloadHash | no afecta: huella del pedido para la idempotencia |
| OrdenDeCompra.creadoPorId | no afecta: quién, no cambia el resultado |
| OrdenDeCompra.creadoEn | no afecta: cuándo |
| OrdenDeCompra.pedidaPorId | no afecta: quién |
| OrdenDeCompra.pedidaEn | no afecta: cuándo |
| OrdenDeCompra.fechaDeNegocio | D |
| OrdenDeCompra.cerradaPorId | no afecta: quién |
| OrdenDeCompra.cerradaEn | no afecta: cuándo |
| OrdenDeCompra.anuladaPorId | no afecta: quién |
| OrdenDeCompra.anuladaEn | no afecta: cuándo |
| OrdenDeCompra.motivoDeAnulacion | T |
| OrdenDeCompra.actualizadoEn | no afecta: marca de tiempo |
| OrdenDeCompra.version | no afecta: contador de cambios |
| LineaDeOrdenDeCompra.id | no afecta: identificador |
| LineaDeOrdenDeCompra.empresaId | no afecta: aislamiento por empresa (RLS) |
| LineaDeOrdenDeCompra.ordenId | no afecta: pertenencia a la orden |
| LineaDeOrdenDeCompra.numero | no afecta: posición de la línea en la orden |
| LineaDeOrdenDeCompra.productoId | H |
| LineaDeOrdenDeCompra.cantidadPedida | Z |
| LineaDeOrdenDeCompra.precioPorUnidadStock | no afecta: precio informativo (sin tres vías en esta etapa) |
| LineaDeOrdenDeCompra.retirada | G |
| SaldoDeLineaDeOrden.id | no afecta: identificador |
| SaldoDeLineaDeOrden.empresaId | no afecta: aislamiento por empresa (RLS) |
| SaldoDeLineaDeOrden.ordenId | no afecta: pertenencia a la orden |
| SaldoDeLineaDeOrden.linea | no afecta: número de la línea |
| SaldoDeLineaDeOrden.cantidadPedida | Z |
| SaldoDeLineaDeOrden.cantidadRecibida | Z |
| SaldoDeLineaDeOrden.actualizadoEn | no afecta: marca de tiempo |
| VinculoDeRenglonConOrden.id | no afecta: identificador |
| VinculoDeRenglonConOrden.empresaId | no afecta: aislamiento por empresa (RLS) |
| VinculoDeRenglonConOrden.facturaProveedorId | no afecta: pertenencia a la compra |
| VinculoDeRenglonConOrden.facturaProveedorSucursalId | no afecta: pertenencia a la parte |
| VinculoDeRenglonConOrden.facturaProveedorRenglonId | no afecta: el renglón vinculado |
| VinculoDeRenglonConOrden.ordenId | no afecta: la orden vinculada |
| VinculoDeRenglonConOrden.lineaDeOrden | no afecta: la línea vinculada |
| VinculoDeRenglonConOrden.confirmoExceso | X |
| VinculoDeRenglonConOrden.registradoPorId | no afecta: quién |
| VinculoDeRenglonConOrden.registradoEn | no afecta: cuándo |
| NivelDeControl.id | no afecta: identificador |
| NivelDeControl.empresaId | no afecta: aislamiento por empresa (RLS) |
| NivelDeControl.control | no afecta: hoy hay un solo control (`compras.recepcion_excede_la_orden`, fijado por el CHECK de la base) |
| NivelDeControl.nivel | N |
| NivelDeControl.actualizadoPorId | no afecta: quién |
| NivelDeControl.actualizadoEn | no afecta: cuándo |
| NivelDeControl.version | no afecta: contador de cambios |

## Estados y reglas que el código declara

Los estados de la orden son exactamente BORRADOR, PEDIDA, CERRADA y ANULADA (CHECK `OrdenDeCompra_estado_chk`); los niveles del control, PERMITIR, AVISAR y BLOQUEAR (la dimensión N suma SIN_FILA, que vale PERMITIR); los motivos de cierre, COMPLETA y CON_SALDO. El módulo `ordenes_de_compra` es vendible y requiere `recepcion_de_compras`. Las acciones `orden_de_compra_gestionar` y `compras_configurar` son del módulo, de la empresa y de piso administrador (semilla admin); `orden_de_compra_ver` es del módulo, de la empresa, de piso operario y solo lectura (semilla admin y operador): así lo verifica el guardián.
