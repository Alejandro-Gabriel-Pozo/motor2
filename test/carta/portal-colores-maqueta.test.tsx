import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { entradasDelPortalNuevo, estiloDelPortalSimple, resolverEstiloPortal, type EntradaPortalCarta, type SucursalDelPortal } from "../../src/core/carta/public";
import { PortalVista } from "../../src/components/carta-publica/portal-vista";
import { TEXTOS_DE_LA_MAQUETA, contrasteWcag } from "./portal-colores.oraculo";

/** El portal como la maqueta de Pedernal: lo puro (variables y marca), el dibujo y el contraste de cada texto sobre el fondo donde se pinta. */
const NUEVO = { variante: "A", lineaSuperior: null, titulo: null, colorEncabezado: null, colorPagina: null, colorDetras: null, imagen: null, logoVisible: true } as const;
const css = readFileSync("src/app/globals.css", "utf8");
const token = (nombre: string): string => {
  const m = new RegExp(`${nombre}:\\s*(#[0-9a-f]{6})`).exec(css);
  if (!m) throw new Error(`token ${nombre} no encontrado`);
  return m[1]!;
};
const SUC: EntradaPortalCarta[] = [
  { slug: "huinganco", etiqueta: "Huinganco", subtitulo: null, posicion: null, telefono: "2994001122" },
  { slug: "varvarco", etiqueta: "Varvarco", subtitulo: null, posicion: null },
];
const vista = (estilo: ReturnType<typeof resolverEstiloPortal>) => renderToStaticMarkup(<PortalVista sucursales={SUC} empresaNombre="Hoteles" estilo={estilo} hrefDe={(s) => `/${s}`} modo="publico" />);

describe("estiloDelPortalSimple marca el diseño de la maqueta; el estilo de siempre no", () => {
  it("con la pantalla simple: conMaqueta y el tercer fondo en la tarjeta contenedora", () => {
    const e = estiloDelPortalSimple({}, { ...NUEVO, colorDetras: "#FFF2B3" });
    expect(e.conMaqueta).toBe(true);
    expect(e.variablesCss["--portal-detras-bg"]).toBe("#fff2b3");
  });
  it("sin tercer fondo, la tarjeta contenedora no se pinta (sin variable)", () => {
    expect(estiloDelPortalSimple({}, NUEVO).variablesCss["--portal-detras-bg"]).toBeUndefined();
  });
  it("un tercer fondo ilegible se ajusta a 7:1 (con el texto blanco) y el texto de las tarjetas NO depende de él", () => {
    const e = estiloDelPortalSimple({}, { ...NUEVO, colorDetras: "#777777" });
    expect(contrasteWcag(e.variablesCss["--portal-detras-bg"]!, "#ffffff")).toBeGreaterThanOrEqual(7);
    expect(e.variablesCss["--portal-ver-carta-color"]).toBeUndefined();
  });
  it("«Ver carta» usa la marca solo si llega a 7:1 sobre blanco; la barra usa la marca siempre que se pueda leer como #rrggbb", () => {
    const oscura = estiloDelPortalSimple({ portal_color_marca: "#1f4e79" }, NUEVO);
    expect(oscura.variablesCss["--portal-ver-carta-color"]).toBe("#1f4e79");
    expect(oscura.variablesCss["--portal-barra-color"]).toBe("#1f4e79");
    const clara = estiloDelPortalSimple({ portal_color_marca: "#ffd54a" }, NUEVO);
    expect(clara.variablesCss["--portal-ver-carta-color"]).toBeUndefined();
    expect(clara.variablesCss["--portal-barra-color"]).toBe("#ffd54a");
  });
  it("el estilo de siempre no trae la marca", () => {
    expect(resolverEstiloPortal({}).conMaqueta).toBeUndefined();
  });
});

describe("el dibujo", () => {
  it("con la maqueta: contenedor, tarjetas con nombre, teléfono (si lo hay) y «Ver carta»", () => {
    const html = vista(estiloDelPortalSimple({}, { ...NUEVO, colorDetras: "#FFF2B3", lineaSuperior: "Hoteles", titulo: "Elegí" }));
    expect(html).toContain("data-maqueta");
    expect(html).toContain("portal-detras");
    expect(html.match(/portal-tarjeta-maqueta/g)).toHaveLength(2);
    expect(html.match(/Ver carta/g)).toHaveLength(2);
    expect(html).toContain("2994001122");
  });
  it("sin la maqueta: el portal de siempre (sin contenedor, sin «Ver carta»)", () => {
    const html = vista(resolverEstiloPortal({}));
    expect(html).not.toContain("data-maqueta");
    expect(html).not.toContain("portal-detras");
    expect(html).not.toContain("Ver carta");
    expect(html).toContain("portal-card-grilla");
  });
});

describe("los textos de la maqueta se leen (7:1) sobre el fondo donde se pintan, con los tokens reales de globals.css", () => {
  for (const t of TEXTOS_DE_LA_MAQUETA) {
    it(t.elemento, () => expect(contrasteWcag(token(t.color), t.fondo)).toBeGreaterThanOrEqual(7));
  }
  it("el CSS de la maqueta pinta cada texto con el token declarado y la tarjeta en blanco", () => {
    const bloque = css.slice(css.indexOf(".portal[data-maqueta] .portal-tarjeta-maqueta {"));
    expect(bloque).toMatch(/background: #ffffff;\s*color: var\(--carta-ink\)/);
    expect(css).toMatch(/\.portal-tarjeta-detalle \{[^}]*color: var\(--carta-ink-soft\)/);
    expect(css).toMatch(/\.portal-ver-carta \{[^}]*var\(--carta-primary\)/);
  });
});

describe("el teléfono de la tarjeta", () => {
  const sucursales = new Map<string, SucursalDelPortal>([["a", { slug: "a", etiqueta: null, subtitulo: null, orden: 0, nombreDeLaSucursal: "A", publicada: true, activa: true }]]);
  const args = { variante: "A", tarjetas: [{ sucursalId: "a", orden: 0, visible: true, nombre: null, telefono: "2994001122" }], zonas: [], sucursales } as const;
  it("apagado: NO sale en la entrada (la lectura pública es la de siempre)", () => {
    expect(entradasDelPortalNuevo(args)[0]).not.toHaveProperty("telefono");
  });
  it("encendido: sale si la tarjeta lo tiene; si no, no hay clave", () => {
    expect(entradasDelPortalNuevo({ ...args, conTelefono: true })[0]?.telefono).toBe("2994001122");
    expect(entradasDelPortalNuevo({ ...args, conTelefono: true, tarjetas: [{ ...args.tarjetas[0], telefono: null }] })[0]).not.toHaveProperty("telefono");
  });
});
