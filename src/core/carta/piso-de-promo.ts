import { precioMinimoPromo } from "@/core/pos/public";

/**
 * El PISO de precio de una promo armable (Task #16, docs/plan-promo-combo-2026-09-26.md, D3): $0,01 por unidad en el PEOR caso, con todos los cupos en su
 * máximo (`precioMinimoPromo`, core/pos/promo-combo.ts). Sin esto, una elección real podría no tener forma de prorratear el precio sin dejar algún componente
 * en $0. Vale para el precio de la empresa y para el precio local de cualquier sucursal.
 *
 * Hito 4 de la pureza (bloque 4.2, paso H4C-2): estas dos funciones vivían privadas en la Server Action `src/server/actions/carta/promos.ts` y se mudaron TAL
 * CUAL (mismo cálculo, mismo texto) para que las usen los casos de uso del precio local de la promo y de sus cupos. Puras: sin Prisma ni reloj.
 *
 * Se importa por su ruta (no por `core/carta/public.ts`): `core/pos` ya depende de la fachada de la carta, y si la fachada reexportara este archivo (que
 * depende de `core/pos/public`) se armaría un ciclo.
 */
export interface PisoDePromo {
  /** El precio mínimo admitido ($0,01 por unidad, redondeado a moneda). */
  minimo: number;
  /** Cuántas unidades suma el peor caso (todos los cupos en su máximo). */
  unidades: number;
}

/** El piso de precio de una promo con estos cupos (peor caso: todos en su máximo), o `null` si no tiene cupos (informativa: sin piso). */
export function pisoDePrecioDePromo(cupos: readonly { cantidadMaxima: number }[]): PisoDePromo | null {
  if (!cupos.length) return null;
  const unidades = cupos.reduce((suma, c) => suma + c.cantidadMaxima, 0);
  return { minimo: precioMinimoPromo([{ cantidad: unidades }]), unidades };
}

/** El mensaje del rechazo cuando `precio` no alcanza el piso: nombra la promo, el precio, las unidades del peor caso y el mínimo. */
export function mensajePisoDePromo(titulo: string, precio: number, piso: PisoDePromo): string {
  return (
    `El precio de "${titulo}" ($${precio}) no alcanza el piso de $0,01 por unidad en el peor caso ` +
    `(${piso.unidades} unidades si se elige el máximo de cada cupo: hace falta al menos $${piso.minimo}). Subí el precio o bajá los máximos.`
  );
}
