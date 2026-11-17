import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAVES_PORTAL_V1, conFondosDelPortal, estiloDelPortalSimple, resolverEstiloPortal, type FondosDelPortal } from "../../src/core/carta/public";
import { ACENTO_DE, CLAVES_DE_COLOR_DEL_PORTAL_DECLARADAS, MARCAS, PARES_DE_TEXTO, TOKENS_DEL_SISTEMA, contrasteWcag } from "./portal-colores.oraculo";

/**
 * «Ve como un pedernal» (dueño, 2026-11-17): una marca NO puede bajar la legibilidad. Cada color × cada marca (peores casos incluidos) contra el ORÁCULO escrito aparte: el color elegido llega SOLO a su acento y a nada más (ni a un texto, ni a un ícono, ni a un fondo), se guarda tal cual,
 * y todo texto del portal llega a 7:1 sobre su fondo del sistema. Más los guardianes de dimensiones y de tokens.
 */
const VACIO: FondosDelPortal = { encabezado: null, pagina: null, detras: null };
const GRUPOS = ["encabezado", "pagina", "detras"] as const;
const css = readFileSync("src/app/globals.css", "utf8");

describe("guardianes", () => {
  it("toda clave de color del catálogo del portal está declarada en el oráculo (una nueva obliga a decidir)", () => {
    const delCatalogo = CLAVES_PORTAL_V1.filter((d) => d.tipo === "color" || d.clave === "portal_marca_derivada").map((d) => d.clave as string);
    expect([...CLAVES_DE_COLOR_DEL_PORTAL_DECLARADAS].sort()).toEqual([...delCatalogo].sort());
  });
  it("los tokens del sistema del oráculo son los del CSS (si cambian, el oráculo se revisa)", () => {
    for (const [token, valor] of Object.entries(TOKENS_DEL_SISTEMA)) expect(css, token).toMatch(new RegExp(`${token}:\\s*${valor};`));
  });
});

describe("el texto del portal NO depende de la marca: llega a 7:1 sobre su fondo del sistema", () => {
  for (const [texto, fondo] of PARES_DE_TEXTO) {
    it(`${texto} sobre ${fondo}`, () => {
      expect(contrasteWcag(TOKENS_DEL_SISTEMA[texto], TOKENS_DEL_SISTEMA[fondo])).toBeGreaterThanOrEqual(7);
    });
  }
  it("el CSS de la pantalla simple no pinta ningún texto con una variable de acento", () => {
    for (const linea of css.split("\n").filter((l) => /--portal-acento-|--portal-card-border/.test(l))) expect(linea, linea).not.toMatch(/^\s*color:/);
  });
});

describe("cada color × cada marca, contra el oráculo", () => {
  for (const grupo of GRUPOS) {
    for (const marca of MARCAS) {
      it(`${grupo} · ${marca.nombre}`, () => {
        const base = resolverEstiloPortal({});
        const estilo = conFondosDelPortal(base, { ...VACIO, [grupo]: marca.elegida });
        const permitidas = new Set<string>(ACENTO_DE[grupo]);
        // Solo cambian las variables de SU acento, y con el color tal cual (en minúsculas); nada más cambia.
        for (const variable of new Set([...Object.keys(base.variablesCss), ...Object.keys(estilo.variablesCss)])) {
          if (permitidas.has(variable)) expect(estilo.variablesCss[variable], variable).toBe(marca.guardada ?? base.variablesCss[variable]);
          else expect(estilo.variablesCss[variable], variable).toBe(base.variablesCss[variable]);
        }
        // Los valores (fondos, textos, íconos) quedan idénticos: la marca no los toca.
        expect(estilo.valores).toEqual(base.valores);
      });
    }
  }
  it("los tres a la vez, con cada marca de peor caso: ningún valor de texto, ícono o fondo cambia", () => {
    for (const marca of MARCAS) {
      const base = resolverEstiloPortal({});
      const estilo = conFondosDelPortal(base, { encabezado: marca.elegida, pagina: marca.elegida, detras: marca.elegida });
      expect(estilo.valores, marca.nombre).toEqual(base.valores);
    }
  });
});

describe("lo que la empresa ya tenía cargado manda: un color elegido no pisa fondos ni textos del Json", () => {
  const json = { portal_header_bg: "#112233", portal_header_color: "#eeeeee", portal_fondo_color: "#fafafa", portal_card_bg: "#223344", portal_card_color: "#ffffff" };
  const nuevo = { variante: "A", lineaSuperior: null, titulo: null, colorEncabezado: null, colorPagina: null, colorDetras: null, imagen: null, logoVisible: true } as const;
  for (const marca of MARCAS) {
    it(`con la marca ${marca.nombre}`, () => {
      const sin = estiloDelPortalSimple(json, nuevo);
      const con = estiloDelPortalSimple(json, { ...nuevo, colorEncabezado: marca.elegida, colorPagina: marca.elegida, colorDetras: marca.elegida });
      expect(con.valores).toEqual(sin.valores);
      expect(sin.valores.portal_header_bg).toBe("#112233");
      expect(sin.valores.portal_card_color).toBe("#ffffff");
    });
  }
});
