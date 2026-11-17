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

import { readFileSync } from "node:fs";
import { FICHA_AYUDAS_VISIBLES } from "../../src/core/catalogo/public";
import { AvisoAltaSinPrecio } from "../../src/components/catalogo/campos-sensibles-solo-lectura";
import { ProductoForm, type ProductoExistente } from "../../src/app/(app)/catalogo/productos/producto-form";

/**
 * Interruptor de las AYUDAS permanentes de la ficha del producto (`FICHA_AYUDAS_VISIBLES`, `src/core/catalogo/ficha-ayudas-visibles.ts`; dueño, 2026-11-16, paso 2 de «Pantallas: simplificar»), lado PANTALLA del formulario de Datos:
 * con el interruptor apagado (hoy) no se dibujan las ayudas listadas en el interruptor, pero SÍ las etiquetas, los campos y los avisos; encendido, vuelven tal cual (reversibilidad). Solo cambia la pantalla.
 */
const comunes = {
  unidades: [{ id: "u-kg", nombre: "kg", decimales: 2 }],
  insumosIniciales: [],
  categoriasIniciales: [],
  proveedoresIniciales: [],
  puedeCrear: { categoria: false, insumo: false, proveedor: false },
  puedeGestionarConsignacion: true,
  puedeEditarCamposSensibles: true,
  cantidadSucursales: 3,
  nombreSucursalActual: "Central",
  presentacionesIniciales: [],
};
const harina: ProductoExistente = { id: "p1", codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: "u-kg", unidadCompraId: "u-kg", factorConversion: 1, precioVenta: 0, observaciones: null };
const dibujar = (Form: typeof ProductoForm, existente?: ProductoExistente) => renderToStaticMarkup(<Form {...comunes} productoExistente={existente} />);

const AYUDAS = [
  "El tipo no se puede cambiar una vez creado el producto",
  "Agrupa esta materia prima con otras",
  "Stock: en qué unidad se mide el inventario",
  "Cuántas unidades de stock entran en 1 unidad de compra",
];
const ETIQUETAS = ["Nombre", "Unidad de stock", "Factor de conversión", "Es consignación"];

describe("ficha del producto, Datos: ayudas OCULTAS", () => {
  it("el interruptor está apagado: la edición no dibuja las ayudas, pero sí las etiquetas y los campos", () => {
    expect(FICHA_AYUDAS_VISIBLES).toBe(false);
    const html = dibujar(ProductoForm, harina);
    for (const a of AYUDAS) expect(html, a).not.toContain(a);
    for (const e of ETIQUETAS) expect(html, e).toContain(e);
    expect(html).toContain('name="nombre"');
  });

  it("el alta tampoco dibuja la ayuda de «activo en todas las sucursales»", () => {
    const html = dibujar(ProductoForm);
    expect(html).not.toContain("queda disponible en las");
    expect(html).toContain("Activo en todas las sucursales");
  });
});

describe("ficha del producto, Datos: ayudas ENCENDIDAS (reversibilidad)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/catalogo/ficha-ayudas-visibles");
    vi.resetModules();
  });

  it("con el interruptor en true vuelven las ayudas", async () => {
    vi.resetModules();
    vi.doMock("../../src/core/catalogo/ficha-ayudas-visibles", () => ({ FICHA_AYUDAS_VISIBLES: true }));
    const { ProductoForm: FormEncendido } = await import("../../src/app/(app)/catalogo/productos/producto-form");
    const html = dibujar(FormEncendido, harina);
    for (const a of AYUDAS) expect(html, a).toContain(a);
    expect(dibujar(FormEncendido)).toContain("queda disponible en las 3 sucursales");
  });
});

/**
 * El AVISO del alta («No se va a poder vender todavía…», quien no puede cargar precio) NO es una ayuda: es un aviso condicional y se queda aunque el interruptor esté apagado (Frente 6, paso 2: solo se ocultan las AYUDAS permanentes).
 * Aparece cuando la persona elige «Producto de venta» en el alta (estado del cliente), así que el recorrido completo lo prueba el e2e; acá se cubre lo que se puede sin navegador: el aviso se dibuja solo, sin pasar por el
 * interruptor, y en el formulario va FUERA de `AyudaDeFicha` (si alguien lo metiera adentro, desaparecería con el interruptor apagado y esta prueba falla).
 */
describe("ficha del producto, alta: el aviso «No se va a poder vender todavía» NO se oculta con el interruptor", () => {
  it("el aviso se dibuja solo, con su texto, sin depender de FICHA_AYUDAS_VISIBLES", () => {
    expect(FICHA_AYUDAS_VISIBLES).toBe(false);
    const html = renderToStaticMarkup(<AvisoAltaSinPrecio />);
    expect(html).toContain("data-aviso-alta-sin-precio");
    expect(html).toContain("No se va a poder vender todavía.");
  });

  it("en el formulario va como rama propia, fuera de `AyudaDeFicha`", () => {
    const fuente = readFileSync("src/app/(app)/catalogo/productos/producto-form.tsx", "utf-8");
    expect(fuente).toMatch(/naceSinPoderVenderse \? \(\s*<AvisoAltaSinPrecio \/>\s*\) : \(\s*<AyudaDeFicha>/);
  });
});
