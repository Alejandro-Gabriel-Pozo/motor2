import { describe, expect, it } from "vitest";
import { filtroAdminEfectivo, filtroDelGerente, filtroMembresiaConAutoridadDeAdmin, filtroRolAdmin, filtroTuvoRolAdmin } from "../../src/core/permisos/filtros";

/**
 * Contrato C1 del RBAC (O.35; Hito 3, Fase II, II.1 de `docs/plan-hito-3-pureza.md`): los filtros de «quién es administrador» y «quién es el gerente» son PUROS y
 * están escritos una sola vez en `core/permisos/filtros.ts`. Este test los fija campo por campo (`toStrictEqual`: ni un campo de más ni uno de menos, ni un
 * `undefined` colado) contra los literales que reemplazaron, copiados de donde vivían antes de II.1:
 *  - `filtroAdminEfectivo`: `membresiaDeAdminEfectivo` de `core/permisos/invariantes.ts` (invariantes (a) y (f), traspaso de gerencia, candidatos a gerente);
 *  - `filtroMembresiaConAutoridadDeAdmin`: el `where` de `actorDesdeLaBase` (más `sucursalId`) y de `objetivoEnLaEmpresa` (`core/permisos/gestion-de-usuarios.ts`);
 *  - `filtroRolAdmin`: el de `buscarRolAdmin` (y, con `activo: true`, el del rol admin de `incorporarPrimerGerente`);
 *  - `filtroTuvoRolAdmin`: el de `tuvoRolAdminEnLaEmpresa` (`core/permisos/gerencia.ts`);
 *  - `filtroDelGerente`: el de `obtenerGerenteDeEmpresa` (y, con `activo: true`, el de `gerentesQueQuedaranSinSucursalActiva`; con el contador de `medirEstadoDeGobierno`).
 * La clave se escribe como texto («admin», «gerente»): si alguien cambia el valor de `CLAVE_ROL_ADMIN` o `ROL_EMPRESA_GERENTE`, esto también lo ve.
 */
const E = "empresa-x";
const U = "usuario-y";

describe("filtros de gobierno (C1): iguales a los literales que reemplazaron", () => {
  it("filtroAdminEfectivo = membresiaDeAdminEfectivo (D1, la definición estricta)", () => {
    expect(filtroAdminEfectivo(E)).toStrictEqual({
      empresaId: E,
      activo: true,
      rol: { clave: "admin", activo: true },
      sucursal: { activo: true },
      empresa: { estado: "ACTIVE" },
      usuario: { activoGlobal: true, empresas: { some: { empresaId: E, activo: true } } },
    });
  });

  it("filtroMembresiaConAutoridadDeAdmin = el where de objetivoEnLaEmpresa; con sucursalId, el de actorDesdeLaBase", () => {
    expect(filtroMembresiaConAutoridadDeAdmin(E, U)).toStrictEqual({ empresaId: E, usuarioId: U, activo: true, rol: { clave: "admin", activo: true } });
    expect({ ...filtroMembresiaConAutoridadDeAdmin(E, U), sucursalId: "s" }).toStrictEqual({
      empresaId: E, usuarioId: U, sucursalId: "s", activo: true, rol: { clave: "admin", activo: true },
    });
  });

  it("filtroRolAdmin = el where de buscarRolAdmin; con activo, el del rol de incorporarPrimerGerente", () => {
    expect(filtroRolAdmin(E)).toStrictEqual({ empresaId: E, clave: "admin" });
    expect({ ...filtroRolAdmin(E), activo: true }).toStrictEqual({ empresaId: E, clave: "admin", activo: true });
  });

  it("filtroTuvoRolAdmin = el where de tuvoRolAdminEnLaEmpresa (histórico: sin filtrar membresía ni rol activos)", () => {
    expect(filtroTuvoRolAdmin(E, U)).toStrictEqual({ empresaId: E, usuarioId: U, rol: { clave: "admin" } });
  });

  it("filtroDelGerente = el where del gerente; con activo, el de gerentesQueQuedaranSinSucursalActiva", () => {
    expect(filtroDelGerente(E)).toStrictEqual({ empresaId: E, rolEmpresa: "gerente" });
    expect({ ...filtroDelGerente(E), activo: true }).toStrictEqual({ empresaId: E, rolEmpresa: "gerente", activo: true });
  });

  it("cada llamada devuelve un objeto nuevo (quien le suma campos no ensucia el de otro)", () => {
    expect(filtroAdminEfectivo(E)).not.toBe(filtroAdminEfectivo(E));
    expect(filtroMembresiaConAutoridadDeAdmin(E, U)).not.toBe(filtroMembresiaConAutoridadDeAdmin(E, U));
  });
});
