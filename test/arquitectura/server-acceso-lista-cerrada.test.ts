import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `src/server/acceso/` es una lista CERRADA de archivos (Pureza Fase 3, tramo B; ADR-011): el guard y sus lectores. Un archivo nuevo ahí es una decisión de arquitectura
 * (¿decide acceso? ¿lee cookies?), no un cajón. Cada uno abre con `import "server-only"`: el acceso nunca puede llegar al navegador, SALVO el que figura en `SIN_SERVER_ONLY` (abajo).
 * Lo que NO pueden importar lo fija la regla `acceso-capa` de dependency-cruiser; que la cáscara no compare ningún rol ni nivel lo fija `acceso-solo-por-el-guard.test.ts`.
 */
const CARPETA = join(__dirname, "../../src/server/acceso");
const PERMITIDOS = ["capacidades-sucursal.ts", "gate.ts", "menu.ts", "modulos-de-empresa.ts", "politica-de-empresa.ts"];

/**
 * Los archivos de `server/acceso/` que NO llevan `import "server-only"` y por qué (Hito 5, pieza 5.2, bloque 2): el valor es el punto de entrada que los alcanza y donde `server-only` revienta (el paquete tira
 * sin la condición `react-server`: un spec o un fixture de Playwright, un script con `tsx`). Solo se achica: una entrada cuyo archivo ya lleva `server-only` (o ya no existe) falla, y un archivo sin `server-only` que
 * no figura acá también. Misma lista y misma lógica que `SIN_SERVER_ONLY` de `server-only-en-consultas-y-lecturas.test.ts`.
 */
const SIN_SERVER_ONLY: Record<string, string> = {
  // La carta pública llega hasta el lector de capacidades (`lecturas/carta/menu` → `precioLocalActivoEn` → `sucursalTieneCapacidad`).
  "capacidades-sucursal.ts": "test/e2e/fixtures/carta-menu.ts (y test/e2e/carta-portal-admin.spec.ts, scripts/auditoria-benchmark-reportes.ts, por la misma cadena de la carta)",
};

describe("server/acceso: lista cerrada", () => {
  const archivos = readdirSync(CARPETA).filter((f) => /\.tsx?$/.test(f)).sort();
  const sinMarca = (f: string) => !/^import "server-only";/m.test(readFileSync(join(CARPETA, f), "utf8"));

  it("son exactamente los archivos permitidos (ni uno más, ni uno menos)", () => {
    expect(archivos).toEqual([...PERMITIDOS].sort());
  });

  it("todos abren con import \"server-only\", salvo los de SIN_SERVER_ONLY", () => {
    const infractores = archivos.filter((f) => sinMarca(f) && !(f in SIN_SERVER_ONLY));
    expect(infractores).toEqual([]);
  });

  it("toda entrada de SIN_SERVER_ONLY sigue haciendo falta (si el archivo ya lleva server-only o ya no existe, se saca de la lista)", () => {
    const sobran = Object.keys(SIN_SERVER_ONLY).filter((f) => !archivos.includes(f) || !sinMarca(f));
    expect(sobran).toEqual([]);
  });
});
