/**
 * Fachada PÚBLICA y PURA del dominio `opciones` (GO-0b, el «elemento configurable»: grupos de opciones de venta).
 *
 * Fuera de `core/opciones/` se importa esta fachada, nunca un archivo interno (regla `sin-internals-de-otro-dominio` de `.dependency-cruiser.cjs`). Acá van SOLO los tipos
 * y topes de las listas cerradas que otros dominios necesitan nombrar; las funciones (validar lo elegido, componer el precio, la huella) las consumen hoy solo los tests y se
 * exponen acá el día que GO-2 las use desde afuera (un export sin consumidor lo marca `npm run analizar:muerto`).
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica).
 */
export { CANTIDAD_MAXIMA_DE_OPCION, FACTOR_DE_ESCALA_MAXIMO } from "./tipos";
export type { EfectoDeConsumoDeOpcion } from "./tipos";
