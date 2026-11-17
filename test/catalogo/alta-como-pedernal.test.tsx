import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// El formulario es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("../../src/server/actions/catalogo/productos", () => ({
  darDeAltaProducto: vi.fn(), actualizarProducto: vi.fn(), sincronizarPrecioGrupoCarta: vi.fn(), obtenerInsumoDeProducto: vi.fn(), asignarInsumoAProducto: vi.fn(),
  agregarPresentacionAlternativa: vi.fn(), actualizarActivaPresentacion: vi.fn(), listarPresentaciones: vi.fn(), buscarProductosSelector: vi.fn(),
}));
vi.mock("../../src/server/actions/catalogo/insumos", () => ({ crearInsumo: vi.fn() }));
vi.mock("../../src/server/actions/catalogo/categorias-producto", () => ({ crearCategoriaProducto: vi.fn() }));
vi.mock("../../src/server/actions/catalogo/proveedores", () => ({ altaProveedor: vi.fn() }));

import { ProductoForm, type ProductoExistente } from "../../src/app/(app)/catalogo/productos/producto-form";
import { ALTA_DE_PRODUCTO_COMO_PEDERNAL, CLASES_DE_ALTA, CLAVES_DE_CLASE_DE_ALTA, claseDeAltaDe } from "../../src/core/catalogo/public";
import { CLASES_DE_ALTA_ESPERADAS } from "./alta-como-pedernal.reglas";

/**
 * «Producto nuevo» como Pedernal (docs/diseno-producto-nuevo-como-pedernal-2026-11-17.md; pedido del dueño, 2026-11-17): «¿Qué es?» con las clases que hoy se pueden guardar, sin las casillas
 * «Se produce (tiene receta propia, se fabrica por lote)» ni «Activo en todas las sucursales». SOLO PANTALLA: cada clase se guarda con los datos de siempre. Los valores esperados salen del
 * oráculo escrito aparte (`alta-como-pedernal.reglas.ts`).
 */
const comunes = {
  unidades: [{ id: "u-kg", nombre: "kg", decimales: 3 }],
  insumosIniciales: [],
  categoriasIniciales: [],
  proveedoresIniciales: [],
  puedeCrear: { categoria: false, insumo: false, proveedor: false },
  puedeGestionarConsignacion: false,
  puedeEditarCamposSensibles: true,
  presentacionesIniciales: [],
  cantidadSucursales: 3,
  nombreSucursalActual: "Central",
};
const alta = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(<ProductoForm {...comunes} {...extra} />);
const existente = (extra: Partial<ProductoExistente>): ProductoExistente => ({
  id: "p1", codigo: "P1", nombre: "Salsa de la casa", tipo: "MP", unidadStockId: "u-kg", unidadCompraId: "u-kg", factorConversion: 1, precioVenta: 0, observaciones: null, ...extra,
} as ProductoExistente);

