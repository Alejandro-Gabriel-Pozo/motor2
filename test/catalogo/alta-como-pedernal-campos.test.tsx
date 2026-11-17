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
// Con renderToStaticMarkup el alta solo se ve con su estado inicial (Materia prima): para ver el alta de un producto VENDIBLE se arranca el estado de la clase y del tipo en «Producto vendible» / PV (solo en esta prueba).
let arrancarComoVendible = false;
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  const useState = ((inicial: unknown) => real.useState(arrancarComoVendible && inicial === "MATERIA_PRIMA" ? "VENDIBLE" : arrancarComoVendible && inicial === "MP" ? "PV" : inicial)) as typeof real.useState;
  return { ...real, useState, default: { ...real, useState } };
});

import { ProductoForm, type ProductoExistente } from "../../src/app/(app)/catalogo/productos/producto-form";
import { CAMPOS, FILAS_ESPERADAS, MARCADOR, type FilaEsperada } from "./alta-como-pedernal-campos.reglas";

/**
 * El alta de un producto como Pedernal (decisión del dueño, 2026-11-17): sin categoría, insumo, unidad de compra, factor, paso de venta ni consignación, con UNA «Unidad»; la edición y la pantalla anterior (interruptor
 * apagado) los siguen dibujando. Recorre pantalla × clase contra el oráculo escrito aparte (`alta-como-pedernal-campos.reglas.ts`), con la clave de campos sensibles y la de consignación (lo más completo que se puede ver).
 */
const comunes = {
  unidades: [{ id: "u-kg", nombre: "kg", decimales: 3 }], insumosIniciales: [{ id: "i1", nombre: "Harina" }], categoriasIniciales: [{ id: "c1", nombre: "Pastas" }], proveedoresIniciales: [],
  puedeCrear: { categoria: true, insumo: true, proveedor: true }, puedeGestionarConsignacion: true, puedeEditarCamposSensibles: true, presentacionesIniciales: [], cantidadSucursales: 3, nombreSucursalActual: "Central",
};
const existente = (vendible: boolean) =>
  ({ id: "p1", codigo: "P1", nombre: "Producto", tipo: vendible ? "PV" : "MP", unidadStockId: "u-kg", unidadCompraId: null, factorConversion: 1, precioVenta: 0, observaciones: null, seProduce: false }) as unknown as ProductoExistente;

function dibujar(f: Pick<FilaEsperada, "pantalla" | "clase">): string {
  const vendible = f.clase === "VENDIBLE";
  arrancarComoVendible = vendible && f.pantalla !== "EDICION";
  try {
    return renderToStaticMarkup(<ProductoForm {...comunes} altaComoPedernal={f.pantalla !== "ALTA_ANTERIOR"} productoExistente={f.pantalla === "EDICION" ? existente(vendible) : undefined} />);
  } finally {
    arrancarComoVendible = false;
  }
}

describe("campos del formulario de producto: pantalla × clase contra el oráculo", () => {
  it.each(FILAS_ESPERADAS.map((f) => ({ ...f, nombre: `${f.pantalla} / ${f.clase}` })))("$nombre", (fila) => {
    const html = dibujar(fila);
    for (const campo of CAMPOS) expect(MARCADOR[campo].test(html), `${campo}: esperado ${fila.dibuja[campo]}`).toBe(fila.dibuja[campo]);
  });

  // Decisión del dueño (2026-11-17): el alta es UNA pantalla final, sin párrafos, avisos ni «Pendiente de completar»; solo las palabras de la maqueta de Pedernal.
  it.each([
    { clase: "MATERIA_PRIMA", clave: true }, { clase: "MATERIA_PRIMA", clave: false }, { clase: "VENDIBLE", clave: true }, { clase: "VENDIBLE", clave: false },
  ] as const)("el ALTA (%j) no dibuja avisos ni ayudas, y sin la clave tampoco el IVA", ({ clase, clave }) => {
    arrancarComoVendible = clase === "VENDIBLE";
    let html: string;
    try {
      html = renderToStaticMarkup(<ProductoForm {...comunes} puedeEditarCamposSensibles={clave} puedeGestionarConsignacion={false} />);
    } finally {
      arrancarComoVendible = false;
    }
    for (const marca of ["data-aviso-campos-sensibles", "data-aviso-alta-sin-precio", "data-alicuota-pendiente", "Pendiente de completar", "Para cambiarla hace falta", "data-solo-lectura"]) expect(html, marca).not.toContain(marca);
    expect(html.includes("name=\"alicuotaIva\"")).toBe(clase === "VENDIBLE" && clave);
    expect(html).not.toContain("<h2");
  });

  it("el oráculo cubre todas las combinaciones de pantalla y clase, sin repetidas", () => {
    expect(new Set(FILAS_ESPERADAS.map((f) => `${f.pantalla}/${f.clase}`)).size).toBe(6);
  });

  it("el arranque como vendible es de verdad un alta vendible (sin esto la fila VENDIBLE del alta no mide nada)", () => {
    const html = dibujar({ pantalla: "ALTA_COMO_PEDERNAL", clase: "VENDIBLE" });
    expect(html).toContain("Nombre de cocina");
    expect(html).toContain('data-alicuota-iva="venta"');
  });
});
