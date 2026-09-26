# Venta fraccionada de un producto puntual — 2026-09-26 (Task #25)

## Qué pedía el dueño

Poder marcar, para UN producto puntual, una excepción de venta fraccionada — ej. "esta pizza se vende en unidades de 1 o
de 0,5 (media pizza)" — sin afectar cómo se compra/cuenta ese mismo producto (o los demás que comparten su unidad) en el
resto del sistema.

## Bug corregido de paso

Antes de esta tarea, cargar "0,5" de un producto cuya unidad tiene 0 decimales (ej. una pizza en "unidad") lo redondeaba
en SILENCIO a "1" (`Math.round(0.5) = 1`), cobrando una pizza entera sin avisar. Con `pasoVenta` puesto, ese mismo 0,5 se
ACEPTA tal cual (no se redondea) si es múltiplo del paso; sin `pasoVenta`, el comportamiento de redondeo queda
EXACTAMENTE igual que antes (`test/pos/cuenta-action.test.ts`, `test/pos/cuenta.test.ts` no se tocaron).

## Diseño

- **Precio**: siempre proporcional — `cantidad × precioUnitario` ya lo resuelve, sin lógica nueva.
- **Schema**: `Producto.pasoVenta Decimal? @db.Decimal(14,4)`, nullable (`null` = comportamiento actual). Migración
  puramente aditiva, sin backfill (`prisma/migrations/20260926182605_producto_paso_venta`).
- **Núcleo puro** (`src/core/catalogo/venta-fraccionada.ts`, sin Prisma):
  - `cumplePaso(cantidad, paso)`: múltiplo exacto, tolerante al ruido de punto flotante (0,1 × 3 no es 0,3 en binario).
  - `validarPasoVenta(paso, { decimalesUnidad, tieneStockReal })`: `0 < paso ≤ 1`, hasta 4 decimales, `1/paso` entero
    (0,5 / 0,25 / 0,2 / 0,125 / 0,1 valen; 0,3 no — así una cantidad ENTERA siempre sigue siendo válida) y la
    precondición **R3**.
  - `decimalesDelPaso(paso)`: cuántos decimales hacen falta para representarlo exacto (hasta 4) — la usan además las
    dos transiciones peligrosas de abajo.
- **R3 (la precondición importante)**: el paso de venta NUNCA amplía la precisión de algo con STOCK REAL
  (`tieneStockReal(tipo, seProduce)`, `core/movimientos/transiciones.ts`, ya existente).
  - Sin "Se produce" (el caso común, "se cocina al momento", sin fila propia en el Kardex): el paso es libre, no
    depende de `Unidad.decimales`.
  - Con "Se produce" (stock real): los decimales del paso tienen que entrar en `Unidad.decimales` — si no, se rechaza
    al guardar con un mensaje que sugiere una unidad propia.
  - Dos transiciones que podrían romperla, ambas bloqueadas:
    - (a) marcar "Se produce" en un producto que ya tiene un `pasoVenta` más fino que su unidad —
      `actualizarProducto` revalida SIEMPRE la combinación completa (tipo, seProduce, pasoVenta, unidadStockId), así
      que esto se cubre solo, sin código especial para la transición.
    - (b) bajar `Unidad.decimales` por debajo de lo que algún producto "Se produce" con paso necesita —
      `actualizarDecimalesUnidad` (`src/server/actions/catalogo/unidades.ts`) ahora busca esos productos y rechaza,
      nombrando el primero que rompería.
- **`validarCantidadPedido`** (`src/core/pos/cantidad-pedido.ts`) suma un tercer parámetro OPCIONAL,
  `{ pasoVenta, tieneStockReal }`:
  - sin él (o `pasoVenta: null`): comportamiento IDÉNTICO a como era antes (redondea a `decimales`).
  - con él: rechaza lo que no sea múltiplo exacto del paso (nunca redondea en silencio); si `tieneStockReal`, igual
    redondea a `decimales` como red de seguridad (no-op: R3 ya lo garantiza); si no, salta ese redondeo para no
    arruinar una fracción más fina que `decimales` (la limpieza de punto flotante alcanza con los 4 decimales de la
    columna).
- **Mostrador** (`registrarVenta`/`registrarVentaEnTx`, `src/core/movimientos/registrar-venta.ts`): validación
  ADICIONAL en `armarLinea` — rechaza si `producto.pasoVenta` está puesto y la cantidad no es múltiplo exacto. No
  reemplaza nada (el mostrador no validaba ningún decimal antes, y sigue sin hacerlo fuera de esto). Comparte núcleo
  con `cerrarCuenta` (POS): cada línea que llega ahí ya pasó por `validarCantidadPedido` al cargarse, y la SUMA de
  múltiplos exactos sigue siendo un múltiplo exacto — así que en la práctica esto solo dispara desde la venta directa
  de mostrador.
- **POS** (`agregar-items.tsx`, `agregar-lista-estado.ts`, `selector-carta.ts`/`-consulta.ts`): `ProductoPedible` suma
  `pasoVenta`/`tieneStockReal`; `normalizarCantidad` los pasa a `validarCantidadPedido`; la línea muestra "Se vende de
  a 0,5" cuando el producto elegido tiene paso. `agregarItems` y `anularItemEnviado` (Server Actions) hacen lo mismo
  del lado servidor — la validación real, no solo la de UI.
- **Catálogo** (`producto-form.tsx`): campo opcional "Paso de venta", solo visible para `tipo === "PV"`, junto al
  precio de venta. Vacío = comportamiento actual. Se audita igual que el resto de los campos de producto
  (`registrarCambioAuditado`, campo `pasoVenta`).

## Fuera de alcance, a propósito (Task #27 aparte)

El redondeo del consumo de MATERIA PRIMA que dispara la receta de un PV con paso (ej. vender 0,5 pizza pide 0,5 "bollo"
a una MP en unidad de 0 decimales) sigue EXACTAMENTE igual que hoy — redondea, sin aviso. Esta tarea no lo toca, ni
siquiera para agregar un aviso: ya está anotado aparte como Task #27 ("Corregir el redondeo del consumo de MP cuando
no encaja en la grilla de decimales").

## Tests

- `test/catalogo/venta-fraccionada.test.ts`: núcleo puro — `cumplePaso`, `validarPasoVenta` (válidos/inválidos, R3 con
  y sin "Se produce", mensaje de rechazo).
- `test/pos/cuenta.test.ts`: `validarCantidadPedido` con el tercer parámetro — idéntico sin él, acepta un múltiplo
  exacto sin redondear, rechaza lo que no lo es, redondea con stock real (no-op).
- `test/catalogo/productos.test.ts`: alta/edición con `pasoVenta` (solo PV, R3, las dos transiciones peligrosas,
  auditoría).
- `test/catalogo/unidades.test.ts` (nuevo): `actualizarDecimalesUnidad` bloquea la transición (b).
- `test/movimientos/venta.test.ts`: mostrador acepta un múltiplo exacto (proporcional) y rechaza el resto; sin
  `pasoVenta`, sigue sin validar nada (comportamiento de siempre).
- `test/e2e/pos-venta-fraccionada.spec.ts` (nuevo): aceptar 0,5 sin redondear, rechazar 0,3 con el mensaje a la vista,
  accesibilidad de la ayuda y del error.
- `test/e2e/movimientos-venta-fraccionada.spec.ts` (nuevo): mismo comportamiento en el mostrador.
