/**
 * Fachada PÚBLICA y PURA del dominio `carta` (ADR-006, `docs/adr/ADR-006-carta-como-modulo-interno.md`).
 *
 * Fuera de `core/carta/` se importa esta fachada o `public-servidor.ts`, nunca un archivo interno (regla
 * `sin-internals-de-otro-dominio` de `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan `@/lib/db` ni el
 * runtime de Prisma, ni directa ni transitivamente (regla `publico-puro`). Lo que sí toca la base va en `public-servidor.ts`.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio (`core/pos/selector-carta.ts`, `selector-carta-consulta.ts`, y desde la
 * Fase 4 el `proxy` y `env.ts`, que importan lo del host y de la empresa única por esta fachada y no por los archivos internos; `next.config.ts` no puede: ver su comentario).
 */
export type { CartaV1, ItemCartaV1, PromoCartaV1, SeccionCartaV1 } from "./armar-menu";
export { precioDeCarta } from "./armar-menu";
export { precioDePromo, seleccionDeSucursalDePromo, wherePromoOfrecidaEn } from "./promo-sucursal";
export { aplicarDescuentoDeProducto, precioCobradoConDescuentos } from "./descuento-producto";
export type { Resultado } from "./validaciones";
// Hito 4, H4C-2: el guard de las promos (`core/features/carta/promos.guard.ts`) valida con los mismos validadores de la carta que usaba la Server Action.
export { LARGO_MAXIMO_DESCRIPCION_CARTA, LARGO_MAXIMO_TITULO_CARTA, validarOrdenCarta, validarPrecioCarta, validarTextoLibreCarta } from "./validaciones";
// Hito 5, bloque D: los guards de la configuración de la carta (`core/features/carta/{secciones,generos,…}.guard.ts`) validan con los mismos validadores que usaban las Server Actions.
export { validarImagenUrlCarta, validarNombreGeneroCarta, validarNombreSeccionCarta } from "./validaciones";
export { formatearPrecioCarta } from "./precio-carta";
export { whereCartaDeSucursal } from "./carta-de-sucursal";
export type { EstiloCarta } from "./estilo";
export { resolverEstiloCarta } from "./estilo";
export type { EstiloPortal } from "./portal";
export { decidirLayoutPortal, resolverEstiloPortal } from "./portal";
export type { ItemAgrupadoAdmin } from "./admin-tipos";
export type { ProductoCartaAdmin } from "./admin-tipos";
export type { SucursalPortalAdmin } from "./admin-tipos";
export { CLAVES_PORTAL_V1 } from "./portal";
export { urlCartaPublicaConEmpresaUnica } from "./carta-empresa-unica";
export type { TemaAdmin } from "./admin-tipos";
export { CLAVES_TEMA_V1 } from "./tema";
export { entradasVistaPreviaPortal } from "./admin-tipos";
export type { EntradaVistaPreviaPortal } from "./admin-tipos";
export { avisoImagenSinMapa } from "./portal";
export { validarValorPortal } from "./portal";
// Hito 5, bloque D: el guard de la apariencia del portal (`core/features/carta/portal-empresa.guard.ts`) valida con el mismo validador que usaba la Server Action.
export { validarValoresPortal } from "./portal";
export type { ValoresPortal } from "./portal";
export { ZONAS_PORTAL } from "./portal";
export type { DefinicionClavePortal } from "./portal";
export { validarValorTema } from "./tema";
export { ZONAS_TEMA } from "./tema";
export type { DefinicionClaveTema } from "./tema";
export { ordenSugeridoAlElegirSeccion } from "./orden-sugerido";
export type { SeccionCartaAdmin, GeneroCartaAdmin, SucursalConCartaPropia, DatosAdminCarta, OpcionItemAgrupadoAdmin, DatosAdminItemsAgrupados, PortalEmpresaAdmin } from "./admin-tipos";
export { esClavePortal } from "./portal";
export { esClaveTema } from "./tema";
export { ofrecerSincronizarPrecio } from "./grupo-de-producto";
export type { GrupoDeProducto, SincronizablePrecioGrupo } from "./grupo-de-producto";
export { armarMenuCarta } from "./armar-menu";
export type { MenuArmado } from "./armar-menu";
export { descuentosVigentes } from "./descuento-producto";
export { esSlugPublicoValido, esHostDeZonaCarta, esMetodoDeLecturaEnHostCarta, esPathPermitidoEnHostCarta, interpretarHostCarta } from "./host";
export { esHostDeEmpresaUnica } from "./carta-empresa-unica";
export { estiloCartaPorDefecto } from "./estilo";
export { posicionCompleta } from "./portal";
export type { EntradaPortalCarta } from "./portal";
