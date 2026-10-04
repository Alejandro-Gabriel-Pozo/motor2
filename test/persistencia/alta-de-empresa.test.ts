import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import type { MensajeDeCorreo, ResultadoDeEnvio } from "../../src/core/correo/tipos";
import { hashDeToken } from "../../src/core/seguridad/tokens";
import { darDeAltaEmpresa, invitarDeNuevo, listarEmpresas, reenviarInvitacion, revocarInvitacion, type DependenciasDeEmpresas } from "../../plataforma/src/servidor/empresas";

/**
 * Alta de empresa e invitación desde la consola (E5, ADR-020) contra Postgres real. Corre con la conexión del DUEÑO (la base de test local no tiene el rol
 * `motor2_plataforma`): se prueba la lógica, la atomicidad con la auditoría y el orden «el mail sale después del commit»; los privilegios del rol real los
 * cubre `invitaciones-rls.test.ts` y el job de integración de CI.
 */
const AUTOR = { adminId: "admin-1", adminEmail: "admin@plataforma.test" };
const AHORA = new Date("2026-10-04T12:00:00.000Z");
const ALTA = { nombre: "Hostería Sur", slug: "hosteria-sur", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ars", nombreSucursal: "Central", emailDuenio: "Dueno@Gmail.com" };

let enviados: MensajeDeCorreo[];
let resultadoDelEnvio: ResultadoDeEnvio;
let alEnviar: ((m: MensajeDeCorreo) => Promise<void>) | undefined;
let ahora = AHORA;
let contadorDeTokens = 0;

function dependencias(): DependenciasDeEmpresas {
  return {
    ahora: () => ahora,
    urlApp: "https://app.ejemplo.com",
    // 43 caracteres base64url, distintos en cada llamada.
    generarToken: () => `T${String(++contadorDeTokens).padStart(2, "0")}${"x".repeat(40)}`,
    enviar: async (m) => {
      await alEnviar?.(m);
      enviados.push(m);
      return resultadoDelEnvio;
    },
  };
}

const tokenDe = (m: MensajeDeCorreo) => /#t=(\S+)/.exec(m.texto)![1];

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "AdminPlataforma"');
  enviados = [];
  resultadoDelEnvio = { ok: true, idExterno: "id-1" };
  alEnviar = undefined;
  ahora = AHORA;
  contadorDeTokens = 0;
});

