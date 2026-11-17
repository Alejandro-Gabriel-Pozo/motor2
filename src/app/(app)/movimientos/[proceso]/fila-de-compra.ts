import type { UnidadesDeCompraDelProducto } from "@/core/compras/public";

/**
 * Una fila («Qué compraste») de la compra por pasos y su valor de partida. Salió de `panel-compra-por-pasos.tsx` tal cual (solo se le sumaron los dos campos de la orden de compra) para que ese archivo no crezca
 * (cerco «tope de líneas»).
 */
export interface FilaCompra {
  productoId: string;
  /** Precarga: evita que SelectorProducto arranque vacío para una fila ya resuelta. */
  etiquetaInicial: string;
  /** NUESTRO código (Producto.codigo) y nombre, solo lectura. Vacíos hasta que el servidor responde. */
  codigo: string;
  nombre: string;
  /** Unidades en que se puede comprar el producto; `null` mientras se leen. */
  unidades: UnidadesDeCompraDelProducto | null;
  /** Vacío = la unidad por defecto del producto; si no, el id de una presentación activa. */
  unidadCompraId: string;
  /** Nombre de la unidad de la última compra cuando ya no está activa (hay que confirmar la que quedó). */
  unidadNoVigente: string | null;
  unidadConfirmada: boolean;
  cantidad: string;
  loteVencimiento: string;
  importe: string;
  pesoReal: string;
  referenciaProveedor: string;
  /** Solo referencia visual, no se manda al servidor. */
  ultimaCompraTexto: string;
  /** La fila vino de la precarga de un proveedor y nadie la tocó desde entonces: al cambiar de proveedor se descarta (las de otro proveedor no se arrastran). */
  precargada: boolean;
  /** Orden de compra (etapa OC): el número de la línea de la orden elegida contra la que se recibe este renglón; vacío = ninguna (nada «viene vinculado»). */
  lineaDeOrden: string;
  /** Orden de compra: confirmo recibir más de lo pedido en esa línea (nace sin tildar). */
  confirmoExceso: boolean;
}

export const FILA_VACIA: FilaCompra = {
  productoId: "",
  etiquetaInicial: "",
  codigo: "",
  nombre: "",
  unidades: null,
  unidadCompraId: "",
  unidadNoVigente: null,
  unidadConfirmada: false,
  cantidad: "",
  loteVencimiento: "",
  importe: "",
  pesoReal: "",
  referenciaProveedor: "",
  ultimaCompraTexto: "",
  precargada: false,
  lineaDeOrden: "",
  confirmoExceso: false,
};
