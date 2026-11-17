import { formatearMonto } from "@/core/formato-de-numero";

/**
 * INTERRUPTOR del armado de promociones «como Pedernal» (docs/diseno-promociones-igual-a-pedernal-2026-11-17.md, primer paso, solo PANTALLA). Una sola constante.
 *
 * Con `true`, la pantalla de Carta › Promociones muestra: la fila de cada promo con lo que lleva y «Activo / Pausado»; «Qué lleva» (lo que ya lleva arriba, y «Agregar un componente» plegado con el
 * resto de las secciones); «Cómo lo ve el cliente»; y dice «componente» donde decía «cupo». Con `false`, la pantalla de siempre. NO cambia lo que se guarda ni lo que se puede vender: los mismos campos,
 * la misma acción (`guardarCuposPromoCarta`), el mismo rango «de mín. a máx.» (la pregunta «cantidad exacta o rango» sigue abierta con el dueño).
 *
 * Nace APAGADO: el valor por defecto se decide con el visto del dueño sobre la captura (pedido del orquestador, 2026-11-17). Para volver atrás: poner `false`. Lo comprueba
 * `test/carta/armado-de-promo-como-pedernal.test.tsx` (los dos estados).
 */
export const ARMADO_DE_PROMO_COMO_PEDERNAL: boolean = false;

/** Una parte de la promo tal como se lee en pantalla: su nombre, el rango y, si es una lista con una sola entrada fija, cuál es. */
export interface ParteDeLaPromoParaLeer {
  nombre: string;
  cantidadMinima: number;
  cantidadMaxima: number;
  /** El producto de una lista que «viene fijo» (una sola entrada activa, con las opciones fijas y mín = máx); `null` en una sección o en una lista que se elige. */
  productoFijo: string | null;
}

/** Cómo se lee una parte: «2 × Hamburguesa» (fija), «1 de Entrada» (cantidad exacta) o «de 0 a 2 de Entrada» (rango). */
export function textoDeLaParte(p: ParteDeLaPromoParaLeer): string {
  if (p.productoFijo !== null && p.cantidadMinima === p.cantidadMaxima) return `${p.cantidadMaxima} × ${p.productoFijo}`;
  if (p.cantidadMinima === p.cantidadMaxima) return `${p.cantidadMaxima} de ${p.nombre}`;
  return `de ${p.cantidadMinima} a ${p.cantidadMaxima} de ${p.nombre}`;
}

/** Lo que lleva la promo, en una línea: «1 de Entrada + 2 × Hamburguesa». Sin partes: «Sin componentes todavía (solo informativa)». */
export function loQueLlevaLaPromo(partes: readonly ParteDeLaPromoParaLeer[]): string {
  return partes.length ? partes.map(textoDeLaParte).join(" + ") : "Sin componentes todavía (solo informativa)";
}

/** El estado de la promo en ESTA sucursal con las palabras de Pedernal. Se vende solo si está prendida en la empresa Y en la sucursal. */
export function estadoDeLaPromo(activaEnLaEmpresa: boolean, prendidaAca: boolean): { activo: boolean; texto: string } {
  if (!activaEnLaEmpresa) return { activo: false, texto: "Pausado en toda la empresa" };
  if (!prendidaAca) return { activo: false, texto: "Pausado en esta sucursal" };
  return { activo: true, texto: "Activo" };
}

/** El renglón de la lista de promos: «Menú ejecutivo — 1 de Entrada · Activo — $ 55.000,00». */
export function renglonDeLaLista(titulo: string, precio: number, partes: readonly ParteDeLaPromoParaLeer[], activaEnLaEmpresa: boolean, prendidaAca: boolean): string {
  return `${titulo} — ${loQueLlevaLaPromo(partes)} · ${estadoDeLaPromo(activaEnLaEmpresa, prendidaAca).texto} — ${formatearMonto(precio)}`;
}

/** «Cómo lo ve el cliente»: «Menú ejecutivo $ 55.000,00 — 1 de Entrada + 1 de Bebidas». */
export function comoLoVeElCliente(titulo: string, precio: number, partes: readonly ParteDeLaPromoParaLeer[]): string {
  return `${titulo} ${formatearMonto(precio)} — ${loQueLlevaLaPromo(partes)}`;
}
