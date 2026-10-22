import { describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO, leer, listarArchivos, sinComentarios } from "./cercos/trinquete";

/**
 * Regla dura «sin alias de color del salón» (Fase 6, 6.30; base 0, sin línea de base). Los 15 alias de `.pos-shell` (`--ink`, `--ink-soft`, `--ink-faint`, `--paper`, `--brand`, `--brand-hover`,
 * `--border`, `--mesa-libre|draft|ocupada` con `-tint` e `-ink`) se retiraron de `globals.css`: el salón usa las utilidades de los tokens (`text-tinta-suave`, `bg-marca`…) o `var(--color-*)`. Un
 * `var(--ink)` que vuelva a escribirse cae en silencio al valor heredado (nadie lo define) y el elemento se ve sin color. El contrato `tokens-visuales` vigila las DEFINICIONES de los alias y
 * los `var(--color-*)` mal escritos, pero no un `var()` del nombre viejo: esta regla lo cubre.
 */
const ALIAS = /var\(\s*--(?:ink(?:-soft|-faint)?|paper|brand(?:-hover)?|border|mesa-(?:libre|draft|ocupada)(?:-tint|-ink)?)\s*[,)]/g;

function usosDeAliasDelSalon(fuente: string, ruta = "x.tsx"): number[] {
  const usos: number[] = [];
  sinComentarios(fuente, ruta)
    .split("\n")
    .forEach((linea, i) => {
      if (linea.match(ALIAS)) usos.push(i + 1);
    });
  return usos;
}

describe("sin alias de color del salón", () => {
  it("el detector ve var(--ink), var(--mesa-libre-tint) y var(--border, #000), y no ve los tokens ni los comentarios", () => {
    expect(usosDeAliasDelSalon('<p className="text-[var(--ink)]">x</p>')).toEqual([1]);
    expect(usosDeAliasDelSalon('const c = "var(--mesa-libre-tint)";\nconst d = "var(--border, #000)";')).toEqual([1, 2]);
    expect(usosDeAliasDelSalon('const c = "var(--color-tinta)"; const d = "var(--carta-border)";')).toEqual([]);
    expect(usosDeAliasDelSalon("// antes era var(--ink)\n/* var(--brand) */\nconst x = 1;")).toEqual([]);
  });

  it("ningún .ts, .tsx ni .css de src/ ni plataforma/src usa un alias de color del salón", () => {
    const hallazgos: string[] = [];
    for (const ruta of listarArchivos(RAIZ_DEL_REPO, ["src", "plataforma/src"], [".ts", ".tsx", ".css"])) {
      const usos = usosDeAliasDelSalon(leer(RAIZ_DEL_REPO, ruta), ruta);
      if (usos.length) hallazgos.push(`${ruta}: líneas ${usos.join(", ")}`);
    }
    expect(hallazgos, "usar la utilidad del token (text-tinta-suave, bg-marca…) o var(--color-…)").toEqual([]);
  });
});
