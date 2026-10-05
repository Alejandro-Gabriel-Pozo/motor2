import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { enviadorEnMemoriaDelCanal } from "../../src/core/correo/enviar";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";
import { agregarOActualizarUsuario, invitarAVincular, listarInvitacionesPendientes, listarUsuariosDeSucursal, reenviarInvitacionPendiente, revocarInvitacion } from "../../src/server/actions/auth/usuarios";

/**
 * E8 (ADR-024): las acciones de invitación de usuario y de vinculación desde Administración → Usuarios, contra Postgres real: el mail sale después del commit, reenviar rota el
 * token (con freno de un minuto), revocar, el techo, el aislamiento entre empresas y qué pasa cuando el mail no sale.
 */
const AUTH_URL = "https://app.ejemplo.test";
const correo = enviadorEnMemoriaDelCanal("avisos");
const hashDelEnlace = (texto: string) => hashDeToken(/#t=(\S+)/.exec(texto)![1]);
const invitaciones = (email: string) => prismaAdmin.invitacion.findMany({ where: { email }, orderBy: { creadaEn: "asc" }, include: { sucursales: true } });

let base: Awaited<ReturnType<typeof sembrarBase>>;
let admin: { id: string; email: string };
let sucursalB: string;

beforeEach(async () => {
  vi.stubEnv("AUTH_URL", AUTH_URL);
  correo.vaciar();
  await limpiarBaseDeTest();
  base = await sembrarBase();
  admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  sucursalB = (await prismaAdmin.sucursal.create({ data: { nombre: "Norte", empresaId: base.sucursal.empresaId } })).id;
  await crearMembresia({ usuarioId: admin.id, sucursalId: sucursalB, rolId: base.admin.id });
  await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
});

afterEach(() => vi.unstubAllEnvs());

describe("alta de alguien que no es parte de la empresa", () => {
  it("no crea User ni membresías: deja una invitación con su sucursal y rol, y manda UN mail con el enlace cuyo hash es el de la fila, anotando el envío", async () => {
    const usuarios = await prismaAdmin.user.count();
    const r = await agregarOActualizarUsuario({ email: "Nueva@Test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prismaAdmin.user.count()).toBe(usuarios);

    const [inv] = await invitaciones("nueva@test.com");
    expect(inv).toMatchObject({ rolEmpresa: "usuario", estado: "PENDIENTE", invitadoPorId: admin.id });
    expect(inv.sucursales.map((s) => [s.sucursalId, s.rolId])).toEqual([[base.sucursal.id, base.operador.id]]);
    expect(correo.enviados).toHaveLength(1);
    expect(correo.enviados[0].para).toEqual(["nueva@test.com"]);
    expect(correo.enviados[0].texto).toContain(`${AUTH_URL}/invitacion#t=`);
    expect(correo.enviados[0].texto).toContain("admin@test.com");
    expect(hashDelEnlace(correo.enviados[0].texto)).toBe(inv.hashToken);
    expect(inv.enviadaEn).not.toBeNull();
  });

  it("el mail sale DESPUÉS del commit: al enviarse, otra conexión ya ve la invitación confirmada", async () => {
    let vistaAlEnviar = -1;
    const original = correo.enviar.bind(correo);
    const espia = vi.spyOn(correo, "enviar").mockImplementation(async (m) => {
      vistaAlEnviar = await prismaAdmin.invitacion.count({ where: { email: "nueva@test.com" } });
      return original(m);
    });
    await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    espia.mockRestore();
    expect(vistaAlEnviar).toBe(1);
  });

  it("una segunda sucursal suma una fila a la MISMA invitación y no manda otro mail", async () => {
    await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const r = await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: sucursalB, rolId: base.operador.id });
    expect(r.ok, r.mensaje).toBe(true);
    const lista = await invitaciones("nueva@test.com");
    expect(lista).toHaveLength(1);
    expect(lista[0].sucursales.map((s) => s.sucursalId).sort()).toEqual([base.sucursal.id, sucursalB].sort());
    expect(correo.enviados).toHaveLength(1);
  });

  it("si el mail no sale, la acción sale bien, lo dice y la invitación queda sin la marca de envío", async () => {
    correo.fallarProximoEnvio("DEFINITIVO");
    const r = await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain("NO salió");
    expect((await invitaciones("nueva@test.com"))[0].enviadaEn).toBeNull();
    expect(correo.enviados).toHaveLength(0);
  });

  it("sin AUTH_URL no se arma ningún enlace: el mail no sale y lo dice", async () => {
    vi.stubEnv("AUTH_URL", "");
    const r = await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain("NO salió");
    expect(correo.enviados).toHaveLength(0);
  });

  it("rechaza una cuenta apagada en toda la plataforma y no deja nada", async () => {
    await prismaAdmin.user.create({ data: { email: "apagada@test.com", activoGlobal: false } });
    const r = await agregarOActualizarUsuario({ email: "apagada@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(r.ok).toBe(false);
    expect(await invitaciones("apagada@test.com")).toHaveLength(0);
  });

  it("un User que existe pero no es parte de ESTA empresa también se invita (no se le crea membresía)", async () => {
    await prismaAdmin.user.create({ data: { email: "ajeno@test.com" } });
    const r = await agregarOActualizarUsuario({ email: "ajeno@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { usuario: { email: "ajeno@test.com" } } })).toBe(0);
    expect(await invitaciones("ajeno@test.com")).toHaveLength(1);
  });
});

describe("alta de alguien que YA es parte de la empresa", () => {
  it("con Google vinculado: se le suma la sucursal al instante, sin invitación ni mail", async () => {
    const op = await crearUsuarioConMembresia({ email: "op@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await prismaAdmin.account.create({ data: { userId: op.id, type: "oidc", provider: "google", providerAccountId: "g-op", id_token: "x" } });
    const r = await agregarOActualizarUsuario({ email: "op@test.com", sucursalId: sucursalB, rolId: base.operador.id });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prismaAdmin.usuarioSucursal.count({ where: { usuarioId: op.id } })).toBe(2);
    expect(await invitaciones("op@test.com")).toHaveLength(0);
    expect(correo.enviados).toHaveLength(0);
  });

  it("sin Google todavía: se le suma la sucursal Y se le manda la invitación de vinculación", async () => {
    const op = await crearUsuarioConMembresia({ email: "op@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const r = await agregarOActualizarUsuario({ email: "op@test.com", sucursalId: sucursalB, rolId: base.operador.id });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prismaAdmin.usuarioSucursal.count({ where: { usuarioId: op.id } })).toBe(2);
    const [inv] = await invitaciones("op@test.com");
    expect(inv).toMatchObject({ rolEmpresa: "vinculacion", estado: "PENDIENTE" });
    expect(correo.enviados).toHaveLength(1);
    expect(hashDelEnlace(correo.enviados[0].texto)).toBe(inv.hashToken);
  });

  it("el techo sigue mandando: un administrador que no es el gerente no toca al gerente", async () => {
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: base.sucursal.empresaId } }, data: { rolEmpresa: "gerente" } });
    const r = await agregarOActualizarUsuario({ email: "gerente@test.com", sucursalId: sucursalB, rolId: base.operador.id });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/gerente/);
  });
});

describe("reenviar, revocar e invitar a vincular", () => {
  async function invitarA(email = "nueva@test.com") {
    await agregarOActualizarUsuario({ email, sucursalId: base.sucursal.id, rolId: base.operador.id });
    const [inv] = await invitaciones(email);
    return inv;
  }
  const envejecerEnvio = (id: string) => prismaAdmin.invitacion.update({ where: { id }, data: { enviadaEn: new Date(Date.now() - 120_000) } });

  it("reenviar rota el token (el enlace anterior ya no existe), manda el mail nuevo y vuelve a firmar la invitación", async () => {
    const inv = await invitarA();
    await envejecerEnvio(inv.id);
    const r = await reenviarInvitacionPendiente(inv.id);
    expect(r.ok, r.mensaje).toBe(true);
    const despues = (await invitaciones("nueva@test.com"))[0];
    expect(despues.hashToken).not.toBe(inv.hashToken);
    expect(correo.enviados).toHaveLength(2);
    expect(hashDelEnlace(correo.enviados[1].texto)).toBe(despues.hashToken);
    expect(await prismaAdmin.invitacion.count({ where: { hashToken: inv.hashToken } })).toBe(0);
  });

  it("respeta el freno de un minuto: dos reenvíos seguidos, el segundo se rechaza y no rota nada", async () => {
    const inv = await invitarA();
    const r = await reenviarInvitacionPendiente(inv.id);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("menos de un minuto");
    expect((await invitaciones("nueva@test.com"))[0].hashToken).toBe(inv.hashToken);
  });

  it("revocar deja la invitación REVOCADA y su enlace ya no sirve; no se puede revocar dos veces", async () => {
    const inv = await invitarA();
    expect((await revocarInvitacion(inv.id)).ok).toBe(true);
    expect((await invitaciones("nueva@test.com"))[0]).toMatchObject({ estado: "REVOCADA" });
    expect((await revocarInvitacion(inv.id)).ok).toBe(false);
  });

  it("no se gestiona una invitación de otra empresa ni una de gerente", async () => {
    await prismaAdmin.empresa.create({ data: { id: "otra", nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    const ajena = await prismaAdmin.invitacion.create({ data: { empresaId: "otra", email: "x@test.com", rolEmpresa: "gerente", hashToken: hashDeToken(generarTokenOpaco()), venceEn: new Date(Date.now() + 1e9) } });
    expect((await reenviarInvitacionPendiente(ajena.id)).ok).toBe(false);
    expect((await revocarInvitacion(ajena.id)).ok).toBe(false);
    expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: ajena.id } })).estado).toBe("PENDIENTE");
  });

  it("una invitación que incluye una sucursal donde quien actúa no puede gestionar usuarios no se toca", async () => {
    const inv = await invitarA();
    const otra = await prismaAdmin.sucursal.create({ data: { nombre: "Sur", empresaId: base.sucursal.empresaId } });
    const dueno = await crearUsuarioConMembresia({ email: "dueno-sur@test.com", sucursalId: otra.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: dueno.id, sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: dueno.id, email: dueno.email, nombre: null });
    await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: otra.id, rolId: base.operador.id });
    // Ahora la invitación incluye "Sur"; el admin original (sin membresía allí) ya no puede revocarla.
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const r = await revocarInvitacion(inv.id);
    expect(r.ok).toBe(false);
    expect((await invitaciones("nueva@test.com"))[0].estado).toBe("PENDIENTE");
  });

  it("una invitación que NO incluye la sucursal donde estás parado no se ve ni se toca desde ahí (aunque seas admin de la otra)", async () => {
    await agregarOActualizarUsuario({ email: "solo-norte@test.com", sucursalId: sucursalB, rolId: base.operador.id });
    const [inv] = await invitaciones("solo-norte@test.com");
    expect(await listarInvitacionesPendientes(base.sucursal.id)).toHaveLength(0);
    expect((await revocarInvitacion(inv.id)).ok).toBe(false);
    expect((await reenviarInvitacionPendiente(inv.id)).ok).toBe(false);
    expect((await invitaciones("solo-norte@test.com"))[0].estado).toBe("PENDIENTE");
  });

  it("invitar a vincular a un miembro sin Google manda el mail; sin Google vinculado ya no hace falta si lo tiene", async () => {
    const op = await crearUsuarioConMembresia({ email: "op@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const membresia = await prismaAdmin.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: op.id } });
    const r = await invitarAVincular(membresia.id);
    expect(r.ok, r.mensaje).toBe(true);
    expect(correo.enviados).toHaveLength(1);
    await prismaAdmin.account.create({ data: { userId: op.id, type: "oidc", provider: "google", providerAccountId: "g-op", id_token: "x" } });
    const otra = await invitarAVincular(membresia.id);
    expect(otra.ok).toBe(false);
  });
});

describe("listados de la pantalla", () => {
  it("las pendientes aparecen con sus accesos y quién invitó; los miembros muestran el estado de su cuenta de Google", async () => {
    await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const op = await crearUsuarioConMembresia({ email: "op@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const pendientes = await listarInvitacionesPendientes(base.sucursal.id);
    expect(pendientes).toMatchObject([{ email: "nueva@test.com", invitadoPor: "admin@test.com", vencida: false, enviada: true, accesos: [{ sucursal: expect.any(String), rol: expect.any(String) }] }]);
    const filas = await listarUsuariosDeSucursal(base.sucursal.id);
    expect(filas.find((f) => f.usuario.email === "op@test.com")?.google).toBe("sin-invitacion");
    await prismaAdmin.account.create({ data: { userId: op.id, type: "oidc", provider: "google", providerAccountId: "g-op", id_token: "x" } });
    expect((await listarUsuariosDeSucursal(base.sucursal.id)).find((f) => f.usuario.email === "op@test.com")?.google).toBe("vinculada");
  });
});
