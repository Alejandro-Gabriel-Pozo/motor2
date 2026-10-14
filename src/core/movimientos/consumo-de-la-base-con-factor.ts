import { consumoDeLineaConfigurada, type IngredienteDeBase } from "./consumo-de-linea-configurada";

/**
 * OPCIONES-FACTOR: cuánto descuenta del stock la receta de un producto por UNA unidad vendida, en el tamaño base y con el factor de un tamaño, para mostrarlo al lado del campo
 * «El factor» («harina 0,25 kg → 0,325 kg»). Solo lectura: no guarda ni decide nada. No copia la fórmula: llama DOS veces a la misma función que usa la venta
 * (`consumoDeLineaConfigurada`, la que `armarLinea` aplica a una línea con opciones), con la receta efectiva de la sucursal tal cual:
 *  - «antes»: sin opciones (la fórmula de siempre, `pedidoDeIngrediente`: rendimiento y merma de la sucursal);
 *  - «después»: con un tamaño de ese factor y sin consumos propios (regla 1 de la venta: cada ingrediente de la base × f, en decimal exacto).
 * Así lo que el operario lee es exactamente lo que la venta pide descontar por unidad (antes del redondeo con arrastre de cada unidad de stock al escribir el Kardex).
 *
 * Lo que esta vista NO muestra a propósito (lo dice la pantalla): lo que la propia opción suma o reemplaza (se multiplica por el factor solo si «escala con el tamaño»), lo que suman
 * otras opciones o los adicionales (no los escala el tamaño), y la receta propia de una combinación cuyo eje es el tamaño (ya es la receta de ese tamaño: no se escala, ADR-032).
 */

export interface LineaDeLaBaseConFactor {
  insumoProductoId: string;
  /** Lo que descuenta una unidad vendida del tamaño base. */
  antes: number;
  /** Lo que descuenta una unidad vendida con el factor. */
  despues: number;
}

/** Las líneas de la base, en el orden de la receta, o `null` si la venta rechazaría el factor (fuera de rango): en ese caso la pantalla muestra solo el aviso. */
export function consumoDeLaBaseConFactor(base: readonly IngredienteDeBase[], factor: number, sucursalId: string): LineaDeLaBaseConFactor[] | null {
  const antes = consumoDeLineaConfigurada({ cantidad: 1, sucursalId, base, opciones: [], adicionales: [] });
  const despues = consumoDeLineaConfigurada({
    cantidad: 1,
    sucursalId,
    base,
    opciones: [{ opcionId: "vista-previa-del-factor", nombre: "este tamaño", tipo: "MEDIDA", ordenDeGrupo: 0, ordenDeOpcion: 0, cantidad: 1, factorEscala: factor, consumos: [] }],
    adicionales: [],
  });
  if (!antes.ok || !despues.ok) return null;
  // Sin reemplazos ni sumas, la venta devuelve un pedido por ingrediente de la base y en su orden: se emparejan por posición.
  return antes.pedidos.map((p, i) => ({ insumoProductoId: p.productoId, antes: p.cantidad, despues: despues.pedidos[i]!.cantidad }));
}
