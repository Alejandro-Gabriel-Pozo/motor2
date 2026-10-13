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

// GO-2b (la venta con opciones, ADR-030): las piezas puras que ahora usa la venta desde afuera de `core/opciones/` (`core/pos/linea-configurada.ts`, la lectura de
// las opciones para vender y el cierre). Para estas ya no rige el aviso de arriba («las consumen hoy solo los tests»): tienen consumidor de producción.
export { validarOpcionesElegidas } from "./validar-opciones-elegidas";
export type { CodigoDeErrorDeOpciones, GrupoPermitido, OpcionElegida, OpcionPermitida } from "./validar-opciones-elegidas";
export { componerPrecioDeLinea } from "./componer-precio-de-linea";
export type { CodigoDeErrorDePrecio, OpcionParaPrecio } from "./componer-precio-de-linea";
export { huellaDeOpciones } from "./huella-de-opciones";
export { versionVigente } from "./version-vigente";
export type { DiferenciaDePrecio, ModoDePrecioDeMedida, TipoDeDiferencia, TipoDeGrupoDeOpciones } from "./tipos";
