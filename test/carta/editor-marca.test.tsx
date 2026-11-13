import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `next/font/local` solo existe dentro del compilador de Next: acá las clases de las fuentes son irrelevantes.
vi.mock("../../src/components/carta-publica/fuente-carta", () => ({ clasesFuentesCarta: "" }));

import { SeccionMarca } from "../../src/components/carta/editor-marca";

/**
 * El bloque «Color de marca» del editor del tema (paso 9, PR C), el HTML con el que abre la pantalla: los botones, el aviso y la vista previa dependen de si la carta ya usa la marca y de si
 * el color elegido se lee bien (M2/M3). El envío con la intención («pasar»/«volver») lo cubre la prueba de acciones y el e2e.
 */
const html = (p: Partial<Parameters<typeof SeccionMarca>[0]> = {}) =>
  renderToStaticMarkup(<SeccionMarca modoMarca={false} marcaInicial="" valores={{}} soloLectura={false} {...p} />);

describe("SeccionMarca: estado inicial", () => {
  it("sin color: el botón «Pasar» está deshabilitado, no hay vista previa y no hay botón de volver", () => {
    const h = html();
    expect(h).toContain('data-modo="clasico"');
    expect(h).toContain("Sin elegir");
    expect(h).toContain("Elegí un color para ver cómo queda.");
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*data-accion-marca="pasar"/);
    expect(h).toContain("Pasar a color de marca");
    expect(h).not.toContain("data-vista-previa-marca");
    expect(h).not.toContain('data-accion-marca="volver"');
  });

  it("con un color que se lee bien: botón habilitado, aviso positivo y vista previa", () => {
    const h = html({ marcaInicial: "#5c57a2" });
    expect(h).toContain("#5c57a2");
    expect(h).toContain("Este color se lee bien.");
    expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*data-accion-marca="pasar"/);
    expect(h).toContain("data-vista-previa-marca");
  });

  it("con un color que no pasa (#ffcb69 casi no se distingue del fondo): el aviso dice qué hacer y el botón queda deshabilitado", () => {
    const h = html({ marcaInicial: "#ffcb69" });
    expect(h).toContain("Elegí uno más fuerte");
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*data-accion-marca="pasar"/);
  });

  it("un valor guardado que no es #rrggbb no se toma como elegido", () => {
    const h = html({ marcaInicial: "red" });
    expect(h).toContain("Sin elegir");
  });

  it("en modo marca: «Guardar color de marca» y «Volver a mis colores anteriores»", () => {
    const h = html({ modoMarca: true, marcaInicial: "#5c57a2" });
    expect(h).toContain('data-modo="marca"');
    expect(h).toContain("Guardar color de marca");
    expect(h).toContain("Volver a mis colores anteriores");
    expect(h).toContain("los colores sueltos de abajo no se usan");
  });

  it("los botones no envían solos (type=button) y hay dos campos escondidos: intención vacía y color elegido", () => {
    const h = html({ modoMarca: true, marcaInicial: "#5c57a2" });
    expect(h.match(/<button[^>]*>/g)!.every((b) => b.includes('type="button"'))).toBe(true);
    expect(h).toMatch(/<input[^>]*type="hidden"[^>]*name="intencion"/);
    expect(h).toMatch(/<input[^>]*type="hidden"[^>]*name="marca_elegida"[^>]*value="#5c57a2"/);
  });

  it("solo lectura: sin botones y con el selector deshabilitado", () => {
    const h = html({ modoMarca: true, marcaInicial: "#5c57a2", soloLectura: true });
    expect(h).not.toContain("data-accion-marca");
    expect(h).toMatch(/<input[^>]*type="color"[^>]*disabled=""/);
  });
});
