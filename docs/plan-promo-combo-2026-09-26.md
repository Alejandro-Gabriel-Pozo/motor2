# Task #16 — promos armables ("menú fijo"/combo) con desglose, stock y margen real

## Decisiones de negocio ya confirmadas por el dueño del producto (no se vuelven a preguntar)

- **D1** (sin alternativa real, adoptada): soportar mínimo y máximo por cupo, mínimo 0 por defecto.
- **D2**: el descuento por cliente (Task #14, ya en main) SÍ se suma sobre el precio prorrateado de cada componente de la
  promo.
- **D3**: el precio de la promo se prorratea entre los componentes PROPORCIONAL AL PRECIO DE CARTA de cada uno (no partes
  iguales, no proporcional al costo).
- **D4**: anular una promo ya cobrada (desde Trazabilidad) SIEMPRE anula todos sus componentes juntos, nunca uno suelto.
- **D5** (sin alternativa real, adoptada): los elegibles de un cupo son solo lo que la carta ya muestra en esa sección
  (sueltos visibles + opciones de ítems agrupados activos, disponibles en la sucursal, excluyendo "Fuera de carta").
- **D6**: SIN recargo por elegir una opción "premium" dentro de un cupo en la v1 (ej. nada de "bife +$2000" todavía).
- **D7** (mismo criterio que la Task #14): la v1 es solo POS, no mostrador.

El diseño completo (modelo de datos, prorrateo, stock, flujo del POS, boleta, y el reporte nuevo
`/reportes/margen-promociones`) vive en el plan de implementación que este documento acompaña — ver el historial de commits
de la rama `feat/promo-combo` para el detalle paso a paso (`docs/plan-redondeo-consumo-fraccionado-2026-09-26.md` y
`docs/plan-clientes-descuento-2026-09-26.md` son el precedente de formato de este tipo de documento en el repo).

## Línea de base (Paso 0), contra `origin/main` en el commit de arranque de esta rama

Commit de arranque: `207bf06` (merge de la Task #27, arrastre de redondeo de consumo fraccionado — el archivo que más se
solapa con esta Task es `src/core/movimientos/registrar-venta.ts`, que ya trae ese arrastre y con el que este cambio tiene
que convivir sin pisarlo).

Corrida en un worktree y bases Postgres dedicadas (`motor2_promo_combo` para dev, `motor2_promo_combo_e2e` para e2e), SIN
ningún cambio de código de esta Task (solo el commit `chore(e2e)` del puerto propio, que no toca ningún test):

- `npx tsc --noEmit`: 1 error, el ruido conocido y ajeno (`LayoutProps` en `src/app/layout.tsx`, generado por
  `next dev`/`next build`, ver `AGENTS.md`).
- `npm run lint`: 0 errores, 0 warnings.
- `npm test` (Vitest): **235 archivos, 2802 tests**, todos en verde. `Duration 470.64s`.
- `npm run test:e2e` (Playwright, servidor de producción — `build:e2e` + `next start`): **359 tests** (64 archivos
  `.spec.ts`), todos en verde. `9.4m`.

El conteo final de esta Task tiene que ser **≥ 2802 tests de Vitest y ≥ 359 de Playwright**, con los 5 comandos en verde en
la MISMA corrida (paso 15 del plan).

## Avisos para quien siga leyendo los reportes de dinero

- El precio promedio de un PV mezcla ventas sueltas y ventas dentro de una promo (cada componente entra a Período/Costos
  con su ingreso PRORRATEADO, no con el precio de carta): un producto que además se vende dentro de un combo va a mostrar
  un precio promedio distinto del de su ficha, sin que eso sea un error.
- Con cliente con descuento (D2), el precio cobrado de cada componente puede diferir en centavos de "descontar el % sobre
  el precio de la promo entero y repartir después" — el orden es SIEMPRE prorratear primero (D3) y descontar después
  (`precioConDescuento` sobre cada componente ya prorrateado), igual criterio que el resto del POS.
- `/reportes/margen-promociones` (paso 12) agrupa por `PromoCarta` (el TIPO, "Menú del día"), no por instancia — igual
  criterio que Período/Costos agrupan por producto y no por línea de venta. El título mostrado es el ACTUAL de la
  `PromoCarta` (si se renombró después de vender, se ve el nombre de hoy, no el snapshot congelado en cada `PromoCuenta`),
  mismo criterio que un producto renombrado en cualquier otro reporte de dinero.
- Una promo dada de baja (`PromoCarta.activa = false`) sigue apareciendo en `/reportes/margen-promociones` si vendió algo
  en el rango, marcada `activa: false` — no se pierde el historial de lo ya cobrado por apagarla.

## Cierre (Paso 14) — qué quedó armado, decisión por decisión

**Modelo de datos** (dos migraciones, `PromoCartaCupo` y `PromoCuenta`; ver el paso 4 y 6 para el detalle de las dos veces
que hubo que corregir a mano el bug conocido de `prisma migrate dev` que degrada FKs RESTRICT ajenas a SET NULL):
`PromoCarta` con uno o más `PromoCartaCupo` pasa a ser ARMABLE (D1: `cantidadMinima`/`cantidadMaxima` por cupo, mínimo 0 por
defecto); sin ninguno sigue siendo la promo puramente informativa de siempre (el POS la ignora, igual que antes de esta
Task). Al agregarla a una cuenta se crea UNA `PromoCuenta` (instancia, con su `titulo`/`precio` YA CONGELADOS) y sus
`CuentaItem` componentes llevan `promoCuentaId` + `precioCartaUnitario` (el precio de carta de esa unidad, para D3 y para
el reporte de margen).

**D1** (mínimo/máximo por cupo): validado en tres capas independientes, cada una defendiéndose de que las otras dos hayan
cambiado entre medio — `armar-promo-estado.ts` (puro, en el diálogo del POS: no deja pasar del máximo tocando +),
`validarEleccionPromo` (`promo-combo.ts`, server, antes de escribir nada en `agregarItems`) y `guardarCuposPromoCarta`
(admin: además valida `precioMinimoPromo` contra el PEOR CASO, el paso 13 lo hace visible antes de guardar).

**D2** (descuento de cliente sobre lo prorrateado): no hizo falta tocar `precioConDescuento` — como cada `CuentaItem`
componente ya lleva su `precioUnitario` prorrateado (D3) desde que se agrega, el camino de cierre de cuenta lo trata
exactamente igual que un suelto; el descuento se aplica DESPUÉS, sobre ese precio ya prorrateado, nunca antes.

**D3** (prorrateo proporcional al precio de carta, `prorratearPrecioPromo`): dos pasadas — proporcional puro primero;
si algún componente cae por debajo del piso de $0,01/unidad, se re-reparte dándole ese piso fijo a cada unidad primero y
el resto proporcional al excedente (nunca "milanesa gratis"). `precioMinimoPromo` es el mismo cálculo usado para
rechazar de una una promo/cupos que ni en el mejor arreglo alcanzarían ese piso.

**D4** (anular/quitar siempre la promo entera): sin enviar, `quitarPromoSinEnviar` borra la `PromoCuenta` y TODOS sus
componentes juntos (rechaza si alguno ya salió a cocina — ahí se usa `anularPromoEnviada`, que anula TODOS los
componentes vigentes con un solo motivo). Ya cobrada, `anularVenta` detecta `Operacion.promoCuentaId` y anula TODAS las
Operaciones hermanas de esa misma `PromoCuenta` juntas, con una reversión propia cada una (nunca una sola compartida). La
UI (`sin-enviar.tsx`, `page.tsx`) agrupa los componentes bajo el título de la promo con un ÚNICO botón de quitar/anular —
nunca se ofrece una acción por componente.

**D5** (elegibles = lo que la carta ya muestra): `selector-carta-consulta.ts` resuelve los elegibles de cada cupo con los
MISMOS pedibles que `armarSelectorCartaPos` ya ubicó en la sección de ese cupo — nunca una fuente propia, así un cupo
nunca queda desincronizado de lo que el mozo ve en esa sección (un producto que se apaga, o una opción que un ítem
agrupado deja de tener, desaparece del cupo sin que haga falta tocar la promo).

**D6** (sin recargo por opción "premium"): no implementado a propósito — cada opción de un cupo cuesta lo mismo para el
prorrateo (D3 reparte por precio de CARTA de lo elegido, que si difiere entre opciones ya da un prorrateo distinto sin
necesidad de un recargo aparte).

**D7** (solo POS, no mostrador): `registrarVenta` (mostrador, Task #14) nunca recibe `promoCuentaId` — un test dedicado
(`venta-en-tx.test.ts`) cubre que un valor colado en el payload se ignora, no que se rechace con error (mismo criterio
que otros campos "solo mesas" del mismo módulo).

**Reportes**: `margen-real.ts` ganó `costoPorItem` (paso 2, aditivo puro) para poder costear TODOS los componentes de
TODAS las promos del rango en una sola pasada; `/reportes/margen-promociones` (paso 12) lo usa agrupando por `PromoCarta`
en vez de por instancia — ver el aviso de arriba.

**Verificación final**: paso 15, los 5 comandos (`tsc`, `lint`, `vitest`, `build`, `playwright`) en la MISMA corrida —
resultado en el último commit de la rama.
