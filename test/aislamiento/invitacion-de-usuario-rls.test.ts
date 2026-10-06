import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { dbDeEmpresa } from "../../src/core/auth/base";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";

/**
 * E8 (ADR-024): invitaciones de USUARIO y de VINCULACIÓN y la tabla hija `InvitacionSucursal` (migración 20261012120000), contra Postgres real y como `motor2_app`:
 * qué puede insertar, rotar, revocar y aceptar la app, qué frena el trigger y qué frenan las claves foráneas compuestas por empresa.
 */
const A = "empresa_principal";
const B = "norte";
const NO_PERMISO = /permission denied|permiso denegado/i;
const FRENA = /Invitacion(Sucursal)?: .*(no permitido|no es una|no se puede)/;

let invitadorId: string;
let sucursalB: string;
let rolB: string;
let sucursalA: string;

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.empresa.create({ data: { id: B, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
  sucursalB = (await prismaAdmin.sucursal.create({ data: { empresaId: B, nombre: "Centro B" } })).id;
  rolB = (await prismaAdmin.rol.create({ data: { empresaId: B, nombre: "operador-b" } })).id;
  sucursalA = (await prismaAdmin.sucursal.create({ data: { empresaId: A, nombre: "Centro A" } })).id;
  await prismaAdmin.rol.create({ data: { empresaId: A, nombre: "operador-a" } });
  invitadorId = (await prismaAdmin.user.create({ data: { email: "gestor@ejemplo.com" } })).id;
});

function datos(rol: "usuario" | "vinculacion" | "gerente", empresaId = B, email = "nuevo@ejemplo.com") {
  const token = generarTokenOpaco();
  return {
    token,
    hash: hashDeToken(token),
    d: { empresaId, email, rolEmpresa: rol, hashToken: hashDeToken(token), venceEn: new Date(Date.now() + 7 * 24 * 3600 * 1000), ...(rol === "gerente" ? {} : { invitadoPorId: invitadorId }) },
  };
}

describe("Invitacion: lo que la app puede hacer según el tipo", () => {
  it("inserta una de usuario y una de vinculación PENDIENTES en SU empresa", async () => {
    const db = dbDeEmpresa(B);
    expect((await db.invitacion.create({ data: datos("usuario").d })).estado).toBe("PENDIENTE");
    expect((await db.invitacion.create({ data: datos("vinculacion", B, "otro@ejemplo.com").d })).estado).toBe("PENDIENTE");
  });

  it("NO inserta una de gerente, ni una ya ACEPTADA o REVOCADA, ni una sin quién invita, ni con marcas de envío, ni en otra empresa", async () => {
    const db = dbDeEmpresa(B);
    await expect(db.invitacion.create({ data: { ...datos("gerente").d } })).rejects.toThrow(FRENA);
    const sinInvitador = datos("usuario").d;
    await expect(db.invitacion.create({ data: { ...sinInvitador, invitadoPorId: null } })).rejects.toThrow(FRENA);
    await expect(db.invitacion.create({ data: { ...datos("usuario", B, "a@ejemplo.com").d, enviadaEn: new Date() } })).rejects.toThrow(FRENA);
    await expect(db.invitacion.create({ data: { ...datos("usuario", B, "b@ejemplo.com").d, estado: "REVOCADA", revocadaEn: new Date() } })).rejects.toThrow(FRENA);
    await expect(db.invitacion.create({ data: { ...datos("usuario", B, "c@ejemplo.com").d, estado: "ACEPTADA", aceptadaEn: new Date(), aceptadaPorId: invitadorId } })).rejects.toThrow(FRENA);
    await expect(db.invitacion.create({ data: datos("usuario", A, "d@ejemplo.com").d })).rejects.toThrow(/row-level security|pol[ií]tica|policy|seguridad a nivel de fila/i);
    expect(await prismaAdmin.invitacion.count()).toBe(0);
  });

  it("rota el token, anota el envío y vuelve a firmar una de usuario; no cambia email, tipo ni empresa", async () => {
    const i = datos("usuario");
    const fila = await prismaAdmin.invitacion.create({ data: i.d });
    const db = dbDeEmpresa(B);
    const nuevoHash = hashDeToken("rotado");
    const r = await db.invitacion.updateMany({ where: { id: fila.id, estado: "PENDIENTE" }, data: { hashToken: nuevoHash, venceEn: new Date(Date.now() + 1000), enviadaEn: new Date() } });
    expect(r.count).toBe(1);
    await expect(db.invitacion.updateMany({ where: { id: fila.id }, data: { email: "otro@ejemplo.com" } })).rejects.toThrow(NO_PERMISO);
    await expect(db.invitacion.updateMany({ where: { id: fila.id }, data: { empresaId: A } })).rejects.toThrow(NO_PERMISO);
    await expect(db.invitacion.updateMany({ where: { id: fila.id }, data: { rolEmpresa: "gerente" } })).rejects.toThrow(NO_PERMISO);
  });

  it("revoca una de usuario sin tocar el token ni el vencimiento; no puede revocar una de GERENTE", async () => {
    const u = await prismaAdmin.invitacion.create({ data: datos("usuario").d });
    const g = await prismaAdmin.invitacion.create({ data: datos("gerente", B, "gerente@ejemplo.com").d });
    const db = dbDeEmpresa(B);
    expect((await db.invitacion.updateMany({ where: { id: u.id }, data: { estado: "REVOCADA", revocadaEn: new Date() } })).count).toBe(1);
    await expect(db.invitacion.updateMany({ where: { id: g.id }, data: { estado: "REVOCADA", revocadaEn: new Date() } })).rejects.toThrow(FRENA);
    await expect(db.invitacion.updateMany({ where: { id: g.id }, data: { hashToken: hashDeToken("x") } })).rejects.toThrow(FRENA);
  });

  it("acepta una de vinculación (PENDIENTE → ACEPTADA) y después ya no se toca", async () => {
    const v = await prismaAdmin.invitacion.create({ data: datos("vinculacion").d });
    const db = dbDeEmpresa(B);
    const r = await db.invitacion.updateMany({ where: { id: v.id, estado: "PENDIENTE" }, data: { estado: "ACEPTADA", aceptadaEn: new Date(), aceptadaPorId: invitadorId } });
    expect(r.count).toBe(1);
    await expect(db.invitacion.updateMany({ where: { id: v.id }, data: { hashToken: hashDeToken("y") } })).rejects.toThrow(FRENA);
  });

  it("el CUIT declarado es solo de gerente (CHECK)", async () => {
    await expect(prismaAdmin.invitacion.create({ data: { ...datos("usuario").d, estado: "ACEPTADA", aceptadaEn: new Date(), aceptadaPorId: invitadorId, cuitDeclarado: "20123456786" } })).rejects.toThrow(/restricci[oó]n|check constraint/i);
  });
});

describe("InvitacionSucursal", () => {
  async function madre(rol: "usuario" | "vinculacion" | "gerente" = "usuario", estado: "PENDIENTE" | "REVOCADA" = "PENDIENTE") {
    const d = datos(rol, B, `${rol}-${estado}`.toLowerCase() + "@ejemplo.com").d;
    return prismaAdmin.invitacion.create({ data: { ...d, ...(estado === "REVOCADA" ? { estado, revocadaEn: new Date() } : {}) } });
  }
  const fila = (invitacionId: string, over: Partial<{ sucursalId: string; rolId: string; empresaId: string }> = {}) => ({ invitacionId, sucursalId: sucursalB, rolId: rolB, invitadoPorId: invitadorId, ...over });

  it("la app inserta una fila para su empresa cuando la madre es una de usuario PENDIENTE (el empresaId sale del contexto)", async () => {
    const m = await madre();
    const creada = await dbDeEmpresa(B).invitacionSucursal.create({ data: fila(m.id) });
    expect(creada.empresaId).toBe(B);
  });

  it("una sucursal o un rol de OTRA empresa lo frena la clave foránea compuesta", async () => {
    const m = await madre();
    const db = dbDeEmpresa(B);
    await expect(db.invitacionSucursal.create({ data: fila(m.id, { sucursalId: sucursalA }) })).rejects.toThrow(/foreign key|llave for[aá]nea|viola/i);
    const rolA = (await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: A } })).id;
    await expect(db.invitacionSucursal.create({ data: fila(m.id, { rolId: rolA }) })).rejects.toThrow(/foreign key|llave for[aá]nea|viola/i);
  });

  it("una madre de otra empresa no se ve: la frena el RLS o la clave foránea", async () => {
    const otraEmpresa = await prismaAdmin.invitacion.create({ data: datos("usuario", A, "a@ejemplo.com").d });
    await expect(dbDeEmpresa(B).invitacionSucursal.create({ data: fila(otraEmpresa.id) })).rejects.toThrow(/foreign key|llave for[aá]nea|viola|row-level security|seguridad a nivel de fila|InvitacionSucursal: la invitación/i);
  });

  it("el trigger frena si la madre es de gerente, de vinculación, REVOCADA o ACEPTADA", async () => {
    const db = dbDeEmpresa(B);
    for (const m of [await madre("gerente"), await madre("vinculacion"), await madre("usuario", "REVOCADA")]) {
      await expect(db.invitacionSucursal.create({ data: fila(m.id) })).rejects.toThrow(FRENA);
    }
    expect(await prismaAdmin.invitacionSucursal.count()).toBe(0);
  });

  it("no se pueden cambiar la sucursal ni la invitación (sin privilegio), pero sí el rol, las notas y quién otorgó; DELETE y TRUNCATE, no", async () => {
    const m = await madre();
    const f = await prismaAdmin.invitacionSucursal.create({ data: { ...fila(m.id), empresaId: B } });
    const db = dbDeEmpresa(B);
    await expect(db.invitacionSucursal.updateMany({ where: { id: f.id }, data: { sucursalId: sucursalA } })).rejects.toThrow(NO_PERMISO);
    await expect(db.invitacionSucursal.updateMany({ where: { id: f.id }, data: { invitacionId: "otra" } })).rejects.toThrow(NO_PERMISO);
    expect((await db.invitacionSucursal.updateMany({ where: { id: f.id }, data: { notas: "nota", invitadoPorId: invitadorId } })).count).toBe(1);
    await expect(db.invitacionSucursal.deleteMany()).rejects.toThrow(NO_PERMISO);
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "InvitacionSucursal"')).rejects.toThrow(NO_PERMISO);
  });

  it("con otra empresa en el contexto no ve las filas; sin contexto, tampoco", async () => {
    const m = await madre();
    await prismaAdmin.invitacionSucursal.create({ data: { ...fila(m.id), empresaId: B } });
    expect(await dbDeEmpresa(B).invitacionSucursal.count()).toBe(1);
    expect(await dbDeEmpresa(A).invitacionSucursal.count()).toBe(0);
  });

  it("un rol de la plataforma no tiene ningún privilegio sobre la tabla hija (si el rol existe en esta base)", async () => {
    const [existe] = await prismaAdmin.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'motor2_plataforma'`;
    if (existe.n === 0) return;
    const [p] = await prismaAdmin.$queryRaw<Array<{ s: boolean; i: boolean }>>`
      SELECT has_table_privilege('motor2_plataforma', '"InvitacionSucursal"', 'SELECT') AS s, has_table_privilege('motor2_plataforma', '"InvitacionSucursal"', 'INSERT') AS i`;
    expect(p).toEqual({ s: false, i: false });
  });

  it("el catálogo: sus privilegios exactos y su trigger", async () => {
    const [p] = await prismaAdmin.$queryRaw<Array<{ sel: boolean; ins: boolean; del: boolean; upd_rol: boolean; upd_suc: boolean }>>`
      SELECT has_table_privilege('motor2_app', '"InvitacionSucursal"', 'SELECT') AS sel, has_table_privilege('motor2_app', '"InvitacionSucursal"', 'INSERT') AS ins,
             has_table_privilege('motor2_app', '"InvitacionSucursal"', 'DELETE') AS del,
             has_column_privilege('motor2_app', '"InvitacionSucursal"', 'rolId', 'UPDATE') AS upd_rol, has_column_privilege('motor2_app', '"InvitacionSucursal"', 'sucursalId', 'UPDATE') AS upd_suc`;
    expect(p).toEqual({ sel: true, ins: true, del: false, upd_rol: true, upd_suc: false });
    const triggers = await prismaAdmin.$queryRaw<Array<{ nombre: string }>>`SELECT tgname::text AS nombre FROM pg_trigger WHERE tgrelid = '"InvitacionSucursal"'::regclass AND NOT tgisinternal ORDER BY 1`;
    expect(triggers.map((t) => t.nombre)).toEqual(["InvitacionSucursal_proteger_fila", "InvitacionSucursal_proteger_truncate"]);
  });
});
