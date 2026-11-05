import { describe, expect, it } from "vitest";
import { guardComandoAltaProveedor } from "../../src/core/features/catalogo/proveedores.guard";
import { MENSAJE_AL_MENOS_UNA_OFERTA, etiquetaDeOferta, validarOferta } from "../../src/core/features/catalogo/oferta-de-proveedor";

/** Proveedores (2026-11-04): la regla pura de «qué le compramos» (productos, servicios o ambos) y cómo la usa el guard del alta. */
describe("oferta de un proveedor", () => {
  it.each([
    [true, false, "Productos"],
    [false, true, "Servicios"],
    [true, true, "Productos y servicios"],
  ] as const)("productos=%s servicios=%s → «%s»", (ofreceProductos, ofreceServicios, etiqueta) => {
    expect(validarOferta(ofreceProductos, ofreceServicios)).toEqual({ ok: true, valor: { ofreceProductos, ofreceServicios } });
    expect(etiquetaDeOferta({ ofreceProductos, ofreceServicios })).toBe(etiqueta);
  });

  it.each([
    [false, false],
    [undefined, undefined],
    ["true", "true"],
    [null, 0],
  ])("ninguna marcada (%j, %j) se rechaza", (a, b) => {
    expect(validarOferta(a, b)).toMatchObject({ ok: false, mensaje: MENSAJE_AL_MENOS_UNA_OFERTA });
  });

  it("el guard del alta: sin decir nada nace «productos»; con las dos en falso se rechaza", () => {
    expect(guardComandoAltaProveedor({ nombre: "Uno" })).toMatchObject({ ok: true, valor: { oferta: { ofreceProductos: true, ofreceServicios: false } } });
    expect(guardComandoAltaProveedor({ nombre: "Uno", ofreceProductos: false, ofreceServicios: true })).toMatchObject({ ok: true, valor: { oferta: { ofreceProductos: false, ofreceServicios: true } } });
    expect(guardComandoAltaProveedor({ nombre: "Uno", ofreceProductos: false, ofreceServicios: false })).toMatchObject({ ok: false });
    expect(guardComandoAltaProveedor({ nombre: "   " })).toMatchObject({ ok: false });
  });
});