describe("alta de producto como Pedernal (M3 de la pantalla «Producto nuevo»)", () => {
  it("el interruptor está encendido", () => {
    expect(ALTA_DE_PRODUCTO_COMO_PEDERNAL).toBe(true);
  });

  it("pide «¿Qué es?» con las cuatro clases que hoy se guardan, en el orden de Pedernal, y la descripción literal de la elegida", () => {
    const html = alta();
    expect(html).toContain("¿Qué es?");
    expect(CLAVES_DE_CLASE_DE_ALTA).toEqual(CLASES_DE_ALTA_ESPERADAS.map((c) => c.clave));
    const posiciones = CLASES_DE_ALTA_ESPERADAS.map((c) => html.indexOf(`>${c.nombre}</option>`));
    expect(posiciones.every((p) => p >= 0), `Falta alguna opción: ${posiciones}`).toBe(true);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
    // Nace «cerrado»: la elegida es la primera (Materia prima) y solo se muestra su descripción.
    expect(html).toContain(CLASES_DE_ALTA_ESPERADAS[0]!.descripcion);
    for (const c of CLASES_DE_ALTA_ESPERADAS.slice(1)) expect(html).not.toContain(c.descripcion);
  });

  it("ya no están los dos botones MP/PV ni las casillas «Se produce…» y «Activo en todas las sucursales»", () => {
    const html = alta();
    for (const viejo of ["Materia prima (MP)", "Producto de venta (PV)", "Se produce (tiene receta propia", "Activo en todas las sucursales", 'name="seProduce"', 'name="tipoRadio"']) expect(html, viejo).not.toContain(viejo);
  });

  it("el alta no pide categoría, insumo, unidad de compra, factor, paso de venta ni consignación, y tiene UNA «Unidad» (decisión del dueño, 2026-11-17); la edición los conserva (detalle en alta-como-pedernal-campos.test.tsx)", () => {
    const html = alta({ puedeGestionarConsignacion: true, puedeCrear: { categoria: true, insumo: true, proveedor: true } });
    for (const sacado of ["Sin categoría", "Sin insumo", "+ Nueva categoría", "+ Nuevo insumo", 'name="unidadCompraId"', 'name="factorConversion"', "Es consignación", "Unidad de stock"]) expect(html, sacado).not.toContain(sacado);
    expect(html).toMatch(/<label[^>]*>Unidad<span/);
    expect(renderToStaticMarkup(<ProductoForm {...comunes} productoExistente={existente({})} />)).toContain('name="factorConversion"');
  });

  it("Insumo se ofrece (E2); Reventa NO (el CHECK de la base no la admite hasta E4): no se inventa", () => {
    const html = alta();
    expect(html).toContain(">Insumo</option>");
    expect(html).not.toContain("Reventa</option>");
  });

  it("con el interruptor apagado vuelve la pantalla anterior", () => {
    const html = alta({ altaComoPedernal: false });
    expect(html).toContain("Materia prima (MP)");
    expect(html).toContain("Producto de venta (PV)");
    expect(html).toContain("Se produce (tiene receta propia");
    expect(html).toContain("Activo en todas las sucursales");
    expect(html).not.toContain("¿Qué es?");
  });

  it("en la edición se ve qué es el producto (con su clase y su descripción), sin casillas ni botones", () => {
    for (const c of CLASES_DE_ALTA_ESPERADAS) {
      const html = renderToStaticMarkup(<ProductoForm {...comunes} productoExistente={existente({ tipo: c.tipo, seProduce: c.seProduce })} />);
      expect(html, c.nombre).toContain(c.nombre);
      expect(html).not.toContain('name="queEs"');
      expect(html).not.toContain('name="seProduce"');
    }
  });

  it("ORÁCULO: cada clase se guarda con el tipo y «se produce» de siempre, y se reconoce al leerla", () => {
    for (const c of CLASES_DE_ALTA_ESPERADAS) {
      expect(CLASES_DE_ALTA[c.clave]).toMatchObject({ nombre: c.nombre, descripcion: c.descripcion, tipo: c.tipo, seProduce: c.seProduce });
      expect(claseDeAltaDe({ tipo: c.tipo, seProduce: c.seProduce, claseDeUso: c.clave })).toBe(c.clave);
    }
    // Un producto de venta es vendible aunque traiga «se produce» (una marca que en un PV no significa nada).
    expect(claseDeAltaDe({ tipo: "PV", seProduce: true })).toBe("VENDIBLE");
    expect(claseDeAltaDe({ tipo: "MP" })).toBe("MATERIA_PRIMA");
    // La clase ESCRITA manda sobre lo deducido (un Insumo es una MP que no se produce: sin la clase escrita se leería como Materia prima).
    expect(claseDeAltaDe({ tipo: "MP", seProduce: false, claseDeUso: "INSUMO" })).toBe("INSUMO");
    // Una clase que no se ofrece (Reventa) o ilegible cae en lo deducido: nunca se muestra una clase inventada.
    expect(claseDeAltaDe({ tipo: "MP", seProduce: false, claseDeUso: "REVENTA" })).toBe("MATERIA_PRIMA");
    expect(claseDeAltaDe({ tipo: "PV", claseDeUso: "no-es-una-clase" })).toBe("VENDIBLE");
  });
});
