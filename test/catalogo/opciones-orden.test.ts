import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { reordenarOpcionesDeGrupo } from "../../src/server/actions/catalogo/opciones-de-venta";
import { reordenarOpcionesDeGrupoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/reordenar-opciones-de-grupo";
import { guardComandoReordenarOpcionesDeGrupo } from "../../src/core/features/catalogo/opciones-de-venta.guard";

/**
 * GO-2d: el ORDEN de las opciones de un grupo («mover tocando», `opciones_definir`). Contra Postgres real, como `motor2_app`. El orden completo se fija de una vez (10, 20, 30…),
 * con la versión de cada opción que cambia de lugar; una lista vieja (le falta o le sobra una opción) se rechaza entera; el mismo pedido repetido no escribe ni audita.
 */
describe("ordenar las opciones de un grupo (GO-2d)", () => {
  let e: EscenarioDeOpciones;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const ordenActual = async () => (await prisma.opcionDeGrupo.findMany({ where: { grupoId: e.grupoMedidaId }, orderBy: [{ orden: "asc" }, { nombre: "asc" }], select: { id: true, orden: true, version: true } }));

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    const adminRol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    await crearMembresia({ usuarioId: e.usuarioId, sucursalId: e.sucursalA, rolId: adminRol.id });
    await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
  });

  it("Grande primero: el orden nuevo (10, 20, 30), la versión +1 de las que cambiaron y una auditoría de `orden` por cada una", async () => {
    const r = await reordenarOpcionesDeGrupoCasoDeUso(actor(), {
      grupoId: e.grupoMedidaId,
      opciones: [e.grandeId, e.chicoId, e.medianoId].map((opcionId) => ({ opcionId, versionEsperada: 1 })),
    });
    expect(r).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect((await ordenActual()).map((o) => [o.id, o.orden, o.version])).toEqual([
      [e.grandeId, 10, 2],
      [e.chicoId, 20, 2],
      [e.medianoId, 30, 2],
    ]);
    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "OpcionDeGrupo", campo: "orden" }, select: { entidadId: true, valorAnterior: true, valorNuevo: true } });
    expect(auditoria.map((a) => [a.entidadId, a.valorAnterior, a.valorNuevo]).sort()).toEqual(
      [
        [e.chicoId, "1", "20"],
        [e.medianoId, "2", "30"],
        [e.grandeId, "3", "10"],
      ].sort()
    );
  });

  it("idempotente: el mismo orden repetido (el segundo clic, aunque lleve las versiones viejas) da éxito sin escribir ni auditar", async () => {
    const comando = { grupoId: e.grupoMedidaId, opciones: [e.grandeId, e.chicoId, e.medianoId].map((opcionId) => ({ opcionId, versionEsperada: 1 })) };
    await reordenarOpcionesDeGrupoCasoDeUso(actor(), comando);
    const auditorias = await prisma.registroAuditoria.count();
    expect(await reordenarOpcionesDeGrupoCasoDeUso(actor(), comando)).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await prisma.registroAuditoria.count()).toBe(auditorias);
    expect((await ordenActual()).map((o) => o.version)).toEqual([2, 2, 2]);
  });

  it("una pantalla vieja: con la versión de otra persona, o con una opción de menos o de otro grupo, se rechaza ENTERO y no cambia nada", async () => {
    await prisma.opcionDeGrupo.update({ where: { id: e.chicoId }, data: { version: 2 } });
    const antes = await ordenActual();
    const todas = (versionEsperada: number) => [e.grandeId, e.chicoId, e.medianoId].map((opcionId) => ({ opcionId, versionEsperada }));
    const casos = [
      { grupoId: e.grupoMedidaId, opciones: todas(1) },
      { grupoId: e.grupoMedidaId, opciones: todas(2).slice(0, 2) },
      { grupoId: e.grupoMedidaId, opciones: [...todas(2).slice(0, 2), { opcionId: e.vacaId, versionEsperada: 1 }] },
    ];
    for (const comando of casos) {
      const r = await reordenarOpcionesDeGrupoCasoDeUso(actor(), comando);
      expect(r).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      if (!r.ok) expect(r.mensaje).toMatch(/cambiaron mientras las ordenabas\. Recargá/);
    }
    expect(await ordenActual()).toEqual(antes);
  });

  it("la Server Action exige el permiso y valida la forma: repetida o vacía no llega a la base", async () => {
    expect(guardComandoReordenarOpcionesDeGrupo({ grupoId: e.grupoMedidaId, opciones: [] }).ok).toBe(false);
    expect(guardComandoReordenarOpcionesDeGrupo({ grupoId: e.grupoMedidaId, opciones: [{ opcionId: e.chicoId, versionEsperada: 1 }, { opcionId: e.chicoId, versionEsperada: 1 }] })).toMatchObject({ ok: false });
    expect(guardComandoReordenarOpcionesDeGrupo({ grupoId: e.grupoMedidaId, opciones: [{ opcionId: e.chicoId, versionEsperada: 0 }] }).ok).toBe(false);
    const r = await reordenarOpcionesDeGrupo({ grupoId: e.grupoMedidaId, opciones: [e.medianoId, e.grandeId, e.chicoId].map((opcionId) => ({ opcionId, versionEsperada: 1 })) });
    expect(r).toEqual({ ok: true, mensaje: "Listo: «Tamaño» quedó con el orden nuevo." });
  });
});
