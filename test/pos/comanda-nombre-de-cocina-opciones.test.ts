import { describe, expect, it } from "vitest";
import { armarComandas } from "../../src/core/pos/comanda";
import { armarDetalleDeMesa, type MesaConCuentaLeida } from "../../src/core/pos/cuenta";

/**
 * Nombre de cocina × opciones (diseño 2026-11-15, O10 y O11), parte PURA: con un producto con opciones el nombre de cocina reemplaza SOLO el nombre del producto (la parte «producto» del nombre compuesto), con lo incluido debajo y los
 * adicionales como siempre; en un producto base configurable gana el nombre de la medida, como hoy; un adicional conserva su nombre; una línea sin nombre congelado sale como siempre. Sin base: arma el detalle a mano.
 */
const AHORA = new Date("2026-11-15T15:00:00Z");
const foto = (tipoGrupo: string, nombreOpcion: string, extra: { cantidad?: number } = {}) => ({
  tipoGrupo, nombreOpcion, cantidad: extra.cantidad ?? 1, grupo: { prefijoEnCarta: null }, opcion: { esNinguna: false },
});
type ItemLeido = MesaConCuentaLeida["cuentas"][number]["items"][number];
const item = (id: string, nombre: string, extra: Partial<ItemLeido> = {}): ItemLeido => ({
  id, productoId: `p-${id}`, producto: { nombre, modoDeVenta: "DIRECTO", unidadStock: { decimales: 0 } }, cantidad: 1, precioUnitario: 1000, precioCartaUnitario: null, numeroEnvio: 1,
  anulaAItemId: null, motivoAnulacion: null, creadoPor: null, creadoEn: new Date("2026-11-15T14:00:00Z"), promoCuenta: null, ...extra,
});
const comandaDe = (items: ItemLeido[]) => {
  const mesa: MesaConCuentaLeida = {
    id: "m", numero: 1,
    cuentas: [{ id: "c", abiertaEn: new Date("2026-11-15T13:00:00Z"), comensales: null, clienteId: null, cliente: null, descuentoPorcentaje: null, abiertaPor: { name: "Mozo", email: "mozo@x.test" }, items }],
  };
  const cuenta = armarDetalleDeMesa(mesa, AHORA)!.cuenta!;
  return armarComandas(cuenta.envios, cuenta.mesero)[0]!;
};

describe("comanda: nombre de cocina con opciones", () => {
  it("O10: producto con una incluida y un adicional: el nombre de cocina va en el lugar del producto, lo incluido debajo y el adicional con su nombre de siempre", () => {
    const c = comandaDe([
      item("l1", "Bife de chorizo", { nombreDeCocina: "Medallón de bife", opcionesElegidas: [foto("INCLUIDA", "Puré")] }),
      item("l2", "Huevo frito", { lineaPadreId: "l1", nombreDeCocina: null, opcionesElegidas: [] }),
    ]);
    expect(c.lineas.map((l) => [l.producto, l.detalle ?? null, l.esAdicional ?? false])).toEqual([["Medallón de bife", "puré", false], ["Huevo frito", null, true]]);
  });

  it("con una opción que se suma al nombre («Café solo chico»): el nombre de cocina reemplaza solo la parte del producto", () => {
    const c = comandaDe([item("l1", "Café", { nombreDeCocina: "Espresso", opcionesElegidas: [foto("MEDIDA", "Solo"), foto("TAMANO", "Chico")] })]);
    expect(c.lineas.map((l) => l.producto)).toEqual(["Espresso solo chico"]);
  });

  it("O11: producto base configurable: gana el nombre de la medida, como hoy, aunque tenga nombre de cocina", () => {
    const c = comandaDe([item("l1", "Milanesa", { nombreDeCocina: "Suprema", producto: { nombre: "Milanesa", modoDeVenta: "BASE_CONFIGURABLE", unidadStock: { decimales: 0 } }, opcionesElegidas: [foto("MEDIDA", "Milanesa napolitana")] })]);
    expect(c.lineas.map((l) => l.producto)).toEqual(["Milanesa napolitana"]);
  });

  it("sin nombre congelado (línea anterior o producto sin nombre de cocina) sale la comanda de siempre, con y sin opciones", () => {
    const c = comandaDe([item("l1", "Café", { opcionesElegidas: [foto("MEDIDA", "Solo")] }), item("l2", "Flan")]);
    expect(c.lineas.map((l) => l.producto)).toEqual(["Café solo", "Flan"]);
  });

  it("el aviso de anulación de una línea con nombre de cocina y opciones lleva el mismo nombre compuesto que la línea", () => {
    const original = item("l1", "Café", { nombreDeCocina: "Espresso", cantidad: 2, opcionesElegidas: [foto("MEDIDA", "Solo")] });
    const espejo = item("e1", "Café", { anulaAItemId: "l1", cantidad: -1, motivoAnulacion: "Se equivocó", nombreDeCocina: "Espresso" });
    const c = comandaDe([original, espejo]);
    expect(c.lineas.map((l) => [l.producto, l.cantidad])).toEqual([["Espresso solo", 1]]);
    expect(c.anulaciones.map((a) => [a.producto, a.cantidad, a.quedan])).toEqual([["Espresso solo", 1, 1]]);
  });
});
