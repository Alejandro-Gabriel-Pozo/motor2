import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortalVista } from "@/components/carta-publica/portal-vista";
import { CLAVES_PORTAL_V1, resolverEstiloPortal, type EntradaPortalCarta } from "@/core/carta/portal";
import { CLAVES_DE_COLOR_DEL_PORTAL } from "./oraculo-marca";
import { PORTAL_REAL } from "./marca-sin-cambio-fixtures";

/**
 * Modo marca del PORTAL (`portal_marca_derivada = «si»`; `docs/diseno-marca-del-portal-2026-11-13.md`, decisiones del dueño 2026-11-13: «Queda neutro; la marca solo en bordes y flechas (Recomendada)» y «Siguen
 * transparentes (Recomendada)»). El ORÁCULO está escrito acá, aparte del código: qué sale de cada una de las claves de color y qué variables CSS quedan.
 */
const MARCA = "#5c57a2";
const ENTRADA: Record<string, string> = { ...PORTAL_REAL, portal_color_marca: MARCA, portal_marca_derivada: "si", portal_titulo: "Nuestras sucursales", portal_bg_overlay: "0.4" };

/** Variables CSS que, en modo marca, lleva la marca (la ÚNICA tabla de «dónde pinta la marca»). */
const VARIABLES_CON_MARCA = ["--portal-card-border-hover", "--portal-card-flecha-color"];

describe("oráculo: claves de color del portal en modo marca", () => {
  const estilo = resolverEstiloPortal(ENTRADA);

  it("todas las claves de color salen vacías salvo la marca (los colores sueltos no se leen)", () => {
    for (const clave of Object.keys(CLAVES_DE_COLOR_DEL_PORTAL)) {
      const esperado = CLAVES_DE_COLOR_DEL_PORTAL[clave] === "marca" ? MARCA : "";
      expect(estilo.valores[clave as keyof typeof estilo.valores], clave).toBe(esperado);
    }
  });

  it("las variables CSS de color que quedan son solo las de la marca (borde al pasar el mouse y flecha)", () => {
    const conColor = Object.keys(estilo.variablesCss).filter((v) => /color|bg|border/.test(v) && !/fuente|alto/.test(v));
    expect(conColor.sort()).toEqual([...VARIABLES_CON_MARCA].sort());
    for (const v of VARIABLES_CON_MARCA) expect(estilo.variablesCss[v]).toBe(MARCA);
  });

  it("lo que no es color se conserva (imagen, tamaños, textos, overlay) y el modo queda marcado", () => {
    expect(estilo.valores.portal_titulo).toBe("Nuestras sucursales");
    expect(estilo.overlay).toBe(0.4);
    expect(estilo.valores.portal_card_fuente_label).toBe("clamp(0.75rem, 2.2vw, 0.95rem)");
    expect(estilo.modoMarca).toBe(true);
  });

  it("los colores sueltos siguen en lo guardado (M6): leer en modo marca no los toca, y sin marcador vuelven a leerse", () => {
    const sinMarcador = resolverEstiloPortal({ ...ENTRADA, portal_marca_derivada: "" });
    expect(sinMarcador.valores.portal_header_bg).toBe("#e5dfdf");
    expect(sinMarcador.modoMarca).toBeUndefined();
    expect(sinMarcador.variablesCss["--portal-header-bg"]).toBe("#e5dfdf");
  });
});

describe("el marcador activa el modo solo con el texto exacto «si» (todo nace cerrado)", () => {
  it.each(["Si", " si ", "sí", "true", "1", "", "no"])("%j no activa el modo marca", (marcador) => {
    const estilo = resolverEstiloPortal({ ...ENTRADA, portal_marca_derivada: marcador });
    expect(estilo.modoMarca).toBeUndefined();
    expect(estilo.valores.portal_header_bg).toBe("#e5dfdf");
  });

  it("un marcador que no es texto tampoco", () => {
    expect(resolverEstiloPortal({ ...ENTRADA, portal_marca_derivada: true }).modoMarca).toBeUndefined();
  });
});

