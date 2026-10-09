import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { prismaAdmin } from "../setup/test-db";
import { __limpiarCookiesDeTest, __setCookieDeTestParaEmpresa, __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { obtenerContextoUsuario } from "../../src/core/auth/contexto";
import { listarProveedores } from "../../src/server/actions/catalogo/proveedores";
import { listarSeccionesParaPanel, crearSeccion } from "../../src/server/actions/movimientos/secciones";
import { limpiarMundo, sembrarMundo, type Mundo } from "./denegacion/mundo";

/**
 * GT-3b, la quinta vía de «ids ajenos»: las COOKIES de empresa y de sucursal activas (`empresaActivaId`, `sucursalActivaId`) las manda el cliente, y un usuario puede escribir a mano la de OTRA empresa o la de una
 * sucursal donde no es miembro. El contexto no se las cree: usa la cookie solo si coincide con una pertenencia real y activa del usuario (`obtenerSituacionDeAcceso`); si no, vuelve a la que le toca. Acá se
 * comprueba con el mundo de la matriz (u1: administrador en S1 y S4 de E1, sin nada en S2 ni en E2) que ni el contexto ni una lectura ni una escritura salen de lo suyo con las cookies manipuladas.
 * Mutación: confiar en la cookie sin mirar la membresía (en `obtenerSituacionDeAcceso`) → rojo.
 */
let mundo: Mundo;

beforeAll(async () => {
  await limpiarMundo();
  mundo = await sembrarMundo();
}, 120_000);
afterAll(() => limpiarMundo(), 60_000);

async function comoU1ConCookies(empresa: string | undefined, sucursal: string | undefined) {
  __limpiarCookiesDeTest();
  __setCookieDeTestParaEmpresa(empresa);
  __setCookieDeTestParaSucursal(sucursal);
  await mockearUsuarioActual({ id: mundo.u1.id, email: mundo.u1.email, nombre: null });
}

describe("las cookies de empresa y sucursal activas no le dan a u1 lo que no es suyo", () => {
  it("la cookie de OTRA empresa se ignora: el contexto sigue siendo el de E1", async () => {
    await comoU1ConCookies(mundo.e2.empresaId, undefined);
    const ctx = await obtenerContextoUsuario();
    expect(ctx?.empresaId).toBe(mundo.e1.empresaId);
    expect(ctx?.sucursalId).not.toBe(mundo.d2.sucursalId);
  });

  it("la cookie de una sucursal donde u1 NO es miembro (S2, la vecina S3, la de otra empresa) se ignora: sigue en una sucursal suya", async () => {
    for (const ajena of [mundo.s2.sucursalId, mundo.s2.vecinaId, mundo.d2.sucursalId]) {
      await comoU1ConCookies(mundo.e1.empresaId, ajena);
      const ctx = await obtenerContextoUsuario();
      expect([mundo.s1.sucursalId, mundo.s4Id], `con la cookie ${ajena}`).toContain(ctx?.sucursalId);
      expect(ctx?.membresias.map((m) => m.sucursalId).sort()).toEqual([mundo.s1.sucursalId, mundo.s4Id].sort());
    }
  });

  it("con las dos cookies manipuladas a la vez, una lectura de la sucursal y una de la empresa no traen una sola fila ajena", async () => {
    await comoU1ConCookies(mundo.e2.empresaId, mundo.s2.sucursalId);
    const proveedores = await listarProveedores();
    const secciones = await listarSeccionesParaPanel(mundo.s1.sucursalId);
    const texto = JSON.stringify([proveedores, secciones]);
    expect(texto).toContain("ZZ-A1");
    expect(texto).not.toMatch(/ZZ-(E2|S2)/i);
  });

  it("con la cookie de una sucursal ajena, una escritura cae en la sucursal propia y no escribe nada en la ajena", async () => {
    await comoU1ConCookies(mundo.e1.empresaId, mundo.s2.sucursalId);
    const antes = await prismaAdmin.seccion.count({ where: { sucursalId: mundo.s2.sucursalId } });
    const r = await crearSeccion("Sección por cookie manipulada");
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prismaAdmin.seccion.count({ where: { sucursalId: mundo.s2.sucursalId } })).toBe(antes);
    const creada = await prismaAdmin.seccion.findFirstOrThrow({ where: { nombre: "Sección por cookie manipulada" } });
    expect([mundo.s1.sucursalId, mundo.s4Id]).toContain(creada.sucursalId);
  });
});
