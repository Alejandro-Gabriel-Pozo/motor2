import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { obtenerContextoUsuario } from "../../src/core/auth/contexto";
import { azarDelProceso } from "../../src/lib/azar";
import { actualizarActivoMembresiaCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/actualizar-activo-membresia";
import { actualizarActivoUsuarioEnEmpresaCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/actualizar-activo-usuario-en-empresa";
import { actualizarNotasMembresiaCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/actualizar-notas-membresia";
import { agregarOActualizarUsuarioCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/agregar-o-actualizar-usuario";
import { crearSucursalConAdminCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/crear-sucursal-con-admin";
import { invitarAVincularCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/invitar-a-vincular";
import { revocarInvitacionCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/revocar-invitacion";

/**
 * O35-B (O.35, «releer el actor dentro de la transacción»; `docs/plan-hito-3-pureza.md` §9): los casos de uso de gobierno de usuarios miden a quien actúa
 * DESDE LA BASE, dentro de su transacción (`actorDesdeLaBase` en una sucursal, `objetivoEnLaEmpresa` en la empresa), y no con el contexto de la sesión.
 *
 * El contexto (`obtenerContextoUsuario`) se arma al principio del pedido. Si entre ese momento y la transacción de gobierno a quien actúa le bajan el rol de
 * administrador a operador, o le apagan la membresía, el contexto sigue diciendo «administrador»: con él, el techo de privilegio dejaba pasar lo que ya no le
 * corresponde (dar el rol admin, tocar a otro admin). Acá se arma el contexto REAL de un administrador (el «contexto viejo»), después la base lo baja, y con ese
 * mismo contexto se llama a cada caso de uso: tiene que rechazar con el mensaje del techo y no escribir nada. El control (la base no cambió) pasa, para que el
 * rechazo sea por la relectura y no por otra cosa.
 *
 * El permiso de la acción (`conPermiso*`, el gate) lo evalúa la Server Action antes, con la base del momento: por eso se llama al caso de uso directo, que es
 * exactamente lo que pasa cuando el cambio de la base cae entre el gate y la transacción. El alta de sucursal (contexto empresa) la sumó O35-B2.
 */
const MENSAJE_TECHO_DE_ADMIN = "Solo un administrador o el gerente de la empresa puede dar el rol de administrador o modificar a un administrador.";

const hacerGerente = (usuarioId: string) =>
  prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });

async function contextoDe(u: { id: string; email: string }) {
  await mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });
  const ctx = await obtenerContextoUsuario();
  if (!ctx) throw new Error(`sin contexto: ${u.email}`);
  return { ...ctx, ahora: new Date() };
}

type Escenario = Awaited<ReturnType<typeof sembrar>>;

/** Central con el gerente (admin), A (el que actúa, admin), B (otro admin, sin cuenta de Google vinculada) y M (operador). El gerente sostiene las invariantes. */
async function sembrar() {
  const base = await sembrarBase();
  const s1 = base.sucursal.id;
  const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: s1, rolId: base.admin.id });
  await hacerGerente(gerente.id);
  const a = await crearUsuarioConMembresia({ email: "a@test.com", sucursalId: s1, rolId: base.admin.id });
  const b = await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: s1, rolId: base.admin.id });
  const m = await crearUsuarioConMembresia({ email: "m@test.com", sucursalId: s1, rolId: base.operador.id });
  const membresia = (usuarioId: string) => prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { usuarioId_sucursalId: { usuarioId, sucursalId: s1 } }, include: { rol: true } });
  return { base, s1, gerente, a, b, m, membresia };
}

/** Lo que la base le hace a A DESPUÉS de que se armó su contexto. */
const CAMBIOS: { nombre: string; rechaza: boolean; aplicar: (e: Escenario) => Promise<unknown> }[] = [
  { nombre: "control: la base no cambió", rechaza: false, aplicar: async () => undefined },
  {
    nombre: "le bajaron el rol a operador",
    rechaza: true,
    aplicar: (e) => prismaAdmin.usuarioSucursal.update({ where: { usuarioId_sucursalId: { usuarioId: e.a.id, sucursalId: e.s1 } }, data: { rolId: e.base.operador.id } }),
  },
  {
    nombre: "le apagaron la membresía",
    rechaza: true,
    aplicar: (e) => prismaAdmin.usuarioSucursal.update({ where: { usuarioId_sucursalId: { usuarioId: e.a.id, sucursalId: e.s1 } }, data: { activo: false } }),
  },
];

