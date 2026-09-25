import type { AnulacionDeComanda, ComandaDeEnvio } from "./comanda";

/**
 * Qué imprimir después de una acción de la pantalla de la mesa (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B2/B4). Núcleo
 * PURO: lo usa el proveedor de impresión del cliente (src/app/(pos)/mesas/[mesaId]/imprimir.tsx).
 *
 * Las Server Actions no cambian su contrato (`{ ok, mensaje }`): el cliente deja un PEDIDO de impresión al salir bien la acción y,
 * con los datos que trae `router.refresh()`, `resolverImpresion` decide si ya puede imprimir, si tiene que esperar al refresco o si
 * no hay nada que imprimir.
 */

export type PedidoImpresion =
  /** «Enviar a cocina»: los ids que estaban en pantalla y el mayor número de envío conocido al hacer clic. */
  | { tipo: "envio"; itemIds: readonly string[]; despuesDe: number }
  /** «Anular» un ítem enviado: los ids de las anulaciones que el ítem ya tenía antes. */
  | { tipo: "anulacion"; itemId: string; espejosAntes: readonly string[] };

export type DocumentoImprimible =
  | { tipo: "comanda" | "reimpresion"; comanda: ComandaDeEnvio }
  | { tipo: "anulacion"; comanda: ComandaDeEnvio; anulacion: AnulacionDeComanda };

export interface DatosDeImpresion {
  comandas: readonly ComandaDeEnvio[];
}

export type ResolucionImpresion = { accion: "imprimir"; documento: DocumentoImprimible } | { accion: "descartar" } | { accion: "esperar" };

const ESPERAR: ResolucionImpresion = { accion: "esperar" };
const DESCARTAR: ResolucionImpresion = { accion: "descartar" };

/**
 * - Envío: imprime el envío de número MAYOR a `despuesDe` que tenga alguno de los ids pedidos. Si todos los ids ya estaban en envíos
 *   ≤ `despuesDe` (conocidos antes del clic: «Esos ítems ya estaban enviados.»), descarta: no se reimprime un envío viejo. Si el envío
 *   nuevo todavía no llegó, espera.
 * - Anulación: imprime la anulación del ítem que no estaba entre `espejosAntes`; mientras no llegue, espera.
 */
export function resolverImpresion(datos: DatosDeImpresion, pedido: PedidoImpresion): ResolucionImpresion {
  switch (pedido.tipo) {
    case "envio": {
      const pedidos = new Set(pedido.itemIds);
      const nuevos = datos.comandas.filter((c) => c.numero > pedido.despuesDe && c.itemIds.some((id) => pedidos.has(id)));
      if (nuevos.length) {
        const comanda = nuevos.reduce((mayor, c) => (c.numero > mayor.numero ? c : mayor));
        return { accion: "imprimir", documento: { tipo: "comanda", comanda } };
      }
      const yaEnviados = new Set(datos.comandas.filter((c) => c.numero <= pedido.despuesDe).flatMap((c) => c.itemIds));
      return pedido.itemIds.every((id) => yaEnviados.has(id)) ? DESCARTAR : ESPERAR;
    }
    case "anulacion": {
      const antes = new Set(pedido.espejosAntes);
      for (const comanda of datos.comandas) {
        const nuevas = comanda.anulaciones.filter((a) => a.itemId === pedido.itemId && !antes.has(a.id));
        if (nuevas.length) return { accion: "imprimir", documento: { tipo: "anulacion", comanda, anulacion: nuevas[nuevas.length - 1] } };
      }
      return ESPERAR;
    }
  }
}
