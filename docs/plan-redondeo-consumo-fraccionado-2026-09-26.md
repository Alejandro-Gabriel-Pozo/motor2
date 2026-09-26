# Task #27 — consumo de materia prima sin error de redondeo acumulado en la venta fraccionada

## El problema

`registrar-venta.ts` redondeaba cada parte de consumo (producto, sección, lote) de CADA venta por separado, con
`redondearACantidadDeUnidad` (`Math.round(cantidad * 10**d) / 10**d`), sin memoria entre ventas. Con una materia prima de unidad
ENTERA (0 decimales) y un producto con venta fraccionada (`Producto.pasoVenta`, Task #25):

- dos ventas separadas de 0,5 pizza (media pizza) consumían **2 bollos** en el Kardex, no 1 (`Math.round(0,5)` redondea el medio
  hacia arriba);
- con paso 0,25, cuatro cuartos de pizza consumían **0 bollos** (`Math.round(0,25)` redondea hacia abajo).

El mismo sesgo existe en cualquier receta con cantidades no representables exactas (ej. "0,3 huevos + 7% de merma") vendida varias
veces, y en un consumo que el reparto por lote parte en dos números que no suman entero (necesidad 1,5 → partes 1 + 0,5 → 1 + 1).

## Diseño elegido: arrastre de redondeo por (sucursal, producto), calculado desde el Kardex

Se agregó `MovimientoStock.cantidadExacta Decimal? @db.Decimal(20, 8)` (migración
`prisma/migrations/20260926230000_movimiento_stock_cantidad_exacta`): guarda la magnitud EXACTA (mismo signo que `cantidad`) de una
parte de CONSUMO de venta, solo cuando difiere de lo escrito.

La deuda de un producto en una sucursal es:

```
D = Σcantidad − ΣcantidadExacta   (sumando solo filas CONSUMO con cantidadExacta no nulo)
```

Antes de escribir una parte nueva, se redondea `D + exacto` (no `exacto` a secas) a los decimales de la unidad del insumo, y la
deuda pasa a ser `D + exacto − escrito`. Con `D = 0` (todo dato existente, y la primera venta de cada producto) el resultado es
IDÉNTICO al de hoy — ninguna venta aislada cambia. Con `Math.round`, `D` se mantiene siempre en `[−u/2, u/2)` (`u = 10^-decimales`):
el Kardex nunca se aparta más de media unidad del consumo exacto acumulado, y ese resto se corrige solo en cuanto la deuda cruza el
medio paso de vuelta.

Código:

- `src/core/movimientos/arrastre-redondeo.ts` — núcleo puro (`crearArrastreDeRedondeo`), sin Prisma. `test/movimientos/arrastre-
  redondeo.test.ts` lo prueba sin base de datos (12 tests: casos puntuales, compatibilidad con `D=0`, `-0` normalizado, y una
  propiedad con 2.000 magnitudes pseudoaleatorias de semilla fija).
- `cargarDeudaDeRedondeo` (dentro de `registrar-venta.ts`) — cargador con Prisma, un `groupBy` por venta, SIEMPRE con `tx` (nunca
  `prisma` global, para que SERIALIZABLE arbitre el conflicto entre dos ventas concurrentes del mismo producto).
- `registrarVentaEnTx` reemplaza la línea `redondearACantidadDeUnidad(c.cantidad, decimales)` por `arrastreDeRedondeo.consumir(...)`.
- `anularVenta` copia `cantidadExacta` invertida en la fila de reversión, para que la deuda vuelva exactamente al estado de las
  ventas que siguen vigentes.

## Alcance de la deuda

Por **(sucursal, producto consumido)**, no por sección ni por lote — coincide con la clave del redondeo actual (el producto de la
parte de consumo). Napolitana y muzzarella que comparten el mismo bollo abierto arrastran la MISMA deuda. Límite documentado: el
resto puede cruzar secciones (la sección A escribe el bollo entero, la B el sobrante en 0) — el total de la sucursal queda exacto;
el error por sección es de ±1 unidad como máximo, corregible con Conteo Físico, igual que cualquier redondeo de reparto.

No genera saldos negativos nuevos: cada parte que entrega el reparto (`origen-venta.ts`) es ≤ lo disponible del lote, que ya es un
múltiplo de `u`; con `D` acotada en `[−u/2, u/2)`, `round(D + parte) ≤ disponible`. La validación de stock (`faltantesDe`) sigue
usando el valor EXACTO, sin pasar por el arrastre — el redondeo nunca decide si una venta se acepta o se rechaza.

## Alternativas descartadas

- **(a1) Resto en una tabla nueva que se actualiza**: estado disputado, editado fuera del Kardex append-only; `anularVenta` no podría
  revertirlo sin guardar más contexto; acumula error en cada anulación.
- **(b) No corregir, dejar que lo arregle el conteo físico**: descartada explícitamente por el dueño del producto (pidió el arreglo
  de fondo, no solo el parche operativo).
- **(c) Escribir el consumo exacto redondeado a 4 decimales sin tocar el schema**: rompe el invariante "Contraste" (una MP de 0
  decimales tiene que quedar en un ENTERO en el Kardex, `test/auditoria/precision-produccion-sin-redondeo.test.ts`), rompe el conteo
  físico y la grilla de stock (que asumen los decimales de la unidad).
- **(d) Sumar dentro de la misma venta sin guardar nada**: no cubre el caso de dos ventas en momentos distintos (la deuda tiene que
  sobrevivir entre transacciones) — (a2)/el diseño elegido ya la incluye internamente para partes de la MISMA venta.
- **(e) Rechazar en la configuración (extender R3, `venta-fraccionada.ts`, a los ingredientes de receta)**: bloquea el negocio, no
  cubre merma ni cantidades fraccionarias de receta que no dependen de `pasoVenta`.

## El arreglo es SOLO hacia adelante

La migración es aditiva y no rellena nada: `cantidadExacta` arranca en `null` para toda fila existente, así que la deuda de
cualquier producto antes de este cambio es 0. No hay backfill posible sin inventar un orden de "qué venta pasó primero" para datos
que ya se escribieron redondeados de forma independiente.

## Seguimiento futuro (fuera de alcance de esta tarea, documentado — no implementado)

El mismo problema de redondeo sin memoria existe en el consumo de **PRODUCCIÓN**
(`src/server/actions/movimientos/movimientos.ts`, `calcularConsumosProduccion`): cada línea de receta también se redondea "a secas"
por lote de producción, sin arrastre. El módulo `arrastre-redondeo.ts` es reusable ahí tal cual (mismo núcleo puro); falta escribir
su propio cargador de deuda (podría compartir `cargarDeudaDeRedondeo` si se generaliza el filtro de proceso) y su propio test de
integración. Nice-to-have adicional, tampoco implementado: una consulta de solo lectura para el dueño del producto que liste ventas
de PV con `pasoVenta` cuya receta use una MP de 0 decimales, para sugerir un conteo físico puntual después del deploy de esta task
(no hay datos previos que corregir — es solo una oportunidad de detectar de un vistazo dónde el arrastre va a empezar a converger).
