import { beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { activarTodosLosModulos } from "../setup/modulos";
import { requierePermisoVer, requierePermisoVerDeAlgunaDelMenu, requierePermisoVerDeEmpresa } from "../../src/server/acceso/gate";
import { contextoDeAccion, type AccionClave, type AccionDeEmpresa, type AccionDeSucursal } from "../../src/core/permisos/acciones";

/**
 * Fase 7, DEC-27: `requierePermisoVerDeAlgunaDelMenu(usuarioId, empresaId, sucursalId, claves, db)`, el gate de la entrada «Configuración» de Stock, que junta pantallas de la sucursal (depósitos,
 * parámetros) y catálogos de la empresa (motivos, destinos). Contra Postgres real. La regla: pasa si y solo si pasa el gate de «Ver» de ALGUNA de las claves EN SU CONTEXTO (`requierePermisoVer` en la
 * sucursal para las de sucursal, `requierePermisoVerDeEmpresa` para las de empresa), devuelve las que se ven, y si niega da el motivo de la primera.
 */
const CLAVES: readonly [AccionClave, ...AccionClave[]] = ["secciones", "motivos_merma", "stock_minimo"];

async function montar() {
  const base = await sembrarBase();
  await activarTodosLosModulos(EMPRESA_POR_DEFECTO_ID);
  const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
  return { base, admin, operador, sucursalId: base.sucursal.id };
}

async function matrizDelRol(rolId: string, conVer: readonly AccionClave[]) {
  for (const clave of CLAVES) {
    const tiene = conVer.includes(clave);
    await prisma.permisoRol.update({ where: { rolId_accionClave: { rolId, accionClave: clave } }, data: { puedeVer: tiene, puedeEditar: tiene } });
  }
}

/** Lo que dice el gate de «Ver» de cada clave en su contexto: la referencia. */
async function referencia(usuarioId: string, sucursalId: string) {
  const porClave = await Promise.all(
    CLAVES.map(async (clave) => {
      const gate =
        contextoDeAccion(clave) === "empresa"
          ? await requierePermisoVerDeEmpresa(usuarioId, EMPRESA_POR_DEFECTO_ID, clave as AccionDeEmpresa, prisma)
          : await requierePermisoVer(usuarioId, sucursalId, clave as AccionDeSucursal, prisma);
      return [clave, gate] as const;
    }),
  );
  return { algunaOk: porClave.some(([, g]) => g.ok), visibles: porClave.filter(([, g]) => g.ok).map(([c]) => c), primera: porClave[0][1] };
}

const subconjuntos = <T,>(xs: readonly T[]): T[][] => xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);

describe("requierePermisoVerDeAlgunaDelMenu: pasa si y solo si pasa el gate de Ver de alguna clave en su contexto", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("equivalencia sobre TODAS las matrices posibles de una clave de sucursal, una de empresa y otra de sucursal, para el administrador", async () => {
    const { base, admin, sucursalId } = await montar();
    for (const conVer of subconjuntos(CLAVES)) {
      await matrizDelRol(base.admin.id, conVer);
      const ref = await referencia(admin.id, sucursalId);
      const gate = await requierePermisoVerDeAlgunaDelMenu(admin.id, EMPRESA_POR_DEFECTO_ID, sucursalId, CLAVES, prisma);
      const etiqueta = `matriz [${conVer.join(", ")}]`;
      expect(gate.ok, etiqueta).toBe(ref.algunaOk);
      expect([...gate.visibles].sort(), etiqueta).toEqual([...ref.visibles].sort());
      if (!gate.ok) {
        expect(gate.visibles.size, etiqueta).toBe(0);
        expect(gate, etiqueta).toMatchObject({ ok: false, mensaje: ref.primera.ok ? undefined : ref.primera.mensaje });
      }
    }
  });

  it("solo con la clave de EMPRESA (motivos de merma) pasa: la entrada no se le niega a quien solo administra los catálogos", async () => {
    const { base, admin, sucursalId } = await montar();
    await matrizDelRol(base.admin.id, ["motivos_merma"]);
    const gate = await requierePermisoVerDeAlgunaDelMenu(admin.id, EMPRESA_POR_DEFECTO_ID, sucursalId, CLAVES, prisma);
    expect(gate.ok).toBe(true);
    expect([...gate.visibles]).toEqual(["motivos_merma"]);
  });

  it("el operador (piso operario) no llega a ninguna de estas claves de piso administrador: se niega con el motivo de la primera", async () => {
    const { operador, sucursalId } = await montar();
    const gate = await requierePermisoVerDeAlgunaDelMenu(operador.id, EMPRESA_POR_DEFECTO_ID, sucursalId, CLAVES, prisma);
    const primera = await requierePermisoVer(operador.id, sucursalId, "secciones", prisma);
    expect(primera.ok).toBe(false);
    expect(gate).toMatchObject({ ok: false, mensaje: primera.ok ? "" : primera.mensaje });
    expect(gate.visibles.size).toBe(0);
  });

  it("quien no tiene membresía en la empresa (otra empresa) no ve nada: se niega", async () => {
    const { sucursalId } = await montar();
    const ajeno = await prisma.user.create({ data: { email: "ajeno@otra.test" } });
    const gate = await requierePermisoVerDeAlgunaDelMenu(ajeno.id, EMPRESA_POR_DEFECTO_ID, sucursalId, CLAVES, prisma);
    expect(gate.ok).toBe(false);
    expect(gate.visibles.size).toBe(0);
  });

  it("con una empresa que no es la del usuario, la clave de empresa no se ve (cada clave en su contexto)", async () => {
    const { admin, sucursalId } = await montar();
    const gate = await requierePermisoVerDeAlgunaDelMenu(admin.id, "00000000-0000-0000-0000-00000000dead", sucursalId, ["motivos_merma"], prisma);
    expect(gate.ok).toBe(false);
  });
});
