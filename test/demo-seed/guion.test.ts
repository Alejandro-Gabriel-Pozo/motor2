import { describe, expect, it } from "vitest";
import { validarGuion, calcularTotalesEsperados, refsDelGuion, crearNumeradorDeFacturas, nroFacturaEstructurado, PROVEEDOR_DE_DEMO_CODIGO, type GuionDemo, type EventoDemo } from "../../scripts/demo-seed/guion";

const compra = (ref: string, semana: number, proveedorCodigo: string, items: { productoCodigo: string; cantidad: number; precioUnitario: number }[]): EventoDemo => ({
  tipo: "COMPRA",
  ref,
  semana,
  diaSemana: 1,
  seccion: "Cocina",
  proveedorCodigo,
  nroFactura: "A-00001-00000001",
  items,
});
const venta = (ref: string, semana: number, items: { productoCodigo: string; cantidad: number }[]): EventoDemo => ({
  tipo: "VENTA",
  ref,
  semana,
  diaSemana: 5,
  seccion: "Cocina",
  items,
});
const anular = (ref: string, semana: number, refCompra: string): EventoDemo => ({ tipo: "ANULAR_COMPRA", ref, semana, diaSemana: 2, refCompra });

describe("refsDelGuion", () => {
  it("da las refs en orden", () => {
    const guion: GuionDemo = { eventos: [compra("c1", 0, "PRV_A", []), venta("v1", 0, [])] };
    expect(refsDelGuion(guion)).toEqual(["c1", "v1"]);
  });
});

describe("validarGuion", () => {
  it("un guion bien armado no tiene problemas", () => {
    const guion: GuionDemo = {
      eventos: [compra("c1", 0, "PRV_A", [{ productoCodigo: "MP001", cantidad: 10, precioUnitario: 100 }]), venta("v1", 1, [{ productoCodigo: "PV001", cantidad: 2 }]), anular("a1", 2, "c1")],
    };
    expect(validarGuion(guion)).toEqual([]);
  });

  it("detecta refs duplicadas", () => {
    const guion: GuionDemo = { eventos: [compra("c1", 0, "PRV_A", []), venta("c1", 1, [])] };
    expect(validarGuion(guion).some((p) => p.includes("duplicada"))).toBe(true);
  });

  it("detecta que el guion no viene en orden cronológico", () => {
    const guion: GuionDemo = { eventos: [compra("c1", 5, "PRV_A", []), venta("v1", 2, [])] };
    expect(validarGuion(guion).some((p) => p.includes("orden cronológico"))).toBe(true);
  });

  it("detecta un ANULAR_COMPRA que referencia una compra inexistente", () => {
    const guion: GuionDemo = { eventos: [anular("a1", 0, "no-existe")] };
    expect(validarGuion(guion).some((p) => p.includes("inexistente"))).toBe(true);
  });

  it("un CORREGIR_COMPRA que sí referencia una compra existente no es un problema", () => {
    const guion: GuionDemo = {
      eventos: [compra("c1", 0, "PRV_A", []), { tipo: "CORREGIR_COMPRA", ref: "cor1", semana: 1, diaSemana: 0, refCompra: "c1", nroFactura: "0001-00000123" }],
    };
    expect(validarGuion(guion)).toEqual([]);
  });
});

