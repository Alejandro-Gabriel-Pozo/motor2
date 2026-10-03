import { describe, expect, it } from "vitest";
import { diagnosticarRolesDeSistema } from "../../src/core/permisos/diagnostico-roles-de-sistema";

const empresa = (slug: string, estado = "ACTIVE") => ({ id: `id-${slug}`, slug, estado });
const rol = (slug: string, nombre: string, clave: string | null) => ({ empresaId: `id-${slug}`, nombre, clave });

describe("diagnosticarRolesDeSistema (G1)", () => {
  it("una empresa con su «admin» con clave no tiene fallas ni avisos", () => {
    const d = diagnosticarRolesDeSistema({ empresas: [empresa("a")], roles: [rol("a", "admin", "admin"), rol("a", "operador", "operador")] });
    expect(d).toEqual({ fallas: [], avisos: [] });
  });

  it("un rol llamado «admin» sin la clave «admin» FALLA", () => {
    const d = diagnosticarRolesDeSistema({ empresas: [empresa("mala")], roles: [rol("mala", "admin", null)] });
    expect(d.fallas).toHaveLength(1);
    expect(d.fallas[0]).toContain("mala [ACTIVE]");
  });

  it("falla solo por la empresa a la que le falta la clave, no por las que la tienen", () => {
    const d = diagnosticarRolesDeSistema({
      empresas: [empresa("buena"), empresa("mala")],
      roles: [rol("buena", "admin", "admin"), rol("mala", "admin", null)],
    });
    expect(d.fallas).toHaveLength(1);
    expect(d.fallas[0]).toContain("mala");
  });

  it("el rol con la clave «admin» alcanza aunque ya no se llame así (el nombre es solo una etiqueta)", () => {
    const d = diagnosticarRolesDeSistema({ empresas: [empresa("a")], roles: [rol("a", "dueño", "admin")] });
    expect(d).toEqual({ fallas: [], avisos: [] });
  });

  it("una empresa ACTIVE sin ningún administrador solo avisa; una que no está ACTIVE, ni eso", () => {
    const d = diagnosticarRolesDeSistema({ empresas: [empresa("vacia"), empresa("prov", "PROVISIONING")], roles: [] });
    expect(d.fallas).toEqual([]);
    expect(d.avisos).toHaveLength(1);
    expect(d.avisos[0]).toContain("vacia [ACTIVE]");
  });
});
