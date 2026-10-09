import { describe, expect, it, vi } from "vitest";
import { diferenciasDelCruce, exportacionesDeFuncionesEnRuntime, exportacionesInventariadas } from "./denegacion/cruce-en-runtime";
import { REEXPORTS_DE_PUERTAS_INVENTARIADAS } from "./denegacion/excepciones";
import { archivosDelInventario, inventariarPuertas, nombresInventariadosDeFuente } from "./denegacion/inventario-de-puertas";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * GT-3b, el CRUCE EN EJECUCIÓN del inventario de puertas (hallazgo I-3 de la auditoría final, fila O.177). El inventario lee el código por AST y no ve `export const f = envolver(…)` ni `export const f = (async () => …) as T`; el cruce
 * importa cada módulo del servidor que el inventario recorre y compara sus exportaciones de función con las inventariadas: lo que sobra o falta es una puerta que la matriz no ejerce. Sin base de datos.
 */
describe("GT-3b: el inventario de puertas coincide con lo que los módulos exportan en ejecución", () => {
  it("fixture en memoria: una exportación ENVUELTA o con «as» en un archivo «use server» no la ve el AST y el cruce la delata", async () => {
    const fuente = [
      '"use server";',
      "export async function normal() {}",
      "export const flecha = async () => {};",
      "export const envuelta = envolver(async () => {});",
      "export const conAs = (async () => {}) as () => Promise<void>;",
    ].join("\n");
    const vistas = nombresInventariadosDeFuente(fuente, true);
    expect(vistas, "el AST ve solo las dos primeras").toEqual(["normal", "flecha"]);
    // Lo que el módulo exportaría de verdad al importarlo.
    const enRuntime = { "actions/fixture.ts": ["conAs", "envuelta", "flecha", "normal"] };
    const problemas = diferenciasDelCruce(enRuntime, { "actions/fixture.ts": [...vistas!].sort() });
    expect(problemas).toHaveLength(2);
    expect(problemas.join("\n")).toContain("«envuelta»");
    expect(problemas.join("\n")).toContain("«conAs»");
  });

  it("fixture en memoria: coincidencia exacta = sin problemas; una función inventariada que el módulo no exporta también falla", () => {
    expect(diferenciasDelCruce({ "a.ts": ["x", "y"] }, { "a.ts": ["x", "y"] })).toEqual([]);
    expect(diferenciasDelCruce({ "a.ts": ["x"] }, { "a.ts": ["x", "y"] })).toHaveLength(1);
  });

  it("un archivo de acciones que no es «use server» no es un endpoint: el inventario no lo recorre", () => {
    expect(nombresInventariadosDeFuente("export async function f() {}", true)).toBeNull();
    expect(nombresInventariadosDeFuente("export async function f() {}", false)).toEqual(["f"]);
  });

  it("cada módulo del servidor que el inventario recorre exporta exactamente las funciones que el inventario ve", { timeout: 120_000 }, async () => {
    const archivos = archivosDelInventario();
    expect(archivos.length, "el inventario recorre los archivos de acciones, consultas y lecturas").toBeGreaterThan(100);
    const enRuntime = await exportacionesDeFuncionesEnRuntime(archivos);
    const problemas = diferenciasDelCruce(enRuntime, exportacionesInventariadas(), REEXPORTS_DE_PUERTAS_INVENTARIADAS);
    expect(problemas, `El inventario por AST y lo que los módulos exportan en ejecución no coinciden:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("REEXPORTS_DE_PUERTAS_INVENTARIADAS: cada alias apunta a una puerta que el inventario sí tiene; no crece", () => {
    const claves = new Set(inventariarPuertas().map((p) => p.clave));
    for (const [alias, origen] of Object.entries(REEXPORTS_DE_PUERTAS_INVENTARIADAS)) expect(claves.has(origen), `${alias}: ${origen} no está en el inventario`).toBe(true);
    expect(Object.keys(REEXPORTS_DE_PUERTAS_INVENTARIADAS).length).toBeLessThanOrEqual(1);
  });
});
