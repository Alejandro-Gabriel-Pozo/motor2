/**
 * GO-2d (ADR-030): cómo se muestran en la mesa las líneas con adicionales. Un adicional («+ Huevo frito») es una fila propia de la cuenta que cuelga de la línea de su producto
 * (`lineaPadreId`): en pantalla va DEBAJO de ese producto, sin botón propio (se quita o se anula con él: lo hace el servidor, `quitarItemSinEnviar` / `anularItemEnviado`). PURO:
 * sin React ni base, lo usa la página de la mesa en el servidor y en el cliente.
 */

/** Una línea a mostrar: el producto y los adicionales que cuelgan de él, en el orden recibido. */
export interface LineaConAdicionales<T> {
  item: T;
  adicionales: T[];
}

/**
 * Agrupa cada adicional bajo su producto, respetando el orden de los productos. Un adicional cuyo producto no está en la lista (no debería pasar: viajan juntos) queda como una
 * línea más, así nunca se esconde nada de la cuenta.
 */
export function agruparConAdicionales<T extends { id: string; lineaPadreId?: string }>(items: readonly T[]): LineaConAdicionales<T>[] {
  const ids = new Set(items.map((i) => i.id));
  const adicionalesDe = new Map<string, T[]>();
  for (const i of items) {
    if (i.lineaPadreId !== undefined && ids.has(i.lineaPadreId)) adicionalesDe.set(i.lineaPadreId, [...(adicionalesDe.get(i.lineaPadreId) ?? []), i]);
  }
  return items.flatMap((i) => (i.lineaPadreId !== undefined && ids.has(i.lineaPadreId) ? [] : [{ item: i, adicionales: adicionalesDe.get(i.id) ?? [] }]));
}

/** «Otro igual»: lo elegido en la línea (lo del producto y cada adicional, por unidad), tal como lo arranca el diálogo «Elegir opciones». Vacío = la línea no tiene opciones. */
export function elegidasDeLaLinea(linea: LineaConAdicionales<{ elegidas?: readonly { opcionId: string; cantidad: number }[] }>): { opcionId: string; cantidad: number }[] {
  return [linea.item, ...linea.adicionales].flatMap((i) => (i.elegidas ?? []).map((e) => ({ opcionId: e.opcionId, cantidad: e.cantidad })));
}
