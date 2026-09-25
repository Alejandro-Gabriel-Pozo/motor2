import type { AnulacionDeComanda, ComandaDeEnvio } from "./comanda";

/**
 * Qué imprimir después de una acción de la pantalla de la mesa (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B2/B4). Núcleo
 * PURO: lo usa el proveedor de impresión del cliente (src/app/(pos)/mesas/[mesaId]/imprimir.tsx).
 *
 * El cliente deja un PEDIDO de impresión al salir bien la acción y, con los datos que trae `router.refresh()`, `resolverImpresion`
 * decide si ya puede imprimir o si tiene que esperar al refresco.
 */

export type PedidoImpresion =
  /**
   * «Enviar a cocina»: el envío que el SERVIDOR confirmó como creado por esta llamada (`enviarACocina` → `numeroEnvio` con
   * `envioNuevo: true`). Quien llama no pide nada si la llamada no creó un envío (una pestaña vieja: «Esos ítems ya estaban enviados.»).
   */
  | { tipo: "envio"; numero: number }
  /** «Anular» un ítem enviado: los ids de las anulaciones que el ítem ya tenía antes. */
  | { tipo: "anulacion"; itemId: string; espejosAntes: readonly string[] };

export type DocumentoImprimible =
  | { tipo: "comanda" | "reimpresion"; comanda: ComandaDeEnvio }
  | { tipo: "anulacion"; comanda: ComandaDeEnvio; anulacion: AnulacionDeComanda };

export interface DatosDeImpresion {
  comandas: readonly ComandaDeEnvio[];
}

export type ResolucionImpresion = { accion: "imprimir"; documento: DocumentoImprimible } | { accion: "esperar" };

const ESPERAR: ResolucionImpresion = { accion: "esperar" };

/**
 * - Envío: imprime la comanda del envío pedido; mientras el refresco no lo traiga, espera.
 * - Anulación: imprime la anulación del ítem que no estaba entre `espejosAntes`; mientras no llegue, espera.
 */
export function resolverImpresion(datos: DatosDeImpresion, pedido: PedidoImpresion): ResolucionImpresion {
  switch (pedido.tipo) {
    case "envio": {
      const comanda = datos.comandas.find((c) => c.numero === pedido.numero);
      return comanda ? { accion: "imprimir", documento: { tipo: "comanda", comanda } } : ESPERAR;
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