afterAll(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

async function empresaDelAlta() {
  return prismaAdmin.empresa.findUniqueOrThrow({ where: { slug: ALTA.slug } });
}

describe("darDeAltaEmpresa", () => {
  it("crea la empresa en PROVISIONING sin CUIT, sembrada, con su sucursal y SIN gerente, y una invitación pendiente que guarda solo el hash", async () => {
    const r = await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, ALTA);
    expect(r).toMatchObject({ ok: true, enviado: true });

    const empresa = await empresaDelAlta();
    expect(empresa).toMatchObject({ nombre: "Hostería Sur", estado: "PROVISIONING", cuit: null, moneda: "ARS" });
    expect((await prismaAdmin.sucursal.findMany({ where: { empresaId: empresa.id } })).map((s) => s.nombre)).toEqual(["Central"]);
    expect((await prismaAdmin.rol.findMany({ where: { empresaId: empresa.id }, orderBy: { clave: "asc" } })).map((x) => x.clave)).toEqual(["admin", "operador"]);
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { empresaId: empresa.id } })).toBe(0);
    expect(await prismaAdmin.moduloEmpresa.count({ where: { empresaId: empresa.id } })).toBe(0);

    const inv = await prismaAdmin.invitacion.findFirstOrThrow({ where: { empresaId: empresa.id } });
    expect(inv).toMatchObject({ email: "dueno@gmail.com", rolEmpresa: "gerente", estado: "PENDIENTE" });
    expect(inv.venceEn.getTime() - AHORA.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(inv.enviadaEn).toEqual(AHORA);

    expect(enviados).toHaveLength(1);
    expect(enviados[0].para).toEqual(["dueno@gmail.com"]);
    const token = tokenDe(enviados[0]);
    expect(inv.hashToken).toBe(hashDeToken(token));
    expect(inv.hashToken).not.toContain(token);
  });

  it("deja la fila de auditoría con el administrador como autor, sin token ni hash", async () => {
    await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, ALTA);
    const empresa = await empresaDelAlta();
    const filas = await prismaAdmin.auditoriaPlataforma.findMany();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ adminId: AUTOR.adminId, adminEmail: AUTOR.adminEmail, accion: "alta-de-empresa", empresaAfectadaId: empresa.id });
    const inv = await prismaAdmin.invitacion.findFirstOrThrow({ where: { empresaId: empresa.id } });
    const texto = JSON.stringify(filas[0]);
    expect(texto).not.toContain(inv.hashToken);
    expect(texto).not.toContain(tokenDe(enviados[0]));
  });

  it("el mail sale DESPUÉS del commit: al enviarse, otra conexión ya ve la empresa y la invitación", async () => {
    let vistaAlEnviar: { empresa: boolean; invitacion: number } | undefined;
    alEnviar = async () => {
      // `prisma` es otra conexión (motor2_app): solo ve lo ya confirmado. Empresa no tiene RLS; la invitación se lee por hash.
      const empresa = await prisma.empresa.findUnique({ where: { slug: ALTA.slug } });
      const conteo = await prismaAdmin.invitacion.count({ where: { empresaId: empresa?.id ?? "-" } });
      vistaAlEnviar = { empresa: empresa !== null, invitacion: conteo };
    };
    await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, ALTA);
    expect(vistaAlEnviar).toEqual({ empresa: true, invitacion: 1 });
  });

  it("si la transacción no se confirma (nombre o slug repetido, email reservado, zona inexistente), no sale ningún mail y no queda nada", async () => {
    await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, ALTA);
    enviados = [];
    const empresas = await prismaAdmin.empresa.count();

    expect((await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, { ...ALTA, nombre: "Otra" })).ok).toBe(false); // mismo slug
    expect((await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, { ...ALTA, slug: "otra" })).ok).toBe(false); // mismo nombre
    expect((await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, { ...ALTA, nombre: "N", slug: "n", zonaHoraria: "America/Narnia" })).ok).toBe(false);
    expect((await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, { ...ALTA, nombre: "N", slug: "n", moneda: "ar$" })).ok).toBe(false);
    expect((await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, { ...ALTA, nombre: "N", slug: "n", emailDuenio: "no-es-email" })).ok).toBe(false);

    expect(enviados).toEqual([]);
    expect(await prismaAdmin.empresa.count()).toBe(empresas);
    expect(await prismaAdmin.auditoriaPlataforma.count()).toBe(1);
  });

  it("si un paso interno falla, se deshace todo: ni empresa, ni invitación, ni auditoría, ni mail", async () => {
    // Una invitación con el mismo hash hace fallar el INSERT de la invitación, ya con la empresa y la siembra escritas dentro de la transacción.
    const dep = { ...dependencias(), generarToken: () => "Z".repeat(43) };
    await prismaAdmin.empresa.create({ data: { id: "previa", nombre: "Previa", slug: "previa", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    await prismaAdmin.invitacion.create({ data: { empresaId: "previa", email: "x@y.com", rolEmpresa: "gerente", hashToken: hashDeToken("Z".repeat(43)), venceEn: AHORA } });

    await expect(darDeAltaEmpresa(prismaAdmin, dep, AUTOR, ALTA)).rejects.toThrow(/Unique constraint/i);
    expect(await prismaAdmin.empresa.count({ where: { slug: ALTA.slug } })).toBe(0);
    expect(await prismaAdmin.auditoriaPlataforma.count()).toBe(0);
    expect(enviados).toEqual([]);
  });

  it("rechaza el email de un administrador de plataforma (y no deja nada)", async () => {
    await prismaAdmin.adminPlataforma.create({ data: { email: "dueno@gmail.com", nombre: "Admin", secretoTotp: "x" } });
    const r = await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, ALTA);
    expect(r).toMatchObject({ ok: false });
    expect(await prismaAdmin.empresa.count({ where: { slug: ALTA.slug } })).toBe(0);
    expect(enviados).toEqual([]);
  });

  it("rechaza el email de una cuenta desactivada en toda la plataforma", async () => {
    await prismaAdmin.user.create({ data: { email: "dueno@gmail.com", activoGlobal: false } });
    const r = await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, ALTA);
    expect(r).toMatchObject({ ok: false });
    expect(enviados).toEqual([]);
  });

  it("si el mail no sale, el alta queda hecha, lo dice y la invitación figura sin enviar", async () => {
    resultadoDelEnvio = { ok: false, motivo: "TRANSITORIO", detalle: "falla" };
    const r = await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, ALTA);
    expect(r).toMatchObject({ ok: true, enviado: false });
    const inv = await prismaAdmin.invitacion.findFirstOrThrow({ where: { empresa: { slug: ALTA.slug } } });
    expect(inv.enviadaEn).toBeNull();
    expect((await listarEmpresas(prismaAdmin, AHORA)).find((e) => e.slug === ALTA.slug)?.invitacion).toMatchObject({ enviada: false, estado: "PENDIENTE" });
  });
});

