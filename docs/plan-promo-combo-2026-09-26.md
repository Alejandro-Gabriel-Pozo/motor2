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
