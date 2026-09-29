/**
 * Fachada PÚBLICA y PURA del dominio `carta` (ADR-006, `docs/adr/ADR-006-carta-como-modulo-interno.md`).
 *
 * Fuera de `core/carta/` se importa esta fachada o `public-servidor.ts`, nunca un archivo interno (regla
 * `sin-internals-de-otro-dominio` de `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan `@/lib/db` ni el
 * runtime de Prisma, ni directa ni transitivamente (regla `publico-puro`). Lo que sí toca la base va en `public-servidor.ts`.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio
 * (`core/pos/selector-carta.ts` y `selector-carta-consulta.ts`).
 */
export type { CartaV1, ItemCartaV1, PromoCartaV1, SeccionCartaV1 } from "./armar-menu";
export { precioDeCarta } from "./armar-menu";
export type { Resultado } from "./validaciones";
export { formatearPrecioCarta } from "./precio-carta";
export type { EstiloCarta } from "./estilo";
export { resolverEstiloCarta } from "./estilo";
