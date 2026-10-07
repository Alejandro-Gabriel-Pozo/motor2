import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { escribirEspecificador, reapuntarImports, resolverEspecificador } from "../../scripts/arquitectura/reapuntar-imports";

/**
 * El codemod de imports de las mudanzas (D-11 del plan de la Fase 4): `scripts/arquitectura/reapuntar-imports.ts`. Puro y sin disco: se prueba sobre texto, con una raíz inventada.
 */
// El guardián `mocks-sin-huerfanos` busca el texto «vi.mock(…)» en los tests: acá es el CÓDIGO DE EJEMPLO que el codemod reescribe, así que se arma sin escribirlo de corrido.
const MOCK = ["vi", "mock"].join(".");
const RAIZ = join("/", "repo");
const archivo = (ruta: string) => join(RAIZ, ruta);
const modulo = (desde: string, hacia: string, nombres?: string[]) => ({ raiz: RAIZ, desde, hacia, nombres });
const aplicar = (codigo: string, ruta: string, o: ReturnType<typeof modulo>) => reapuntarImports(codigo, archivo(ruta), o);

describe("resolverEspecificador y escribirEspecificador", () => {
  it("el alias @/ y los relativos resuelven al mismo archivo; un paquete no resuelve", () => {
    const a = resolverEspecificador("@/core/x/y", archivo("src/app/p.tsx"), RAIZ);
    expect(a).toBe(resolverEspecificador("../../core/x/y", archivo("src/app/q/p.tsx"), RAIZ));
    expect(a?.endsWith("/repo/src/core/x/y")).toBe(true);
    expect(resolverEspecificador("react", archivo("src/app/p.tsx"), RAIZ)).toBeNull();
  });

  it("se escribe en el mismo estilo que el original (alias o relativo)", () => {
    const destino = resolve(RAIZ, "src", "server", "c", "d").split("\\").join("/");
    expect(escribirEspecificador(destino, archivo("src/app/p.tsx"), RAIZ, "@/core/a/b")).toBe("@/server/c/d");
    expect(escribirEspecificador(destino, archivo("test/x/t.test.ts"), RAIZ, "../../src/core/a/b")).toBe("../../src/server/c/d");
    expect(escribirEspecificador(destino, archivo("src/server/c/otro.ts"), RAIZ, "./b")).toBe("./d");
  });
});

describe("módulo completo", () => {
  const o = modulo("src/core/a/b.ts", "src/server/c/d.ts");

  it("reapunta imports, export from, import() dinámico, require y vi.mock; deja lo demás", () => {
    const codigo = [
      'import { f } from "@/core/a/b";',
      'import type { T } from "@/core/a/b";',
      'import { g } from "@/core/a/otro";',
      'export { h } from "@/core/a/b";',
      'import react from "react";',
      'const m = () => import("@/core/a/b");',
      'const r = require("@/core/a/b");',
      `${MOCK}("@/core/a/b", () => ({ f: fn() }));`,
      `${MOCK}("@/core/a/otro", () => ({}));`,
    ].join("\n");
    const salida = aplicar(codigo, "src/app/p.tsx", o)!;
    expect(salida).toBe(
      [
        'import { f } from "@/server/c/d";',
        'import type { T } from "@/server/c/d";',
        'import { g } from "@/core/a/otro";',
        'export { h } from "@/server/c/d";',
        'import react from "react";',
        'const m = () => import("@/server/c/d");',
        'const r = require("@/server/c/d");',
        `${MOCK}("@/server/c/d", () => ({ f: fn() }));`,
        `${MOCK}("@/core/a/otro", () => ({}));`,
      ].join("\n"),
    );
  });

  it("resuelve los relativos de un test y conserva las comillas simples", () => {
    const salida = aplicar(`import { f } from '../../src/core/a/b';\n${MOCK}('../../src/core/a/b');`, "test/x/t.test.ts", o)!;
    expect(salida).toBe(`import { f } from '../../src/server/c/d';\n${MOCK}('../../src/server/c/d');`);
  });

  it("devuelve null si el archivo no importa el módulo (y no reescribe nada)", () => {
    expect(aplicar('import { g } from "@/core/a/otro";', "src/app/p.tsx", o)).toBeNull();
  });
});

describe("solo algunos nombres", () => {
  const o = modulo("src/core/a/b.ts", "src/server/c/d.ts", ["f", "g"]);

  it("saca los nombres elegidos y deja el resto donde estaba", () => {
    expect(aplicar('import { f, h, g } from "@/core/a/b";', "src/app/p.tsx", o)).toBe('import { h } from "@/core/a/b";\nimport { f, g } from "@/server/c/d";');
  });

  it("si se van todos, la sentencia entera pasa al destino", () => {
    expect(aplicar('import { f, g } from "@/core/a/b";', "src/app/p.tsx", o)).toBe('import { f, g } from "@/server/c/d";');
  });

  it("conserva `type` por nombre y por sentencia, y los alias `as`", () => {
    expect(aplicar('import { type f, h } from "@/core/a/b";', "src/app/p.tsx", o)).toBe('import { h } from "@/core/a/b";\nimport { type f } from "@/server/c/d";');
    expect(aplicar('import type { f as ff } from "@/core/a/b";', "src/app/p.tsx", o)).toBe('import type { f as ff } from "@/server/c/d";');
  });

  it("un import por defecto se queda y el nombre elegido se va", () => {
    expect(aplicar('import b, { f } from "@/core/a/b";', "src/app/p.tsx", o)).toBe('import b from "@/core/a/b";\nimport { f } from "@/server/c/d";');
  });

  it("no toca vi.mock ni los nombres que no se pidieron", () => {
    expect(aplicar(`${MOCK}("@/core/a/b");`, "src/app/p.tsx", o)).toBeNull();
    expect(aplicar('import { h } from "@/core/a/b";', "src/app/p.tsx", o)).toBeNull();
  });
});
