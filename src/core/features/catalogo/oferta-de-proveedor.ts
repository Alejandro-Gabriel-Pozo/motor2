import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";

/**
 * Qué le compramos a un proveedor (M1, C20): productos, servicios o ambos. Son dos marcas (`ofreceProductos`, `ofreceServicios`) y «ninguna» no existe (CHECK de la base
 * `Proveedor_ofrece_productos_o_servicios_chk`). Puro: lo usan el guard del alta, el caso de uso de la edición y las pantallas (la etiqueta). Por ahora son solo una
 * CLASIFICACIÓN que se muestra y se edita: no filtran compras ni gastos (eso es otra etapa).
 */
export interface OfertaDeProveedor {
  ofreceProductos: boolean;
  ofreceServicios: boolean;
}

export const MENSAJE_AL_MENOS_UNA_OFERTA = "Marcá al menos una opción: el proveedor ofrece productos, servicios o las dos cosas.";

/** Las dos marcas ya como booleanos: lo que no es `true` es `false` (una casilla desmarcada). Rechaza «ninguna». */
export function validarOferta(ofreceProductos: unknown, ofreceServicios: unknown): ResultadoDato<OfertaDeProveedor> {
  const oferta = { ofreceProductos: ofreceProductos === true, ofreceServicios: ofreceServicios === true };
  if (!oferta.ofreceProductos && !oferta.ofreceServicios) return rechazar("vacio", MENSAJE_AL_MENOS_UNA_OFERTA);
  return aceptar(oferta);
}

/** La etiqueta que se ve en la ficha y en la lista. */
export function etiquetaDeOferta(oferta: OfertaDeProveedor): "Productos" | "Servicios" | "Productos y servicios" {
  if (oferta.ofreceProductos && oferta.ofreceServicios) return "Productos y servicios";
  return oferta.ofreceServicios ? "Servicios" : "Productos";
}
