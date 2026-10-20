import { opcionesParaLaCarta } from "../../src/core/carta/opciones-en-carta";
import type { ResumenDePrecios } from "../../src/core/pos/precio-de-configuracion";

/**
 * Texto de las caracterizaciones de precio y carta (Fase 0 de la ola «precio y carta»): las pruebas escriben con las mismas líneas (la de las combinaciones GO-3a, que
 * también las usaba, se retiró en la Fase 3).
 */
export const n = (x: number | null | undefined): string => (x === null || x === undefined ? "-" : x.toFixed(2));

export function textoDeResumen(r: ResumenDePrecios): string[] {
  const out = [`desde=${n(r.desde)} hayVariacion=${r.hayVariacion} vendible=${r.vendible}`];
  for (const g of r.grupos) {
    out.push(`  ${g.tipo} «${g.nombre}» min=${g.cantidadMinima} max=${g.cantidadMaxima}`);
    for (const o of g.opciones) out.push(`    ${o.nombre}${o.esNinguna ? " (ninguna)" : ""}: precioFinal=${n(o.precioFinal)} diferencia=${n(o.diferencia)}`);
  }
  return out;
}

/** Lo que la carta pública dibuja con el resumen (listas con precio o recargo y pastillas de las opciones sin costo). */
export function textoDeCarta(r: ResumenDePrecios): string[] {
  const c = opcionesParaLaCarta(r);
  if (c === null) return ["carta: el producto no sale (no vendible)"];
  const out = [`carta: desde=${n(c.desde)}`];
  for (const g of c.grupos) out.push(`  lista «${g.nombre}»: ${g.opciones.map((o) => (o.precio !== undefined ? `${o.nombre} ${n(o.precio)}` : `${o.nombre} ${(o.recargo ?? 0) < 0 ? "" : "+"}${n(o.recargo)}`)).join(" | ")}`);
  for (const s of c.sinCosto) out.push(`  pastillas «${s.grupo}»: ${s.opciones.join(" | ")}`);
  return out;
}
