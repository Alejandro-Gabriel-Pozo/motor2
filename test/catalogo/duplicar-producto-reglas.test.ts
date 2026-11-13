import { describe, expect, it } from "vitest";
import {
  AVISO_PASOS_PARA_REVISAR,
  LO_QUE_NO_SE_COPIA,
  hayPasosParaRevisar,
  hayRecetaCircular,
  ingredientesDadosDeBaja,
  textoDeIngredientesDadosDeBaja,
} from "../../src/core/catalogo/duplicar-producto";
import { guardComandoDuplicarProducto } from "../../src/core/features/catalogo/duplicar-producto.guard";

/** Las reglas puras de «Duplicar producto» y el formato de su comando (sin base). */
const VALIDO = { duplicadoId: "0b6f1c0e-6c1d-4f6e-8f40-1b2c3d4e5f60", origenId: "cmabc123", nombre: "  Bife con chimichurri ", copiarReceta: true, copiarOpciones: true, sucursalDeLaRecetaId: null, precioVenta: undefined };

describe("reglas puras de Duplicar producto", () => {
  it("hay pasos para revisar solo si algún paso nombra un ingrediente", () => {
    expect(hayPasosParaRevisar([])).toBe(false);
    expect(hayPasosParaRevisar([{ orden: 1, instruccion: "Servir" }])).toBe(false);
    expect(hayPasosParaRevisar([{ orden: 1, instruccion: "Servir", insumoProductoIds: [] }])).toBe(false);
    expect(hayPasosParaRevisar([{ orden: 1, instruccion: "Servir" }, { orden: 2, instruccion: "Freír el bife", insumoProductoIds: ["mp1"] }])).toBe(true);
    expect(AVISO_PASOS_PARA_REVISAR).toContain("Hay pasos para revisar");
  });

  it("receta circular: el destino aparece entre los ingredientes", () => {
    const ingrediente = (insumoProductoId: string) => ({ insumoProductoId, cantidad: 1, unidadId: "u" });
    expect(hayRecetaCircular("nuevo", [ingrediente("a"), ingrediente("b")])).toBe(false);
    expect(hayRecetaCircular("nuevo", [ingrediente("a"), ingrediente("nuevo")])).toBe(true);
    expect(hayRecetaCircular("nuevo", [])).toBe(false);
  });

  it("los ingredientes dados de baja se nombran todos, sin repetir y en el orden de la receta", () => {
    const ingredientes = ["a", "b", "c", "b"].map((insumoProductoId) => ({ insumoProductoId, cantidad: 1, unidadId: "u" }));
    const nombres = new Map([["a", { nombre: "Harina" }], ["b", { nombre: "Sal" }]]);
    const bajas = ingredientesDadosDeBaja(ingredientes, new Set(["a"]), nombres);
    expect(bajas).toEqual(["Sal", "c"]);
    expect(textoDeIngredientesDadosDeBaja(["Sal"])).toContain("el ingrediente «Sal» está dado de baja");
    expect(textoDeIngredientesDadosDeBaja(bajas)).toContain("los ingredientes «Sal», «c» están dados de baja");
    expect(ingredientesDadosDeBaja(ingredientes, new Set(["a", "b", "c"]), nombres)).toEqual([]);
  });

  it("lo que no se copia dice, entre otras cosas, la carta y los precios por sucursal", () => {
    expect(LO_QUE_NO_SE_COPIA.join(" ")).toContain("«En la carta»");
    expect(LO_QUE_NO_SE_COPIA.join(" ")).toContain("precios por sucursal");
  });
});

describe("guardComandoDuplicarProducto: el formato del pedido", () => {
  it("acepta un pedido bien formado y recorta el nombre", () => {
    const r = guardComandoDuplicarProducto(VALIDO);
    expect(r).toEqual({ ok: true, valor: { duplicadoId: VALIDO.duplicadoId, origenId: "cmabc123", nombre: "Bife con chimichurri", copiarReceta: true, copiarOpciones: true, sucursalDeLaRecetaId: null, precioVenta: null } });
  });

  it("el nombre es obligatorio y se valida como el de un alta", () => {
    for (const nombre of [undefined, null, "", "   ", 5, {}]) expect(guardComandoDuplicarProducto({ ...VALIDO, nombre })).toMatchObject({ ok: false });
    expect(guardComandoDuplicarProducto({ ...VALIDO, nombre: "-raro" })).toMatchObject({ ok: false });
    expect(guardComandoDuplicarProducto({ ...VALIDO, nombre: "x".repeat(400) })).toMatchObject({ ok: false });
  });

  it("los identificadores tienen que ser texto con la forma esperada", () => {
    for (const duplicadoId of [undefined, 5, {}, "corto", "con espacios en el medio 1234", "a".repeat(80)]) expect(guardComandoDuplicarProducto({ ...VALIDO, duplicadoId })).toMatchObject({ ok: false });
    for (const origenId of [undefined, "", 7, { id: "x" }, "x".repeat(80)]) expect(guardComandoDuplicarProducto({ ...VALIDO, origenId })).toMatchObject({ ok: false, mensaje: "No se encontró el producto." });
  });

  it("qué copiar son verdadero o falso estrictos: un texto no se interpreta", () => {
    for (const valor of ["true", 1, 0, null, undefined]) {
      expect(guardComandoDuplicarProducto({ ...VALIDO, copiarReceta: valor })).toMatchObject({ ok: false });
      expect(guardComandoDuplicarProducto({ ...VALIDO, copiarOpciones: valor })).toMatchObject({ ok: false });
    }
  });

  it("la sucursal de la receta es un texto o nada, y solo cuenta si se copia la receta", () => {
    expect(guardComandoDuplicarProducto({ ...VALIDO, sucursalDeLaRecetaId: { id: "x" } })).toMatchObject({ ok: false });
    expect(guardComandoDuplicarProducto({ ...VALIDO, sucursalDeLaRecetaId: "" })).toMatchObject({ ok: false });
    expect(guardComandoDuplicarProducto({ ...VALIDO, sucursalDeLaRecetaId: "suc1" })).toMatchObject({ ok: true, valor: { sucursalDeLaRecetaId: "suc1" } });
    expect(guardComandoDuplicarProducto({ ...VALIDO, sucursalDeLaRecetaId: "suc1", copiarReceta: false })).toMatchObject({ ok: true, valor: { sucursalDeLaRecetaId: null } });
  });

  it("el precio, si viene, es un importe válido (≥ 0, hasta 2 decimales); sin precio queda en null", () => {
    expect(guardComandoDuplicarProducto({ ...VALIDO, precioVenta: "5600.50" })).toMatchObject({ ok: true, valor: { precioVenta: 5600.5 } });
    expect(guardComandoDuplicarProducto({ ...VALIDO, precioVenta: 0 })).toMatchObject({ ok: true, valor: { precioVenta: 0 } });
    expect(guardComandoDuplicarProducto({ ...VALIDO, precioVenta: "" })).toMatchObject({ ok: true, valor: { precioVenta: null } });
    for (const precioVenta of ["abc", "-1", -1, "1.234", NaN, Infinity, "1e308", {}, []]) expect(guardComandoDuplicarProducto({ ...VALIDO, precioVenta }), String(precioVenta)).toMatchObject({ ok: false });
  });
});
