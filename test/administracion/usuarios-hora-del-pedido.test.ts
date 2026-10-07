import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * La hora que fija el envoltorio (`ctx.ahora`): el guard es el REAL; solo se reemplaza la hora que `conGate` le entrega a la acción, como si el pedido hubiera
 * llegado en `reloj.fija`. Así se distingue una acción que lee `ctx.ahora` de una que lee el reloj por su cuenta (con relojes falsos las dos verían lo mismo).
 */
const reloj = vi.hoisted(() => ({ fija: null as Date | null }));
vi.mock("../../src/server/actions/con-permiso", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/actions/con-permiso")>();
  const conLaHoraFija =
    <C extends { ahora: Date }, R>(fn: (ctx: C) => Promise<R>) =>
    (ctx: C) =>
      fn(reloj.fija ? { ...ctx, ahora: reloj.fija } : ctx);
  return {
    ...real,
    conPermiso: ((clave, fn) => real.conPermiso(clave, conLaHoraFija(fn))) as typeof real.conPermiso,
    conPermisoDeEmpresa: ((clave, fn) => real.conPermisoDeEmpresa(clave, conLaHoraFija(fn))) as typeof real.conPermisoDeEmpresa,
  };
});

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { DIA_MS, enElPasado } from "../setup/tiempo";
import { enviadorEnMemoriaDelCanal } from "../../src/core/correo/enviar";
import { vencimientoDeInvitacion } from "../../src/core/features/empresa/invitacion";
import { agregarOActualizarUsuario, invitarAVincular, reenviarInvitacionPendiente, revocarInvitacion } from "../../src/server/actions/auth/usuarios";

/**
 * D.3 / paso 0.8 del Hito 3 (decisión del dueño, 2026-10-08): las mutaciones de `server/actions/auth/usuarios.ts` toman la hora del pedido de `ctx.ahora` (la fija
 * `conPermiso` una vez, Pureza 1.2), no de `new Date()`. Cuatro lugares la leían por su cuenta: el alta por invitación, reenviar, revocar e invitar a vincular. Cada
 * caso corre con la hora del pedido tres días atrás y mira lo que la acción escribe con esa hora (vencimiento, envío, revocación) o lo que decide con ella (el freno de
 * un minuto entre reenvíos).
 */
const correo = enviadorEnMemoriaDelCanal("avisos");
let base: Awaited<ReturnType<typeof sembrarBase>>;
let admin: { id: string; email: string };

const invitacionDe = (email: string) => prismaAdmin.invitacion.findFirstOrThrow({ where: { email }, orderBy: { creadaEn: "desc" } });

beforeEach(async () => {
  reloj.fija = null;
  vi.stubEnv("AUTH_URL", "https://app.ejemplo.test");
  correo.vaciar();
  await limpiarBaseDeTest();
  base = await sembrarBase();
  admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
});

afterEach(() => {
  reloj.fija = null;
  vi.unstubAllEnvs();
});

describe("usuarios.ts: la hora es la del pedido (ctx.ahora), no la del reloj", () => {
  it("alta de alguien de afuera: la invitación vence a los 7 días de la hora del pedido y el envío queda anotado con esa hora", async () => {
    reloj.fija = enElPasado(3 * DIA_MS);
    const r = await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(r.ok, r.mensaje).toBe(true);
    const inv = await invitacionDe("nueva@test.com");
    expect(inv.venceEn.getTime()).toBe(vencimientoDeInvitacion(reloj.fija).getTime());
    expect(inv.enviadaEn?.getTime()).toBe(reloj.fija.getTime());
  });

  it("reenviar: el freno de un minuto se mide contra la hora del pedido, y lo renovado lleva esa hora", async () => {
    await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const inv = await invitacionDe("nueva@test.com");
    const pedido = enElPasado(2 * DIA_MS);
    // Enviada 30 segundos antes del pedido: aunque el reloj real esté dos días después, el freno tiene que saltar.
    await prismaAdmin.invitacion.update({ where: { id: inv.id }, data: { enviadaEn: new Date(pedido.getTime() - 30_000) } });

    reloj.fija = pedido;
    const frenado = await reenviarInvitacionPendiente(inv.id);
    expect(frenado).toEqual({ ok: false, mensaje: "Esa invitación se envió hace menos de un minuto. Esperá un momento antes de reenviarla." });

    reloj.fija = new Date(pedido.getTime() + 2 * 60_000);
    const r = await reenviarInvitacionPendiente(inv.id);
    expect(r.ok, r.mensaje).toBe(true);
    const renovada = await invitacionDe("nueva@test.com");
    expect(renovada.venceEn.getTime()).toBe(vencimientoDeInvitacion(reloj.fija).getTime());
    expect(renovada.enviadaEn?.getTime()).toBe(reloj.fija.getTime());
  });

  it("revocar: la revocación queda con la hora del pedido", async () => {
    await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const inv = await invitacionDe("nueva@test.com");
    reloj.fija = enElPasado(3 * DIA_MS);
    const r = await revocarInvitacion(inv.id);
    expect(r.ok, r.mensaje).toBe(true);
    const revocada = await invitacionDe("nueva@test.com");
    expect(revocada.estado).toBe("REVOCADA");
    expect(revocada.revocadaEn?.getTime()).toBe(reloj.fija.getTime());
  });

  it("invitar a vincular: la invitación de vinculación vence a los 7 días de la hora del pedido y el envío lleva esa hora", async () => {
    const precargado = await crearUsuarioConMembresia({ email: "precargado@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const membresia = await prismaAdmin.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: precargado.id } });
    reloj.fija = enElPasado(3 * DIA_MS);
    const r = await invitarAVincular(membresia.id);
    expect(r.ok, r.mensaje).toBe(true);
    const inv = await invitacionDe("precargado@test.com");
    expect(inv.rolEmpresa).toBe("vinculacion");
    expect(inv.venceEn.getTime()).toBe(vencimientoDeInvitacion(reloj.fija).getTime());
    expect(inv.enviadaEn?.getTime()).toBe(reloj.fija.getTime());
  });
});
