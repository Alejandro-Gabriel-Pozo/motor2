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
export { cambiosPorColumna, cantidadesEfectivas, validarGrupo } from "./validar-configuracion";
export { contenidoDeVersionIgual, validarConsumos, validarOpcionNueva, validarVersion } from "./validar-configuracion";
export type { ContenidoDeVersion } from "./validar-configuracion";
export { controlarPrecioDeLista, validarAdmisionDeGrupo } from "./validar-configuracion";
export type { AdmisionDeOpcion } from "./validar-configuracion";

// GO-2b (la venta con opciones, ADR-030): las piezas puras que ahora usa la venta desde afuera de `core/opciones/` (`core/pos/linea-configurada.ts`, la lectura de
// las opciones para vender y el cierre). Para estas ya no rige el aviso de arriba («las consumen hoy solo los tests»): tienen consumidor de producción. La huella
// (`node:crypto`) NO va acá: va en `public-servidor.ts`, porque esta fachada llega al bundle del cliente.
export { validarOpcionesElegidas } from "./validar-opciones-elegidas";
export type { CodigoDeErrorDeOpciones, GrupoPermitido, OpcionElegida, OpcionPermitida } from "./validar-opciones-elegidas";
export { componerPrecioDeLinea } from "./componer-precio-de-linea";
export type { CodigoDeErrorDePrecio, OpcionParaPrecio } from "./componer-precio-de-linea";
export { versionVigente } from "./version-vigente";
export type { TipoDeDiferencia } from "./tipos";
// (GO-3b exportaba acá el precio por combinación, `combinaciones.ts`: se retiró con GO-3a en la Fase 3 de la ola «precio y carta».)

// GO-2d (las pantallas de opciones de venta, ADR-030 «Pantallas»): los textos puros que comparten la administración, el selector del POS y la carta pública.
export { ayudaDelTipoDeGrupo, espejoDeDiferencia, nombreDelTipoDeGrupo, resumenDeConsumos, textoDeDiferencia, textoDeLimites, textoDePorcentaje } from "./presentacion";

// OPCIONES-LIMPIEZA (G2): «Limpiar» — los candidatos a archivar según un criterio y la vista previa de los productos afectados (puro; lo usa `/catalogo/opciones/limpiar`).
export { CRITERIOS_DE_LIMPIEZA, candidatosALimpiar, productosAfectados } from "./limpieza";
export type { CriterioDeLimpieza, GrupoParaLimpiar, OpcionParaLimpiar, VentasRecientes } from "./limpieza";

// OPCIONES-FACTOR: el factor de un tamaño en palabras («Factor 1,3 = lleva 30% más que el tamaño base»), para el campo «El factor» de `/catalogo/opciones/[grupoId]`.
export { leerFactorDeEscala } from "./factor-de-escala";

// Fase 4 de la ola «precio y carta» (ADR-035): el modo de venta del producto (directo o «se vende por opción»).
export { MENSAJE_FALTA_PRECIO_FINAL, esBaseConfigurable, precioDeReferenciaDeAdmisiones, rechazoDeAdmisionesDeBase, rechazoDeBaseConfigurable, rechazoDelProductoComoBase } from "./modo-de-venta";
export type { AdmisionParaSerBase, ProductoParaSerBase } from "./modo-de-venta";
export { MODOS_DE_VENTA } from "./tipos";
export type { ModoDeVenta } from "./tipos";
