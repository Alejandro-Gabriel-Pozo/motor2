import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { dbDeEmpresa } from "../../src/core/auth/base";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";

/**
 * E5 (ADR-020): la tabla `Invitacion` (migración 20261010120000). Se prueba contra Postgres real:
 *  - su forma (CHECK, índices parciales, FK) como dueño;
 *  - el aislamiento de `motor2_app`: sin empresa ni hash no ve nada, con el hash ve UNA fila, con otra empresa no ve la ajena;
 *  - sus privilegios por columna y que no puede insertar ni borrar;
 *  - la máquina de estados del trigger, aunque se le devuelvan los privilegios.
 * El camino de `motor2_plataforma` (rol que se crea a mano) se prueba en test/persistencia/alta-de-empresa.test.ts cuando hay PLATAFORMA_DATABASE_URL.
 */

const A = "empresa_principal";
const B = "norte";
const NO_PERMISO = /permission denied|permiso denegado/i;

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

function nueva(empresaId: string, email = "dueno@ejemplo.com") {
  const token = generarTokenOpaco();
  return { token, hash: hashDeToken(token), datos: { empresaId, email, rolEmpresa: "gerente", hashToken: hashDeToken(token), venceEn: new Date(Date.now() + 7 * 24 * 3600 * 1000) } };
}

