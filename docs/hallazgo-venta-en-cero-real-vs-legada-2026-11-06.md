# Hallazgo C (lote 1b): `precioTotal = 0` se lee como «venta vieja sin precio»

Estado: **RESUELTO por decisión del dueño (CONFIRMADA, 2026-11-06)**: las ventas quedan congeladas, un importe $0 significa «sin dato» y nada más; no se revalúa a precio de hoy ni se estima. Sin migración.

Qué se cambió: `calcularVentasDelPeriodo` ya no estima; las líneas $0 (no anuladas) quedan fuera del total y de las filas y se cuentan en `lineasSinDato`. Reportes que comparten la regla (todos pasan por esa función): Período (y su margen nominal), Ventas por categoría, Ventas por sección de carta, Consolidado (solo totales), Resumen operativo. Visible para el usuario: se quitó la marca «(estimado)» de la tabla del Período; el aviso de ventas pasa a decir cuántas ventas quedan sin dato; en el Resumen la leyenda «incluye estimados» pasa a «N ventas sin dato (fuera del total)». Coherente con el margen Real, que ya las excluía.

(Lo que sigue es el análisis previo a la decisión.)

Verificado contra el código el 2026-11-06.

## Qué pasa hoy
`calcularVentasDelPeriodo` (`src/core/reportes/periodo-ventas.ts`) trata una fila VENTA con `precioTotal > 0` como importe real y una con `precioTotal = 0` como «venta vieja sin precio»: la valúa al **precio de venta vigente hoy** y la marca `estimado`. `margen-real.ts` y `periodo-margen.ts` hacen lo opuesto (la dejan afuera por «sin precio»).

## Evidencia
- Una venta nueva escribe `precioTotal = importeDeLinea(cantidadVendida, precioVenta)` (`filas-de-venta.ts`) y `precioPorUnidadStock = precioVenta`. Ningún guardia impide `precioVenta = 0`: `Producto.precioVenta` tiene `@default(0)` (`schema.prisma:384`) y no hay validación de «precio mayor que cero» en `registrar-venta-en-tx.ts` ni en `core/pos` (solo la promo exige ≥ $0,01). Un producto con precio 0 (o una cantidad tan chica que el importe redondea a 0,00) produce hoy una venta legítima a $0 **indistinguible** de una legada.
- El descuento de cliente no la genera (`0 ≤ % < 100`).
- La CHECK de la base solo exige `precioTotal >= 0`.
- **No hay marcador confiable de «legada»**: la fila legada y la de $0 real tienen los mismos valores (`precioTotal = 0`, `precioPorUnidadStock = 0`); `costoUnitarioVenta` es `null` también en ventas nuevas con costeo incompleto; `precioListaUnitario` es `null` también sin descuento; no hay columna de «venta sin precio» ni fecha de corte documentada de la migración.

## Por qué no se arregla acá
Distinguirlas exige (a) una columna o marca nueva + backfill de ventas ya guardadas (migración sobre datos reales), o (b) una fecha de corte que solo el dueño puede afirmar. Ninguna es «barata y segura» y el lote prohíbe migraciones.

## Pregunta abierta (para el dueño)
¿Hay en producción ventas anteriores al guardado del precio por línea (importadas del sistema viejo)? Si **no** hay: se puede decidir que `precioTotal = 0` es siempre un $0 real (se deja de revaluar y se elimina el aviso «estimadas»). Si **sí** hay: hace falta una marca (fecha de corte o columna) y su backfill.
