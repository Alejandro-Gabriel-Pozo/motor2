/**
 * Fachada PÚBLICA y PURA del dominio `pos` (Pureza Fase 2, paso 2.1).
 *
 * Fuera de `core/pos/` se importa esta fachada o `public-servidor.ts`, nunca un archivo interno (regla `sin-internals-de-otro-dominio` de
 * `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan la base, ni directa ni transitivamente (regla `publico-puro` y
 * `fachadas-publicas-sin-io.test.ts`); lo que sí la toca va en `public-servidor.ts`. Los TIPOS se exportan desde acá aunque su archivo toque la base:
 * se borran al compilar y no arrastran nada al bundle.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export type { NumeroDeTicket } from "./numeracion-ticket";
export { precioMinimoPromo } from "./promo-combo";
export type { EstadoDeTicket, ItemConVenta, LineaDeTicket } from "./ticket";
export { formatearMonto } from "./formato";
export { nombreDeMesa } from "./formato";
export { formatearNumeroTicket } from "./numeracion-ticket";
export type { EstadoMesa } from "./mesas";
export { pediblesDeEntrada } from "./selector-carta";
export type { EntradaPromoSelectorCarta } from "./selector-carta";
export type { ProductoPedible } from "./selector-carta";
export type { SelectorCartaPos } from "./selector-carta";
export { estadoInicialSelectorCarta } from "./selector-carta-estado";
export { reducirSelectorCarta } from "./selector-carta-estado";
export { estadoInicialListaPorAgregar } from "./agregar-lista-estado";
export { itemsDeListaPorAgregar } from "./agregar-lista-estado";
export { listaPorAgregarLlena } from "./agregar-lista-estado";
export { puedeConfirmarListaPorAgregar } from "./agregar-lista-estado";
export { reducirListaPorAgregar } from "./agregar-lista-estado";
export type { EleccionParaAgregar } from "./armar-promo-estado";
export { MAXIMO_ITEMS_POR_AGREGADO } from "./cantidad-pedido";
export { formatearCantidad } from "./formato";
export { cantidadElegida } from "./armar-promo-estado";
export { eleccionParaAgregar } from "./armar-promo-estado";
export { estadoInicialArmarPromo } from "./armar-promo-estado";
export { puedeConfirmarArmarPromo } from "./armar-promo-estado";
export { reducirArmarPromo } from "./armar-promo-estado";
export { totalElegidoDelCupo } from "./armar-promo-estado";
export type { TicketDeCuenta } from "./ticket";
export { documentoDeReimpresion } from "./comanda";
export type { ComandaDeEnvio } from "./comanda";
export { resolverImpresion } from "./impresion";
export type { DocumentoImprimible } from "./impresion";
export type { PedidoImpresion } from "./impresion";
export type { ItemDeCuenta } from "./cuenta";
export type { ItemEnEnvio } from "./cuenta";
export { armarComandas } from "./comanda";
export type { EntradaCarpetaSelectorCarta } from "./selector-carta";
export type { EntradaSelectorCarta } from "./selector-carta";
export { SECCION_FUERA_DE_CARTA } from "./selector-carta-estado";
export type { AccionSelectorCarta } from "./selector-carta-estado";
export type { EstadoSelectorCarta } from "./selector-carta-estado";
export { estaEnListaPorAgregar } from "./agregar-lista-estado";
export type { EstadoListaPorAgregar } from "./agregar-lista-estado";
