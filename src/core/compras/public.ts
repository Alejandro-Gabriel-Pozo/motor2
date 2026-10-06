/**
 * Fachada PÚBLICA y PURA del dominio `compras` (Pureza Fase 2, paso 2.1).
 *
 * Fuera de `core/compras/` se importa esta fachada, nunca un archivo interno (regla `sin-internals-de-otro-dominio` de
 * `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan `@/lib/db` ni el runtime de Prisma (regla `publico-puro`).
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio: la anulación y la corrección de una
 * compra, que consumen sus casos de uso (`server/actions/movimientos/casos-de-uso/`) y su persistencia (`server/persistencia/compras/`).
 */
export { claveDeLote, descripcionAuditoriaAnulacion, evaluarAnulacion, mensajeCompraAnulada } from "./anulacion";
export type { LineaComprada, LineaDeReversion, ResultadoAnulacion, SaldosPorLote } from "./anulacion";
export {
  cabeceraCoincide,
  clavesDeFactura,
  descripcionAuditoriaCorreccion,
  diferenciasDeCabecera,
  mensajeCompraCorregida,
  normalizarCorreccion,
  validarCorreccion,
} from "./correccion";
export type { CabeceraCompra } from "./correccion";
