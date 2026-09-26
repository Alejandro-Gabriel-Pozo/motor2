import type { BoletaDeCuenta } from "./boleta";
import type { AnulacionDeComanda, ComandaDeEnvio } from "./comanda";

/**
 * Qué imprimir después de una acción de la pantalla de la mesa (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B2/B4). Núcleo
 * PURO: lo usa el proveedor de impresión del cliente (src/app/(pos)/mesas/[mesaId]/imprimir.tsx).
 *
 * El cliente deja un PEDIDO de impresión al salir bien la acción y, con los datos que trae `router.refresh()`, `resolverImpresion`
 * decide si ya puede imprimir, si tiene que esperar al refresco o si no hay nada que imprimir.
 *
 * Solo tipos de `./boleta` (que consulta la base): este módulo corre en el navegador.
 */

export type PedidoImpresion =
  /**
   * «Enviar a cocina»: el envío que el SERVIDOR confirmó como creado por esta llamada (`enviarACocina` → `numeroEnvio` con
   * `envioNuevo: true`). Quien llama no pide nada si la llamada no creó un envío (una pestaña vieja: «Esos ítems ya estaban enviados.»).
   */
  | { tipo: "envio"; numero: number }
  /** «Anular» un ítem enviado: los ids de las anulaciones que el ítem ya tenía antes. */
  | { tipo: "anulacion"; itemId: string; espejosAntes: readonly string[] }
  /** «Cerrar y registrar la venta» con total > 0: la boleta de la cuenta cerrada. */
  | { tipo: "boleta"; cuentaId: string }
  /**
   * «Emitir boleta corregida»: el ejemplar que el SERVIDOR confirmó como emitido por esta llamada (`emitirBoletaCorregida` → `ejemplar`),
   * con el mismo número que el A (docs/plan-numeracion-boleta-2026-09-25.md, paso 8).
   */
  | { tipo: "boleta-correccion"; cuentaId: string; ejemplar: number };

export type DocumentoImprimible =
  | { tipo: "comanda" | "reimpresion"; comanda: ComandaDeEnvio }
  | { tipo: "anulacion"; comanda: ComandaDeEnvio; anulacion: AnulacionDeComanda }
  | { tipo: "boleta" | "boleta-reimpresion" | "boleta-correccion"; boleta: BoletaDeCuenta };

export interface DatosDeImpresion {
  comandas: readonly ComandaDeEnvio[];
  /** Las últimas cuentas cerradas con venta de la mesa («Cuentas cerradas»). */
  boletas: readonly BoletaDeCuenta[];
}

export type ResolucionImpresion = { accion: "imprimir"; documento: DocumentoImprimible } | { accion: "descartar" } | { accion: "esperar" };

const ESPERAR: ResolucionImpresion = { accion: "esperar" };
const DESCARTAR: ResolucionImpresion = { accion: "descartar" };

/**
 * - Envío: imprime la comanda del envío pedido; mientras el refresco no lo traiga, espera.
 * - Anulación: imprime la anulación del ítem que no estaba entre `espejosAntes`; mientras no llegue, espera.
 * - Boleta: imprime la de la cuenta cerrada en cuanto el refresco la trae en «Cuentas cerradas» (también en el caso idempotente «ya
 *   estaba cerrada»: una copia de más no genera trabajo repetido). Si su venta se anuló, descarta: no se imprime el comprobante de una
 *   venta revertida.
 * - Boleta corregida: imprime el ejemplar pedido en cuanto el refresco lo trae como último ejemplar de la cuenta; mientras la cuenta siga
 *   mostrando uno anterior, espera. Si ya hay uno posterior, o el pedido dejó de estar vigente (otra anulación en el medio), descarta.
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
    case "boleta": {
      const boleta = datos.boletas.find((b) => b.cuentaId === pedido.cuentaId);
      if (!boleta) return ESPERAR;
      if (boleta.ventaAnulada) return DESCARTAR;
      return { accion: "imprimir", documento: { tipo: "boleta", boleta } };
    }
    case "boleta-correccion": {
      const boleta = datos.boletas.find((b) => b.cuentaId === pedido.cuentaId);
      const ejemplar = boleta?.numero?.ejemplar ?? 0;
      if (!boleta || ejemplar < pedido.ejemplar) return ESPERAR;
      if (ejemplar > pedido.ejemplar || boleta.estado !== "vigente") return DESCARTAR;
      return { accion: "imprimir", documento: { tipo: "boleta-correccion", boleta } };
    }
  }
}
