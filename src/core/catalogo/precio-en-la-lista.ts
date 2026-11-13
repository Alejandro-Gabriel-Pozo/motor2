import { esBaseConfigurable } from "@/core/opciones/public";
import { formatearMonto } from "@/core/formato-de-numero";

/**
 * Lo que dice la lista de Productos en el lugar del precio (maqueta aprobada de Pedernal, «Productos y precios»; docs/diseno-productos-igual-a-pedernal-2026-11-13.md, D1). Puro: no lee nada.
 *
 *  - Un producto de venta DIRECTO con precio: «$ 9.500,00» (el de la sucursal activa si tiene precio propio vigente, si no el central: eso lo decide quien llama).
 *  - Un producto de venta DIRECTO con precio 0: «Sin precio» (es lo mismo que marca el filtro «Sin precio de venta»).
 *  - Un producto de venta POR OPCIÓN: «Según medida» (su precio está en cada opción de su grupo de medida, no hay un precio propio).
 *  - Lo que no se vende (materia prima, incluida la que se produce): `null`, no lleva precio de venta.
 */
export type TextoDePrecioDeLaLista = string | null;

export function textoDelPrecioEnLaLista(producto: { tipo: "MP" | "PV"; modoDeVenta: string; precio: number }): TextoDePrecioDeLaLista {
  if (producto.tipo !== "PV") return null;
  if (esBaseConfigurable(producto.modoDeVenta)) return "Según medida";
  return producto.precio > 0 ? formatearMonto(producto.precio) : "Sin precio";
}
