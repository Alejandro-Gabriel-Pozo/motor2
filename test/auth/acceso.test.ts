import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { decidirInicioDeSesion, emailPuedeIniciarSesion } from "../../src/server/sesion/acceso";

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
    expect(await emailPuedeIniciarSesion("nadie@afuera.com")).toBe(false);
  });

  it("BOOTSTRAP_ADMIN_EMAILS ya no abre nada (ADR-022): un email de esa variable, nunca visto antes, no puede entrar", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueño@negocio.com";
    expect(await emailPuedeIniciarSesion("dueño@negocio.com")).toBe(false);
  });

  // S-17 / D5 (T8 del endurecimiento): en este sistema no existen usuarios sin empresa. Una cuenta de Google del dominio Workspace de la empresa, sin membresía activa ni invitación
  // pendiente, NO abre sesión: la vía 1 (ALLOWED_EMAIL_DOMAINS + claim `hd`) se retiró y la variable ya no se lee, esté o no configurada.
  it("EL ATAQUE (S-17): una cuenta del dominio Workspace, con el claim hd firmado por Google, sin membresía ni invitación, NO entra aunque ALLOWED_EMAIL_DOMAINS lo liste", async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "negocio.com";
    expect(await emailPuedeIniciarSesion("cualquiera@negocio.com")).toBe(false);

    // La decisión completa de `signIn` (la que corre antes de que el adapter de Auth.js cree el `User`): con el claim `hd` en el perfil de Google no cambia nada, y NO queda ninguna fila.
    const decision = await decidirInicioDeSesion({
      emailUsuario: "cualquiera@negocio.com", emailPerfil: "cualquiera@negocio.com", emailVerificado: true, tokenDeSesionAbierta: undefined, tokenDeInvitacion: undefined,
      cuenta: { providerAccountId: "google-del-dominio", type: "oidc", id_token: "id-token-de-prueba" },
    });
    expect(decision).toBe(false);
    expect(await prisma.user.count({ where: { email: "cualquiera@negocio.com" } })).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it("un email ya dado de alta con membresía activa puede entrar, aunque no matchee ningún dominio", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "externo@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    expect(await emailPuedeIniciarSesion(usuario.email)).toBe(true);
  });

  it("una cuenta de empresa o de sucursal apagada no alcanza: sin membresía ACTIVA tampoco hay sesión (D5)", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "dado-de-baja@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.usuarioSucursal.updateMany({ where: { usuarioId: usuario.id }, data: { activo: false } });
    expect(await emailPuedeIniciarSesion(usuario.email)).toBe(false);
  });

  it("kill-switch: User.activoGlobal=false bloquea aunque el email siga con membresía y esté en BOOTSTRAP_ADMIN_EMAILS (variable retirada)", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "ex-admin@negocio.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.user.update({ where: { id: usuario.id }, data: { activoGlobal: false } });
    process.env.BOOTSTRAP_ADMIN_EMAILS = "ex-admin@negocio.com";

    expect(await emailPuedeIniciarSesion(usuario.email)).toBe(false);
  });

  it("kill-switch: User.activoGlobal=false bloquea aunque tenga membresía activa", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "ex-empleado@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.user.update({ where: { id: usuario.id }, data: { activoGlobal: false } });

    expect(await emailPuedeIniciarSesion(usuario.email)).toBe(false);
  });

  it("reactivar activoGlobal devuelve el acceso por la vía de membresía", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "reactivado@gmail.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.user.update({ where: { id: usuario.id }, data: { activoGlobal: false } });
    expect(await emailPuedeIniciarSesion(usuario.email)).toBe(false);

    await prisma.user.update({ where: { id: usuario.id }, data: { activoGlobal: true } });
    expect(await emailPuedeIniciarSesion(usuario.email)).toBe(true);
  });
});
