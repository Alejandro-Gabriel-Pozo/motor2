import { leerOpcionEnCarta, opcionesDelEje } from "@/core/opciones/public";
import { nombreDeCarta } from "./armar-menu";

/**
 * El NOMBRE PARA MOSTRAR de un producto de venta en las pantallas donde alguien arma o elige (la administración de promos y el POS), pedido del dueño (2026-11-05): un producto que se vende por opción
 * (base configurable) con el nombre OCULTO en la carta (`mostrarNombreArriba = false`) no se llama «BIFE-» para quien lo arma: se llama por lo que la carta muestra, los rótulos de las opciones de su grupo
 * MEDIDA («Bife a criolla · Bife con chimichurri»), con el nombre interno chico al lado, entre paréntesis («(BIFE-)»), porque el administrador igual lo necesita. Los rótulos salen de la MISMA lectura que
 * la carta (`leerOpcionEnCarta` con el prefijo del grupo, y `opcionesDelEje`), no de una regla paralela. Cualquier otro producto: el nombre en la carta o, si no tiene, el del producto, como hoy.
 *
 * Supuesto declarado: se usa solo el grupo MEDIDA (el eje que la carta pone en las filas de una base oculta), no las proteínas ni las guarniciones. Puro.
 */
export interface EntradaDeNombreParaMostrar {
  /** `Producto.nombre`: el nombre interno. */
  nombre: string;
  /** `ContenidoCartaProducto.nombreEnCarta` de la sucursal (o ausente). */
  nombreEnCarta?: string | null;
  /** `modoDeVenta = BASE_CONFIGURABLE`. */
  esBase: boolean;
  /** `ContenidoCartaProducto.mostrarNombreArriba` (ausente = la base sale oculta). */
  mostrarNombreArriba?: boolean;
  /** El grupo MEDIDA del producto, con su prefijo de lectura en la carta y sus opciones activas, en su orden. */
  medida: { prefijoEnCarta: string | null; opciones: readonly { nombre: string; esNinguna: boolean }[] } | null;
}

export function nombreParaMostrar(p: EntradaDeNombreParaMostrar): string {
  if (p.esBase && !p.mostrarNombreArriba && p.medida) {
    const rotulos = opcionesDelEje({ tipo: "MEDIDA", opciones: p.medida.opciones }).map((o) => leerOpcionEnCarta(p.medida!.prefijoEnCarta, o));
    if (rotulos.length > 0) return `${rotulos.join(" · ")} (${p.nombre})`;
  }
  return nombreDeCarta({ nombre: p.nombre }, { nombreEnCarta: p.nombreEnCarta });
}