describe("calcularTotalesEsperados", () => {
  const precios = new Map([
    ["PV001", 100],
    ["PV002", 50],
  ]);

  it("suma el gasto de compras, total y por proveedor", () => {
    const guion: GuionDemo = {
      eventos: [
        compra("c1", 0, "PRV_A", [{ productoCodigo: "MP001", cantidad: 10, precioUnitario: 100 }]), // $1000
        compra("c2", 1, "PRV_B", [{ productoCodigo: "MP002", cantidad: 5, precioUnitario: 40 }]), // $200
        compra("c3", 2, "PRV_A", [{ productoCodigo: "MP001", cantidad: 2, precioUnitario: 100 }]), // $200
      ],
    };
    const totales = calcularTotalesEsperados(guion, precios);
    expect(totales.compras.totalGastado).toBe(1400);
    expect(totales.compras.porProveedor.get("PRV_A")).toBe(1200);
    expect(totales.compras.porProveedor.get("PRV_B")).toBe(200);
    expect(totales.compras.cantidadCompras).toBe(3);
  });

  it("la compra del proveedor de demo (stock inicial, feria) cae bajo su propia clave", () => {
    const guion: GuionDemo = { eventos: [compra("c1", 0, PROVEEDOR_DE_DEMO_CODIGO, [{ productoCodigo: "MP001", cantidad: 1, precioUnitario: 500 }])] };
    const totales = calcularTotalesEsperados(guion, precios);
    expect(totales.compras.porProveedor.get(PROVEEDOR_DE_DEMO_CODIGO)).toBe(500);
  });

  it("una compra ANULADA no cuenta ni en el total ni por proveedor ni en cantidadCompras — mismo criterio que K1c", () => {
    const guion: GuionDemo = {
      eventos: [
        compra("c1", 0, "PRV_A", [{ productoCodigo: "MP001", cantidad: 10, precioUnitario: 100 }]),
        compra("c2", 1, "PRV_A", [{ productoCodigo: "MP001", cantidad: 1, precioUnitario: 100 }]),
        anular("a1", 2, "c1"),
      ],
    };
    const totales = calcularTotalesEsperados(guion, precios);
    expect(totales.compras.totalGastado).toBe(100); // solo c2
    expect(totales.compras.cantidadCompras).toBe(1);
    expect(totales.compras.porProveedor.get("PRV_A")).toBe(100);
  });

  it("suma la facturación de ventas, total, por producto y cantidad vendida — usa el precioVenta del catálogo", () => {
    const guion: GuionDemo = {
      eventos: [venta("v1", 0, [{ productoCodigo: "PV001", cantidad: 3 }]), venta("v2", 1, [{ productoCodigo: "PV001", cantidad: 1 }, { productoCodigo: "PV002", cantidad: 4 }])],
    };
    const totales = calcularTotalesEsperados(guion, precios);
    expect(totales.ventas.totalFacturado).toBe(3 * 100 + 1 * 100 + 4 * 50); // 600
    expect(totales.ventas.porProducto.get("PV001")).toBe(400);
    expect(totales.ventas.porProducto.get("PV002")).toBe(200);
    expect(totales.ventas.cantidadVendidaPorProducto.get("PV001")).toBe(4);
    expect(totales.ventas.cantidadVendidaPorProducto.get("PV002")).toBe(4);
  });

  it("una venta de un producto sin precioVenta en el mapa tira un error explícito (mejor que un NaN silencioso)", () => {
    const guion: GuionDemo = { eventos: [venta("v1", 0, [{ productoCodigo: "PV_FANTASMA", cantidad: 1 }])] };
    expect(() => calcularTotalesEsperados(guion, precios)).toThrow(/PV_FANTASMA/);
  });

  it("un guion vacío da todo en cero, no undefined ni NaN", () => {
    const totales = calcularTotalesEsperados({ eventos: [] }, precios);
    expect(totales.compras.totalGastado).toBe(0);
    expect(totales.compras.cantidadCompras).toBe(0);
    expect(totales.ventas.totalFacturado).toBe(0);
  });
});

describe("crearNumeradorDeFacturas", () => {
  it("arma números estructurados con punto de venta fijo por proveedor y correlativo propio", () => {
    const nroDe = crearNumeradorDeFacturas(["PRV_A", "PRV_B"]);
    expect([nroDe("PRV_A"), nroDe("PRV_B"), nroDe("PRV_A"), nroDe("PRV_A")]).toEqual(["A-00001-00000001", "A-00002-00000001", "A-00001-00000002", "A-00001-00000003"]);
  });

  it("el proveedor de demo va con letra X, punto de venta 1", () => {
    const nroDe = crearNumeradorDeFacturas(["PRV_A"]);
    expect([nroDe(PROVEEDOR_DE_DEMO_CODIGO), nroDe(PROVEEDOR_DE_DEMO_CODIGO)]).toEqual(["X-00001-00000001", "X-00001-00000002"]);
  });

  it("un proveedor sin punto de venta es un error del guion", () => {
    expect(() => crearNumeradorDeFacturas(["PRV_A"])("PRV_Z")).toThrow(/PRV_Z/);
  });

  it("nroFacturaEstructurado completa con ceros (5 dígitos el punto de venta, 8 el número)", () => {
    expect(nroFacturaEstructurado("A", 23, 237728)).toBe("A-00023-00237728");
  });
});
