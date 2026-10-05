import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import type { MensajeDeCorreo } from "../../src/core/correo/tipos";
import { suspenderEmpresa } from "../../plataforma/src/servidor/ciclo-de-vida";
import { darDeAltaEmpresa, empresasConEseCuit, reenviarInvitacion, type DependenciasDeEmpresas } from "../../plataforma/src/servidor/empresas";
import { crearAdminDePlataforma, InstalacionNoRevisableError } from "../../src/core/plataforma/primer-admin";

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
  // La base B también arranca cada test limpia: sin esto, lo que crea un test (empresas con un CUIT, usuarios, invitaciones) lo ve el siguiente. Se vuelve a crear la `empresa_principal` que la migración dejó.
  await dbB.$executeRawUnsafe('TRUNCATE TABLE "Empresa" CASCADE');
  await dbB.user.deleteMany();
  await dbB.empresa.create({ data: { id: "empresa_principal", nombre: "Empresa principal", slug: "principal", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
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

describe("alta de administrador de plataforma: se revisan TODAS las bases (ADR-025)", () => {
  const SECRETOS = { claveTotp: randomBytes(32).toString("base64"), secretoCodigos: "c".repeat(40) };
  // `dbB` se crea en el `beforeAll`: se lee al usarla (un getter), no al definir el `describe`, cuando todavía es `undefined`.
  const otraBaseB = { id: "b", nombre: "B", get db() { return dbB; } };

  afterEach(async () => {
    await prismaAdmin.$executeRawUnsafe('DELETE FROM "CodigoDeRecuperacionPlataforma"');
    await prismaAdmin.$executeRawUnsafe('DELETE FROM "AdminPlataforma"');
    await dbB.invitacion.deleteMany({ where: { empresaId: "empresa_principal" } });
    await dbB.user.deleteMany({ where: { email: { contains: "test" } } });
    await dbB.adminPlataforma.deleteMany({ where: { email: { contains: "test" } } });
  });

  it("un email que ya es de un usuario de una empresa EN B se rechaza, nombrando la instalación, y no escribe nada", async () => {
    // Mutación: no revisar `otrasBases` deja pasar este alta y pone este test en rojo.
    await dbB.user.create({ data: { email: "usuario@empresadeb.test" } });
    await expect(
      crearAdminDePlataforma(prismaAdmin, { email: "usuario@empresadeb.test", nombre: "X" }, SECRETOS, { otrasBases: [otraBaseB] }),
    ).rejects.toThrow(/usuario de una empresa.*«B»/);
    expect(await prismaAdmin.adminPlataforma.count()).toBe(0);
  });

  it("una invitación PENDIENTE en B se rechaza nombrando la instalación; una vez REVOCADA, no bloquea", async () => {
    const inv = await dbB.invitacion.create({
      data: { empresaId: "empresa_principal", email: "invitado-b@empresa.test", rolEmpresa: "gerente", hashToken: "a".repeat(64), venceEn: AHORA },
    });
    await expect(
      crearAdminDePlataforma(prismaAdmin, { email: "invitado-b@empresa.test", nombre: "X" }, SECRETOS, { otrasBases: [otraBaseB] }),
    ).rejects.toThrow(/invitación pendiente.*«B»/);
    expect(await prismaAdmin.adminPlataforma.count()).toBe(0);

    await dbB.invitacion.update({ where: { id: inv.id }, data: { estado: "REVOCADA", revocadaEn: AHORA } });
    await expect(
      crearAdminDePlataforma(prismaAdmin, { email: "invitado-b@empresa.test", nombre: "X" }, SECRETOS, { otrasBases: [otraBaseB] }),
    ).resolves.toBeTruthy();
  });

  it("email libre en las dos bases: resuelve, y no queda ningún AdminPlataforma en B (la identidad vive solo en la principal)", async () => {
    const creado = await crearAdminDePlataforma(prismaAdmin, { email: "libre@empresa.test", nombre: "Libre" }, SECRETOS, { otrasBases: [otraBaseB] });
    expect(creado.email).toBe("libre@empresa.test");
    expect(await prismaAdmin.adminPlataforma.count({ where: { email: "libre@empresa.test" } })).toBe(1);
    expect(await dbB.adminPlataforma.count()).toBe(0);
  });

  it("una fila AdminPlataforma en B con ese email no bloquea: no es identidad (basura de esa base)", async () => {
    await dbB.adminPlataforma.create({ data: { email: "admin-en-b@empresa.test", nombre: "Admin en B", secretoTotp: "x" } });
    await expect(
      crearAdminDePlataforma(prismaAdmin, { email: "admin-en-b@empresa.test", nombre: "X" }, SECRETOS, { otrasBases: [otraBaseB] }),
    ).resolves.toBeTruthy();
  });

  it("una base adicional que no responde aborta el alta sin crear nada, y el mensaje nunca repite una clave de conexión", async () => {
    // Mutación: devolver `null` en vez de lanzar InstalacionNoRevisableError deja pasar este alta y pone este test en rojo.
    const baseCaida = {
      user: {
        findFirst: async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.1:5432 password=clave-filtrable");
        },
      },
    } as unknown as PrismaClient;
    const otraCaida = { id: "caida", nombre: "Caída", db: baseCaida };

    await expect(
      crearAdminDePlataforma(prismaAdmin, { email: "nuevo@empresa.test", nombre: "X" }, SECRETOS, { otrasBases: [otraCaida] }),
    ).rejects.toThrow(InstalacionNoRevisableError);
    expect(await prismaAdmin.adminPlataforma.count({ where: { email: "nuevo@empresa.test" } })).toBe(0);

    try {
      await crearAdminDePlataforma(prismaAdmin, { email: "nuevo@empresa.test", nombre: "X" }, SECRETOS, { otrasBases: [otraCaida] });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("clave-filtrable");
    }
  });

  it("una base un paso atrás en migraciones (sin tabla de invitaciones) no bloquea el alta; sin tabla de usuarios, falla cerrado", async () => {
    const sinInvitaciones = {
      user: { findFirst: async () => null },
      invitacion: {
        findFirst: async () => {
          throw Object.assign(new Error("la relación Invitacion no existe"), { code: "P2021" });
        },
      },
    } as unknown as PrismaClient;
    await expect(
      crearAdminDePlataforma(prismaAdmin, { email: "atrasada@empresa.test", nombre: "X" }, SECRETOS, { otrasBases: [{ id: "atrasada", nombre: "Atrasada", db: sinInvitaciones }] }),
    ).resolves.toBeTruthy();

    const sinUsuarios = {
      user: {
        findFirst: async () => {
          throw Object.assign(new Error("la relación User no existe"), { code: "P2021" });
        },
      },
    } as unknown as PrismaClient;
    await expect(
      crearAdminDePlataforma(prismaAdmin, { email: "otra-atrasada@empresa.test", nombre: "X" }, SECRETOS, { otrasBases: [{ id: "atrasada", nombre: "Atrasada", db: sinUsuarios }] }),
    ).rejects.toThrow(InstalacionNoRevisableError);
  });
});

describe("empresasConEseCuit: aviso de CUIT repetido entre instalaciones (ADR-025)", () => {
  const CUIT_COMPARTIDO = "30712345671";
  const CUIT_OTRO = "20123456786";

  /** Lleva la invitación PENDIENTE de una `darDeAltaEmpresa` recién hecha a ACEPTADA, con un CUIT declarado (mismo patrón que `alta-de-empresa.test.ts`). */
  async function aceptarConCuitDeclarado(db: PrismaClient, empresaId: string, email: string, cuit: string) {
    const inv = await db.invitacion.findFirstOrThrow({ where: { empresaId, rolEmpresa: "gerente" } });
    const usuario = await db.user.create({ data: { email } });
    await db.invitacion.update({ where: { id: inv.id }, data: { estado: "ACEPTADA", aceptadaEn: AHORA, aceptadaPorId: usuario.id, cuitDeclarado: cuit } });
  }

  it("el mismo CUIT, confirmado en A y declarado (invitación aceptada) en B, se encuentra en cada base con el origen correcto", async () => {
    const altaA = await darDeAltaEmpresa(prismaAdmin, deps("https://a.test"), AUTOR_A, alta("confirmada-en-a", "dueno-confirmada@gmail.com"));
    if (!altaA.ok) throw new Error(altaA.mensaje);
    await prismaAdmin.empresa.update({ where: { id: altaA.empresaId }, data: { cuit: CUIT_COMPARTIDO, estado: "ACTIVE" } });

    const altaB = await darDeAltaEmpresa(dbB, deps("https://b.test"), AUTOR_B, alta("declarada-en-b", "dueno-declarada@gmail.com"));
    if (!altaB.ok) throw new Error(altaB.mensaje);
    await aceptarConCuitDeclarado(dbB, altaB.empresaId, "dueno-declarada@gmail.com", CUIT_COMPARTIDO);

    expect(await empresasConEseCuit(prismaAdmin, CUIT_COMPARTIDO, AHORA)).toEqual([{ empresaId: altaA.empresaId, nombre: "Empresa confirmada-en-a", origen: "confirmado" }]);
    expect(await empresasConEseCuit(dbB, CUIT_COMPARTIDO, AHORA)).toEqual([{ empresaId: altaB.empresaId, nombre: "Empresa declarada-en-b", origen: "declarado" }]);
  });

  it("una invitación ACEPTADA con ese CUIT, superada por otra más nueva del gerente, no cuenta (se mira la ÚLTIMA invitación, no cualquiera)", async () => {
    // Mutación: comparar contra CUALQUIER invitación (no solo la última) pone este test en rojo.
    const altaB = await darDeAltaEmpresa(dbB, deps("https://b.test"), AUTOR_B, alta("superada-en-b", "dueno-superada@gmail.com"));
    if (!altaB.ok) throw new Error(altaB.mensaje);
    await aceptarConCuitDeclarado(dbB, altaB.empresaId, "dueno-superada@gmail.com", CUIT_COMPARTIDO);

    const otra = await dbB.invitacion.create({
      data: { empresaId: altaB.empresaId, email: "otra@gmail.com", rolEmpresa: "gerente", hashToken: "b".repeat(64), venceEn: AHORA, creadaEn: new Date(Date.now() + 3_600_000) }, // relativa a la hora REAL: la invitación original se crea con now(), y una fecha fija se vuelve "vieja" con el paso del tiempo
    });
    await dbB.invitacion.update({ where: { id: otra.id }, data: { estado: "REVOCADA", revocadaEn: AHORA } });

    expect(await empresasConEseCuit(dbB, CUIT_COMPARTIDO, AHORA)).toEqual([]);
  });

  it("una empresa con otro CUIT confirmado y un CUIT declarado (viejo) que coincide NO cuenta para el declarado", async () => {
    const altaA = await darDeAltaEmpresa(prismaAdmin, deps("https://a.test"), AUTOR_A, alta("con-otro-cuit-en-a", "dueno-otro@gmail.com"));
    if (!altaA.ok) throw new Error(altaA.mensaje);
    await aceptarConCuitDeclarado(prismaAdmin, altaA.empresaId, "dueno-otro@gmail.com", CUIT_COMPARTIDO);
    await prismaAdmin.empresa.update({ where: { id: altaA.empresaId }, data: { cuit: CUIT_OTRO, estado: "ACTIVE" } });

    expect(await empresasConEseCuit(prismaAdmin, CUIT_COMPARTIDO, AHORA)).toEqual([]);
    expect(await empresasConEseCuit(prismaAdmin, CUIT_OTRO, AHORA)).toEqual([{ empresaId: altaA.empresaId, nombre: "Empresa con-otro-cuit-en-a", origen: "confirmado" }]);
  });
});
