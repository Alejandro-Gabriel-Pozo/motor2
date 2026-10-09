import { redondearACantidadDeUnidad } from "@/core/movimientos/transiciones";

/**
 * Task #27 (docs/plan-redondeo-consumo-fraccionado-2026-09-26.md): arrastre de redondeo por (sucursal, producto consumido) — núcleo
 * PURO, sin Prisma (el cargador que arma la deuda inicial es `cargarDeudaDeRedondeo`, en `server/lecturas/movimientos/deuda-de-redondeo.ts`), mismo criterio que
 * `origen-venta.ts`.
 *
 * EL PROBLEMA: `redondearACantidadDeUnidad` (transiciones.ts) redondea CADA parte de consumo de CADA venta por separado, sin memoria
 * entre ventas. Con una unidad de 0 decimales, dos ventas de 0,5 escriben 1 + 1 = 2 en vez de 1 (Math.round redondea el 0,5 hacia
 * arriba); con paso 0,25, cuatro cuartos escriben 0 (Math.round redondea 0,25 hacia abajo) — el Kardex se aleja del consumo real
 * cuanto más fraccionada es la venta.
 *
 * LA SOLUCIÓN: en vez de redondear `x` (la cantidad EXACTA de esta parte) a secas, se redondea `D + x` — la deuda acumulada de las
 * partes anteriores del mismo producto MÁS esta — y la deuda se actualiza con lo que quedó sin escribir: `D' = D + x − escrito`. Con
 * `D = 0` (todo dato existente, y la primera venta de cada producto) el resultado es IDÉNTICO al de hoy (`redondearACantidadDeUnidad`
 * a secas) — ninguna venta aislada cambia. Con `Math.round`, `D` se mantiene siempre en `[−u/2, u/2)` (`u = 10^-decimales`): el
 * Kardex nunca se aparta más de media unidad del consumo exacto acumulado, y esa media unidad se corrige sola en cuanto la deuda
 * cruza el medio paso de vuelta — nunca se acumula sin límite.
 *
 * ALCANCE DE LA DEUDA: por (sucursal, producto), nunca por sección ni por lote — coincide con la clave del redondeo actual (el
 * producto de la parte, `c.productoId` en `registrar-venta.ts`). El resto puede cruzar secciones (la sección A escribe el bollo
 * entero, la B el 0 de la sobra) — el TOTAL de la sucursal queda exacto; el error por sección es de ±1 unidad como máximo,
 * corregible con conteo físico, igual que cualquier redondeo de reparto.
 *
 * NO GENERA SALDOS NEGATIVOS NUEVOS: cada parte que entrega el reparto (`origen-venta.ts`) es ≤ lo disponible del lote, que ya es un
 * múltiplo de `u`. Con `D` siempre en `[−u/2, u/2)`, `round(D + parte) ≤ disponible` — la validación de stock del mostrador
 * (`faltantesDe`, con el valor EXACTO, sin pasar por acá) sigue sin dejar pasar nada que lleve el Kardex a negativo.
 */

const r8 = (n: number) => redondearACantidadDeUnidad(n, 8);

/** `-0` → `0` (Math.round de un negativo que redondea a cero, ej. Math.round(-0.25), devuelve -0 — el Kardex nunca debe guardar signo en un cero). */
const sinCeroNegativo = (n: number) => n || 0;

export interface ResultadoArrastre {
  /** Magnitud a ESCRIBIR en el Kardex (`MovimientoStock.cantidad`, sin signo todavía — quien llama aplica el signo del proceso) — siempre múltiplo exacto de `10^-decimales`. */
  cantidad: number;
  /**
   * Magnitud EXACTA de esta parte (sin signo), solo cuando difiere de `cantidad` (representar de más no aporta nada: el Kardex ya
   * queda exacto con `cantidad` a secas) — `null` en caso contrario, mismo criterio que el resto de columnas opcionales de
   * `MovimientoStock` (no se llena redundante con el mismo valor).
   */
  cantidadExacta: number | null;
}

export interface ArrastreDeRedondeo {
  /**
   * Consume `exacto` (magnitud, SIN signo) del producto `productoId`, con `decimales` = `Unidad.decimales` de SU unidad de stock
   * (la misma fuente que redondeaba antes en `registrar-venta.ts:374`) — devuelve lo que hay que escribir, y actualiza la deuda
   * interna de ESE producto para la próxima parte (de esta venta o de una posterior, si `consumir` vuelve a llamarse sobre el mismo
   * arrastre).
   */
  consumir(productoId: string, exacto: number, decimales: number): ResultadoArrastre;
}

/**
 * `deudaInicial`: la deuda de arranque de cada producto (`productoId → D`), típicamente cargada desde el Kardex por
 * `cargarDeudaDeRedondeo` — ausente o sin ese producto = 0 (ninguna venta previa de ese producto, o todas sus partes fueron
 * exactas). Se copia (no se muta el Map recibido).
 */
export function crearArrastreDeRedondeo(deudaInicial: ReadonlyMap<string, number> = new Map()): ArrastreDeRedondeo {
  const deuda = new Map(deudaInicial);

  return {
    consumir(productoId, exacto, decimales) {
      const exactoLimpio = r8(exacto);
      const deudaPrevia = deuda.get(productoId) ?? 0;
      const escrito = sinCeroNegativo(redondearACantidadDeUnidad(r8(deudaPrevia + exactoLimpio), decimales));
      deuda.set(productoId, deudaPrevia + exactoLimpio - escrito);
      return { cantidad: escrito, cantidadExacta: exactoLimpio === escrito ? null : exactoLimpio };
    },
  };
}
