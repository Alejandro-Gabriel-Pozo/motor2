# Hallazgo C (lote 1b): `precioTotal = 0` se lee como «venta vieja sin precio»

Estado: **NO implementado — espera una decisión del dueño** (ver «Pregunta abierta»). Verificado contra el código el 2026-11-06.

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
