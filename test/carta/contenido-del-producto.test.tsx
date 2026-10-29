import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProductoCartaAdmin } from "../../src/core/carta/public";
// Las Server Actions arrastran la sesión (next-auth) que no se carga fuera de Next: el render del servidor no las ejecuta, alcanza con que existan.
vi.mock("../../src/server/actions/carta/contenido-producto", () => ({ guardarContenidoCartaProducto: vi.fn() }));
vi.mock("../../src/server/actions/carta/descuento-producto", () => ({ guardarDescuentoProducto: vi.fn() }));
vi.mock("../../src/server/actions/carta/mantenimiento", () => ({ quitarProductoDeLaCarta: vi.fn() }));
vi.mock("../../src/server/actions/refrescar", () => ({ refrescarVistaSiHaceFalta: vi.fn() }));
// Interruptor del descuento por producto (`DESCUENTO_POR_PRODUCTO_VISIBLE`, decisión del dueño 2026-10-29): apagado en el código; acá se prende para seguir probando el campo y se apaga en el último test.
const interruptor = vi.hoisted(() => ({ visible: true }));
vi.mock("../../src/core/carta/public", async (original) => ({
  ...(await original<typeof import("../../src/core/carta/public")>()),
  get DESCUENTO_POR_PRODUCTO_VISIBLE() {
    return interruptor.visible;
  },
}));
import { ContenidoDelProducto } from "../../src/components/carta/contenido-del-producto";

/**
 * Fase 6, paso 6.17a: `ContenidoDelProducto` (antes `ContenidoProducto` de Parametrización › Secciones) dibuja con las primitivas del sistema y conserva lo que fotografía la línea de base de
 * navegador y buscan los e2e: los textos de las etiquetas y de los botones, los `name` que lee la acción y los `data-*`. Se mira el HTML del servidor (los closures "use server" no se ejecutan).
 */
const UBICACION = {
  secciones: [{ id: "s1", nombre: "Platos", activa: true }],
  cantidadPorSeccion: { s1: 3 },
  generos: [
    { id: "g1", nombre: "Cerveza", activo: true },
    { id: "g2", nombre: "Vino", activo: false },
  ],
};

function producto(cambios: Partial<ProductoCartaAdmin> = {}): ProductoCartaAdmin {
  return {
    id: "p1",
    nombre: "Milanesas",
    seccionCarta: "Platos",
    precio: 20000,
    descuento: null,
    contenido: { visibleEnCarta: true, seccionCartaId: "s1", descripcion: "Con papas", tags: ["Regional"], especial: false, orden: 2, generoCartaId: null },
    agrupadoEn: null,
    generoCarta: null,
    ...cambios,
  };
}

const dibujar = (p: ProductoCartaAdmin, extra: Partial<Parameters<typeof ContenidoDelProducto>[0]> = {}) =>
  renderToStaticMarkup(<ContenidoDelProducto producto={p} ubicacion={UBICACION} puedeEditar puedeDescuento precioLocalActivo sucursalId="suc" {...extra} />);

