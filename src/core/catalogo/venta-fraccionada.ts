import { esNumeroFinito } from "@/core/numero";

/**
 * Venta fraccionada (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): excepción de venta, POR PRODUCTO, al criterio general de
 * "una unidad entera por línea" — ej. "esta pizza se vende de a 1 o de a 0,5 (media pizza)". Vive en `core/catalogo` (junto a
 * `Producto.pasoVenta`, el campo que esto valida) y NO en `core/pos`: la misma regla aplica también en la venta de mostrador
 * (`registrar-venta.ts`), no solo en el POS de mesas.
 *
 * PRECIO: siempre proporcional (0,5 = 50% del precio de venta) — `cantidad × precioUnitario` ya lo resuelve solo, sin lógica nueva.
 *
 * R3 (la precondición que cuida `validarPasoVenta`, IMPORTANTE): el paso de venta nunca puede ampliar la precisión de algo que
 * tenga STOCK REAL (`tieneStockReal`, `core/movimientos/transiciones.ts`) — si el producto se produce (stock propio en el Kardex),
 * sus decimales tienen que entrar en los que admite su unidad de stock; si no (el caso común, "se cocina al momento", sin fila
 * propia en el Kardex), el paso es libre. Sin esta precondición, un `pasoVenta` más fino que `Unidad.decimales` haría que el
 * propio Kardex tuviera que redondear la cantidad vendida del PV — silenciosamente, el mismo bug que esta tarea corrige para la
 * cantidad CARGADA.
 *
 * RESUELTO por la Task #27 (docs/plan-redondeo-consumo-fraccionado-2026-09-26.md): el consumo de MATERIA PRIMA que la receta de este
 * PV dispara (ej. vender 0,5 pizza pide 0,5 "bollo" a una MP en unidad de 0 decimales) ya NO se redondea "a secas" por separado en
 * cada venta — `registrar-venta.ts` arrastra un resto por (sucursal, producto consumido) con `src/core/movimientos/arrastre-
 * redondeo.ts` (`crearArrastreDeRedondeo`/`cargarDeudaDeRedondeo`), así que dos medias pizzas consumen 1 bollo en total, no 2 (ni 0
 * con paso 0,25). El arreglo es transparente para este archivo: sigue sin mirar la unidad de las materias primas de la receta, la
 * validación de acá (R3) solo protege la unidad del PV cuando tiene stock propio.
 */

/**
 * 0 a 4: cuántos decimales hacen falta para representar `n` exactamente (hasta 4) — 5 si necesita más. Exportada: además de
 * `validarPasoVenta`, la usan las dos transiciones peligrosas de R3 — marcar "Se produce" en un producto con un paso ya
 * inconsistente (`actualizarProducto`) y bajar `Unidad.decimales` por debajo de lo que algún producto "se produce" con paso
 * necesita (`actualizarDecimalesUnidad`).
 */
export function decimalesDelPaso(n: number): number {
  for (let d = 0; d <= 4; d++) {
    const factor = 10 ** d;
    if (Math.abs(Math.round(n * factor) - n * factor) < 1e-6) return d;
  }
  return 5;
}

/** «0,5», «0,25»: paso para un mensaje, siempre con coma decimal (nunca notación exponencial: `paso` está en (0, 1]). */
function formatearPaso(paso: number): string {
  return String(paso).replace(".", ",");
}

/**
 * true si `cantidad` es un múltiplo EXACTO de `paso` (tolerante al ruido de punto flotante — ej. 0,1 × 3 no es 0,3 en binario).
 * `paso` inválido (≤ 0) nunca cumple nada.
 */
export function cumplePaso(cantidad: number, paso: number): boolean {
  if (!(paso > 0) || !esNumeroFinito(paso) || !esNumeroFinito(cantidad)) return false;
  const cociente = cantidad / paso;
  return Math.abs(cociente - Math.round(cociente)) < 1e-6;
}

export interface OpcionesValidarPasoVenta {
  /** `Unidad.decimales` de la unidad de stock de ESTE producto. */
  decimalesUnidad: number;
  /** `tieneStockReal(producto.tipo, producto.seProduce)` — ver el docstring del módulo (R3). */
  tieneStockReal: boolean;
}

/**
 * Valida un `Producto.pasoVenta` al configurarlo (alta/edición de producto, o al validar las dos transiciones peligrosas que
 * podrían romper R3 después: marcar "Se produce" con un paso ya inconsistente, o bajar los decimales de la Unidad).
 *
 * Reglas (decisión de negocio, docs/plan-venta-fraccionada-2026-09-26.md):
 *  - `0 < paso ≤ 1`, hasta 4 decimales.
 *  - `1 / paso` tiene que ser un entero (0,5 / 0,25 / 0,2 / 0,125 / 0,1 valen; 0,3 no) — así una cantidad ENTERA sigue siendo
 *    siempre válida (1 es múltiplo de cualquiera de esos pasos).
 *  - R3: si `tieneStockReal`, los decimales que pide el paso no pueden superar los que admite la unidad de stock.
 */
export function validarPasoVenta(paso: unknown, opciones: OpcionesValidarPasoVenta): { ok: true; paso: number } | { ok: false; mensaje: string } {
  const n = typeof paso === "number" ? paso : Number.NaN;
  if (!esNumeroFinito(n)) return { ok: false, mensaje: "El paso de venta tiene que ser un número." };
  if (!(n > 0) || n > 1) return { ok: false, mensaje: "El paso de venta tiene que ser mayor que 0 y hasta 1." };

  const decimalesPaso = decimalesDelPaso(n);
  if (decimalesPaso > 4) return { ok: false, mensaje: "El paso de venta admite hasta 4 decimales." };

  const cociente = 1 / n;
  if (Math.abs(cociente - Math.round(cociente)) > 1e-6) {
    return { ok: false, mensaje: "El paso de venta tiene que dividir a 1 en partes iguales (ej. 0,5, 0,25, 0,2, 0,125 o 0,1)." };
  }

  if (opciones.tieneStockReal && decimalesPaso > opciones.decimalesUnidad) {
    return {
      ok: false,
      mensaje:
        `Este producto "se produce" (tiene stock propio): su unidad admite ${opciones.decimalesUnidad} decimal(es) y este paso ` +
        `necesita ${decimalesPaso} — usá una unidad propia con más precisión, o desmarcá "Se produce".`,
    };
  }

  return { ok: true, paso: Math.round(n * 10_000) / 10_000 };
}

/** Mensaje de rechazo de una cantidad que no es múltiplo exacto del paso de venta del producto (POS y mostrador, mismo texto). */
export function mensajeCantidadNoCumplePaso(paso: number): string {
  return `Se vende de a ${formatearPaso(paso)}: la cantidad tiene que ser un múltiplo exacto.`;
}
