import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { hashDeToken } from "../../src/core/seguridad/tokens";
import { asegurarInvitacionDeUsuario, asegurarInvitacionDeVinculacion, revocarInvitacionPendiente, rotarInvitacionPendiente } from "../../src/core/features/empresa/invitacion-de-usuario";
import { VIDA_DE_LA_INVITACION_MS } from "../../src/core/features/empresa/invitacion";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * E8 (ADR-024): crear, extender, rotar y revocar invitaciones de usuario y de vinculación (helpers de transacción), contra Postgres real. El mail y el permiso de quien invita
 * son de quien llama; acá se prueba el estado: filas, vencimientos, hash y auditoría.
 */
const E = "empresa_principal";
const AHORA = AHORA_DE_LA_CORRIDA;
let invitador: string;
let otro: string;
let suc1: string;
let suc2: string;
let rol: string;
let n = 0;
const token = () => `T${String(++n).padStart(2, "0")}${"z".repeat(40)}`;

beforeEach(async () => {
  await limpiarBaseDeTest();
  n = 0;
  invitador = (await prismaAdmin.user.create({ data: { email: "gestor@ejemplo.com" } })).id;
  otro = (await prismaAdmin.user.create({ data: { email: "otro-gestor@ejemplo.com" } })).id;
  suc1 = (await prismaAdmin.sucursal.create({ data: { empresaId: E, nombre: "Centro" } })).id;
  suc2 = (await prismaAdmin.sucursal.create({ data: { empresaId: E, nombre: "Norte" } })).id;
  rol = (await prismaAdmin.rol.create({ data: { empresaId: E, nombre: "operador" } })).id;
});

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

const base = (email = "Nueva@Ejemplo.com") => ({ empresaId: E, email, invitadoPorId: invitador, acceso: { sucursalId: suc1, rolId: rol }, ahora: AHORA, generarToken: token });
const enTx = <T>(fn: (tx: Parameters<Parameters<typeof prismaAdmin.$transaction>[0]>[0]) => Promise<T>) => prismaAdmin.$transaction(fn);
const auditoria = () => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "UsuarioEmpresa", campo: "invitacion" }, orderBy: { creadoEn: "asc" } });

