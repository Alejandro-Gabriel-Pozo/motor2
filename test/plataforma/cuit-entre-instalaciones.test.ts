import { describe, expect, it, vi } from "vitest";
import type { Instalacion } from "../../plataforma/src/entorno";
import { cuitEnOtrasInstalaciones, type EmpresaConEseCuit } from "../../plataforma/src/servidor/cuit-en-instalaciones";

/**
 * El aviso de CUIT repetido ENTRE instalaciones (ADR-025) es puro: la lectura entra por parámetro, sin base. Mismo patrón tolerante que el resumen
 * del inicio: una instalación que falla o no responde a tiempo no lanza ni tumba a las demás.
 */
const instalacion = (id: string, nombre = id): Instalacion => ({ id, nombre, databaseUrl: `postgresql://x@${id}.test/db`, urlApp: `https://${id}.test`, principal: false });

describe("cuitEnOtrasInstalaciones", () => {
  it("sin CUIT en juego, no llama al lector ni una vez (costo cero por defecto)", async () => {
    const buscar = vi.fn(async (): Promise<EmpresaConEseCuit[]> => [{ empresaId: "e1", nombre: "Empresa 1", origen: "confirmado" }]);
    const r = await cuitEnOtrasInstalaciones([instalacion("b")], null, buscar);
    expect(r).toEqual({ coincidencias: [], sinLeer: [] });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("sin otras instalaciones, no llama al lector ni una vez", async () => {
    const buscar = vi.fn(async (): Promise<EmpresaConEseCuit[]> => []);
    expect(await cuitEnOtrasInstalaciones([], "20111111113", buscar)).toEqual({ coincidencias: [], sinLeer: [] });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("agrupa las coincidencias por instalación y omite las que no tienen ninguna", async () => {
    const b = instalacion("b", "B");
    const c = instalacion("c", "C");
    const buscar = async (i: Instalacion): Promise<EmpresaConEseCuit[]> => (i.id === "b" ? [{ empresaId: "e1", nombre: "Empresa en B", origen: "confirmado" }] : []);
    const r = await cuitEnOtrasInstalaciones([b, c], "20111111113", buscar);
    expect(r).toEqual({ coincidencias: [{ instalacion: b, empresas: [{ empresaId: "e1", nombre: "Empresa en B", origen: "confirmado" }] }], sinLeer: [] });
  });

  it("preserva el orden configurado (principal primero, tal como llega la lista)", async () => {
    const [a, b, c] = ["a", "b", "c"].map((id) => instalacion(id, id.toUpperCase()));
    const buscar = async (): Promise<EmpresaConEseCuit[]> => [{ empresaId: "e", nombre: "E", origen: "declarado" as const }];
    const r = await cuitEnOtrasInstalaciones([a, b, c], "20111111113", buscar);
    expect(r.coincidencias.map((c) => c.instalacion.id)).toEqual(["a", "b", "c"]);
  });

  it("una instalación que falla y otra que no responde a tiempo caen en sinLeer, sin lanzar y sin tapar a las que sí respondieron", async () => {
    // Mutación: sacar el tope (conTiempoLimite) o el try/catch implícito del allSettled cuelga o hace fallar este test.
    const ok = instalacion("ok");
    const falla = instalacion("falla");
    const colgada = instalacion("colgada");
    const buscar = async (i: Instalacion): Promise<EmpresaConEseCuit[]> => {
      if (i.id === "ok") return [{ empresaId: "e1", nombre: "Empresa OK", origen: "confirmado" }];
      if (i.id === "falla") throw new Error("la base no responde");
      return new Promise<EmpresaConEseCuit[]>(() => {});
    };
    const r = await cuitEnOtrasInstalaciones([ok, falla, colgada], "20111111113", buscar, 20);
    expect(r.coincidencias).toEqual([{ instalacion: ok, empresas: [{ empresaId: "e1", nombre: "Empresa OK", origen: "confirmado" }] }]);
    expect(r.sinLeer).toEqual([falla, colgada]);
  });
});
