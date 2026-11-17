/**
 * ORÁCULO ESCRITO A MANO, aparte del código (diseño `docs/diseno-precio-fuera-del-alta-2026-11-17.md` §3.A, §4 y §6; pedido del dueño, 2026-11-17: «No, el precio donde lo pide... Donde lo pide Pedernal.»;
 * A1: el producto de venta nace NO disponible hasta que se le cargue el precio y se active). Dimensiones cuyas combinaciones cambian el stock vendible: la clase de alta, si quien da de alta tiene la
 * clave `producto_campos_sensibles` y si el pedido trae precio. El interruptor `ALTA_DE_PRODUCTO_COMO_PEDERNAL` es de pantalla y se prueba en `precio-fuera-del-alta-pantalla.test.tsx`.
 * Una fila por combinación. `disponible`: lo que queda escrito en `DisponibilidadProducto` de la sucursal; `null` = el alta se rechaza y no se crea nada.
 */
export interface FilaDelAlta {
  clase: "MATERIA_PRIMA" | "INSUMO" | "REVENTA" | "ELABORADO" | "VENDIBLE";
  conClave: boolean;
  traePrecio: boolean;
  disponible: boolean | null;
}

export const ALTAS_ESPERADAS: readonly FilaDelAlta[] = [
  // Lo que no se vende no tiene precio de venta: nace disponible, con o sin clave (sin clave, un precio distinto de 0 se rechaza).
  { clase: "MATERIA_PRIMA", conClave: false, traePrecio: false, disponible: true },
  { clase: "MATERIA_PRIMA", conClave: true, traePrecio: false, disponible: true },
  { clase: "INSUMO", conClave: false, traePrecio: false, disponible: true },
  { clase: "INSUMO", conClave: true, traePrecio: false, disponible: true },
  { clase: "ELABORADO", conClave: false, traePrecio: false, disponible: true },
  { clase: "ELABORADO", conClave: true, traePrecio: false, disponible: true },
  { clase: "MATERIA_PRIMA", conClave: false, traePrecio: true, disponible: null },
  { clase: "INSUMO", conClave: false, traePrecio: true, disponible: null },
  { clase: "ELABORADO", conClave: false, traePrecio: true, disponible: null },
  // El producto de venta: sin precio nace NO disponible (con o sin clave); con precio solo lo trae quien tiene la clave y nace disponible; sin clave el precio se rechaza.
  { clase: "VENDIBLE", conClave: false, traePrecio: false, disponible: false },
  { clase: "VENDIBLE", conClave: true, traePrecio: false, disponible: false },
  { clase: "VENDIBLE", conClave: false, traePrecio: true, disponible: null },
  { clase: "VENDIBLE", conClave: true, traePrecio: true, disponible: true },
  // La Reventa es un producto de venta (E4-5): se comporta igual que el vendible.
  { clase: "REVENTA", conClave: false, traePrecio: false, disponible: false },
  { clase: "REVENTA", conClave: true, traePrecio: false, disponible: false },
  { clase: "REVENTA", conClave: false, traePrecio: true, disponible: null },
  { clase: "REVENTA", conClave: true, traePrecio: true, disponible: true },
];
