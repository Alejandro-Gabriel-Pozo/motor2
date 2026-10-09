import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { obtenerContextoUsuario } from "../../src/core/auth/contexto";
import { transferirGerenciaCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/transferir-gerencia";
import { transferirGerenciaDeEmpresa } from "../../src/server/actions/auth/casos-de-uso/transferir-gerencia-en-tx";
import { transferirGerencia } from "../../src/server/actions/auth/usuarios";

/**
 * S-11 del plan de endurecimiento de seguridad (fila O.60 de `docs/pureza-integracion.md`; CAMBIA COMPORTAMIENTO, aprobado por el dueño): `transferirGerencia` le sacaba la gerencia a
 * QUIEN LA TUVIERA en ese momento y no a quien la pidió, y auditaba `valorAnterior = actor.email` (el de la sesión) aunque ese ya no fuera el gerente. El gate de la acción
 * (`traspasar_gerencia`, piso gerente) se evalúa ANTES de la transacción, con la base de ese momento: si entre el gate y la transacción la gerencia cambia de manos, un gerente
 * que ya no lo es le quitaba la gerencia al nuevo. Invariante que no se rompe: el gerente se toca a sí mismo y a nadie más.
 *
 * Ahora la transacción RELEE al gerente y rechaza si quien tiene hoy la gerencia no es el actor («La gerencia cambió…»), sin cambiar nada; y la auditoría registra el email del gerente
 * releído de la base, no el de la sesión. Se llama al caso de uso directo con el contexto VIEJO de A (exactamente lo que pasa cuando el cambio cae entre el gate y la transacción).
 */
const MENSAJE_CAMBIO = "La gerencia cambió mientras tanto. Recargá la pantalla y volvé a intentar.";

const darGerencia = (usuarioId: string, rolEmpresa: "gerente" | null) =>
  prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa } });
const gerentes = async () => (await prismaAdmin.usuarioEmpresa.findMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID, rolEmpresa: "gerente" }, select: { usuarioId: true } })).map((g) => g.usuarioId);
const auditoriaDeGerencia = () => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "UsuarioEmpresa", campo: "rolEmpresa" } });

async function contextoDe(u: { id: string; email: string }) {
  await mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });
  const ctx = await obtenerContextoUsuario();
  if (!ctx) throw new Error(`sin contexto: ${u.email}`);
  return { ...ctx, ahora: new Date() };
}

