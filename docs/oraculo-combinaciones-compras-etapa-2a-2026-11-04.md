# Oráculo de combinaciones: unidad de compra y cantidad real (Compras, etapa 2a, 2026-11-04)

Tabla de reglas esperadas escrita APARTE del código (regla del dueño del 2026-10-28, «Combinaciones»). La recorre el test
`test/movimientos/combinaciones-unidad-de-compra.test.ts` contra la base real y un guardián (`test/arquitectura/combinaciones-unidad-de-compra-declaradas.test.ts`) falla si aparece una dimensión nueva sin declarar.
Diseño: `docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md` §6 (fila 2a), §14.1 y §14.2 (puntos 1 y 2).

## Dimensiones que cambian el resultado (dinero, stock, permisos o lo que se ve)

| Dimensión | Valores | Qué representa |
|---|---|---|
| **U** unidad de compra | `IGUAL_A_STOCK` · `DISTINTA_DE_STOCK` | Se compra en la misma unidad en que se lleva el stock (kg y kg, factor 1), o en otra (g, caja…) con su factor |
| **M** magnitud | `IGUAL` · `DISTINTA` | El tipo de la unidad de compra (`Unidad.magnitud`: peso, volumen, cantidad) es el mismo que el de stock (kg→g) o cruza de tipo (caja→kg) |
| **R** cantidad real (peso real) | `SIN` · `CON` | Quien carga deja vacía la cantidad real, o escribe una |
| **F** forma de la compra | `COMPRA_SIMPLE` · `FACTURA_REPARTIDA` | Una compra simple (`Operacion` + `MovimientoStock`) o una factura repartida (renglón de factura + sus partes) |
| **T** envío | `PRIMERO` · `REINTENTO` | La primera vez que llega el pedido, o la misma clave de reintento enviada otra vez (clic doble, corte de red) |

`U = IGUAL_A_STOCK` con `M = DISTINTA` es IMPOSIBLE: la misma unidad es del mismo tipo.

## Regla (el resultado esperado de cada combinación)

1. **Rechaza** (`LINEA_INVALIDA`, mensaje que dice que la cantidad real no se carga porque la conversión es exacta) si y solo si `R = CON` **y** `M = IGUAL`: con el mismo tipo la conversión es exacta y una cantidad real sería una segunda fuente de verdad (§14.2 punto 2, CONFIRMADA). No escribe nada (ni Operación, ni Kardex, ni factura, ni vínculo), sea cual sea `U`, `F` y `T`; un reintento se rechaza igual.
2. **Acepta** en cualquier otro caso. Lo que guarda:
   - **La unidad de compra y lo comprado, tal como se tecleó**: `unidadCompraId` = la unidad en que se compró (la del producto o la de la presentación elegida; si el producto no tiene otra, su unidad de stock) y `cantidadCompra` = cuántas (por ejemplo 3 cajas, 5000 g, 10 kg), SIEMPRE, con o sin cantidad real y con o sin conversión.
   - **Dónde**: `F = COMPRA_SIMPLE` → en la línea del Kardex (`MovimientoStock`). `F = FACTURA_REPARTIDA` → en el renglón de la factura (`FacturaProveedorRenglon`); las partes (`MovimientoStock`) quedan en NULL y se leen del renglón.
   - **El stock y el dinero NO cambian**: la cantidad que entra al stock sigue siendo la de siempre (cantidad × factor, o la cantidad real cuando `R = CON` y `M = DISTINTA`), y el importe y el precio por unidad de stock no se tocan.
3. **T no cambia la regla**: un reintento con la misma clave devuelve el resultado ya guardado (`repetida`) y NO vuelve a escribir: una sola operación, las mismas filas, la misma unidad y cantidad. Un reintento de un rechazo se rechaza igual.
4. **NULL = «pendiente de completar»**: lo cargado antes de esta migración, la devolución a proveedor y todo proceso que no es una compra quedan sin unidad ni cantidad (nunca se inventan). Las dos columnas van juntas y la cantidad es mayor que cero (lo exige la base).

## Enumeración (32 combinaciones)