describe("ContenidoDelProducto: el formulario de quien puede editar", () => {
  const html = dibujar(producto());

  it("cada control lleva su etiqueta atada (htmlFor/id) con el texto de siempre", () => {
    for (const etiqueta of ["Se muestra en la carta", "Especial (★)", "Género (opcional)", "Descripción (opcional)", "Tags (separados por coma)", "Descuento en esta sucursal, % (vacío = sin descuento)"]) {
      const m = new RegExp(`<label for="([^"]+)"[^>]*>${etiqueta.replace(/[()★]/g, "\\$&")}</label>`).exec(html);
      expect(m, `etiqueta «${etiqueta}»`).not.toBeNull();
      expect(html, `control de «${etiqueta}»`).toMatch(new RegExp(`id="${m![1]}"`));
    }
  });

  it("conserva los name que lee la acción y los botones con su texto", () => {
    for (const nombre of ["visibleEnCarta", "especial", "seccionCartaId", "orden", "generoCartaId", "descripcion", "tags", "descuento"]) expect(html, nombre).toContain(`name="${nombre}"`);
    expect(html).toContain("Guardar contenido de «Milanesas»");
    expect(html).toContain("Guardar descuento de «Milanesas»");
    expect(html).toContain("Quitar «Milanesas» de la carta (vuelve a «Fuera de carta»)");
    expect(html).toContain('data-contenido-carta="Milanesas"');
  });

  it("las casillas llegan con lo guardado y el género apagado sigue deshabilitado", () => {
    expect(html).toMatch(/name="visibleEnCarta"[^>]*checked/);
    expect(html).not.toMatch(/name="especial"[^>]*checked/);
    expect(html).toMatch(/<option value="g2" disabled="">Vino \(apagado\)<\/option>/);
  });

  it("no usa los controles a mano de antes: ni la escala de color ni el modo oscuro", () => {
    expect(html).not.toMatch(/neutral-|dark:|bg-white/);
  });

  it("«Entiendo que se pierde …» solo aparece si hay algo cargado a mano, y es una casilla obligatoria", () => {
    const casilla = /<input[^>]*name="confirmado"[^>]*>/.exec(html)?.[0] ?? "";
    expect(casilla).toContain('type="checkbox"');
    expect(casilla).toContain("required");
    expect(html).toContain("Entiendo que se pierde la descripción, los tags");
    const vacio = dibujar(producto({ contenido: { visibleEnCarta: true, seccionCartaId: "s1", descripcion: null, tags: [], especial: false, orden: 0, generoCartaId: null } }));
    expect(vacio).not.toContain('name="confirmado"');
    expect(vacio).toContain("Quitar «Milanesas» de la carta");
  });

  it("sin contenido de carta no hay «Quitar»; plegada por defecto y desplegada con `abierto`", () => {
    expect(dibujar(producto({ contenido: null }))).not.toContain("Quitar «Milanesas»");
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(dibujar(producto(), { abierto: true })).toMatch(/<details open=""/);
  });

  it("«Mostrar el nombre del producto arriba» solo se dibuja si la base de un eje lo pide", () => {
    expect(html).not.toContain("Mostrar el nombre del producto arriba");
    const conBase = dibujar(producto(), { mostrarNombreArriba: true });
    expect(conBase).toContain("Mostrar el nombre del producto arriba");
    expect(conBase).toContain('data-mostrar-nombre-arriba="Milanesas"');
  });
});

describe("ContenidoDelProducto: contraespejos de quien no puede editar", () => {
  it("sin «Editar» el contenido sale como texto: ningún formulario de contenido ni «Quitar»", () => {
    const html = dibujar(producto(), { puedeEditar: false, puedeDescuento: false });
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Guardar contenido");
    expect(html).not.toContain("Quitar «Milanesas»");
    expect(html).toContain("Con papas");
    expect(html).toContain("Sin descuento");
  });

  it("puede editar el contenido pero no el descuento: el descuento sale como dato", () => {
    const html = dibujar(producto({ descuento: 10 }), { puedeDescuento: false });
    expect(html).toContain("Guardar contenido de «Milanesas»");
    expect(html).not.toContain("Guardar descuento");
    expect(html).toContain("10 %");
  });

  it("un producto agrupado no admite descuento y avisa dónde sale", () => {
    const html = dibujar(producto({ agrupadoEn: "Combos" }));
    expect(html).not.toContain("Guardar descuento");
    expect(html).toContain("Sale en la carta dentro de «Combos»");
  });

  it("con el precio local apagado, el descuento avisa que no rige", () => {
    expect(dibujar(producto({ descuento: 10 }), { precioLocalActivo: false })).toContain("No rige: el precio local está apagado en esta sucursal");
  });
});

describe("ContenidoDelProducto: interruptor del descuento por producto (decisión del dueño 2026-10-29)", () => {
  it("apagado, no ofrece el campo ni el botón ni el dato de solo lectura del descuento, pero el contenido sigue editable", () => {
    interruptor.visible = false;
    try {
      for (const extra of [{}, { puedeDescuento: false }] as const) {
        const html = dibujar(producto(), extra);
        expect(html).toContain("Guardar contenido de «Milanesas»");
        expect(html).not.toContain('name="descuento"');
        expect(html).not.toContain("Guardar descuento");
        expect(html).not.toContain("Descuento en esta sucursal");
        expect(html).not.toContain("Sin descuento");
      }
    } finally {
      interruptor.visible = true;
    }
  });
});
