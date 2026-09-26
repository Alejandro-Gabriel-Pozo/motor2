# Plan: Cliente con % de descuento fijo — 2026-09-26

Task #14 del backlog. Decisiones de negocio ya resueltas por el dueño (D1-D7 abajo); este documento deja registro de lo
implementado, en el mismo espíritu que `docs/plan-reporte-boletas-emitidas-2026-09-26.md` — no es un plan previo a confirmar.

## Decisiones del negocio

- **D1 — un único % por cliente.** `Cliente.descuentoPorcentaje` no varía por categoría de producto ni por sección de carta: un
  cliente tiene UN descuento, aplicado parejo a toda su cuenta.
- **D3 — quién puede asignarlo.** CUALQUIER mozo con `pos_tomar_pedido` puede asignar (o cambiar, o quitar) el cliente de una
  cuenta abierta, no solo admin — el permiso nuevo `pos_asignar_cliente` se semilla junto con `pos_tomar_pedido` (ver el punto 9).
- **D4 — rango del %.** `0 ≤ % < 100` (tope estricto, sin excepción: 100% "regalaría" todo). Hasta 2 decimales.
- **D6 — alcance de esta v1.** Solo ventas de MESA (`cerrarCuenta`, módulo POS). La venta de mostrador (`registrarVenta`) no pasa
  ningún cliente todavía — el núcleo (`registrarVentaEnTx`) ya acepta `clienteId`/`precioListaUnitario` para que esa extensión,
  cuando llegue, no pida otra migración.
- **D7 — snapshot congelado.** El % se copia a `Cuenta.descuentoPorcentaje` en el momento de `asignarClienteACuenta` (no una FK que
  se resuelva después): si el % del `Cliente` cambia con la cuenta ya abierta (o después de cerrada), esa cuenta nunca se entera.
  Es el mismo criterio que el precio de cada `CuentaItem`, que también se congela al pedir.

## Qué se construyó

1. **`Cliente`** (`prisma/schema.prisma`): catálogo CENTRAL (sin `sucursalId`, mismo criterio que `Proveedor`), `nombre` único,
   `descuentoPorcentaje Decimal(5,2)`, `activo` (nunca se borra: una `Cuenta`/`Operacion` ya cerrada lo referencia para siempre,
   FK RESTRICT). Migración `20260926190000_cliente_cuenta_descuento`.
2. **`Cuenta.clienteId` + `Cuenta.descuentoPorcentaje`** (misma migración): el snapshot de D7. `asignarClienteACuenta`
   (`src/server/actions/pos/cuenta.ts`) los escribe juntos; `null`/`null` = sin cliente, precio de lista de siempre.
3. **`Operacion.clienteId`** y **`MovimientoStock.precioListaUnitario`** (migración `20260926190100_operacion_movimiento_cliente_
   descuento`): `Operacion.clienteId` agrupa el Kardex por cliente (no reusa `proveedorId` — mezclaría los dos catálogos).
   `precioListaUnitario` guarda el precio de LISTA de la fila VENTA SOLO cuando difiere de lo cobrado (`precioTotal`/
   `precioPorUnidadStock`, que siguen siendo lo COBRADO real — ningún reporte de dinero existente cambió de fuente).
4. **`registrarVentaEnTx`** (`src/core/movimientos/registrar-venta.ts`): dos extensiones internas nuevas, nunca expuestas por la
   Server Action pública (`registrarVenta`, D6) — `datos.clienteId` (va a `Operacion.clienteId`) y `lineas[].precioListaUnitario`
   (va a `MovimientoStock.precioListaUnitario` de esa línea VENTA). El núcleo no sabe nada de clientes ni de porcentajes: solo
   recibe los números ya resueltos.
5. **Permisos** (`src/core/permisos/acciones.ts` + migración de datos `20260926190200_permiso_pos_asignar_cliente`): `clientes`
   (administrar el catálogo, admin-only, mismo molde que Proveedores/Categorías) y `pos_asignar_cliente` (D3). A diferencia del
   molde habitual de una migración de permisos (semillar solo a `admin` por nombre), la de `pos_asignar_cliente` es DINÁMICA: le
   da la fila a CUALQUIER rol que YA edite `pos_tomar_pedido` en esa base — así una base con un rol «mozo» ya armado no necesita
   que un admin vuelva a tocar la matriz a mano.
