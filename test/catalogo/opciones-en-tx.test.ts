import { beforeEach, describe, expect, it } from "vitest";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { azarDelProceso } from "../../src/lib/azar";
import { conTransaccionSerializable } from "../../src/lib/transaccion-serializable";
import type { ComandoCrearOpcionDeGrupo } from "../../src/core/features/catalogo/opciones-de-venta.schema";
import { fracaso } from "../../src/core/resultado-caso";
import { crearGrupoDeOpcionesEnTx } from "../../src/server/actions/catalogo/casos-de-uso/crear-grupo-de-opciones";
import { crearOpcionDeGrupoEnTx } from "../../src/server/actions/catalogo/casos-de-uso/crear-opcion-de-grupo";

/**
 * Fase 6, paso 6.14a: los cuerpos «EnTx» del alta de un grupo y de una opción se pueden encadenar en UNA transacción SERIALIZABLE ajena (la premisa del comando compuesto «crear un grupo sin salir
 * del producto», 6.14c). Contra Postgres:
 *  - dos altas del mismo grupo en la misma transacción: la segunda ve el grupo de la primera («ya existía») y no audita de nuevo;
 *  - una excepción lanzada DESPUÉS de escribir deshace todo: no queda el grupo, ni la opción, ni la versión, ni ninguna fila de auditoría;
 *  - un `fracaso` DEVUELTO desde adentro no deshace nada (Prisma confirma lo ya escrito): por eso el comando compuesto tiene que lanzar en todo rechazo posterior a la primera escritura.
 */
describe("los cuerpos EnTx de crear un grupo y una opción se componen en una transacción ajena", () => {
  let actor: ReturnType<typeof actorDePrueba>;
  const grupo = { nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 } as const;
  const opcion = (grupoId: string, nombre: string, orden: number): ComandoCrearOpcionDeGrupo => ({
    grupoId,
    nombre,
    orden,
    esNinguna: false,
    version: { diferencia: { tipo: "MONTO", monto: 0 }, factorEscala: null, consumos: [] },
    ancla: null,
  });
  const cuentas = async () => ({
    grupos: await prisma.grupoDeOpciones.count(),
    opciones: await prisma.opcionDeGrupo.count(),
    versiones: await prisma.versionDeOpcion.count(),
    auditorias: await prisma.registroAuditoria.count(),
  });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    actor = actorDePrueba(admin.id, base.sucursal.id);
  });

  it("el grupo y sus opciones se crean juntos; repetir el alta del grupo en la misma transacción devuelve el mismo, sin auditar de nuevo", async () => {
    const r = await conTransaccionSerializable(actor.transaccion, async (tx) => {
      const g = await crearGrupoDeOpcionesEnTx(tx, actor, grupo);
      if (!g.ok) return g;
      const a = await crearOpcionDeGrupoEnTx(tx, actor, opcion(g.datos.grupoId, "Chico", 10), azarDelProceso);
      const b = await crearOpcionDeGrupoEnTx(tx, actor, opcion(g.datos.grupoId, "Grande", 20), azarDelProceso);
      const auditoriasAntes = await tx.registroAuditoria.count();
      const otraVez = await crearGrupoDeOpcionesEnTx(tx, actor, grupo);
      return { g, a, b, otraVez, auditoriasNuevas: (await tx.registroAuditoria.count()) - auditoriasAntes };
    });
    expect(r).toMatchObject({ g: { ok: true, datos: { yaExistia: false } }, a: { ok: true }, b: { ok: true }, otraVez: { ok: true, datos: { yaExistia: true } }, auditoriasNuevas: 0 });
    const despues = await cuentas();
    expect(despues).toMatchObject({ grupos: 1, opciones: 2, versiones: 2 });
    expect(despues.auditorias).toBeGreaterThan(0);
  });

  it("una excepción lanzada después de escribir deshace el grupo, las opciones, las versiones y su auditoría", async () => {
    await expect(
      conTransaccionSerializable(actor.transaccion, async (tx) => {
        const g = await crearGrupoDeOpcionesEnTx(tx, actor, grupo);
        if (!g.ok) throw new Error("no debería fallar");
        await crearOpcionDeGrupoEnTx(tx, actor, opcion(g.datos.grupoId, "Chico", 10), azarDelProceso);
        throw new Error("un paso posterior se rechazó");
      }),
    ).rejects.toThrow("un paso posterior se rechazó");
    expect(await cuentas()).toEqual({ grupos: 0, opciones: 0, versiones: 0, auditorias: 0 });
  });

  it("un fracaso DEVUELTO desde adentro NO deshace lo escrito (por eso el comando compuesto lanza)", async () => {
    const r = await conTransaccionSerializable(actor.transaccion, async (tx) => {
      const g = await crearGrupoDeOpcionesEnTx(tx, actor, grupo);
      if (!g.ok) throw new Error("no debería fallar");
      return fracaso("CONFIGURACION_INVALIDA", "un paso posterior se rechazó");
    });
    expect(r).toMatchObject({ ok: false });
    expect((await cuentas()).grupos).toBe(1);
  });

  it("un rechazo de las reglas puras (MEDIDA con máximo 2) sale sin escribir nada", async () => {
    const r = await conTransaccionSerializable(actor.transaccion, (tx) => crearGrupoDeOpcionesEnTx(tx, actor, { ...grupo, cantidadMaxima: 2 }));
    expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await cuentas()).toEqual({ grupos: 0, opciones: 0, versiones: 0, auditorias: 0 });
  });
});
