import { describe, expect, it } from "vitest";
import { guardComandoAnularVenta, guardComandoRegistrarVenta } from "../../../../src/core/features/ventas/venta.guard";

/** Guard del comando «anular una venta» (src/core/features/ventas/venta.guard.ts; Task #41, Fase M): formato, puro. */
describe("guardComandoAnularVenta", () => {
  it("un operacionId string pasa tal cual (exista o no: eso lo decide el caso de uso)", () => {
    expect(guardComandoAnularVenta({ operacionId: "op-1" })).toEqual({ ok: true, valor: { operacionId: "op-1" } });
    expect(guardComandoAnularVenta({ operacionId: "" })).toEqual({ ok: true, valor: { operacionId: "" } });
  });

  it.each([undefined, null, 42, { id: "op-1" }])("operacionId %j: el mismo mensaje que «no encontrada», sin llegar a la base", (operacionId) => {
    expect(guardComandoAnularVenta({ operacionId })).toEqual({ ok: false, codigo: "formato", mensaje: "No se encontró esa operación en esta sucursal." });
  });

  it("sin entrada: rechaza igual", () => {
    expect(guardComandoAnularVenta(undefined)).toMatchObject({ ok: false, codigo: "formato" });
  });
});

const linea = (cantidadVendida: unknown, productoId: unknown = "p-1") => ({ productoId, cantidadVendida });
const venta = (ventas: unknown, resto: Record<string, unknown> = {}) => ({ seccionId: "s-1", fecha: new Date(), ventas, ...resto });

/** Guard del comando «registrar una venta de mostrador»: formato, puro, sin transformar la entrada. */
describe("guardComandoRegistrarVenta", () => {
  it("una venta bien formada pasa y devuelve la MISMA entrada", () => {
    const entrada = venta([linea(2), linea(0.5)], { nroFactura: "A-1" });
    const r = guardComandoRegistrarVenta(entrada);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toBe(entrada);
  });

  it("una cantidad en 0 pasa (el núcleo la saltea)", () => {
    expect(guardComandoRegistrarVenta(venta([linea(0), linea(1)])).ok).toBe(true);
  });

  it.each([undefined, null, [], "x", {}])("ventas %j: pide cargar al menos un producto", (ventas) => {
    expect(guardComandoRegistrarVenta(venta(ventas))).toMatchObject({ ok: false, mensaje: "Cargá al menos un producto con cantidad." });
  });

  it("sin entrada: rechaza igual", () => {
    expect(guardComandoRegistrarVenta(undefined)).toMatchObject({ ok: false });
  });

  it.each([NaN, Infinity, "2", null, undefined, {}])("cantidad %j: rechaza el lote entero (no la descarta en silencio)", (c) => {
    expect(guardComandoRegistrarVenta(venta([linea(1), linea(c)]))).toMatchObject({ ok: false, mensaje: "La cantidad vendida no es un número válido." });
  });

  it("cantidad negativa, demasiado grande o con más de 4 decimales: rechaza", () => {
    expect(guardComandoRegistrarVenta(venta([linea(-1)]))).toMatchObject({ ok: false, codigo: "negativo" });
    expect(guardComandoRegistrarVenta(venta([linea(1e12)]))).toMatchObject({ ok: false, codigo: "rango" });
    expect(guardComandoRegistrarVenta(venta([linea(0.00001)]))).toMatchObject({ ok: false, codigo: "decimales" });
    expect(guardComandoRegistrarVenta(venta([linea(0.0001)])).ok).toBe(true);
  });

  it("una línea sin producto o una sección vacía rechaza", () => {
    expect(guardComandoRegistrarVenta(venta([linea(1, "")]))).toMatchObject({ ok: false, mensaje: "Hay una línea sin producto." });
    expect(guardComandoRegistrarVenta(venta([null]))).toMatchObject({ ok: false, mensaje: "Hay una línea sin producto." });
    expect(guardComandoRegistrarVenta({ ...venta([linea(1)]), seccionId: "" })).toMatchObject({ ok: false, mensaje: "Elegí una sección." });
  });

  it("clave de reintento inválida y N.º de factura demasiado largo rechazan", () => {
    expect(guardComandoRegistrarVenta(venta([linea(1)], { claveIdempotencia: "no valida!" }))).toMatchObject({ ok: false, mensaje: "Clave de reintento inválida." });
    expect(guardComandoRegistrarVenta(venta([linea(1)], { nroFactura: "x".repeat(200) }))).toMatchObject({ ok: false, codigo: "largo" });
  });
});
