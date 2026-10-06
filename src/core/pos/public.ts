/**
 * Fachada PÚBLICA y PURA del dominio `pos` (Pureza Fase 2, paso 2.1).
 *
 * Fuera de `core/pos/` se importa esta fachada, nunca un archivo interno (regla `sin-internals-de-otro-dominio` de
 * `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan `@/lib/db` ni el runtime de Prisma (regla `publico-puro`).
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export { claveDeLineaDeVenta, lineasDeVenta } from "./cuenta";
export { nombreDelMesero } from "./mesas";
export type { NumeroDeTicket } from "./numeracion-ticket";
export { precioMinimoPromo } from "./promo-combo";
export { armarTicketImpresoEn, estadoDeTicket } from "./ticket";
export type { EstadoDeTicket, ItemConVenta, LineaDeTicket } from "./ticket";