describe("la marca guardada se lee si se puede leer (decisión del dueño 2026-11-13: «Se usa si se puede leer (Recomendada)»)", () => {
  it.each([
    ["#5C57A2", "#5c57a2"],
    ["rgb(92, 87, 162)", "#5c57a2"],
    ["#abc", "#aabbcc"],
  ])("%j se lee como %s", (guardado, esperado) => {
    const estilo = resolverEstiloPortal({ ...ENTRADA, portal_color_marca: guardado });
    expect(estilo.valores.portal_color_marca).toBe(esperado);
    expect(estilo.variablesCss["--portal-card-flecha-color"]).toBe(esperado);
  });

  it.each(["red", "transparent", "inherit", "javascript:alert(1)", "x".repeat(70)])("%j no se puede leer: el portal usa el sistema (sin color de marca)", (guardado) => {
    const estilo = resolverEstiloPortal({ ...ENTRADA, portal_color_marca: guardado });
    expect(estilo.valores.portal_color_marca).toBe("");
    for (const v of VARIABLES_CON_MARCA) expect(estilo.variablesCss[v]).toBeUndefined();
    expect(estilo.modoMarca).toBe(true);
  });

  it("sin color de marca cargado, el modo marca deja el portal neutro", () => {
    const estilo = resolverEstiloPortal({ portal_marca_derivada: "si" });
    expect(estilo.valores.portal_color_marca).toBe("");
    for (const v of VARIABLES_CON_MARCA) expect(estilo.variablesCss[v]).toBeUndefined();
  });
});

describe("la vista y el CSS: las tarjetas del mapa siguen transparentes", () => {
  const sucursales: EntradaPortalCarta[] = [
    { slug: "centro", etiqueta: "Centro", subtitulo: null, posicion: { x: 50, y: 40, w: 20, h: null } },
    { slug: "sur", etiqueta: "Sur", subtitulo: "Calle 1", posicion: null },
  ];
  const html = (entrada: Record<string, string>) =>
    renderToStaticMarkup(<PortalVista sucursales={sucursales} empresaNombre="Empresa" estilo={resolverEstiloPortal({ ...entrada, portal_bg_image_url: "https://cdn.example.com/mapa.png" })} hrefDe={(s) => `/${s}`} modo="vista-previa" />);

  it("con el marcador la raíz del portal lleva `data-modo-marca`; sin él, no", () => {
    expect(html(ENTRADA)).toContain("data-modo-marca");
    expect(html({ ...ENTRADA, portal_marca_derivada: "" })).not.toContain("data-modo-marca");
  });

  it("globals.css deja transparentes, en modo marca, las tarjetas sobre el mapa (fondo, borde, nombre, subtítulo y flecha)", () => {
    const css = readFileSync(join(__dirname, "../../src/app/globals.css"), "utf8");
    const bloque = css.slice(css.indexOf(".portal[data-modo-marca] .portal-card-mapa"));
    expect(bloque).toMatch(/background: transparent;[^}]*border-color: transparent;[^}]*color: transparent;/);
    expect(bloque).toContain(".portal[data-modo-marca] .portal-card-mapa .portal-card-flecha");
    expect(bloque).toContain(".portal-card-notas");
  });
});

describe("el catálogo del portal: las dos claves nuevas nacen vacías y cerradas", () => {
  it("`portal_marca_derivada` es un enum de un solo valor «si» y sin default; la marca es un color sin default", () => {
    const marcador = CLAVES_PORTAL_V1.find((d) => d.clave === "portal_marca_derivada");
    const marca = CLAVES_PORTAL_V1.find((d) => d.clave === "portal_color_marca");
    expect(marcador && "opciones" in marcador ? marcador.opciones : null).toEqual(["si"]);
    expect(marcador?.defaultPortal).toBe("");
    expect(marca?.defaultPortal).toBe("");
    expect(CLAVES_PORTAL_V1).toHaveLength(24);
  });
});
