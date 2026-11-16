import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// El formulario es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA y lo que el formulario manda (mismo molde que `observaciones-interruptor.test.tsx`).
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

import { ProductoForm, type ProductoExistente } from "../../src/app/(app)/catalogo/productos/producto-form";
import { nombreDeCocinaDelFormulario } from "../../src/app/(app)/catalogo/productos/campo-nombre-de-cocina";

/**
 * Nombre de cocina (2026-11-15), lado PANTALLA: el campo «Nombre de cocina» de la ficha aparece solo en un producto de venta (PV), con el valor guardado cuando lo hay, y NO aparece en una materia prima (MP).
 * Y lo que el formulario manda: en el alta, vacío = no manda nada; en la edición, vaciado = `null` explícito (borra), porque «ausente» significaría «queda como estaba»; una MP nunca lo manda.
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
const base = { unidadStockId: "u-kg", unidadCompraId: "u-kg", factorConversion: 1, precioVenta: 0 };
const bife: ProductoExistente = { id: "p1", codigo: "PV_BIFE", nombre: "Bife de chorizo", tipo: "PV", ...base, precioVenta: 18000, nombreDeCocina: "Medallón de bife" };
const harina: ProductoExistente = { id: "p2", codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", ...base };
const dibujar = (existente?: ProductoExistente) => renderToStaticMarkup(<ProductoForm {...comunes} productoExistente={existente} />);
const formulario = (valor?: string) => {
  const f = new FormData();
  if (valor !== undefined) f.set("nombreDeCocina", valor);
  return f;
};

describe("ficha del producto: «Nombre de cocina»", () => {
  it("un PV existente muestra el campo con su valor guardado; uno sin nombre de cocina lo muestra vacío", () => {
    expect(dibujar(bife)).toMatch(/name="nombreDeCocina"[^>]*value="Medallón de bife"|value="Medallón de bife"[^>]*name="nombreDeCocina"/);
    const sin = dibujar({ ...bife, nombreDeCocina: null });
    expect(sin).toContain('name="nombreDeCocina"');
    expect(sin).not.toContain("Medallón de bife");
  });

  it("una MP no dibuja el campo", () => {
    expect(dibujar(harina)).not.toContain("nombreDeCocina");
    expect(dibujar(harina)).not.toContain("Nombre de cocina");
  });

  it("el alta nace como MP (sin el campo); el campo aparece cuando se elige «Producto de venta»: la pantalla del alta lo maneja con el tipo elegido", () => {
    expect(dibujar(undefined)).not.toContain("nombreDeCocina");
  });
});

describe("lo que el formulario manda del nombre de cocina", () => {
  it("PV con texto: lo manda recortado por `texto()`; en el alta y en la edición", () => {
    expect(nombreDeCocinaDelFormulario(formulario("  Medallón de bife "), "PV", false)).toEqual({ nombreDeCocina: "Medallón de bife" });
    expect(nombreDeCocinaDelFormulario(formulario("Medallón de bife"), "PV", true)).toEqual({ nombreDeCocina: "Medallón de bife" });
  });

  it("PV vacío o de espacios: en el alta no manda nada; en la edición manda null explícito (borra)", () => {
    for (const vacio of ["", "   "]) {
      expect(nombreDeCocinaDelFormulario(formulario(vacio), "PV", false), `alta ${JSON.stringify(vacio)}`).toEqual({});
      expect(nombreDeCocinaDelFormulario(formulario(vacio), "PV", true), `edición ${JSON.stringify(vacio)}`).toEqual({ nombreDeCocina: null });
    }
    expect(nombreDeCocinaDelFormulario(formulario(), "PV", true), "campo ausente en el FormData").toEqual({ nombreDeCocina: null });
  });

  it("una MP nunca lo manda, ni con texto en el FormData", () => {
    expect(nombreDeCocinaDelFormulario(formulario("Algo"), "MP", false)).toEqual({});
    expect(nombreDeCocinaDelFormulario(formulario("Algo"), "MP", true)).toEqual({});
  });
});
