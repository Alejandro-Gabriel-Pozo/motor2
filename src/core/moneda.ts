import { Decimal } from "@prisma/client/runtime/index-browser";

/**
 * Precisión decimal para dinero (plan de precisión de montos, 2026-09-25).
 *
 * Todo el core sigue trabajando con `number`: entra `number` (de `Number(Decimal)` o de una cantidad ya redondeada a su unidad) y sale
 * `number` redondeado a 2 decimales. La aritmética exacta con `Decimal` (el decimal.js que Prisma ya trae) queda encerrada acá, SOLO en
 * multiplicar y redondear; ningún objeto `Decimal` sale de este módulo.
 *
 * Por qué hace falta: `Math.round(n * 100) / 100` redondea mal los empates de medio centavo que no son exactos en binario
 * (`128.045 * 100` da `12804.499999999998` → 128,04 en vez de 128,05), devuelve `-0` con restos negativos mínimos (que `Intl` es-AR
 * muestra como "-$ 0,00") y con negativos desempata hacia +∞ (`-128.045` → -128,04), distinto de `NUMERIC` de Postgres, que se aleja
 * del cero (-128,05). Además, si el producto cantidad × precio se hace en float ANTES de redondear, puede quedar apenas debajo del
 * empate (`0.3 * 1234.55` = `370.36499999999995` → 370,36 en vez de 370,37): por eso `importeDeLinea` multiplica en decimal.
 *
 * `new Decimal(n)` toma la representación decimal más corta del double (`String(n)`: "128.045"), que es el valor que se cargó o que
 * vino de la base — no la expansión binaria exacta. `NaN` y `±Infinity` pasan igual que con `Math.round` (sin tirar error).
 *
 * Import del subpath `@prisma/client/runtime/index-browser` (apto para navegador, sin motor ni `pg`): este módulo termina en el bundle
 * del cliente vía `transiciones.ts` → `historial-vistas.ts`/`rendimiento-recetas-vistas.ts`, importados por componentes "use client".
 */

/** Clon propio: no depende de la configuración global de Decimal (20 dígitos). 40 dígitos alcanzan de sobra para el producto de dos
 *  números de hasta 17 dígitos significativos y la suma de muchos de ellos. Empates alejándose del cero, igual que `NUMERIC`. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** `-0` → `0`; cualquier otro valor pasa igual. */
function sinCeroNegativo(n: number): number {
  return n === 0 ? 0 : n;
}

function aCentavos(valor: InstanceType<typeof D>): number {
  return sinCeroNegativo(valor.toDecimalPlaces(2, D.ROUND_HALF_UP).toNumber());
}

/**
 * Redondea exacto a 2 decimales, alejándose del cero en los empates (igual que `round(v::numeric, 2)` de Postgres), y normaliza `-0`
 * a `0`. Los enteros vuelven directo, sin pasar por Decimal (son la mayoría de los montos en pesos).
 */
export function redondearMoneda(n: number): number {
  if (!Number.isFinite(n)) return n;
  if (Number.isInteger(n)) return sinCeroNegativo(n);
  return aCentavos(new D(n));
}

/** Importe de una línea: producto cantidad × precio unitario EXACTO (en decimal, no en float) y un solo redondeo a centavos. */
export function importeDeLinea(cantidad: number, precioUnitario: number): number {
  if (!Number.isFinite(cantidad) || !Number.isFinite(precioUnitario)) return redondearMoneda(cantidad * precioUnitario);
  if (Number.isInteger(cantidad) && Number.isInteger(precioUnitario)) {
    const producto = cantidad * precioUnitario;
    if (Number.isSafeInteger(producto)) return sinCeroNegativo(producto);
  }
  return aCentavos(new D(cantidad).times(precioUnitario));
}

/**
 * Precio COBRADO a un cliente con descuento (Task #14, docs/plan-clientes-descuento-2026-09-26.md, punto 6): aplica `porcentaje` (0 a
 * menor que 100 — lo valida `validarPorcentajeDescuento`, src/core/datos/porcentaje-descuento.ts, no este módulo) sobre `precioLista`
 * con aritmética Decimal EXACTA (mismo `D` que el resto de este archivo) y un solo redondeo al centavo, alejándose del cero en los
 * empates — igual criterio que `redondearMoneda`.
 *
 * `porcentaje` ausente, `null`, `0` o no numérico devuelve `precioLista` TAL CUAL, sin pasar por Decimal: sin descuento, cero cambios
 * respecto al precio de lista ya congelado (`CuentaItem.precioUnitario`, que NO cambia de semántica con esta Task).
 *
 * PISO DE 0,01 (confirmado contra `src/core/reportes/periodo.ts`, `calcularVentasDelPeriodo`): con `precioLista > 0` esta función NUNCA
 * devuelve 0, ni con un porcentaje altísimo (99,99 %) — ese reporte trata `MovimientoStock.precioTotal === 0` en una línea VENTA como
 * "venta vieja cargada sin precio" y la REESTIMA al precio de carta vigente de HOY, ignorando el precio congelado de ese día; si el
 * precio con descuento pudiera dar 0, una venta con descuento real (que sí tiene precio, aunque sea mínimo) se leería como si no
 * hubiera tenido descuento. `precioLista <= 0` pasa sin piso: no hay nada que proteger (no debería llegar así — no es este módulo el
 * que lo valida).
 */
export function precioConDescuento(precioLista: number, porcentaje: number | null | undefined): number {
  if (!porcentaje || !Number.isFinite(porcentaje)) return precioLista;
  if (!Number.isFinite(precioLista) || precioLista <= 0) return precioLista;
  const conDescuento = aCentavos(new D(precioLista).times(new D(100).minus(porcentaje).dividedBy(100)));
  return conDescuento > 0 ? conDescuento : 0.01;
}

/**
 * Total de varias líneas: suma EXACTA de los productos cantidad × precio y UN SOLO redondeo al final (la política de redondeo que ya
 * tenía el POS para sus totales, ahora sin el error del float).
 */
export function totalDeLineas(lineas: readonly { cantidad: number; precioUnitario: number }[]): number {
  if (lineas.some((l) => !Number.isFinite(l.cantidad) || !Number.isFinite(l.precioUnitario))) {
    return redondearMoneda(lineas.reduce((suma, l) => suma + l.cantidad * l.precioUnitario, 0));
  }
  let suma = new D(0);
  for (const l of lineas) suma = suma.plus(new D(l.cantidad).times(l.precioUnitario));
  return aCentavos(suma);
}
