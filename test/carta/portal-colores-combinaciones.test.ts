import { describe, expect, it } from "vitest";
import { guardComandoGuardarColoresDelPortal } from "../../src/core/features/carta/portal-colores.guard";
import { CLAVES_PORTAL_V1, colorDelPortal, textoDelContraste, conFondosDelPortal, resolverEstiloPortal, type FondosDelPortal } from "../../src/core/carta/public";
import { CLAVES_DE_COLOR_DEL_PORTAL_DECLARADAS, DEPENDEN_DE, FONDOS_ELEGIDOS, TEXTOS_CARGADOS, contrasteWcag } from "./portal-colores.oraculo";

/**
 * Combinaciones de «Colores del portal» contra el ORÁCULO escrito aparte (`portal-colores.oraculo.ts`): cada uno de los tres fondos × cada fondo elegido × cada texto que la empresa ya tenía cargado, EXHAUSTIVO (3 × 7 × 5 = 105 casos). Más el guardián: una clave de color nueva del catálogo
 * del portal sin declarar hace fallar el test (hay que decidir si un fondo la afecta).
 */
const CLAVE_DEL_FONDO = { encabezado: "encabezado", pagina: "pagina", detras: "detras" } as const;
const VACIO: FondosDelPortal = { encabezado: null, pagina: null, detras: null };

describe("guardián de dimensiones", () => {
  it("toda clave de color del catálogo del portal está declarada en el oráculo (una nueva obliga a decidir si un fondo la afecta)", () => {
    const delCatalogo = CLAVES_PORTAL_V1.filter((d) => d.tipo === "color" || d.clave === "portal_marca_derivada").map((d) => d.clave as string);
    expect([...CLAVES_DE_COLOR_DEL_PORTAL_DECLARADAS].sort()).toEqual([...delCatalogo].sort());
  });

  it("las claves que dependen de un fondo existen en el catálogo", () => {
    const claves = new Set(CLAVES_PORTAL_V1.map((d) => d.clave as string));
    for (const d of Object.values(DEPENDEN_DE)) for (const c of [d.fondo, ...d.textos]) expect(claves.has(c), c).toBe(true);
  });
});

describe("cada fondo × cada elegido × cada texto cargado, contra el oráculo", () => {
  for (const [grupo, dep] of Object.entries(DEPENDEN_DE) as [keyof typeof DEPENDEN_DE, (typeof DEPENDEN_DE)[keyof typeof DEPENDEN_DE]][]) {
    for (const fondo of FONDOS_ELEGIDOS) {
      for (const texto of TEXTOS_CARGADOS) {
        it(`${grupo} · ${fondo.nombre} · ${texto.nombre}`, () => {
          const cargado = Object.fromEntries(dep.textos.map((c) => [c, texto.cargado]));
          const base = resolverEstiloPortal(cargado);
          const estilo = conFondosDelPortal(base, { ...VACIO, [CLAVE_DEL_FONDO[grupo]]: fondo.elegido });
          // Sin fondo (o mal escrito) NADA cambia: el portal sale como hoy (lo cargado manda).
          if (fondo.esperado.mostrado === null) {
            expect(estilo.valores).toEqual(base.valores);
            expect(estilo.variablesCss).toEqual(base.variablesCss);
            return;
          }
          const mostrado = estilo.valores[dep.fondo as keyof typeof estilo.valores] as string;
          if (fondo.esperado.mostrado === "ajustado-oscuro") {
            // Mismo tono (un gris sigue siendo gris), más oscuro que el elegido, a 7:1 con el texto derivado.
            const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(mostrado.slice(i, i + 2), 16));
            expect(r === g && g === b, "sigue siendo gris").toBe(true);
            expect(r!).toBeLessThan(0x77);
            expect(contrasteWcag(mostrado, "#ffffff")).toBeGreaterThanOrEqual(7);
          } else {
            expect(mostrado).toBe(fondo.esperado.mostrado);
          }
          expect(contrasteWcag(mostrado, fondo.esperado.texto!)).toBeGreaterThanOrEqual(7);
          // Los textos: el cargado manda SOLO si se lee (7:1) sobre el fondo que se muestra; si no, el derivado (blanco o negro).
          for (const clave of dep.textos) {
            const usado = estilo.valores[clave as keyof typeof estilo.valores] as string;
            const seLee = /^#[0-9a-f]{6}$/.test(texto.cargado) && contrasteWcag(texto.cargado, mostrado) >= 7;
            expect(usado, clave).toBe(seLee ? texto.cargado : fondo.esperado.texto);
            expect(contrasteWcag(usado, mostrado), `${clave} se lee`).toBeGreaterThanOrEqual(7);
          }
          // Lo que NINGÚN fondo de otro grupo toca: las claves de los otros dos grupos quedan como estaban.
          for (const [otro, d] of Object.entries(DEPENDEN_DE)) {
            if (otro === grupo) continue;
            for (const c of [d.fondo, ...d.textos]) expect(estilo.valores[c as keyof typeof estilo.valores], c).toBe(base.valores[c as keyof typeof base.valores]);
          }
        });
      }
    }
  }
});

describe("el ajuste siempre termina y llega a 7:1 (de a 5 niveles de gris, de #000000 a #ffffff)", () => {
  it("el resultado llega a 7:1 con su texto, y «ajustado» es verdad exactamente cuando el color cambió", () => {
    for (let v = 0; v <= 255; v += 5) {
      const hex = `#${v.toString(16).padStart(2, "0").repeat(3)}`;
      const r = colorDelPortal(hex)!;
      expect(contrasteWcag(r.hex, r.texto), hex).toBeGreaterThanOrEqual(7);
      expect(r.ajustado === (r.hex !== hex), hex).toBe(true);
    }
  });
});

describe("aviso y guardado de cada marca (maqueta `portal-de-la-empresa.html:633`)", () => {
  for (const f of FONDOS_ELEGIDOS.filter((x): x is Extract<typeof x, { elegido: string }> => x.elegido !== null && x.esperado.mostrado !== null)) {
    it(`${f.nombre}: el aviso ${f.esperado.aviso ? "sale" : "no sale"}, el texto llega a 7:1 y se GUARDA el color elegido`, () => {
      const c = colorDelPortal(f.elegido)!;
      expect(c.ajustado).toBe(f.esperado.aviso);
      expect(contrasteWcag(c.hex, c.texto)).toBeGreaterThanOrEqual(7);
      expect(c.razon).toBeGreaterThanOrEqual(7);
      expect(c.hex === f.elegido.toLowerCase()).toBe(!f.esperado.aviso);
      const guardado = guardComandoGuardarColoresDelPortal({ colorEncabezado: f.elegido, logoVisible: true });
      expect(guardado.ok && guardado.valor.colorEncabezado).toBe(f.elegido.toLowerCase());
    });
  }
  it("el «N a 1» sale con coma y truncado a un decimal", () => {
    expect(textoDelContraste(21)).toBe("21");
    expect(textoDelContraste(7.04)).toBe("7");
    expect(textoDelContraste(8.36)).toBe("8,3");
    expect(textoDelContraste(colorDelPortal("#777777")!.razon)).toMatch(/^7(,\d)?$/);
  });
});