describe.each(CAMBIOS)("O35-B: el contexto de A dice administrador, y en la base $nombre", ({ rechaza, aplicar }) => {
  let e: Escenario;
  let viejo: Awaited<ReturnType<typeof contextoDe>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrar();
    viejo = await contextoDe(e.a);
    expect(viejo.membresias).toEqual([expect.objectContaining({ sucursalId: e.s1, esAdmin: true })]);
  });
  afterEach(() => __setCookieDeTestParaSucursal(undefined));

  const rechazoDelTecho = { ok: false, codigo: "TECHO_DE_PRIVILEGIO", mensaje: MENSAJE_TECHO_DE_ADMIN };

  it("agregarOActualizarUsuario: darle el rol admin a un miembro", async () => {
    await aplicar(e);
    const r = await agregarOActualizarUsuarioCasoDeUso(viejo, { email: e.m.email, sucursalId: e.s1, rolId: e.base.admin.id }, azarDelProceso);
    if (rechaza) {
      expect(r).toEqual(rechazoDelTecho);
      expect((await e.membresia(e.m.id)).rol.clave).toBe("operador");
    } else {
      expect(r.ok, r.mensaje).toBe(true);
      expect((await e.membresia(e.m.id)).rol.clave).toBe("admin");
    }
  });

  it("actualizarActivoMembresia: desactivar a otro admin", async () => {
    const mb = await e.membresia(e.b.id);
    await aplicar(e);
    const r = await actualizarActivoMembresiaCasoDeUso(viejo, { membresiaId: mb.id, activo: false });
    if (rechaza) expect(r).toEqual(rechazoDelTecho);
    else expect(r.ok, r.mensaje).toBe(true);
    expect((await e.membresia(e.b.id)).activo).toBe(rechaza);
  });

  it("actualizarNotasMembresia: las notas de otro admin", async () => {
    const mb = await e.membresia(e.b.id);
    await aplicar(e);
    const r = await actualizarNotasMembresiaCasoDeUso(viejo, { membresiaId: mb.id, notas: "nota nueva" });
    if (rechaza) expect(r).toEqual(rechazoDelTecho);
    else expect(r.ok, r.mensaje).toBe(true);
    expect((await e.membresia(e.b.id)).notas).toBe(rechaza ? null : "nota nueva");
  });

  it("actualizarActivoUsuarioEnEmpresa: apagar la cuenta de otro admin en la empresa", async () => {
    await aplicar(e);
    const r = await actualizarActivoUsuarioEnEmpresaCasoDeUso(viejo, { usuarioId: e.b.id, activo: false });
    if (rechaza) expect(r).toEqual(rechazoDelTecho);
    else expect(r.ok, r.mensaje).toBe(true);
    const cuenta = await prismaAdmin.usuarioEmpresa.findUniqueOrThrow({ where: { usuarioId_empresaId: { usuarioId: e.b.id, empresaId: EMPRESA_POR_DEFECTO_ID } } });
    expect(cuenta.activo).toBe(rechaza);
  });

  it("invitarAVincular: invitar a vincular su cuenta a otro admin", async () => {
    const mb = await e.membresia(e.b.id);
    await aplicar(e);
    const r = await invitarAVincularCasoDeUso(viejo, { membresiaId: mb.id }, azarDelProceso);
    if (rechaza) expect(r).toEqual(rechazoDelTecho);
    else expect(r.ok, r.mensaje).toBe(true);
    expect(await prismaAdmin.invitacion.count({ where: { email: e.b.email } })).toBe(rechaza ? 0 : 1);
  });

  it("revocarInvitacion (invitacionGestionable): revocar una invitación que ofrece el rol admin", async () => {
    // La invitación la deja el gerente (no es miembro todavía: nace pendiente, sin mail, el mail lo manda la Server Action).
    const invitada = await agregarOActualizarUsuarioCasoDeUso(await contextoDe(e.gerente), { email: "nuevo@test.com", sucursalId: e.s1, rolId: e.base.admin.id }, azarDelProceso);
    expect(invitada.ok, invitada.mensaje).toBe(true);
    const inv = await prismaAdmin.invitacion.findFirstOrThrow({ where: { email: "nuevo@test.com" } });
    await aplicar(e);
    const r = await revocarInvitacionCasoDeUso(viejo, { invitacionId: inv.id });
    if (rechaza) expect(r).toEqual({ ok: false, codigo: "INVITACION_NO_GESTIONABLE", mensaje: MENSAJE_TECHO_DE_ADMIN });
    else expect(r.ok, r.mensaje).toBe(true);
    expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { id: inv.id } })).estado).toBe(rechaza ? "PENDIENTE" : "REVOCADA");
  });

  it("crearSucursalConAdmin (contexto empresa, O35-B2): crear una sucursal y nombrar primer admin a un miembro", async () => {
    await aplicar(e);
    const r = await crearSucursalConAdminCasoDeUso(viejo, { nombre: "Norte", email: e.m.email });
    if (rechaza) expect(r).toEqual(rechazoDelTecho);
    else expect(r.ok, r.mensaje).toBe(true);
    expect(await prismaAdmin.sucursal.count({ where: { nombre: "Norte" } })).toBe(rechaza ? 0 : 1);
  });
});