6. **`precioConDescuento`** (`src/core/moneda.ts`): el núcleo puro. Aritmética Decimal exacta (mismo `D` que el resto del
   archivo), un solo redondeo al centavo, piso de 0,01 (nunca devuelve 0 con precio de lista > 0 — confirmado contra
   `calcularVentasDelPeriodo`, que reestima un `precioTotal === 0` como "venta vieja sin precio"). Sin porcentaje, es un
   pasamanos: el precio de lista tal cual.
7. **`validarPorcentajeDescuento`** (`src/core/datos/porcentaje-descuento.ts`): mismo patrón `ResultadoDato` que
   `validarImporte`/`validarCantidad` — D4 (0 ≤ % < 100), hasta 2 decimales.
8. **`calcularMargenRealDelPeriodo`** extraído a `src/core/reportes/margen-real.ts`: vivía sin exportar, atrapado dentro de
   `calcularMargenDelPeriodo` (`periodo.ts`). Refactor puro (ningún número de Período/Promociones cambió) para que el reporte
   nuevo (punto 10) y, después, Promociones/Combos con costo real lo reusen sin duplicar la lógica de costeo línea a línea.
9. Ver el punto 5.
10. **`/reportes/descuentos-clientes`** (`src/core/reportes/descuentos-clientes.ts` + su página): cuánto se descontó por cliente
    en el rango, y si ese descuento dejó el margen sano — Margen Real de lo COBRADO vs. el que hubiera dado la MISMA venta a
    precio de lista (dos pasadas de `calcularMargenRealDelPeriodo` por cliente, mismo costo real en las dos: la diferencia entre
    ambos márgenes es, centavo a centavo, lo que el descuento le sacó al margen). Mismo permiso que el resto de los reportes de
    dinero (`ver_reportes_dinero`).

## Cerrar la cuenta con descuento (`cerrarCuenta`, `src/server/actions/pos/cuenta.ts`)

1. Arma las líneas netas por (producto, precio de LISTA congelado) — sin cambios, `lineasDeVenta`.
2. Si la cuenta tiene un cliente asignado, aplica `precioConDescuento` sobre el precio de lista de cada línea con el snapshot
   (`Cuenta.descuentoPorcentaje`, nunca el % actual del `Cliente`) — el precio de lista solo viaja aparte
   (`precioListaUnitario`) cuando el descuento cambió el número.
3. Registra la venta con `registrarVentaEnTx`, pasando el cliente de la cuenta y el precio COBRADO de cada línea.
4. Enlaza cada `CuentaItem` con su `Operacion` buscando por el precio de LISTA (sin cambios: el descuento no toca esa búsqueda,
   `CuentaItem.precioUnitario` sigue siendo el precio de lista de siempre).

El mensaje de cierre, el total en pantalla (`obtenerDetalleDeMesa`) y la boleta (`src/core/pos/boleta.ts`,
`armarBoleta(items, descuentoPorcentaje)`) recalculan con la MISMA `precioConDescuento` y el mismo snapshot — determinístico, sin
tener que leer el `MovimientoStock` de cada línea para saber qué se cobró.

## UI

- **`/catalogo/clientes`**: alta, edición inline (nombre + %) y activar/desactivar — mismo molde de una sola pantalla que
  Categorías, con un `<details>` de edición por fila (dos campos no ameritan una ruta `/editar` propia).
- **Mesa del salón** (`src/app/(pos)/mesas/[mesaId]/cliente-cuenta.tsx`): «Asignar cliente» / «Cambiar», junto a Comensales en el
  encabezado — mismo patrón «Editar» inline. Gatea con `pos_asignar_cliente`.
- **Boleta impresa** (`boleta-cuenta.tsx`) y **`/reportes/boletas`**: un renglón «Cliente: X (−Y% dto.)» y, en cada línea con
  descuento, el precio de lista tachado antes del cobrado.

## Fuera de alcance de esta v1

- Venta de mostrador con cliente (D6): el núcleo ya lo admite, la Server Action pública todavía no lo expone.
- Filtro por cliente en `/reportes/boletas` (`FiltroBoletas.clienteId`, comentado en `boletas-emitidas.ts`): el modelo ya existe,
  el filtro visible queda para otra vuelta.
- Descuento por categoría de producto (D1 lo descarta a propósito para esta v1).
