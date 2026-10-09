import { describe, expect, it } from "vitest";
import { generarPedidoDeIngreso, leerPedidoDeIngreso, serializarPedidoDeIngreso } from "../../../src/core/plataforma/pedido-de-ingreso";
import { azarDelProceso } from "../../../src/lib/azar";

/** El pedido de un código de ingreso (S-08): lo que ata el código del mail al navegador que lo pidió. Puro: el azar entra por el puerto. */
describe("pedido de ingreso", () => {
  it("cada pedido es distinto y tiene 128 bits de id y 256 de nonce", () => {
    const pedidos = Array.from({ length: 50 }, () => generarPedidoDeIngreso(azarDelProceso));
    expect(new Set(pedidos.map((p) => p.codigoId)).size).toBe(50);
    expect(new Set(pedidos.map((p) => p.nonce)).size).toBe(50);
    for (const p of pedidos) {
      expect(p.codigoId).toMatch(/^[0-9a-f]{32}$/);
      expect(p.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("ida y vuelta por la cookie", () => {
    const pedido = generarPedidoDeIngreso(azarDelProceso);
    expect(leerPedidoDeIngreso(serializarPedidoDeIngreso(pedido))).toEqual(pedido);
  });

  it("todo valor que no tenga exactamente la forma que se genera es null (ausente, recortado, con otro alfabeto o separador)", () => {
    const { codigoId, nonce } = generarPedidoDeIngreso(azarDelProceso);
    for (const malo of [undefined, null, "", ".", codigoId, `${codigoId}.`, `.${nonce}`, `${codigoId}.${nonce}.x`, `${codigoId}:${nonce}`, `${codigoId.toUpperCase()}.${nonce}`, `${codigoId.slice(1)}.${nonce}`, `${codigoId}.${nonce.slice(1)}`, `${codigoId}.${nonce}x`, `${codigoId}.${nonce.slice(0, 42)}!`]) {
      expect(leerPedidoDeIngreso(malo), String(malo)).toBeNull();
    }
  });
});