describe("reenviarInvitacion", () => {
  async function altaYEmpresa() {
    await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, ALTA);
    return empresaDelAlta();
  }

  it("rota el token (el enlace anterior deja de servir), renueva el vencimiento, manda el mail y deja auditoría", async () => {
    const empresa = await altaYEmpresa();
    const tokenViejo = tokenDe(enviados[0]);
    ahora = new Date(AHORA.getTime() + 3 * 24 * 3600 * 1000);
    const r = await reenviarInvitacion(prismaAdmin, dependencias(), AUTOR, empresa.id);
    expect(r).toMatchObject({ ok: true, enviado: true });

    const inv = await prismaAdmin.invitacion.findFirstOrThrow({ where: { empresaId: empresa.id } });
    const tokenNuevo = tokenDe(enviados[1]);
    expect(tokenNuevo).not.toBe(tokenViejo);
    expect(inv.hashToken).toBe(hashDeToken(tokenNuevo));
    expect(await prismaAdmin.invitacion.count({ where: { hashToken: hashDeToken(tokenViejo) } })).toBe(0);
    expect(inv.venceEn.getTime() - ahora.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect((await prismaAdmin.auditoriaPlataforma.findMany({ orderBy: { creadoEn: "asc" } })).map((a) => a.accion)).toEqual(["alta-de-empresa", "invitacion-reenviada"]);
  });

  it("renueva una invitación vencida, y manda el mismo mail al mismo invitado", async () => {
    const empresa = await altaYEmpresa();
    ahora = new Date(AHORA.getTime() + 30 * 24 * 3600 * 1000);
    const r = await reenviarInvitacion(prismaAdmin, dependencias(), AUTOR, empresa.id);
    expect(r).toMatchObject({ ok: true });
    expect(enviados[1].para).toEqual(["dueno@gmail.com"]);
    const [fila] = await listarEmpresas(prismaAdmin, ahora);
    expect(fila.invitacion?.estado).toBe("PENDIENTE");
  });

  it("rechaza reenviar si el email ahora es de un administrador de plataforma", async () => {
    const empresa = await altaYEmpresa();
    enviados = [];
    await prismaAdmin.adminPlataforma.create({ data: { email: "dueno@gmail.com", nombre: "Admin", secretoTotp: "x" } });
    const r = await reenviarInvitacion(prismaAdmin, dependencias(), AUTOR, empresa.id);
    expect(r.ok).toBe(false);
    expect(enviados).toEqual([]);
  });

  it("no reenvía una invitación revocada o aceptada, ni de una empresa inexistente", async () => {
    const empresa = await altaYEmpresa();
    await revocarInvitacion(prismaAdmin, AUTOR, empresa.id, ahora);
    expect((await reenviarInvitacion(prismaAdmin, dependencias(), AUTOR, empresa.id)).ok).toBe(false);
    expect((await reenviarInvitacion(prismaAdmin, dependencias(), AUTOR, "no-existe")).ok).toBe(false);
  });

  it("si el mail falla queda hecha igual, y un reenvío posterior lo anota", async () => {
    const empresa = await altaYEmpresa();
    resultadoDelEnvio = { ok: false, motivo: "CUPO", detalle: "cupo" };
    expect(await reenviarInvitacion(prismaAdmin, dependencias(), AUTOR, empresa.id)).toMatchObject({ ok: true, enviado: false });
    expect((await prismaAdmin.invitacion.findFirstOrThrow({ where: { empresaId: empresa.id } })).enviadaEn).toBeNull();
    resultadoDelEnvio = { ok: true, idExterno: null };
    expect(await reenviarInvitacion(prismaAdmin, dependencias(), AUTOR, empresa.id)).toMatchObject({ ok: true, enviado: true });
    expect((await prismaAdmin.invitacion.findFirstOrThrow({ where: { empresaId: empresa.id } })).enviadaEn).not.toBeNull();
  });
});

