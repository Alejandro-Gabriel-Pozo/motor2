/**
 * Fachada PÚBLICA DE SERVIDOR del dominio `catalogo` (Task #41, Fase C1 — piloto del patrón de fronteras por dominio).
 *
 * Los módulos de `catalogo` que alcanzan la base (`@/lib/db`) o el runtime de Prisma, directa o transitivamente. Separada de
 * `public.ts` a propósito: esa la importan módulos que terminan en el bundle del cliente, y esta no puede llegar ahí.
 *
 * Sin `import "server-only"`: Vitest, Playwright (specs que importan `core/`) y los scripts standalone (`tsx`) cargan
 * `core/` fuera de la resolución de módulos de Next, donde ese paquete tira al importarse.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export {
  disponibilidadDeProductos,
  disponibilidadPorSucursalDeProducto,
  productoDisponibleEn,
  whereDisponibleEn,
  whereDisponibleEnAlguna,
} from "./disponibilidad-producto-consulta";
export { preciosLocalesVigentes } from "./precio-local-consulta";
export { creariaCiclo, textoCadenaDeGrupos } from "./grupo";
export { validarFusionInsumos, validarUnidadInsumo } from "./producto";
export { dependenciasParaDesactivar } from "./desactivar-producto";
export { crearConCodigoAutogenerado, esErrorDeUnicidad } from "./generar-codigo";
export { validarCabecera, validarIngredientes, validarPasos } from "./receta-validacion";
export type { CabeceraRecetaInput, IngredienteInput, PasoInput } from "./receta-validacion";
