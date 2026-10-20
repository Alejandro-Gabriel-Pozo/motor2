import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// El formulario es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA (como campos-sensibles-pantallas.test.tsx).
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
import { CampoSeLeeEnLaCarta } from "../../src/app/(app)/catalogo/opciones/[grupoId]/campo-se-lee-en-la-carta";

/**
 * Fase 4 de la ola «precio y carta», C9 (ADR-035): las pantallas mínimas, lo que DIBUJAN (la interacción y axe a 375 px van en los e2e `catalogo-producto-base.spec.ts` y
 * `catalogo-grupo-se-lee-en-carta.spec.ts`):
 *  - el formulario de un PV: «¿Cómo se vende?» como grupo de radios con leyenda; «Por opción» apagado con el motivo visible (y `aria-describedby`) si no hay grupo de precio; siendo base, el precio guardado en
 *    solo lectura («no se cobra») con el enlace a las opciones y SIN el campo editable; sin la clave, el modo en solo lectura;
 *  - «Se lee en la carta como»: la lectura en vivo (`aria-live`) con el prefijo guardado, y el texto de «sin prefijo».
 */
const comunes = {
  unidades: [{ id: "u-un", nombre: "unidad", decimales: 0 }],
  insumosIniciales: [],
  categoriasIniciales: [],
  proveedoresIniciales: [],
  puedeCrear: { categoria: false, insumo: false, proveedor: false },
  puedeGestionarConsignacion: false,
  presentacionesIniciales: [],
};
const pizzas: ProductoExistente = { id: "p1", codigo: "PV_1", nombre: "Pizzas", tipo: "PV", unidadStockId: "u-un", unidadCompraId: null, factorConversion: 1, precioVenta: 18000 };
const dibujar = (venta: { modo: "DIRECTO" | "BASE_CONFIGURABLE"; grupoConPrecioFinal: string | null } | undefined, puede = true) =>
  renderToStaticMarkup(<ProductoForm {...comunes} puedeEditarCamposSensibles={puede} productoExistente={pizzas} venta={venta} />);
const textoPlano = (html: string) => html.split(/<[^>]*>/).join(" ").replace(/\s+/g, " ");
/** El radio de ese valor (la etiqueta entera, con sus atributos en cualquier orden). */
const radio = (html: string, valor: string) => html.match(new RegExp(`<input[^>]*type="radio"[^>]*value="${valor}"[^>]*>`))?.[0] ?? html.match(new RegExp(`<input[^>]*value="${valor}"[^>]*type="radio"[^>]*>`))?.[0] ?? "";

describe("C9: «¿Cómo se vende?» en el formulario del producto", () => {
  it("directo con grupo de precio: los dos radios con su leyenda, «Directo» elegido y el precio editable", () => {
    const html = dibujar({ modo: "DIRECTO", grupoConPrecioFinal: "Tipos de Pizza" });
    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>¿Cómo se vende\?<\/legend>/);
    expect(radio(html, "DIRECTO")).toContain('name="modoDeVenta"');
    expect(radio(html, "DIRECTO")).toContain('checked=""');
    expect(radio(html, "BASE_CONFIGURABLE")).not.toContain("disabled");
    expect(textoPlano(html)).toContain("El precio final de cada opción está en «Tipos de Pizza».");
    expect(html).toContain('name="precioVenta"');
  });

  it("sin grupo de precio, «Por opción» se ve apagado y dice por qué (visible y conectado con aria-describedby)", () => {
    const html = dibujar({ modo: "DIRECTO", grupoConPrecioFinal: null });
    const porOpcion = radio(html, "BASE_CONFIGURABLE");
    expect(porOpcion).toContain('disabled=""');
    const describedBy = porOpcion.match(/aria-describedby="([^"]+)"/)?.[1] ?? "";
    expect(html).toMatch(new RegExp(`id="${describedBy}"[^>]*>Para venderlo por opción, primero asignale un grupo de tamaños`));
  });

  it("siendo base: el precio guardado en solo lectura «(no se cobra)», el enlace a las opciones y SIN el campo editable", () => {
    const html = dibujar({ modo: "BASE_CONFIGURABLE", grupoConPrecioFinal: "Tipos de Pizza" });
    expect(radio(html, "BASE_CONFIGURABLE")).toContain('checked=""');
    expect(html).not.toContain('name="precioVenta"');
    expect(textoPlano(html)).toContain("Precio guardado (no se cobra)");
    expect(textoPlano(html)).toContain("$18.000,00");
    expect(html).toContain('href="/catalogo/productos/p1/opciones"');
  });

  it("sin producto_campos_sensibles, el modo se ve en solo lectura (sin radios)", () => {
    const html = dibujar({ modo: "BASE_CONFIGURABLE", grupoConPrecioFinal: "Tipos de Pizza" }, false);
    expect(html).not.toContain('name="modoDeVenta"');
    expect(html).toContain('data-solo-lectura="modoDeVenta"');
    expect(textoPlano(html)).toContain("Por opción: el precio final está en cada opción");
  });

  it("una materia prima o el alta no muestran «¿Cómo se vende?»", () => {
    expect(dibujar(undefined)).not.toContain("¿Cómo se vende?");
  });
});

describe("C9: «Se lee en la carta como» en el formulario del grupo", () => {
  const opciones = [{ nombre: "Carne", esNinguna: false }, { nombre: "Pollo", esNinguna: false }, { nombre: "Sin nada", esNinguna: true }];

  it("con el prefijo guardado: el campo (name, tope 20, contador) y la lectura en vivo anunciada", () => {
    const html = renderToStaticMarkup(<CampoSeLeeEnLaCarta prefijoInicial="De" opciones={opciones} />);
    const campo = html.match(/<input[^>]*name="prefijoEnCarta"[^>]*>/)?.[0] ?? "";
    expect(campo).toContain('maxLength="20"');
    expect(campo).toContain('value="De"');
    expect(html).toMatch(/<label[^>]*>Se lee en la carta como/);
    expect(textoPlano(html)).toContain("(2/20)");
    expect(html).toMatch(/<p aria-live="polite"[^>]*>En la carta se verá: De carne · De pollo<\/p>/);
  });

  it("sin prefijo: «Sin prefijo: cada opción se lee con su nombre.»", () => {
    const html = renderToStaticMarkup(<CampoSeLeeEnLaCarta prefijoInicial={null} opciones={opciones} />);
    expect(html).toMatch(/<p aria-live="polite"[^>]*>Sin prefijo: cada opción se lee con su nombre\.<\/p>/);
  });
});
