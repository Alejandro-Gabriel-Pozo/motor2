/**
 * Fachada PÚBLICA y PURA del dominio `catalogo` (Task #41, Fase C1 — piloto del patrón de fronteras por dominio).
 *
 * Fuera de `core/catalogo/` se importa esta fachada o `public-servidor.ts`, nunca un archivo interno (regla
 * `sin-internals-de-otro-dominio` de `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan `@/lib/db` ni el
 * runtime de Prisma, ni directa ni transitivamente (regla `publico-puro`): la importan módulos que terminan en el bundle
 * del cliente (ej. `core/pos/cantidad-pedido.ts`), así que meter acá algo que toque la base la arrastraría al navegador.
 * Lo que sí toca la base va en `public-servidor.ts`.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export { cumplePaso, decimalesDelPaso, mensajeCantidadNoCumplePaso, validarPasoVenta } from "./venta-fraccionada";
export { rendimientoEfectivo } from "./rendimiento-local";
export { creariaCicloEnArbol, textoCadenaDeGruposEn } from "./cadena-de-grupos";
export type { NodoDeGrupo } from "./cadena-de-grupos";
export { clasificarGruposNoComestibles } from "./no-comestibles";
export type { ClasificacionNoComestibles } from "./no-comestibles";
export type { FiltroSelectorProducto } from "./filtro-selector-producto";
export { aplicarSecuencia, esPermutacionExacta, insertarEnPosicion, secuenciaMoviendo } from "./pasos-receta";
export { filtrarPreciosLocalesVigentes } from "./precio-local";
export type { PrecioLocalVigente } from "./precio-local";
export { productosUniversales } from "./disponibilidad-producto";
export type { FilaDisponibilidadEnSucursal } from "./disponibilidad-producto";
export { describirCambioVersionReceta, describirCopiaDeRecetaPropia, describirRecetaPropiaGuardada, describirVueltaALaRecetaCentral } from "./describir-cambio-receta";
export { describirCalibracion, describirDescarteArrastre, describirVueltaAlCentral, normalizarOrigen } from "./origen-cambio-receta";
// Hito 4, H4C-5: el comando de la calibración (`core/features/catalogo/rendimiento-local.schema.ts`) lleva el origen ya normalizado por su guard.
export type { OrigenNormalizado } from "./origen-cambio-receta";
export type { OrigenCalibracionInput } from "./origen-cambio-receta";
export {
  claveDeUnidadDeSustituto,
  validarCabecera,
  validarDatosDeIngrediente,
  validarEncabezadoDePaso,
  validarEnterosDeCabecera,
  validarIngredientes,
  validarMinutosYMarcadosDePaso,
  validarPasos,
  validarTextosYTopesDeCabecera,
} from "./receta-validacion";
export type { CabeceraRecetaInput, DatosParaValidarReceta, IngredienteInput, PasoInput } from "./receta-validacion";
export { resolverDisponibilidad, resolverDisponibilidadPorSucursal } from "./disponibilidad-producto";
export { whereDisponibleEn, whereDisponibleEnAlguna } from "./disponibilidad-producto-consulta";
export { ALCANCE_CENTRAL, alcanceDeSucursal, incluirRecetaVigente, quedarseConLaVigente, whereConReceta } from "./recetas-vigentes";
export type { AlcanceCentral, AlcanceDeReceta } from "./recetas-vigentes";
// Hito 4, paso A5 (O.8a): el armado puro de la comparativa de precios por insumo (lo usa el lector de la comparativa, server/lecturas/catalogo/ofertas-de-proveedor.ts).
export { armarComparativaDePrecios } from "./comparativa-de-precios";
export type { FilaComparativaPrecios } from "./comparativa-de-precios";