describe("asegurarInvitacionDeUsuario", () => {
  it("sin pendiente: crea la invitación (email en minúscula, hash del token, 7 días) con su sucursal y rol, y deja auditoría; NO crea User ni membresías", async () => {
    const usuarios = await prismaAdmin.user.count();
    const r = await enTx((tx) => asegurarInvitacionDeUsuario(tx, base()));
    expect(r).toMatchObject({ ok: true, accion: "creada", token: expect.any(String) });
    if (!r.ok || !r.token) throw new Error("esperaba token");
    const inv = await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: r.invitacionId }, include: { sucursales: true } });
    expect(inv).toMatchObject({ email: "nueva@ejemplo.com", rolEmpresa: "usuario", estado: "PENDIENTE", invitadoPorId: invitador, hashToken: hashDeToken(r.token), enviadaEn: null });
    expect(inv.venceEn.getTime()).toBe(AHORA.getTime() + VIDA_DE_LA_INVITACION_MS);
    expect(inv.sucursales).toMatchObject([{ sucursalId: suc1, rolId: rol, invitadoPorId: invitador }]);
    expect(await prismaAdmin.user.count()).toBe(usuarios);
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { usuario: { email: "nueva@ejemplo.com" } } })).toBe(0);
    expect((await auditoria()).map((a) => [a.valorAnterior, a.valorNuevo])).toEqual([[null, "pendiente"]]);
  });

  it("con una pendiente VIGENTE: suma la sucursal a la misma invitación y NO devuelve token (no se manda otro mail)", async () => {
    const primera = await enTx((tx) => asegurarInvitacionDeUsuario(tx, base()));
    const segunda = await enTx((tx) => asegurarInvitacionDeUsuario(tx, { ...base(), acceso: { sucursalId: suc2, rolId: rol, notas: "turno noche" } }));
    expect(segunda).toMatchObject({ ok: true, accion: "extendida", token: null });
    if (!primera.ok || !segunda.ok) throw new Error("esperaba ok");
    expect(segunda.invitacionId).toBe(primera.invitacionId);
    expect(await prismaAdmin.invitacion.count()).toBe(1);
    expect((await prismaAdmin.invitacionSucursal.findMany({ orderBy: { creadaEn: "asc" } })).map((f) => [f.sucursalId, f.notas])).toEqual([[suc1, null], [suc2, "turno noche"]]);
  });

  it("repetir la misma sucursal actualiza el rol en lugar de duplicar la fila", async () => {
    await enTx((tx) => asegurarInvitacionDeUsuario(tx, base()));
    const otroRol = (await prismaAdmin.rol.create({ data: { empresaId: E, nombre: "cajero" } })).id;
    await enTx((tx) => asegurarInvitacionDeUsuario(tx, { ...base(), acceso: { sucursalId: suc1, rolId: otroRol } }));
    expect((await prismaAdmin.invitacionSucursal.findMany()).map((f) => f.rolId)).toEqual([otroRol]);
  });

  it("con una pendiente VENCIDA: rota el token (el hash viejo desaparece), renueva el vencimiento, vuelve a firmar y devuelve el token nuevo", async () => {
    const primera = await enTx((tx) => asegurarInvitacionDeUsuario(tx, base()));
    if (!primera.ok || !primera.token) throw new Error("esperaba token");
    const despues = new Date(AHORA.getTime() + VIDA_DE_LA_INVITACION_MS + 1000);
    const segunda = await enTx((tx) => asegurarInvitacionDeUsuario(tx, { ...base(), ahora: despues, invitadoPorId: otro }));
    expect(segunda).toMatchObject({ ok: true, accion: "rotada" });
    if (!segunda.ok || !segunda.token) throw new Error("esperaba token");
    expect(segunda.token).not.toBe(primera.token);
    const inv = await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: segunda.invitacionId } });
    expect(inv).toMatchObject({ hashToken: hashDeToken(segunda.token), invitadoPorId: otro });
    expect(inv.venceEn.getTime()).toBe(despues.getTime() + VIDA_DE_LA_INVITACION_MS);
    expect(await prismaAdmin.invitacion.count({ where: { hashToken: hashDeToken(primera.token) } })).toBe(0);
  });

  it("no se pisa una invitación de gerente ni de vinculación pendiente", async () => {
    await prismaAdmin.invitacion.create({ data: { empresaId: E, email: "g@ejemplo.com", rolEmpresa: "gerente", hashToken: hashDeToken("g"), venceEn: new Date(AHORA.getTime() + 1e9) } });
    expect((await enTx((tx) => asegurarInvitacionDeUsuario(tx, base("g@ejemplo.com")))).ok).toBe(false);
    await enTx((tx) => asegurarInvitacionDeVinculacion(tx, { empresaId: E, email: "v@ejemplo.com", invitadoPorId: invitador, ahora: AHORA, generarToken: token }));
    expect((await enTx((tx) => asegurarInvitacionDeUsuario(tx, base("v@ejemplo.com")))).ok).toBe(false);
  });

  it("después de revocar o aceptar, una invitación nueva es otra fila", async () => {
    const primera = await enTx((tx) => asegurarInvitacionDeUsuario(tx, base()));
    if (!primera.ok) throw new Error("ok");
    await enTx((tx) => revocarInvitacionPendiente(tx, { empresaId: E, invitacionId: primera.invitacionId, actorId: invitador, ahora: AHORA }));
    const segunda = await enTx((tx) => asegurarInvitacionDeUsuario(tx, base()));
    expect(segunda).toMatchObject({ ok: true, accion: "creada" });
    expect(await prismaAdmin.invitacion.count()).toBe(2);
  });
});

