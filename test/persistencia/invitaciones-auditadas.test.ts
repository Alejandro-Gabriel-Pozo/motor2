import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import {
  asegurarInvitacionDeUsuario,
  asegurarInvitacionDeVinculacion,
  revocarInvitacionPendiente,
  rotarInvitacionPendiente,
} from "../../src/server/actions/auth/casos-de-uso/invitaciones-de-usuario-en-tx";
import { revocarInvitacionSiSiguePendiente } from "../../src/server/persistencia/auth/invitaciones-de-usuario";
import { VIDA_DE_LA_INVITACION_MS } from "../../src/core/features/empresa/invitacion";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { azarDelProceso } from "../../src/lib/azar";

/**
 * Hito 3, I.5e2: la auditoría de las invitaciones queda en el paso compartido `invitaciones-de-usuario-en-tx.ts` (las escrituras bajaron a persistencia). Cada camino
 * deja SU fila (`UsuarioEmpresa.invitacion`, del estado anterior al nuevo, con quién lo hizo): crear, extender, rotar una vencida (usuario y vinculación), reenviar y
 * revocar; y una vinculación vigente o un rechazo no dejan ninguna. Hasta acá solo se miraba la fila del alta (`invitacion-de-usuario.test.ts`): sacar la auditoría de
 * reenviar o de revocar no ponía nada en rojo (ni la huella, que no vuelca esas filas). Verde también contra el código previo a I.5e2. Postgres real.
 */
const E = "empresa_principal";
const AHORA = AHORA_DE_LA_CORRIDA;
const DESPUES = new Date(AHORA.getTime() + VIDA_DE_LA_INVITACION_MS + 1000);
let invitador: string;
let otro: string;
let suc1: string;
let rol: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  invitador = (await prismaAdmin.user.create({ data: { email: "gestor@ejemplo.com" } })).id;
  otro = (await prismaAdmin.user.create({ data: { email: "otro-gestor@ejemplo.com" } })).id;
  suc1 = (await prismaAdmin.sucursal.create({ data: { empresaId: E, nombre: "Centro" } })).id;
  rol = (await prismaAdmin.rol.create({ data: { empresaId: E, nombre: "operador" } })).id;
});

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

const enTx = <T>(fn: (tx: Parameters<Parameters<typeof prismaAdmin.$transaction>[0]>[0]) => Promise<T>) => prismaAdmin.$transaction(fn);
const usuario = (ahora = AHORA, por = invitador) => ({ empresaId: E, email: "Nueva@Ejemplo.com", invitadoPorId: por, acceso: { sucursalId: suc1, rolId: rol }, ahora, azar: azarDelProceso });
const vinculacion = (ahora = AHORA) => ({ empresaId: E, email: "vincular@ejemplo.com", invitadoPorId: invitador, ahora, azar: azarDelProceso });
const filas = async () =>
  (await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "UsuarioEmpresa", campo: "invitacion" }, orderBy: { creadoEn: "asc" } })).map((f) => [f.valorAnterior, f.valorNuevo, f.actorId === invitador ? "invitador" : "otro"]);

describe("invitaciones: cada camino deja su fila de auditoría", () => {
  it("usuario: crear, extender (vigente) y rotar (vencida)", async () => {
    await enTx((tx) => asegurarInvitacionDeUsuario(tx, usuario()));
    await enTx((tx) => asegurarInvitacionDeUsuario(tx, usuario()));
    await enTx((tx) => asegurarInvitacionDeUsuario(tx, usuario(DESPUES, otro)));
    expect(await filas()).toEqual([
      [null, "pendiente", "invitador"],
      ["pendiente", "pendiente (suma una sucursal)", "invitador"],
      ["vencida", "pendiente", "otro"],
    ]);
  });

  it("vinculación: crear y rotar (vencida); una vigente no deja fila", async () => {
    await enTx((tx) => asegurarInvitacionDeVinculacion(tx, vinculacion()));
    await enTx((tx) => asegurarInvitacionDeVinculacion(tx, vinculacion()));
    await enTx((tx) => asegurarInvitacionDeVinculacion(tx, vinculacion(DESPUES)));
    expect(await filas()).toEqual([
      [null, "pendiente", "invitador"],
      ["vencida", "pendiente", "invitador"],
    ]);
  });

  it("reenviar y revocar, a nombre de quien lo hace; revocar otra vez no deja fila", async () => {
    const r = await enTx((tx) => asegurarInvitacionDeUsuario(tx, usuario()));
    if (!r.ok) throw new Error("esperaba ok");
    await enTx((tx) => rotarInvitacionPendiente(tx, { empresaId: E, invitacionId: r.invitacionId, actorId: otro, ahora: AHORA, azar: azarDelProceso }));
    expect(await enTx((tx) => revocarInvitacionPendiente(tx, { empresaId: E, invitacionId: r.invitacionId, actorId: invitador, ahora: AHORA }))).toBe(true);
    expect(await enTx((tx) => revocarInvitacionPendiente(tx, { empresaId: E, invitacionId: r.invitacionId, actorId: invitador, ahora: AHORA }))).toBe(false);
    expect(await filas()).toEqual([
      [null, "pendiente", "invitador"],
      ["pendiente", "pendiente (reenviada)", "otro"],
      ["pendiente", "revocada", "invitador"],
    ]);
  });

  it("un rechazo (pendiente de otro tipo) no deja fila", async () => {
    await enTx((tx) => asegurarInvitacionDeVinculacion(tx, { ...vinculacion(), email: "Nueva@Ejemplo.com" }));
    const r = await enTx((tx) => asegurarInvitacionDeUsuario(tx, usuario()));
    expect(r.ok).toBe(false);
    expect(await filas()).toEqual([[null, "pendiente", "invitador"]]);
  });
});

describe("revocarInvitacionSiSiguePendiente (persistencia)", () => {
  it("es condicional: una invitación que ya no está pendiente no se toca (la carrera de dos revocaciones, que la lectura previa no ve)", async () => {
    const r = await enTx((tx) => asegurarInvitacionDeUsuario(tx, usuario()));
    if (!r.ok) throw new Error("esperaba ok");
    expect(await enTx((tx) => revocarInvitacionSiSiguePendiente(tx, { invitacionId: r.invitacionId, ahora: AHORA }))).toBe(1);
    expect(await enTx((tx) => revocarInvitacionSiSiguePendiente(tx, { invitacionId: r.invitacionId, ahora: DESPUES }))).toBe(0);
    expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: r.invitacionId } })).revocadaEn).toEqual(AHORA);
  });
});
