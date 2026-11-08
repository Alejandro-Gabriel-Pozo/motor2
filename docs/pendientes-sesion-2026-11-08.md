# Pendientes anotados el 2026-11-08

## Tablas de reportes «mobile-first» (decisión del dueño: no es para hoy)

- **Qué pasa hoy.** Las tablas de los reportes (`TablaReporte`) son más anchas que una pantalla de celular (375 px) y se desplazan hacia el costado. En Trazabilidad → «Ver operación», la columna **«Corregir este movimiento»** (E0 PR3, #203) queda a la derecha, **fuera de vista**: hay que deslizar la tabla para verla. En escritorio se ve sin desplazar.
- **Evidencia.** Capturas a 375 px y 1280 px sobre la pantalla real con datos reales de la empresa: rama `alegp/tmp-capturas-e0-pr3` (`71-corregir-movimiento-0-operacion-con-enlace`, `72-celular-tabla-desplazada-a-la-derecha`, `73-escritorio-operacion-con-enlace`).
- **Decisión (2026-11-08, el dueño, al aprobar las capturas de E0 PR3).** Quedan aprobadas «por ahora»: hacer las tablas mobile-first es un refactor y no es para hoy. Nada que cambiar en #203.
- **Cuando se retome (opciones, de la más barata a la más grande).**
  1. En Trazabilidad, poner «Corregir este movimiento» en la primera columna o debajo del producto (un cambio chico y local).
  2. Que `TablaReporte` muestre cada fila como tarjeta apilada en celular (afecta a todos los reportes: se diseña antes con la escalera de 10 niveles y se prueba a 375 px en cada pantalla que use la tabla).
- **Necesidad que resuelve.** Que quien opera desde el celular vea las acciones de cada fila (corregir, anular) sin tener que descubrir que la tabla se desplaza. Pedido y aprobación del dueño: 2026-11-08, en la revisión de las capturas de E0 PR3.
