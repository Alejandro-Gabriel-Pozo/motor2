import type { AlicuotaIva } from "@/core/fiscal/public";

/**
 * Las ALÍCUOTAS DE IVA dentro de un combo (GO-3, ADR-032, decisión D-2 del dueño): cada componente conserva la alícuota de su propio producto (`CuentaItem.productoId` es el
 * producto real), pero mientras el contador no confirme cómo se discrimina el IVA de un precio cerrado repartido en proporción al precio de lista, un combo NO PUEDE MEZCLAR
 * alícuotas DECLARADAS distintas (`COMBO_ALICUOTAS_DISTINTAS`). Una alícuota sin declarar (`Producto.alicuotaIvaVenta` NULL) no bloquea: es un AVISO (la emisión fiscal, cuando
 * exista, falla cerrada con ella, como hoy con cualquier producto sin alícuota).
 *
 * Es una regla de código, sin esquema: si el contador aprueba mezclar, se quita sin migración. Se aplica dos veces: al guardar los cupos y las entradas (sobre TODOS los elegibles
 * posibles del combo) y al vender (sobre los elegidos). Función pura.
 */

export interface ComponenteConAlicuota {
  productoId: string;
  /** Para el mensaje. */
  nombre: string;
  /** `Producto.alicuotaIvaVenta`; `null` = sin declarar. */
  alicuota: AlicuotaIva | null;
}

export type RevisionDeAlicuotasDeCombo =
  | { ok: true; alicuota: AlicuotaIva | null; sinDeclarar: { productoId: string; nombre: string }[] }
  | { ok: false; codigo: "COMBO_ALICUOTAS_DISTINTAS"; mensaje: string };

/**
 * Revisa las alícuotas de los componentes (posibles o elegidos) de un combo. Con todas las declaradas iguales (o ninguna declarada) es `ok`, con la alícuota común (o `null`) y la
 * lista de los que no la tienen declarada (el aviso). Con dos declaradas distintas, rechaza nombrando un producto de cada una (en el orden recibido).
 */
export function revisarAlicuotasDeCombo(componentes: readonly ComponenteConAlicuota[]): RevisionDeAlicuotasDeCombo {
  let primera: ComponenteConAlicuota | null = null;
  const sinDeclarar: { productoId: string; nombre: string }[] = [];
  const vistos = new Set<string>();
  for (const c of componentes) {
    if (c.alicuota === null) {
      if (!vistos.has(c.productoId)) sinDeclarar.push({ productoId: c.productoId, nombre: c.nombre });
      vistos.add(c.productoId);
      continue;
    }
    if (primera === null) {
      primera = c;
      continue;
    }
    if (c.alicuota !== primera.alicuota) {
      return {
        ok: false,
        codigo: "COMBO_ALICUOTAS_DISTINTAS",
        mensaje:
          `«${primera.nombre}» y «${c.nombre}» tienen alícuotas de IVA distintas: por ahora un combo no puede mezclar alícuotas ` +
          `(hasta que el contador confirme cómo se discrimina el IVA de un precio cerrado). Armá combos con productos de la misma alícuota.`,
      };
    }
  }
  return { ok: true, alicuota: primera?.alicuota ?? null, sinDeclarar };
}
