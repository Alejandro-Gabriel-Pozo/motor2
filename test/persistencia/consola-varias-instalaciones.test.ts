import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import type { MensajeDeCorreo } from "../../src/core/correo/tipos";
import { suspenderEmpresa } from "../../plataforma/src/servidor/ciclo-de-vida";
import { darDeAltaEmpresa, reenviarInvitacion, type DependenciasDeEmpresas } from "../../plataforma/src/servidor/empresas";

/**
 * UNA consola, DOS bases (ADR-025), contra Postgres real: A es la base de pruebas de siempre y B una base temporal con todas las migraciones. Las dos tienen una `empresa_principal`
 * (la crea la migración multiempresa con id fijo), que es justo el caso que hace peligroso confiar en un estado «ambiental»: la operación tiene que ir a la base que se le indica y
 * a ninguna otra, y la identidad (los administradores) no se lee de la base operada.
 */
const AUTOR_A = { adminId: "admin-1", adminEmail: "admin@plataforma.test", instalacionId: "a" };
const AUTOR_B = { ...AUTOR_A, instalacionId: "b" };
const AHORA = new Date("2026-10-05T12:00:00.000Z");

let temporal: BaseTemporalMigrada;
let dbB: PrismaClient;
let enviados: MensajeDeCorreo[];

function deps(urlApp: string, reservados: readonly string[] = []): DependenciasDeEmpresas {
  return {
    ahora: () => AHORA,
    urlApp,
    emailsDeAdmins: async () => reservados,
    enviar: async (m) => {
      enviados.push(m);
      return { ok: true, idExterno: "id" };
    },
  };
}

const alta = (slug: string, emailDuenio: string) => ({ nombre: `Empresa ${slug}`, slug, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", nombreSucursal: "Central", emailDuenio });

beforeAll(async () => {
  temporal = await crearBaseTemporalMigrada();
  await temporal.aplicarRestantes();
  dbB = new PrismaClient({ adapter: new PrismaPg({ connectionString: temporal.url }) });
}, 180_000);

afterAll(async () => {
  await dbB?.$disconnect();
  await temporal?.eliminar();
  await limpiarBaseDeTest();
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  enviados = [];
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await dbB.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await prismaAdmin.empresa.update({ where: { id: "empresa_principal" }, data: { estado: "ACTIVE" } });
  await dbB.empresa.update({ where: { id: "empresa_principal" }, data: { estado: "ACTIVE" } });
});

describe("el mismo id de empresa en dos bases", () => {
  it("suspender `empresa_principal` con la base B la suspende SOLO en B; la de A queda activa y la auditoría queda en B, con la instalación", async () => {
    // Mutación: operar contra la base equivocada (dbB → prismaAdmin) pone este test en rojo.
    const r = await suspenderEmpresa(dbB, AUTOR_B, "empresa_principal", "Falta de pago");
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    expect((await dbB.empresa.findUniqueOrThrow({ where: { id: "empresa_principal" } })).estado).toBe("SUSPENDED");
    expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: "empresa_principal" } })).estado).toBe("ACTIVE");
    expect(await dbB.auditoriaPlataforma.findMany({ where: { empresaAfectadaId: "empresa_principal" } })).toMatchObject([{ accion: "empresa-suspendida", detalle: { instalacion: "b" } }]);
    expect(await prismaAdmin.auditoriaPlataforma.count({ where: { empresaAfectadaId: "empresa_principal" } })).toBe(0);
  });

  it("una empresa que existe solo en A, operada con la base B, no existe: no se toca nada y no queda auditoría en ninguna", async () => {
    await prismaAdmin.empresa.deleteMany({ where: { id: "solo-en-a" } });
    await prismaAdmin.empresa.create({ data: { id: "solo-en-a", nombre: "Solo en A", slug: "solo-en-a", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    try {
      const r = await suspenderEmpresa(dbB, AUTOR_B, "solo-en-a", "motivo");
      expect(r).toEqual({ ok: false, mensaje: "La empresa no existe." });
      expect(await dbB.auditoriaPlataforma.count({ where: { empresaAfectadaId: "solo-en-a" } })).toBe(0);
      expect(await prismaAdmin.auditoriaPlataforma.count({ where: { accion: "empresa-suspendida" } })).toBe(0);
      expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: "solo-en-a" } })).estado).toBe("ACTIVE");
    } finally {
      await prismaAdmin.empresa.deleteMany({ where: { id: "solo-en-a" } });
    }
  });
});

describe("identidad y operación", () => {
  it("un email que es de un administrador se rechaza al dar de alta en B aunque B no tenga ningún administrador: la lista llega aparte", async () => {
    // Mutación: volver a leer `tx.adminPlataforma` (vacía en B) deja pasar el alta y pone este test en rojo.
    expect(await dbB.adminPlataforma.count()).toBe(0);
    const r = await darDeAltaEmpresa(dbB, deps("https://b.test", ["admin@identidad.test"]), AUTOR_B, alta("en-b", "Admin@Identidad.test"));
    expect(r.ok).toBe(false);
    expect(enviados).toHaveLength(0);
    expect(await dbB.empresa.count({ where: { slug: "en-b" } })).toBe(0);
  });

  it("reenviar una invitación en B también rechaza el email de un administrador", async () => {
    const creada = await darDeAltaEmpresa(dbB, deps("https://b.test"), AUTOR_B, alta("reenvio-b", "dueno-b@gmail.com"));
    if (!creada.ok) throw new Error(creada.mensaje);
    const r = await reenviarInvitacion(dbB, deps("https://b.test", ["dueno-b@gmail.com"]), AUTOR_B, creada.empresaId);
    expect(r.ok).toBe(false);
  });
});

describe("el enlace del mail apunta a la app de la instalación operada", () => {
  it("el alta en B manda el enlace con la dirección de la app de B", async () => {
    // Mutación: armar el enlace con la dirección de otra instalación pone este test en rojo.
    const r = await darDeAltaEmpresa(dbB, deps("https://stock.ejemplo.test"), AUTOR_B, alta("enlace-b", "dueno-enlace@gmail.com"));
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain("https://stock.ejemplo.test/invitacion#t=");
    expect(enviados[0].texto).not.toContain("https://a.test");
  });
});