describe("S-11: el traspaso de la gerencia relee al gerente dentro de la transacción", () => {
  let s1: string;
  let a: { id: string; email: string };
  let b: { id: string; email: string };
  let c: { id: string; email: string };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    s1 = base.sucursal.id;
    // A es el gerente (y admin); B y C son admins que pueden recibir la gerencia.
    a = await crearUsuarioConMembresia({ email: "a@test.com", sucursalId: s1, rolId: base.admin.id });
    b = await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: s1, rolId: base.admin.id });
    c = await crearUsuarioConMembresia({ email: "c@test.com", sucursalId: s1, rolId: base.admin.id });
    await darGerencia(a.id, "gerente");
  });

  it("ATAQUE: la gerencia pasó a B después del gate; A (contexto viejo) transfiere a C → se rechaza, B sigue siendo el gerente y C no lo es", async () => {
    const ctxViejoDeA = await contextoDe(a);
    // Entre el gate y la transacción: A deja de ser el gerente y B lo pasa a ser.
    await darGerencia(a.id, null);
    await darGerencia(b.id, "gerente");

    const r = await transferirGerenciaCasoDeUso(ctxViejoDeA, { usuarioDestinoId: c.id, emailConfirmado: c.email });

    expect(r).toMatchObject({ ok: false, codigo: "TRASPASO_RECHAZADO", mensaje: MENSAJE_CAMBIO });
    expect(await gerentes()).toEqual([b.id]);
    expect(await auditoriaDeGerencia()).toEqual([]);
  });

  it("ATAQUE: la empresa se quedó sin gerente después del gate; A (contexto viejo) no se puede nombrar a nadie", async () => {
    const ctxViejoDeA = await contextoDe(a);
    await darGerencia(a.id, null);

    const r = await transferirGerenciaCasoDeUso(ctxViejoDeA, { usuarioDestinoId: c.id, emailConfirmado: c.email });

    expect(r).toMatchObject({ ok: false, codigo: "TRASPASO_RECHAZADO", mensaje: MENSAJE_CAMBIO });
    expect(await gerentes()).toEqual([]);
    expect(await auditoriaDeGerencia()).toEqual([]);
  });

  it("CONTROL: A sigue siendo el gerente → la gerencia pasa a C y la auditoría dice de quién a quién", async () => {
    const ctxDeA = await contextoDe(a);

    const r = await transferirGerenciaCasoDeUso(ctxDeA, { usuarioDestinoId: c.id, emailConfirmado: c.email });

    expect(r.ok, r.mensaje).toBe(true);
    expect(await gerentes()).toEqual([c.id]);
    const [fila, ...resto] = await auditoriaDeGerencia();
    expect(resto).toEqual([]);
    expect(fila).toMatchObject({ entidadId: c.id, valorAnterior: "a@test.com", valorNuevo: "c@test.com", actorId: a.id, sucursalId: null });
  });

  it("la auditoría registra el email del gerente RELEÍDO de la base, no el de la sesión (que pudo quedar viejo)", async () => {
    const ctxDeA = await contextoDe(a);
    await prismaAdmin.user.update({ where: { id: a.id }, data: { email: "a-nuevo@test.com" } });

    const r = await transferirGerenciaCasoDeUso(ctxDeA, { usuarioDestinoId: c.id, emailConfirmado: c.email });

    expect(r.ok, r.mensaje).toBe(true);
    expect((await auditoriaDeGerencia())[0]).toMatchObject({ valorAnterior: "a-nuevo@test.com", valorNuevo: "c@test.com" });
  });

  it("por la Server Action (el camino del navegador) con la gerencia ya en otras manos: el gate la rechaza antes y no cambia nada", async () => {
    await darGerencia(a.id, null);
    await darGerencia(b.id, "gerente");
    await contextoDe(a);

    const r = await transferirGerencia(c.id, c.email);

    expect(r.ok).toBe(false);
    expect(await gerentes()).toEqual([b.id]);
  });

  describe("el paso compartido (transferirGerenciaDeEmpresa)", () => {
    const transferir = (gerenteEsperadoId: string | null, usuarioDestinoId: string) =>
      prismaAdmin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.empresa_id', ${EMPRESA_POR_DEFECTO_ID}, true)`;
        return transferirGerenciaDeEmpresa(tx, { empresaId: EMPRESA_POR_DEFECTO_ID, usuarioDestinoId, gerenteEsperadoId });
      });

    it("con un gerente esperado distinto del actual rechaza sin tocar nada; con el esperado correcto pasa la gerencia", async () => {
      expect(await transferir(b.id, c.id)).toEqual({ ok: false, mensaje: MENSAJE_CAMBIO });
      expect(await gerentes()).toEqual([a.id]);
      expect(await transferir(a.id, c.id)).toMatchObject({ ok: true, gerenteAnteriorId: a.id });
      expect(await gerentes()).toEqual([c.id]);
    });

    it("con un gerente esperado y una empresa SIN gerente rechaza (no se nombra a nadie a nombre de un gerente que ya no existe)", async () => {
      await darGerencia(a.id, null);
      expect(await transferir(a.id, c.id)).toEqual({ ok: false, mensaje: MENSAJE_CAMBIO });
      expect(await gerentes()).toEqual([]);
    });

    it("la plataforma (gerenteEsperadoId null) sigue pudiendo nombrar gerente: con y sin gerente actual", async () => {
      expect(await transferir(null, c.id)).toMatchObject({ ok: true, gerenteAnteriorId: a.id });
      await darGerencia(c.id, null);
      expect(await transferir(null, b.id)).toMatchObject({ ok: true, gerenteAnteriorId: null });
      expect(await gerentes()).toEqual([b.id]);
    });
  });
});