describe("asegurarInvitacionDeVinculacion", () => {
  const datos = { empresaId: E, email: "Precargado@Ejemplo.com", invitadoPorId: "", ahora: AHORA, generarToken: token };

  it("sin pendiente la crea con token; vigente no devuelve token; vencida rota", async () => {
    const d = { ...datos, invitadoPorId: invitador };
    const a = await enTx((tx) => asegurarInvitacionDeVinculacion(tx, d));
    expect(a).toMatchObject({ ok: true, accion: "creada", token: expect.any(String) });
    expect(await enTx((tx) => asegurarInvitacionDeVinculacion(tx, d))).toMatchObject({ ok: true, accion: "extendida", token: null });
    const tarde = { ...d, ahora: new Date(AHORA.getTime() + VIDA_DE_LA_INVITACION_MS + 1) };
    expect(await enTx((tx) => asegurarInvitacionDeVinculacion(tx, tarde))).toMatchObject({ ok: true, accion: "rotada", token: expect.any(String) });
    expect(await prismaAdmin.invitacion.count()).toBe(1);
    expect(await prismaAdmin.invitacion.findFirstOrThrow()).toMatchObject({ rolEmpresa: "vinculacion", email: "precargado@ejemplo.com" });
  });
});

describe("rotarInvitacionPendiente y revocarInvitacionPendiente", () => {
  it("reenviar rota el token y vuelve a firmar la invitación y TODAS sus sucursales a nombre de quien reenvía", async () => {
    const a = await enTx((tx) => asegurarInvitacionDeUsuario(tx, base()));
    await enTx((tx) => asegurarInvitacionDeUsuario(tx, { ...base(), acceso: { sucursalId: suc2, rolId: rol } }));
    if (!a.ok || !a.token) throw new Error("esperaba token");
    const r = await enTx((tx) => rotarInvitacionPendiente(tx, { empresaId: E, invitacionId: a.invitacionId, actorId: otro, ahora: AHORA, generarToken: token }));
    expect(r).toMatchObject({ ok: true, accion: "rotada" });
    expect(await prismaAdmin.invitacion.count({ where: { hashToken: hashDeToken(a.token) } })).toBe(0);
    expect(await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: a.invitacionId } })).toMatchObject({ invitadoPorId: otro, enviadaEn: null });
    expect((await prismaAdmin.invitacionSucursal.findMany()).map((f) => f.invitadoPorId)).toEqual([otro, otro]);
  });

  it("no rota ni revoca una aceptada, una revocada, una de gerente ni una de otra empresa", async () => {
    const a = await enTx((tx) => asegurarInvitacionDeUsuario(tx, base()));
    if (!a.ok) throw new Error("ok");
    expect((await enTx((tx) => rotarInvitacionPendiente(tx, { empresaId: "otra-empresa", invitacionId: a.invitacionId, actorId: otro, ahora: AHORA }))).ok).toBe(false);
    expect(await enTx((tx) => revocarInvitacionPendiente(tx, { empresaId: "otra-empresa", invitacionId: a.invitacionId, actorId: otro, ahora: AHORA }))).toBe(false);
    expect(await enTx((tx) => revocarInvitacionPendiente(tx, { empresaId: E, invitacionId: a.invitacionId, actorId: otro, ahora: AHORA }))).toBe(true);
    expect(await enTx((tx) => revocarInvitacionPendiente(tx, { empresaId: E, invitacionId: a.invitacionId, actorId: otro, ahora: AHORA }))).toBe(false);
    expect((await enTx((tx) => rotarInvitacionPendiente(tx, { empresaId: E, invitacionId: a.invitacionId, actorId: otro, ahora: AHORA }))).ok).toBe(false);
    const g = await prismaAdmin.invitacion.create({ data: { empresaId: E, email: "g2@ejemplo.com", rolEmpresa: "gerente", hashToken: hashDeToken("g2"), venceEn: new Date(AHORA.getTime() + 1e9) } });
    expect(await enTx((tx) => revocarInvitacionPendiente(tx, { empresaId: E, invitacionId: g.id, actorId: otro, ahora: AHORA }))).toBe(false);
  });
});
