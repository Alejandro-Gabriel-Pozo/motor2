import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// El formulario es de cliente: fuera de Next no hay router ni acciones de servidor. Esta prueba mide solo lo que DIBUJA.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("../../src/server/actions/catalogo/productos", () => ({
  darDeAltaProducto: vi.fn(), actualizarProducto: vi.fn(), sincronizarPrecioGrupoCarta: vi.fn(), obtenerInsumoDeProducto: vi.fn(), asignarInsumoAProducto: vi.fn(),
  agregarPresentacionAlternativa: vi.fn(), actualizarActivaPresentacion: vi.fn(), listarPresentaciones: vi.fn(), buscarProductosSelector: vi.fn(),
}));
vi.mock("../../src/server/actions/catalogo/insumos", () => ({ crearInsumo: vi.fn() }));
vi.mock("../../src/server/actions/catalogo/categorias-producto", () => ({ crearCategoriaProducto: vi.fn() }));
vi.mock("../../src/server/actions/catalogo/proveedores", () => ({ altaProveedor: vi.fn() }));
// Con renderToStaticMarkup el alta solo se ve con su estado inicial (Materia prima). Para ver el alta de un producto VENDIBLE se arranca el estado de la clase y del tipo en «Producto vendible» / PV (solo en esta prueba).
let arrancarComoVendible = false;
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  const useState = ((inicial: unknown) => real.useState(arrancarComoVendible && inicial === "MATERIA_PRIMA" ? "VENDIBLE" : arrancarComoVendible && inicial === "MP" ? "PV" : inicial)) as typeof real.useState;
  return { ...real, useState, default: { ...real, useState } };
});

import { ProductoForm, type ProductoExistente } from "../../src/app/(app)/catalogo/productos/producto-form";
import { CampoPrecioDeVenta } from "../../src/app/(app)/catalogo/productos/campo-precio-de-venta";

/**
 * Frente 2 (`docs/diseno-precio-fuera-del-alta-2026-11-17.md`; pedido del dueño, 2026-11-17: «No, el precio donde lo pide... Donde lo pide Pedernal.»): el ALTA de un producto de venta ya no pide «El precio de venta»
 * (campo `precioVenta`); la EDICIÓN lo sigue mostrando y editando con la clave; con el interruptor apagado la pantalla vuelve a la de antes.
 */
const comunes = {
  unidades: [{ id: "u-kg", nombre: "kg", decimales: 3 }], insumosIniciales: [], categoriasIniciales: [], proveedoresIniciales: [],
  puedeCrear: { categoria: false, insumo: false, proveedor: false }, puedeGestionarConsignacion: false, presentacionesIniciales: [], cantidadSucursales: 3, nombreSucursalActual: "Central",
};
const pv = { id: "p1", codigo: "P1", nombre: "Milanesa", tipo: "PV", unidadStockId: "u-kg", unidadCompraId: null, factorConversion: 1, precioVenta: 9000, observaciones: null } as unknown as ProductoExistente;
const dibujar = (extra: Record<string, unknown>, vendible: boolean) => {
  arrancarComoVendible = vendible;
  try {
    return renderToStaticMarkup(<ProductoForm {...comunes} puedeEditarCamposSensibles={true} {...extra} />);
  } finally {
    arrancarComoVendible = false;
  }
};

describe("el precio de venta fuera del alta (pantalla)", () => {
  it("el arranque de la prueba es de verdad un alta de producto vendible (sin esto las demás pruebas no miden nada)", () => {
    const html = dibujar({}, true);
    expect(html).toContain("Nombre de cocina");
    expect(html).toContain("¿Qué es?");
  });

  it.each([true, false])("el ALTA de un producto de venta no tiene el campo precioVenta (con la clave: %s)", (conClave) => {
    const html = dibujar({ puedeEditarCamposSensibles: conClave }, true);
    expect(html).not.toContain('name="precioVenta"');
    expect(html).not.toContain("El precio de venta");
    expect(html).not.toContain("Precio de venta");
  });

  it("la EDICIÓN de un producto de venta con la clave sí muestra y edita el precio", () => {
    const html = dibujar({ productoExistente: pv }, false);
    expect(html).toContain('name="precioVenta"');
    expect(html).toContain('aria-label="Precio de venta"');
  });

  it("la EDICIÓN sin la clave lo muestra en solo lectura (sin campo)", () => {
    const html = dibujar({ productoExistente: pv, puedeEditarCamposSensibles: false }, false);
    expect(html).not.toContain('name="precioVenta"');
    expect(html).toContain("Precio de venta");
  });

  it("con el interruptor APAGADO el alta vuelve a pedir el precio (con la clave: campo; sin ella: solo lectura)", () => {
    expect(dibujar({ altaComoPedernal: false }, true)).toContain('name="precioVenta"');
    const sinClave = dibujar({ altaComoPedernal: false, puedeEditarCamposSensibles: false }, true);
    expect(sinClave).not.toContain('name="precioVenta"');
    expect(sinClave).toContain("Precio de venta");
  });

  // Combinaciones: edición × clave × interruptor. Oráculo a mano: el campo (editable) solo se dibuja con la clave y fuera del alta-como-Pedernal; el solo lectura, sin la clave y fuera del alta-como-Pedernal.
  it.each([
    { editando: false, altaComoPedernal: true, clave: true, campo: false, lectura: false },
    { editando: false, altaComoPedernal: true, clave: false, campo: false, lectura: false },
    { editando: false, altaComoPedernal: false, clave: true, campo: true, lectura: false },
    { editando: false, altaComoPedernal: false, clave: false, campo: false, lectura: true },
    { editando: true, altaComoPedernal: true, clave: true, campo: true, lectura: false },
    { editando: true, altaComoPedernal: true, clave: false, campo: false, lectura: true },
    { editando: true, altaComoPedernal: false, clave: true, campo: true, lectura: false },
    { editando: true, altaComoPedernal: false, clave: false, campo: false, lectura: true },
  ])("CampoPrecioDeVenta %j", (c) => {
    const html = renderToStaticMarkup(<CampoPrecioDeVenta editando={c.editando} altaComoPedernal={c.altaComoPedernal} puedeEditarCamposSensibles={c.clave} precioGuardado={9000} />);
    expect(html.includes('name="precioVenta"')).toBe(c.campo);
    expect(html.includes("Precio de venta") && !html.includes('name="precioVenta"')).toBe(c.lectura);
  });
});