| U | M | R | F | T | Resultado |
|---|---|---|---|---|---|
| IGUAL_A_STOCK | IGUAL | SIN | COMPRA_SIMPLE | PRIMERO | ACEPTA |
| IGUAL_A_STOCK | IGUAL | SIN | COMPRA_SIMPLE | REINTENTO | ACEPTA |
| IGUAL_A_STOCK | IGUAL | SIN | FACTURA_REPARTIDA | PRIMERO | ACEPTA |
| IGUAL_A_STOCK | IGUAL | SIN | FACTURA_REPARTIDA | REINTENTO | ACEPTA |
| IGUAL_A_STOCK | IGUAL | CON | COMPRA_SIMPLE | PRIMERO | RECHAZA |
| IGUAL_A_STOCK | IGUAL | CON | COMPRA_SIMPLE | REINTENTO | RECHAZA |
| IGUAL_A_STOCK | IGUAL | CON | FACTURA_REPARTIDA | PRIMERO | RECHAZA |
| IGUAL_A_STOCK | IGUAL | CON | FACTURA_REPARTIDA | REINTENTO | RECHAZA |
| IGUAL_A_STOCK | DISTINTA | SIN | COMPRA_SIMPLE | PRIMERO | IMPOSIBLE |
| IGUAL_A_STOCK | DISTINTA | SIN | COMPRA_SIMPLE | REINTENTO | IMPOSIBLE |
| IGUAL_A_STOCK | DISTINTA | SIN | FACTURA_REPARTIDA | PRIMERO | IMPOSIBLE |
| IGUAL_A_STOCK | DISTINTA | SIN | FACTURA_REPARTIDA | REINTENTO | IMPOSIBLE |
| IGUAL_A_STOCK | DISTINTA | CON | COMPRA_SIMPLE | PRIMERO | IMPOSIBLE |
| IGUAL_A_STOCK | DISTINTA | CON | COMPRA_SIMPLE | REINTENTO | IMPOSIBLE |
| IGUAL_A_STOCK | DISTINTA | CON | FACTURA_REPARTIDA | PRIMERO | IMPOSIBLE |
| IGUAL_A_STOCK | DISTINTA | CON | FACTURA_REPARTIDA | REINTENTO | IMPOSIBLE |
| DISTINTA_DE_STOCK | IGUAL | SIN | COMPRA_SIMPLE | PRIMERO | ACEPTA |
| DISTINTA_DE_STOCK | IGUAL | SIN | COMPRA_SIMPLE | REINTENTO | ACEPTA |
| DISTINTA_DE_STOCK | IGUAL | SIN | FACTURA_REPARTIDA | PRIMERO | ACEPTA |
| DISTINTA_DE_STOCK | IGUAL | SIN | FACTURA_REPARTIDA | REINTENTO | ACEPTA |
| DISTINTA_DE_STOCK | IGUAL | CON | COMPRA_SIMPLE | PRIMERO | RECHAZA |
| DISTINTA_DE_STOCK | IGUAL | CON | COMPRA_SIMPLE | REINTENTO | RECHAZA |
| DISTINTA_DE_STOCK | IGUAL | CON | FACTURA_REPARTIDA | PRIMERO | RECHAZA |
| DISTINTA_DE_STOCK | IGUAL | CON | FACTURA_REPARTIDA | REINTENTO | RECHAZA |
| DISTINTA_DE_STOCK | DISTINTA | SIN | COMPRA_SIMPLE | PRIMERO | ACEPTA |
| DISTINTA_DE_STOCK | DISTINTA | SIN | COMPRA_SIMPLE | REINTENTO | ACEPTA |
| DISTINTA_DE_STOCK | DISTINTA | SIN | FACTURA_REPARTIDA | PRIMERO | ACEPTA |
| DISTINTA_DE_STOCK | DISTINTA | SIN | FACTURA_REPARTIDA | REINTENTO | ACEPTA |
| DISTINTA_DE_STOCK | DISTINTA | CON | COMPRA_SIMPLE | PRIMERO | ACEPTA |
| DISTINTA_DE_STOCK | DISTINTA | CON | COMPRA_SIMPLE | REINTENTO | ACEPTA |
| DISTINTA_DE_STOCK | DISTINTA | CON | FACTURA_REPARTIDA | PRIMERO | ACEPTA |
| DISTINTA_DE_STOCK | DISTINTA | CON | FACTURA_REPARTIDA | REINTENTO | ACEPTA |

## Dimensiones que NO cambian el resultado (declaradas, con motivo)

| Dimensión | Por qué no cambia |
|---|---|
| Otra empresa | La unidad de compra tiene que ser de la MISMA empresa: lo exige la clave foránea compuesta (empresaId, unidadCompraId) y el RLS aísla las lecturas; una unidad de otra empresa no se puede guardar |
| Otro proveedor | El proveedor no interviene en la unidad ni en lo comprado: se guarda igual con cualquiera |
| Sucursal de quien carga | Lo comprado se guarda igual en cualquier sucursal; el permiso de cargar compras ya está resuelto antes (no cambia con esta etapa) |
| Presentación alternativa | Si la línea elige una presentación activa, la unidad de compra es la de esa presentación (otro valor de la misma dimensión U: distinta de la de stock); se guarda igual |
| Devolución a proveedor | Usa la misma conversión pero NO guarda unidad ni cantidad comprada (solo una COMPRA las escribe): queda NULL |
| Con o sin precio | El importe no interviene en la unidad ni en lo comprado |
