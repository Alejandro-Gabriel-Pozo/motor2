import type { DocumentoImprimible } from "./impresion";

/**
 * Comanda de cocina (KOT) de cada envío de una cuenta: lo que se imprime para la cocina al enviar, al reimprimir y al anular
 * (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B1). Núcleo PURO: la página la arma en el servidor a partir de los envíos
 * agrupados (`agruparPorEnvio`) y se la pasa al proveedor de impresión del cliente.
 *
 * SIN PRECIOS, a propósito y a nivel de tipos: ningún tipo de este archivo tiene un campo de precio, y los objetos se arman campo por
 * campo (nunca con spread del ítem), así que un precio no puede colarse en la comanda aunque el ítem de entrada lo traiga. La boleta
 * del cliente (con precios) es otro documento, con su propio armador (src/core/pos/boleta.ts).
 *
 * Sin importar `./cuenta` (que trae el cliente de Prisma): `documentoDeReimpresion` corre en el navegador, dentro del proveedor.
 */

/** Cantidades de la columna `Decimal(14, 4)`: mismo redondeo que `restanteDe` (src/core/pos/cuenta.ts). */
function redondearCantidad(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export interface LineaDeComanda {
  itemId: string;
  producto: string;
  /** Lo vigente del ítem (cantidad pedida menos sus anulaciones). */
  cantidad: number;
}

export interface AnulacionDeComanda {
  /** Id de la fila espejo. */
  id: string;
  /** Id del ítem original anulado. */
  itemId: string;
  producto: string;
  /** Cantidad anulada, en positivo. */
  cantidad: number;
  motivo: string;
  /** Quién anuló. */
  por: string;
  /** Lo que quedó del ítem después de ESTA anulación (las anteriores incluidas). */
  quedan: number;
}

export interface ComandaDeEnvio {
  numero: number;
  /** Todos los ítems originales del envío, también los anulados enteros (no están en `lineas`). */
  itemIds: string[];
  /** Quién tomó el pedido: los autores distintos de los ítems del envío o, si no hay ninguno registrado, el mozo de la cuenta. */
  tomo: string[];
  /** Lo que la cocina tiene que preparar: los ítems con algo vigente. */
  lineas: LineaDeComanda[];
  anulaciones: AnulacionDeComanda[];
}

/** Lo único que la comanda lee de cada ítem enviado (de `agruparPorEnvio` sobre los ítems de `obtenerDetalleDeMesa`). */
export interface ItemParaComanda {
  id: string;
  productoNombre: string;
  restante: number;
  creadoPor: string | null;
  anulaciones: readonly { id: string; cantidad: number; motivoAnulacion: string | null; creadoPor: string | null }[];
}

/** Una comanda por envío, en el orden recibido. `mesero` es el mozo de la cuenta: el respaldo de «Tomó» cuando ningún ítem tiene autor. */
export function armarComandas(envios: readonly { numero: number; items: readonly ItemParaComanda[] }[], mesero: string): ComandaDeEnvio[] {
  return envios.map((envio) => {
    const autores = [...new Set(envio.items.flatMap((i) => (i.creadoPor ? [i.creadoPor] : [])))];
    const lineas: LineaDeComanda[] = envio.items.filter((i) => i.restante > 0).map((i) => ({ itemId: i.id, producto: i.productoNombre, cantidad: i.restante }));
    const anulaciones: AnulacionDeComanda[] = envio.items.flatMap((item) =>
      item.anulaciones.map((a, n) => ({
        id: a.id,
        itemId: item.id,
        producto: item.productoNombre,
        cantidad: -a.cantidad,
        motivo: a.motivoAnulacion ?? "",
        por: a.creadoPor ?? "—",
        // Lo vigente hoy más lo que anularon las posteriores (espejos en orden de creación).
        quedan: redondearCantidad(item.anulaciones.slice(n + 1).reduce((suma, posterior) => suma - posterior.cantidad, item.restante)),
      }))
    );
    return { numero: envio.numero, itemIds: envio.items.map((i) => i.id), tomo: autores.length ? autores : [mesero], lineas, anulaciones };
  });
}

/** La copia de un envío ya impreso («Reimprimir»): la comanda tal como está hoy (cantidades vigentes y lo anulado), marcada como reimpresión. */
export function documentoDeReimpresion(comandas: readonly ComandaDeEnvio[], numero: number): DocumentoImprimible | null {
  const comanda = comandas.find((c) => c.numero === numero);
  return comanda ? { tipo: "reimpresion", comanda } : null;
}
