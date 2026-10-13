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

// GO-2a: el catálogo de opciones de venta (administración, sin pantallas). Las listas cerradas y los topes que validan los guards de `core/features/catalogo/` y las
// reglas puras de la configuración (`validar-configuracion.ts`) que aplican los casos de uso de `server/actions/catalogo/casos-de-uso/`.
export { EFECTOS_DE_CONSUMO_DE_OPCION, MODOS_DE_PRECIO_DE_MEDIDA, TIPOS_DE_GRUPO_DE_OPCIONES } from "./tipos";
export type { DiferenciaDePrecio, ModoDePrecioDeMedida, TipoDeGrupoDeOpciones } from "./tipos";
export { MAXIMO_CONSUMOS_POR_VERSION, MERMA_MAXIMA_DE_CONSUMO } from "./validar-configuracion";
export type { ConsumoDeConfiguracion } from "./validar-configuracion";
