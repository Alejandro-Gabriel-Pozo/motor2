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

describe("SeccionMarca en el portal de la empresa (`portal`): su color viaja por `portal_color_marca` y la vista previa es la del portal", () => {
  const vistaPrevia = (marca: string) => <p data-vista-del-portal>{marca}</p>;
  const htmlPortal = (p: Partial<Parameters<typeof SeccionMarca>[0]> = {}) =>
    renderToStaticMarkup(<SeccionMarca modoMarca={false} marcaInicial="" valores={{}} soloLectura={false} portal={{ vistaPrevia }} {...p} />);

  it("sin color: botón «Pasar» deshabilitado, sin vista previa, textos del portal", () => {
    const h = htmlPortal();
    expect(h).toContain("Este portal usa los colores sueltos de abajo, como siempre.");
    expect(h).toContain("las tarjetas sobre el mapa siguen transparentes");
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*data-accion-marca="pasar"/);
    expect(h).not.toContain("data-vista-del-portal");
    expect(h).toMatch(/<input[^>]*type="hidden"[^>]*name="portal_color_marca"/);
    expect(h).not.toContain('name="marca_elegida"');
  });

  it("con un color que se lee bien: campo escondido con la marca, vista previa del portal y botón habilitado", () => {
    const h = htmlPortal({ marcaInicial: "#5c57a2" });
    expect(h).toMatch(/<input[^>]*type="hidden"[^>]*name="portal_color_marca"[^>]*value="#5c57a2"/);
    expect(h).toMatch(/data-vista-del-portal[^>]*>#5c57a2/);
    expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*data-accion-marca="pasar"/);
  });

  it("en modo marca: «Guardar color de marca» y «Volver a mis colores anteriores», con el texto del portal", () => {
    const h = htmlPortal({ modoMarca: true, marcaInicial: "#5c57a2" });
    expect(h).toContain("Este portal usa el color de marca: el resto se calcula solo.");
    expect(h).toContain("Mientras el portal use el color de marca");
    expect(h).toContain("Guardar color de marca");
    expect(h).toContain("Volver a mis colores anteriores");
  });

  it("la sección de la carta sigue igual (campo `marca_elegida`, textos de la carta)", () => {
    const h = html({ modoMarca: true, marcaInicial: "#5c57a2" });
    expect(h).toContain('name="marca_elegida"');
    expect(h).toContain("Esta carta usa el color de marca");
    expect(h).toContain("Mientras la carta use el color de marca");
  });
});
