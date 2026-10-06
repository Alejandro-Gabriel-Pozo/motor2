/**
 * Fachada PÚBLICA y PURA del dominio `fiscal` (Pureza 0.5: `fiscal` pasa de infraestructura transversal a dominio de negocio, porque va a crecer con el IVA, los
 * tributos y el emisor fiscal de tres modos).
 *
 * Fuera de `core/fiscal/` se importa esta fachada o `public-servidor.ts`, nunca un archivo interno (regla `sin-internals-de-otro-dominio` de
 * `.dependency-cruiser.cjs`). Acá va SOLO lo puro: los identificadores fiscales (CUIT) y su diagnóstico.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export { formatearCuit, normalizarCuit, validarCuit } from "./cuit";
export { diagnosticarCuits } from "./diagnostico-cuit";
export type { DiagnosticoDeCuit, FilaConCuit } from "./diagnostico-cuit";
