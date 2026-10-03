import { describe, expect, it } from "vitest";
import { diagnosticarRegistroDeModulos, type EmpresaParaDiagnostico } from "../../src/core/modulos/diagnostico-registro";

const empresa = (slug: string, estado: string, creadaAntesDeLaMigracion: boolean): EmpresaParaDiagnostico => ({ id: `id-${slug}`, slug, estado, creadaAntesDeLaMigracion });
const fila = (slug: string, modulo: string) => ({ empresaId: `id-${slug}`, modulo });

describe("diagnosticarRegistroDeModulos (P5)", () => {
  it("todo en orden: cada empresa con sus filas, sin fallas ni avisos", () => {
    const d = diagnosticarRegistroDeModulos({ empresas: [empresa("a", "ACTIVE", true)], filas: [fila("a", "stock"), fila("a", "salon")] });
    expect(d).toEqual({ fallas: [], avisos: [] });
  });

  it("una empresa ACTIVE anterior a la migración sin ninguna fila FALLA", () => {
    const d = diagnosticarRegistroDeModulos({ empresas: [empresa("vieja", "ACTIVE", true)], filas: [] });
    expect(d.fallas).toHaveLength(1);
    expect(d.fallas[0]).toContain("vieja [ACTIVE]");
    expect(d.avisos).toEqual([]);
  });

  it("falla solo por la empresa que perdió el registro, no por las que lo conservan", () => {
    const d = diagnosticarRegistroDeModulos({
      empresas: [empresa("buena", "ACTIVE", true), empresa("mala", "ACTIVE", true)],
      filas: [fila("buena", "stock")],
    });
    expect(d.fallas).toHaveLength(1);
    expect(d.fallas[0]).toContain("mala");
  });

  it("una empresa creada DESPUÉS de la migración sin filas es válida: solo avisa, aunque esté ACTIVE", () => {
    const d = diagnosticarRegistroDeModulos({ empresas: [empresa("nueva", "ACTIVE", false)], filas: [] });
    expect(d.fallas).toEqual([]);
    expect(d.avisos).toHaveLength(1);
    expect(d.avisos[0]).toContain("nueva [ACTIVE]");
  });

  it.each(["PROVISIONING", "SUSPENDED", "DELETING"])("una empresa %s anterior a la migración sin filas no hace fallar el build", (estado) => {
    const d = diagnosticarRegistroDeModulos({ empresas: [empresa("x", estado, true)], filas: [] });
    expect(d.fallas).toEqual([]);
    expect(d.avisos).toHaveLength(1);
  });

  it("lista (como aviso) las filas de un módulo inexistente y las de un módulo fijo o de soporte, que el guard ignora", () => {
    const d = diagnosticarRegistroDeModulos({
      empresas: [empresa("a", "ACTIVE", true)],
      filas: [fila("a", "stock"), fila("a", "inventado"), fila("a", "administracion"), fila("a", "clientes_basico")],
    });
    expect(d.fallas).toEqual([]);
    expect(d.avisos).toHaveLength(3);
    expect(d.avisos.join("\n")).toContain("«inventado» no existe en el catálogo");
    expect(d.avisos.join("\n")).toContain("«administracion» es un módulo fijo o de soporte");
    expect(d.avisos.join("\n")).toContain("«clientes_basico» es un módulo fijo o de soporte");
  });

  it("una fila de una empresa que no está en la lista se nombra por su id", () => {
    const d = diagnosticarRegistroDeModulos({ empresas: [], filas: [{ empresaId: "huerfana", modulo: "inventado" }] });
    expect(d.avisos[0]).toContain("huerfana");
  });

  it("el orden de los mensajes no depende del orden de entrada (por slug)", () => {
    const d = diagnosticarRegistroDeModulos({ empresas: [empresa("z", "ACTIVE", true), empresa("b", "ACTIVE", true)], filas: [] });
    expect(d.fallas.map((f) => f.split(" ")[0])).toEqual(["b", "z"]);
  });
});