/** Corre `fn` como motor2_app con `app.invitacion_hash` fijado en la transacción (lo que hará `dbDeInvitacion`). */
function conHash<T>(hash: string, fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.invitacion_hash', ${hash}, true)`;
    return fn(tx);
  });
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.empresa.create({ data: { id: B, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
});

describe("forma de la tabla (como dueño)", () => {
  it("guarda el estado PENDIENTE por defecto y rechaza email no canónico, rol que no sea gerente, hash mal formado y CUIT mal formado", async () => {
    const i = nueva(B);
    expect((await prismaAdmin.invitacion.create({ data: i.datos })).estado).toBe("PENDIENTE");
    const otra = nueva(B, "otro@ejemplo.com");
    await expect(prismaAdmin.invitacion.create({ data: { ...otra.datos, email: "Otro@Ejemplo.com" } })).rejects.toThrow(/email_canonico_check|check constraint/i);
    await expect(prismaAdmin.invitacion.create({ data: { ...otra.datos, rolEmpresa: "operador" } })).rejects.toThrow(/rol_check|check constraint/i);
    await expect(prismaAdmin.invitacion.create({ data: { ...otra.datos, hashToken: "no-es-un-hash" } })).rejects.toThrow(/hash_check|check constraint/i);
    await expect(prismaAdmin.invitacion.create({ data: { ...otra.datos, cuitDeclarado: "20123456786" } })).rejects.toThrow(/check constraint/i);
  });

  it("el estado y sus marcas son coherentes: ACEPTADA exige quién y cuándo; REVOCADA exige cuándo; el CUIT solo con ACEPTADA", async () => {
    const i = nueva(B);
    await expect(prismaAdmin.invitacion.create({ data: { ...i.datos, estado: "ACEPTADA" } })).rejects.toThrow(/aceptada_coherente_check|check constraint/i);
    await expect(prismaAdmin.invitacion.create({ data: { ...i.datos, estado: "REVOCADA" } })).rejects.toThrow(/revocada_coherente_check|check constraint/i);
    await expect(prismaAdmin.invitacion.create({ data: { ...i.datos, cuitDeclarado: "20123456786" } })).rejects.toThrow(/check constraint/i);
  });

  it("una sola PENDIENTE por (empresa, email) y una sola PENDIENTE de gerente por empresa; revocada libera el lugar", async () => {
    const a = await prismaAdmin.invitacion.create({ data: nueva(B).datos });
    await expect(prismaAdmin.invitacion.create({ data: nueva(B).datos })).rejects.toThrow(/Unique constraint/i);
    await expect(prismaAdmin.invitacion.create({ data: nueva(B, "otro@ejemplo.com").datos })).rejects.toThrow(/Unique constraint/i);
    await prismaAdmin.invitacion.update({ where: { id: a.id }, data: { estado: "REVOCADA", revocadaEn: new Date() } });
    await expect(prismaAdmin.invitacion.create({ data: nueva(B, "otro@ejemplo.com").datos })).resolves.toBeTruthy();
  });

  it("el hash es único y la fila sigue a la empresa (FK)", async () => {
    const i = nueva(B);
    await prismaAdmin.invitacion.create({ data: i.datos });
    await expect(prismaAdmin.invitacion.create({ data: { ...nueva(A, "x@ejemplo.com").datos, hashToken: i.hash } })).rejects.toThrow(/Unique constraint/i);
    await expect(prismaAdmin.invitacion.create({ data: nueva("no-existe").datos })).rejects.toThrow(/Foreign key/i);
    await expect(prismaAdmin.empresa.delete({ where: { id: B } })).rejects.toThrow(/Foreign key/i);
  });
});

describe("lectura como motor2_app", () => {
  it("sin empresa ni hash no ve ninguna fila", async () => {
    await prismaAdmin.invitacion.create({ data: nueva(B).datos });
    expect(await prisma.invitacion.count()).toBe(0);
  });

  it("con el hash ve exactamente esa fila, aunque la empresa esté en PROVISIONING y sin contexto de empresa", async () => {
    const i = nueva(B);
    const otra = nueva(B, "otro@ejemplo.com");
    await prismaAdmin.invitacion.create({ data: i.datos });
    await prismaAdmin.invitacion.update({ where: { hashToken: i.hash }, data: { estado: "REVOCADA", revocadaEn: new Date() } });
    await prismaAdmin.invitacion.create({ data: otra.datos });
    const filas = await conHash(otra.hash, (tx) => tx.invitacion.findMany());
    expect(filas.map((f) => f.hashToken)).toEqual([otra.hash]);
    expect(await conHash(hashDeToken("otro-token-cualquiera"), (tx) => tx.invitacion.count())).toBe(0);
    expect(await conHash("", (tx) => tx.invitacion.count())).toBe(0);
  });

  it("con el contexto de su empresa ve las de su empresa y no las de otra", async () => {
    await prismaAdmin.invitacion.create({ data: nueva(B).datos });
    expect(await dbDeEmpresa(B).invitacion.count()).toBe(1);
    expect(await dbDeEmpresa(A).invitacion.count()).toBe(0);
  });
});

describe("escritura como motor2_app: solo aceptar una PENDIENTE", () => {
  it("no puede borrar ni truncar; tampoco cambiar email ni empresa (privilegios por columna); insertar o tocar una de GERENTE lo frena el trigger (E8: la app ahora tiene INSERT y UPDATE de algunas columnas, solo para usuario y vinculación)", async () => {
    const i = nueva(B);
    await prismaAdmin.invitacion.create({ data: i.datos });
    const db = dbDeEmpresa(B);
    const frena = /Invitacion: .* no permitido/;
    await expect(db.invitacion.create({ data: nueva(B, "x@ejemplo.com").datos })).rejects.toThrow(frena);
    await expect(db.invitacion.deleteMany()).rejects.toThrow(NO_PERMISO);
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "Invitacion"')).rejects.toThrow(NO_PERMISO);
    await expect(db.invitacion.updateMany({ data: { email: "otro@ejemplo.com" } })).rejects.toThrow(NO_PERMISO);
    await expect(db.invitacion.updateMany({ data: { empresaId: A } })).rejects.toThrow(NO_PERMISO);
    await expect(db.invitacion.updateMany({ data: { hashToken: hashDeToken("x") } })).rejects.toThrow(frena);
    await expect(db.invitacion.updateMany({ data: { venceEn: new Date("2099-01-01") } })).rejects.toThrow(frena);
    expect(await prismaAdmin.invitacion.count()).toBe(1);
  });

  it("acepta una PENDIENTE de su empresa: estado, quién, cuándo y CUIT declarado", async () => {
    const i = nueva(B);
    await prismaAdmin.invitacion.create({ data: i.datos });
    const usuario = await prismaAdmin.user.create({ data: { email: i.datos.email } });
    const ahora = new Date();
    const r = await dbDeEmpresa(B).invitacion.updateMany({
      where: { hashToken: i.hash, estado: "PENDIENTE" },
      data: { estado: "ACEPTADA", aceptadaEn: ahora, aceptadaPorId: usuario.id, cuitDeclarado: "20123456786" },
    });
    expect(r.count).toBe(1);
    expect(await prismaAdmin.invitacion.findUniqueOrThrow({ where: { hashToken: i.hash } })).toMatchObject({ estado: "ACEPTADA", aceptadaPorId: usuario.id, cuitDeclarado: "20123456786" });
  });

  it("la segunda aceptación no encuentra la fila PENDIENTE: cuenta 0 (un solo uso)", async () => {
    const i = nueva(B);
    await prismaAdmin.invitacion.create({ data: i.datos });
    const usuario = await prismaAdmin.user.create({ data: { email: i.datos.email } });
    const aceptar = () =>
      dbDeEmpresa(B).invitacion.updateMany({
        where: { hashToken: i.hash, estado: "PENDIENTE" },
        data: { estado: "ACEPTADA", aceptadaEn: new Date(), aceptadaPorId: usuario.id, cuitDeclarado: "20123456786" },
      });
    expect((await aceptar()).count).toBe(1);
    expect((await aceptar()).count).toBe(0);
  });

  it("no puede aceptar una invitación de otra empresa (RLS)", async () => {
    const i = nueva(B);
    await prismaAdmin.invitacion.create({ data: i.datos });
    const usuario = await prismaAdmin.user.create({ data: { email: i.datos.email } });
    const r = await dbDeEmpresa(A).invitacion.updateMany({
      where: { hashToken: i.hash },
      data: { estado: "ACEPTADA", aceptadaEn: new Date(), aceptadaPorId: usuario.id, cuitDeclarado: "20123456786" },
    });
    expect(r.count).toBe(0);
  });

  it("segundo candado: aunque se le devuelvan los privilegios, el trigger frena todo salvo PENDIENTE → ACEPTADA", async () => {
    const i = nueva(B);
    await prismaAdmin.invitacion.create({ data: i.datos });
    const usuario = await prismaAdmin.user.create({ data: { email: i.datos.email } });
    await prismaAdmin.$executeRawUnsafe('GRANT INSERT, UPDATE, DELETE, TRUNCATE ON "Invitacion" TO motor2_app');
    try {
      const db = dbDeEmpresa(B);
      const frena = /Invitacion: .* no permitido/;
      await expect(db.invitacion.updateMany({ data: { email: "otro@ejemplo.com" } })).rejects.toThrow(frena);
      await expect(db.invitacion.updateMany({ data: { estado: "REVOCADA", revocadaEn: new Date() } })).rejects.toThrow(frena);
      await expect(db.invitacion.updateMany({ data: { venceEn: new Date("2099-01-01") } })).rejects.toThrow(frena);
      await expect(db.invitacion.deleteMany()).rejects.toThrow(frena);
      await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "Invitacion"')).rejects.toThrow(/Invitacion|record|assigned|llave for[aá]nea|foreign key/i);
      expect(await prismaAdmin.invitacion.findUniqueOrThrow({ where: { hashToken: i.hash } })).toMatchObject({ estado: "PENDIENTE", email: i.datos.email });
      // Lo único permitido sigue andando.
      const ok = await db.invitacion.updateMany({
        where: { hashToken: i.hash },
        data: { estado: "ACEPTADA", aceptadaEn: new Date(), aceptadaPorId: usuario.id, cuitDeclarado: "20123456786" },
      });
      expect(ok.count).toBe(1);
      // Y una ACEPTADA ya no se toca.
      await expect(db.invitacion.updateMany({ data: { cuitDeclarado: "30123456781" } })).rejects.toThrow(frena);
    } finally {
      await prismaAdmin.$executeRawUnsafe('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "Invitacion" FROM motor2_app');
      await prismaAdmin.$executeRawUnsafe('GRANT INSERT ON "Invitacion" TO motor2_app');
      await prismaAdmin.$executeRawUnsafe('GRANT UPDATE ("estado", "aceptadaEn", "aceptadaPorId", "cuitDeclarado", "hashToken", "venceEn", "enviadaEn", "revocadaEn", "invitadoPorId") ON "Invitacion" TO motor2_app');
    }
  });
});

describe("catálogo", () => {
  it("la tabla tiene sus tres políticas y sus dos triggers, y motor2_app tiene INSERT (E8, solo usuario y vinculación) pero no DELETE", async () => {
    const politicas = await prismaAdmin.$queryRaw<Array<{ nombre: string }>>`SELECT policyname::text AS nombre FROM pg_policies WHERE tablename = 'Invitacion' ORDER BY 1`;
    expect(politicas.map((p) => p.nombre)).toEqual(["aislamiento_empresa", "escritura_plataforma", "lectura_por_token"]);
    const triggers = await prismaAdmin.$queryRaw<Array<{ nombre: string }>>`SELECT tgname::text AS nombre FROM pg_trigger WHERE tgrelid = '"Invitacion"'::regclass AND NOT tgisinternal ORDER BY 1`;
    expect(triggers.map((t) => t.nombre)).toEqual(["Invitacion_proteger_fila", "Invitacion_proteger_truncate"]);
    const [p] = await prismaAdmin.$queryRaw<Array<{ ins: boolean; del: boolean; sel: boolean }>>`
      SELECT has_table_privilege('motor2_app', '"Invitacion"', 'INSERT') AS ins, has_table_privilege('motor2_app', '"Invitacion"', 'DELETE') AS del, has_table_privilege('motor2_app', '"Invitacion"', 'SELECT') AS sel`;
    // E8 (20261012120000): la app inserta invitaciones de usuario y de vinculación (el trigger rechaza las de gerente); sigue sin DELETE.
    expect(p).toEqual({ ins: true, del: false, sel: true });
  });
});
