import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// El formulario es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("../../src/server/actions/catalogo/productos", () => ({
  darDeAltaProducto: vi.fn(),
  actualizarProducto: vi.fn(),
  sincronizarPrecioGrupoCarta: vi.fn(),
  obtenerInsumoDeProducto: vi.fn(),
  asignarInsumoAProducto: vi.fn(),
  agregarPresentacionAlternativa: vi.fn(),
  actualizarActivaPresentacion: vi.fn(),
  listarPresentaciones: vi.fn(),
  buscarProductosSelector: vi.fn(),
}));
vi.mock("../../src/server/actions/catalogo/insumos", () => ({ crearInsumo: vi.fn() }));
vi.mock("../../src/server/actions/catalogo/categorias-producto", () => ({ crearCategoriaProducto: vi.fn() }));
vi.mock("../../src/server/actions/catalogo/proveedores", () => ({ altaProveedor: vi.fn() }));

import { PRESENTACIONES_VISIBLES } from "../../src/core/catalogo/public";
import { ProductoForm, type ProductoExistente } from "../../src/app/(app)/catalogo/productos/producto-form";

/**
 * Interruptor de las presentaciones (`PRESENTACIONES_VISIBLES`, decisión del dueño 2026-11-06), lado PANTALLA: el formulario de edición de una materia prima no ofrece la gestión de
 * presentaciones con el interruptor apagado, y la vuelve a ofrecer encendido. El lado servidor está en `presentaciones-interruptor.test.ts`.
 */
const comunes = {
  unidades: [{ id: "u-kg", nombre: "kg", decimales: 2 }, { id: "u-g", nombre: "g", decimales: 0 }],
  insumosIniciales: [],
  categoriasIniciales: [],
  proveedoresIniciales: [],
  puedeCrear: { categoria: false, insumo: false, proveedor: false },
  puedeGestionarConsignacion: false,
  puedeEditarCamposSensibles: true,
  cantidadSucursales: 1,
  nombreSucursalActual: "Central",
  presentacionesIniciales: [{ id: "pr1", unidadCompraId: "u-g", unidadCompraNombre: "g", factorConversion: 20, activa: true }],
};
const harina: ProductoExistente = { id: "p1", codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: "u-kg", unidadCompraId: "u-kg", factorConversion: 1, precioVenta: 0 };
const dibujar = (Form: typeof ProductoForm) => renderToStaticMarkup(<Form {...comunes} productoExistente={harina} />);

describe("formulario del producto: presentaciones APAGADAS", () => {
  it("el interruptor está apagado y el formulario de edición de una materia prima no ofrece su gestión (ni la lista de las que ya existían)", () => {
    expect(PRESENTACIONES_VISIBLES).toBe(false);
    const html = dibujar(ProductoForm);
    expect(html).not.toContain("Presentaciones de compra alternativas");
  });
});

describe("formulario del producto: presentaciones ENCENDIDAS (reversibilidad)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/catalogo/presentaciones-visibles");
    vi.resetModules();
  });

  it("con el interruptor en true vuelve la gestión de presentaciones, con la que ya existía", async () => {
    vi.resetModules();
    vi.doMock("../../src/core/catalogo/presentaciones-visibles", async (original) => ({ ...(await original<typeof import("../../src/core/catalogo/presentaciones-visibles")>()), PRESENTACIONES_VISIBLES: true }));
    const { ProductoForm: FormEncendido } = await import("../../src/app/(app)/catalogo/productos/producto-form");
    const html = dibujar(FormEncendido);
    expect(html).toContain("Presentaciones de compra alternativas");
    expect(html).toContain("20");
  });
});
