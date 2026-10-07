import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { emailPuedeIniciarSesion } from "../../src/server/sesion/acceso";

describe("emailPuedeIniciarSesion", () => {
  const envBootstrapOriginal = process.env.BOOTSTRAP_ADMIN_EMAILS;
  const envDominiosOriginal = process.env.ALLOWED_EMAIL_DOMAINS;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    delete process.env.BOOTSTRAP_ADMIN_EMAILS;
    delete process.env.ALLOWED_EMAIL_DOMAINS;
  });

  afterEach(() => {
    process.env.BOOTSTRAP_ADMIN_EMAILS = envBootstrapOriginal;
    process.env.ALLOWED_EMAIL_DOMAINS = envDominiosOriginal;
  });

  it("un email nunca visto antes, sin dominio permitido ni invitación, no puede entrar", async () => {
    expect(await emailPuedeIniciarSesion("nadie@afuera.com", undefined)).toBe(false);
  });

  it("BOOTSTRAP_ADMIN_EMAILS ya no abre nada (ADR-022): un email de esa variable, nunca visto antes, no puede entrar", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueño@negocio.com";
    expect(await emailPuedeIniciarSesion("dueño@negocio.com", undefined)).toBe(false);
  });

  it("un email de un dominio en ALLOWED_EMAIL_DOMAINS puede entrar aunque no exista todavía, si Google certifica el dominio (claim hd)", async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "negocio.com";
    expect(await emailPuedeIniciarSesion("cualquiera@negocio.com", "negocio.com")).toBe(true);
    expect(await emailPuedeIniciarSesion("cualquiera@negocio.com", " Negocio.COM ")).toBe(true);
  });

  it("S-17: sin el claim hd, el sufijo del email no alcanza: una cuenta personal de Google con ese dominio no entra", async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "negocio.com";
    expect(await emailPuedeIniciarSesion("cualquiera@negocio.com", undefined)).toBe(false);
  });

  it("S-17: un hd de otro dominio no habilita el email aunque su sufijo sea el permitido", async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "negocio.com";
    expect(await emailPuedeIniciarSesion("cualquiera@negocio.com", "otro.com")).toBe(false);
  });

  it("un email ya dado de alta con membresía activa puede entrar, aunque no matchee ningún dominio", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "externo@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    expect(await emailPuedeIniciarSesion(usuario.email, undefined)).toBe(true);
  });

  it("kill-switch: User.activoGlobal=false bloquea aunque el email siga con membresía y esté en BOOTSTRAP_ADMIN_EMAILS (variable retirada)", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "ex-admin@negocio.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.user.update({ where: { id: usuario.id }, data: { activoGlobal: false } });
    process.env.BOOTSTRAP_ADMIN_EMAILS = "ex-admin@negocio.com";

    expect(await emailPuedeIniciarSesion(usuario.email, undefined)).toBe(false);
  });

  it("kill-switch: User.activoGlobal=false bloquea aunque el email esté en ALLOWED_EMAIL_DOMAINS", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "ex-empleado@negocio.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.user.update({ where: { id: usuario.id }, data: { activoGlobal: false } });
    process.env.ALLOWED_EMAIL_DOMAINS = "negocio.com";

    expect(await emailPuedeIniciarSesion(usuario.email, undefined)).toBe(false);
  });

  it("kill-switch: User.activoGlobal=false bloquea aunque tenga membresía activa", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "ex-empleado@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.user.update({ where: { id: usuario.id }, data: { activoGlobal: false } });

    expect(await emailPuedeIniciarSesion(usuario.email, undefined)).toBe(false);
  });

  it("reactivar activoGlobal devuelve el acceso por la vía de membresía", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "reactivado@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.user.update({ where: { id: usuario.id }, data: { activoGlobal: false } });
    expect(await emailPuedeIniciarSesion(usuario.email, undefined)).toBe(false);

    await prisma.user.update({ where: { id: usuario.id }, data: { activoGlobal: true } });
    expect(await emailPuedeIniciarSesion(usuario.email, undefined)).toBe(true);
  });
});
