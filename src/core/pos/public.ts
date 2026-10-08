/**
 * Fachada PÚBLICA y PURA del dominio `pos` (Pureza Fase 2, paso 2.1; completada en la Fase 3).
 *
 * Fuera de `core/pos/` se importa esta fachada, nunca un archivo interno (regla `sin-internals-de-otro-dominio` de `.dependency-cruiser.cjs`). Acá van SOLO los
 * módulos que no alcanzan la base, ni directa ni transitivamente (regla `publico-puro` y `fachadas-publicas-sin-io.test.ts`). Desde la Fase 3 todo `core/pos` es
 * puro: las lecturas viven en `server/consultas/pos/` y `server/lecturas/pos/`, y `pos` ya no tiene `public-servidor.ts`.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export { estaEnListaPorAgregar, estadoInicialListaPorAgregar, itemsDeListaPorAgregar, listaPorAgregarLlena, puedeConfirmarListaPorAgregar, reducirListaPorAgregar } from "./agregar-lista-estado";
export type { EstadoListaPorAgregar } from "./agregar-lista-estado";
export { cantidadElegida, eleccionParaAgregar, estadoInicialArmarPromo, puedeConfirmarArmarPromo, reducirArmarPromo, totalElegidoDelCupo } from "./armar-promo-estado";
export type { EleccionParaAgregar } from "./armar-promo-estado";
export { MAXIMO_ITEMS_POR_AGREGADO } from "./cantidad-pedido";
export { armarComandas } from "./comanda";
export type { ComandaDeEnvio } from "./comanda";
export { armarDetalleDeMesa, claveDeLineaDeVenta, lineasDeVenta } from "./cuenta";
export type { DetalleDeMesa, ItemDeCuenta, ItemEnEnvio } from "./cuenta";
export { formatearCantidad, formatearMonto, nombreDeMesa } from "./formato";
export { documentoDeReimpresion, resolverImpresion } from "./impresion";
export type { DocumentoImprimible, PedidoImpresion } from "./impresion";
export { armarMapaDeMesas, esEstadoMesa, filtrarMesas, nombreDelMesero, validarMaxMesasAbiertas } from "./mesas";
export type { EstadoMesa, MapaDeMesas } from "./mesas";
export { formatearNumeroTicket } from "./numeracion-ticket";
export type { NumeroDeTicket } from "./numeracion-ticket";
export { precioMinimoPromo } from "./promo-combo";
export type { CupoPromoDefinicion } from "./promo-combo";
export { armarSelectorCartaPos, pediblesDeEntrada } from "./selector-carta";
export type { EntradaCarpetaSelectorCarta, EntradaPromoSelectorCarta, EntradaSelectorCarta, GenerosSelectorCartaPos, ProductoPedible, PromoSelectorCartaPos, SelectorCartaPos } from "./selector-carta";
export { SECCION_FUERA_DE_CARTA, estadoInicialSelectorCarta, reducirSelectorCarta } from "./selector-carta-estado";
export type { AccionSelectorCarta, EstadoSelectorCarta } from "./selector-carta-estado";
export { TICKETS_RECIENTES_POR_MESA, armarTicketImpresoEn, armarTicketsDeCuentas, estadoDeTicket } from "./ticket";
export type { EstadoDeTicket, ItemConVenta, LineaDeTicket, TicketDeCuenta } from "./ticket";
