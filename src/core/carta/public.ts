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
export type { CartaV1 } from "./armar-menu";
// S-25: lo único que la carta pública entrega a un anónimo (la carta armada SIN los ids internos) y la proyección que la arma; ver `carta-publica.ts`.
export type { CartaPublicaV1, ItemCartaPublico, PromoCartaPublica, SeccionCartaPublica } from "./carta-publica";
export { etiquetaDeCacheDeCartasPublicas, proyectarCartaPublica } from "./carta-publica";
export { precioDeCarta } from "./armar-menu";
export { precioDePromo, seleccionDeSucursalDePromo, wherePromoOfrecidaEn } from "./promo-sucursal";
// GO-3 (ADR-032): los tipos de cupo y la lectura tolerante del primer despliegue (solo los cupos de sección activos; una promo con un cupo activo de tipo nuevo no se ofrece).
export { WHERE_CUPO_ACTIVO_DE_TIPO_NUEVO, WHERE_CUPO_DE_SECCION_ACTIVO, cuposDeSeccionActivos } from "./cupos-de-promo";
export type { TipoDeCupo } from "./cupos-de-promo";
// GO-3b (D3): la administración de los cupos sin borrar (la clave natural de cada cupo y la diferencia contra lo que hay) y los tipos de cupo para el guard.
export { LARGO_MAXIMO_NOMBRE_DE_CUPO, TIPOS_DE_CUPO, claveNaturalDeCupo, diferenciaDeCupos } from "./cupos-de-promo";
export type { CupoExistente, CupoPedido } from "./cupos-de-promo";
export { aplicarDescuentoDeProducto, precioCobradoConDescuentos } from "./descuento-producto";
export type { Resultado } from "./validaciones";
// Hito 4, H4C-2: el guard de las promos (`core/features/carta/promos.guard.ts`) valida con los mismos validadores de la carta que usaba la Server Action.
export { LARGO_MAXIMO_DESCRIPCION_CARTA, LARGO_MAXIMO_TITULO_CARTA, validarCantidadCupoPromo, validarOrdenCarta, validarPrecioCarta, validarTextoLibreCarta } from "./validaciones";
// Hito 5, bloque D: los guards de la configuración de la carta (`core/features/carta/{secciones,generos,…}.guard.ts`) validan con los mismos validadores que usaban las Server Actions.
export { normalizarTagsCarta, validarImagenUrlCarta, validarNombreGeneroCarta, validarNombreItemAgrupadoCarta, validarNombreSeccionCarta } from "./validaciones";
// Hito 5, bloque D: el guard del registro público del portal (`core/features/carta/registro-publico.guard.ts`) valida con los mismos validadores que usaba la Server Action.
export { LARGO_MAXIMO_ETIQUETA_PORTAL, LARGO_MAXIMO_SUBTITULO_PORTAL, validarPosicionPortal, validarSlugTenant } from "./validaciones";
export type { PosicionPortal } from "./validaciones";
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
export { origenPublicoDeCarta, urlCartaPublicaConEmpresaUnica } from "./carta-empresa-unica";
export { MARCA_PUBLICA } from "./marca";
export { textoRobotsDeCarta, xmlSitemapDeCarta } from "./robots-sitemap";
export type { MetadatosPublicos } from "./metadatos";
export { descripcionDeCartaDeSucursal, descripcionDelPortal, imagenParaCompartir, tituloDeCartaDeSucursal, tituloDelPortal } from "./metadatos";
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
// Hito 5, bloque D: el guard y los casos de uso del tema (`core/features/carta/tema.guard.ts`, `casos-de-uso/{guardar-tema-carta,cambiar-aplicacion-tema}.ts`) usan los mismos validadores y contadores que usaba la Server Action.
export { contarValoresTema, validarValoresTema } from "./tema";
export type { ValoresTema } from "./tema";
export { ZONAS_TEMA } from "./tema";
export type { DefinicionClaveTema } from "./tema";
export { ordenSugeridoAlElegirSeccion } from "./orden-sugerido";
export type { SeccionCartaAdmin, GeneroCartaAdmin, SucursalConCartaPropia, DatosAdminCarta, OpcionItemAgrupadoAdmin, DatosAdminItemsAgrupados, PortalEmpresaAdmin } from "./admin-tipos";
// GO-3b (U1): los combos de la carta (lugares de entradas, entradas y vigencia).
export type { CombosDeLaCarta, LugarDeCombo, ProductoParaEntrada, VigenciaDePromoAdmin } from "./admin-tipos";
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
// GO-3b (ADR-032, D-7): la vigencia de una promo (el guard de la administración la valida; la venta la evalúa al agregar).
export { TODOS_LOS_DIAS, mascaraDeDias, promoVigenteEl, validarVigenciaDePromo } from "./vigencia-de-promo";
export type { VigenciaDePromo } from "./vigencia-de-promo";
// GO-3b (ADR-032, D-1): la fecha del menú del día (de hoy a hoy + 13, en la zona de la empresa).
export { DIAS_DE_ANTICIPACION_DEL_MENU, validarFechaDeMenuDelDia } from "./menu-del-dia";
export type { CandidatoAPlato, MenuDelDiaDeLaSucursal } from "./menu-del-dia";
// CARTA-MANT (mantenimiento de la carta): en qué lista va cada producto de la pantalla de la carta («Fuera de carta» es el POS y el menú del día, no un faltante).
export { coincideConLaBusqueda, lugaresParaPoner, ordenAlFinalDeLaSeccion, organizarCartaParaMantener, ponerEnElLugar, vistaPreviaDeOpciones } from "./mantenimiento";
export type { CartaParaMantener, ProductoParaMantener } from "./mantenimiento";
// CARTA-MANT: la vista previa de «Agregar a la carta» usa la MISMA presentación de opciones que la carta pública.
export { opcionesParaLaCarta } from "./opciones-en-carta";