describe("revocarInvitacion e invitarDeNuevo", () => {
  async function altaYEmpresa() {
    await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, ALTA);
    return empresaDelAlta();
  }

  it("revocar deja la invitación REVOCADA con auditoría, y no se puede revocar dos veces", async () => {
    const empresa = await altaYEmpresa();
    expect((await revocarInvitacion(prismaAdmin, AUTOR, empresa.id, ahora)).ok).toBe(true);
    expect(await prismaAdmin.invitacion.findFirstOrThrow({ where: { empresaId: empresa.id } })).toMatchObject({ estado: "REVOCADA", revocadaEn: ahora });
    expect((await revocarInvitacion(prismaAdmin, AUTOR, empresa.id, ahora)).ok).toBe(false);
    expect((await prismaAdmin.auditoriaPlataforma.findMany({ orderBy: { creadoEn: "asc" } })).map((a) => a.accion)).toEqual(["alta-de-empresa", "invitacion-revocada"]);
  });

  it("invitar de nuevo con otro email revoca la pendiente y crea una nueva, y el token viejo deja de existir como pendiente", async () => {
    const empresa = await altaYEmpresa();
    const r = await invitarDeNuevo(prismaAdmin, dependencias(), AUTOR, empresa.id, "Correcto@Gmail.com");
    expect(r).toMatchObject({ ok: true, enviado: true });
    const filas = await prismaAdmin.invitacion.findMany({ where: { empresaId: empresa.id }, orderBy: { creadaEn: "asc" } });
    expect(filas.map((f) => [f.email, f.estado])).toEqual([["dueno@gmail.com", "REVOCADA"], ["correcto@gmail.com", "PENDIENTE"]]);
    expect(enviados[1].para).toEqual(["correcto@gmail.com"]);
  });

  it("invitar de nuevo después de revocar también funciona; rechaza email reservado, empresa que ya no está en alta e invitación aceptada", async () => {
    const empresa = await altaYEmpresa();
    await revocarInvitacion(prismaAdmin, AUTOR, empresa.id, ahora);
    expect((await invitarDeNuevo(prismaAdmin, dependencias(), AUTOR, empresa.id, "nuevo@gmail.com")).ok).toBe(true);

    await prismaAdmin.adminPlataforma.create({ data: { email: "admin@gmail.com", nombre: "Admin", secretoTotp: "x" } });
    expect((await invitarDeNuevo(prismaAdmin, dependencias(), AUTOR, empresa.id, "admin@gmail.com")).ok).toBe(false);

    const pendiente = await prismaAdmin.invitacion.findFirstOrThrow({ where: { empresaId: empresa.id, estado: "PENDIENTE" } });
    const u = await prismaAdmin.user.create({ data: { email: "nuevo@gmail.com" } });
    await prismaAdmin.invitacion.update({ where: { id: pendiente.id }, data: { estado: "ACEPTADA", aceptadaEn: ahora, aceptadaPorId: u.id } });
    expect((await invitarDeNuevo(prismaAdmin, dependencias(), AUTOR, empresa.id, "otro@gmail.com")).ok).toBe(false);

    await prismaAdmin.empresa.update({ where: { id: empresa.id }, data: { estado: "ACTIVE" } });
    expect((await invitarDeNuevo(prismaAdmin, dependencias(), AUTOR, empresa.id, "otro@gmail.com")).ok).toBe(false);
  });
});

describe("listarEmpresas", () => {
  it("muestra cada empresa con el estado EFECTIVO de su última invitación (vencida incluida)", async () => {
    await darDeAltaEmpresa(prismaAdmin, dependencias(), AUTOR, ALTA);
    const antes = (await listarEmpresas(prismaAdmin, AHORA)).find((e) => e.slug === ALTA.slug);
    expect(antes).toMatchObject({ estado: "PROVISIONING", cuit: null, invitacion: { email: "dueno@gmail.com", estado: "PENDIENTE", enviada: true } });
    const despues = (await listarEmpresas(prismaAdmin, new Date(AHORA.getTime() + 8 * 24 * 3600 * 1000))).find((e) => e.slug === ALTA.slug);
    expect(despues?.invitacion?.estado).toBe("VENCIDA");
    expect((await listarEmpresas(prismaAdmin, AHORA)).find((e) => e.id === "empresa_principal")?.invitacion).toBeNull();
  });
});
