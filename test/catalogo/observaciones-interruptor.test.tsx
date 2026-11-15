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

import { OBSERVACIONES_VISIBLES } from "../../src/core/catalogo/public";
import { ProductoForm, type ProductoExistente } from "../../src/app/(app)/catalogo/productos/producto-form";

/**
 * Interruptor de «Observaciones» (`OBSERVACIONES_VISIBLES`, dueño 2026-11-13: «Ocultarlo con interruptor reversible»), lado PANTALLA: con el interruptor apagado el formulario del producto (alta y edición) no dibuja el
 * campo ni el valor guardado; encendido, vuelve con su valor. Es el guardián de ausencia: si alguien vuelve a dibujar el campo sin pasar por el interruptor, el primer caso se pone rojo; y el segundo (el interruptor
 * encendido) prueba que el campo existe y que la ausencia viene del interruptor, no de que el campo se haya borrado.
 */
const comunes = {
  unidades: [{ id: "u-kg", nombre: "kg", decimales: 2 }],
  insumosIniciales: [],
  categoriasIniciales: [],
  proveedoresIniciales: [],
  puedeCrear: { categoria: false, insumo: false, proveedor: false },
  puedeGestionarConsignacion: false,
  puedeEditarCamposSensibles: true,
  cantidadSucursales: 1,
  nombreSucursalActual: "Central",
  presentacionesIniciales: [],
};
const harina: ProductoExistente = { id: "p1", codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: "u-kg", unidadCompraId: "u-kg", factorConversion: 1, precioVenta: 0, observaciones: "Se guarda en seco" };
const dibujar = (Form: typeof ProductoForm, existente?: ProductoExistente) => renderToStaticMarkup(<Form {...comunes} productoExistente={existente} />);

describe("formulario del producto: «Observaciones» OCULTAS", () => {
  it("el interruptor está apagado: ni la edición ni el alta dibujan el campo, y el valor guardado no se ve", () => {
    expect(OBSERVACIONES_VISIBLES).toBe(false);
    for (const html of [dibujar(ProductoForm, harina), dibujar(ProductoForm)]) {
      expect(html).not.toContain('name="observaciones"');
      expect(html).not.toContain("Se guarda en seco");
    }
  });
});

describe("formulario del producto: «Observaciones» ENCENDIDAS (reversibilidad)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/catalogo/observaciones-visibles");
    vi.resetModules();
  });

  it("con el interruptor en true vuelve el campo, con su valor", async () => {
    vi.resetModules();
    vi.doMock("../../src/core/catalogo/observaciones-visibles", () => ({ OBSERVACIONES_VISIBLES: true }));
    const { ProductoForm: FormEncendido } = await import("../../src/app/(app)/catalogo/productos/producto-form");
    const html = dibujar(FormEncendido, harina);
    expect(html).toContain('name="observaciones"');
    expect(html).toContain("Se guarda en seco");
    expect(dibujar(FormEncendido)).toContain('name="observaciones"');
  });
});
