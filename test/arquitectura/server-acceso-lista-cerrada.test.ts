import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `src/server/acceso/` es una lista CERRADA de archivos (Pureza Fase 3, tramo B; ADR-011): el guard y sus lectores. Un archivo nuevo ahí es una decisión de arquitectura
 * (¿decide acceso? ¿lee cookies?), no un cajón. Cada uno abre con `import "server-only"`: el acceso nunca puede llegar al navegador. Lo que NO pueden importar lo fija la
 * regla `acceso-capa` de dependency-cruiser; que la cáscara no compare ningún rol ni nivel lo fija `acceso-solo-por-el-guard.test.ts`.
 */
const CARPETA = join(__dirname, "../../src/server/acceso");
const PERMITIDOS = ["gate.ts", "menu.ts", "modulos-de-empresa.ts", "politica-de-empresa.ts"];

describe("server/acceso: lista cerrada", () => {
  const archivos = readdirSync(CARPETA).filter((f) => /\.tsx?$/.test(f)).sort();

  it("son exactamente los archivos permitidos (ni uno más, ni uno menos)", () => {
    expect(archivos).toEqual([...PERMITIDOS].sort());
  });

  it("todos abren con import \"server-only\"", () => {
    const sinMarca = archivos.filter((f) => !/^import "server-only";/m.test(readFileSync(join(CARPETA, f), "utf8")));
    expect(sinMarca).toEqual([]);
  });
});
