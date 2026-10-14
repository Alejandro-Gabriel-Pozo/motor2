import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, prismaSinEmpresa } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { archivarOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/archivar-opciones";
import { editarOpcionDeGrupoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/editar-opcion-de-grupo";

/**
 * OPCIONES-LIMPIEZA: CONCURRENCIA REAL de archivar y restaurar (Promise.allSettled contra Postgres, como `motor2_app`, sin mocks de base), en loop de 10 porque el cruce depende del
 * timing, y con la guarda contra el falso verde (si en ninguna vuelta hubo un reintento, el test no ejercitó el conflicto). Fija que dos pedidos a la vez SIEMPRE terminan en un
 * estado válido y con una auditoría coherente:
 *  - dos «archivar» del mismo lote: uno cambia y el otro ve que ya estaba (una sola fila de auditoría por elemento, la versión sube de a una);
 *  - «archivar» contra «restaurar»: el estado final es el de la última en el orden serializado, y la cadena de auditoría encadena (el «antes» de una es el «después» de la otra);
 *  - «archivar» contra una edición abierta con la versión de antes: el archivo no se pierde nunca (o la edición entra primero y después se archiva, o la edición se rechaza);
 *  - dos lotes que se pisan en parte: todo queda archivado y cada elemento con UNA auditoría.
 */
const ITERACIONES = 10;

describe("archivar y restaurar — concurrencia real (OPCIONES-LIMPIEZA)", () => {
  let e: EscenarioDeOpciones;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const archivar = (grupoIds: string[], opcionIds: string[], valor: boolean) => archivarOpcionesCasoDeUso(actor(), { grupoIds, opcionIds, archivar: valor });
  type Resultado = Awaited<ReturnType<typeof archivarOpcionesCasoDeUso>>;
  const valores = (r: PromiseSettledResult<Resultado>[]) => r.map((s) => (s as PromiseFulfilledResult<Resultado>).value);
  const auditoriaDe = (entidadId: string) => prisma.registroAuditoria.findMany({ where: { entidadId }, orderBy: { creadoEn: "asc" }, select: { valorAnterior: true, valorNuevo: true } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    const adminRol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    await crearMembresia({ usuarioId: e.usuarioId, sucursalId: e.sucursalA, rolId: adminRol.id });
  });

  it("dos «archivar» (o dos «restaurar») del mismo lote a la vez: uno cambia, el otro ve que ya estaba; una auditoría por elemento y la versión sube de a una", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      const archivando = i % 2 === 0;
      const antesGrupo = (await auditoriaDe(e.grupoVarianteId)).length;
      const antesOpcion = (await auditoriaDe(e.chicoId)).length;
      const resultados = await Promise.allSettled([archivar([e.grupoVarianteId], [e.chicoId], archivando), archivar([e.grupoVarianteId], [e.chicoId], archivando)]);
      expect(resultados.every((s) => s.status === "fulfilled"), `vuelta ${i}: una promesa rechazó (el conflicto no se absorbió)`).toBe(true);
      const v = valores(resultados);
      expect(v.every((r) => r.ok), `vuelta ${i}: ${v.map((r) => r.mensaje).join(" | ")}`).toBe(true);
      expect(v.map((r) => (r.ok ? r.datos.cambiados : -1)).sort()).toEqual([0, 2]);

      expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoVarianteId }, select: { activo: true, version: true } })).toEqual({ activo: !archivando, version: i + 2 });
      expect(await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: e.chicoId }, select: { activa: true, version: true } })).toEqual({ activa: !archivando, version: i + 2 });
      expect((await auditoriaDe(e.grupoVarianteId)).length, `vuelta ${i}`).toBe(antesGrupo + 1);
      expect((await auditoriaDe(e.chicoId)).length, `vuelta ${i}`).toBe(antesOpcion + 1);
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna vuelta chocaron los dos pedidos: el test no ejercitó el reintento").toBeGreaterThan(2 * ITERACIONES);
    intentos.mockRestore();
  });

  it("«archivar» contra «restaurar» a la vez: el estado final es válido y la cadena de auditoría encadena (el antes de cada fila es el después de la anterior)", async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const resultados = await Promise.allSettled([archivar([], [e.almendrasId], true), archivar([], [e.almendrasId], false)]);
      expect(resultados.every((s) => s.status === "fulfilled" && s.value.ok), `vuelta ${i}: ${JSON.stringify(resultados)}`).toBe(true);
      const filas = await auditoriaDe(e.almendrasId);
      const actual = await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: e.almendrasId }, select: { activa: true, version: true } });
      // La versión sube una vez por cada fila de auditoría: nada se escribió sin dejar rastro.
      expect(actual.version, `vuelta ${i}`).toBe(1 + filas.length);
      for (let k = 1; k < filas.length; k++) expect(filas[k]!.valorAnterior, `vuelta ${i}, fila ${k}`).toBe(filas[k - 1]!.valorNuevo);
      expect(String(actual.activa)).toBe(filas.length === 0 ? "true" : filas[filas.length - 1]!.valorNuevo);
    }
  });

  it("«archivar» contra una edición abierta con la versión de antes: el archivo NUNCA se pierde (o la edición entra antes, o se rechaza por la versión)", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    let nombreEsperado = "Grande";
    let ediciones = 0;
    for (let i = 0; i < ITERACIONES; i++) {
      await archivar([], [e.grandeId], false);
      const vista = (await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: e.grandeId } })).version;
      const [archivo, edicion] = await Promise.allSettled([
        archivar([], [e.grandeId], true),
        editarOpcionDeGrupoCasoDeUso(actor(), { opcionId: e.grandeId, versionEsperada: vista, nombre: `Grande ${i}`, orden: 3, activa: true }),
      ]);
      expect(archivo.status === "fulfilled" && archivo.value.ok, `vuelta ${i}`).toBe(true);
      expect(edicion.status, `vuelta ${i}`).toBe("fulfilled");
      const editada = edicion.status === "fulfilled" && edicion.value.ok;
      if (!editada && edicion.status === "fulfilled" && !edicion.value.ok) expect(edicion.value.codigo).toBe("VERSION_DESACTUALIZADA");
      const final = await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: e.grandeId }, select: { nombre: true, activa: true, version: true } });
      expect(final.activa, `vuelta ${i}: la edición pisó el archivo`).toBe(false);
      if (editada) {
        nombreEsperado = `Grande ${i}`;
        ediciones++;
      }
      expect(final.nombre, `vuelta ${i}`).toBe(nombreEsperado);
      expect(final.version, `vuelta ${i}`).toBe(vista + (editada ? 2 : 1));
    }
    // Las dos órdenes son válidas; lo que no puede pasar es que no se haya ejercitado el cruce: o la edición perdió alguna vez, o alguna transacción se reintentó (3 por vuelta sin conflicto).
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(ediciones < ITERACIONES || transacciones > 3 * ITERACIONES, "ni la edición perdió ni hubo un reintento: el test no ejercitó la carrera").toBe(true);
    intentos.mockRestore();
  });

  it("dos lotes que se pisan en parte, a la vez: todo queda archivado y cada elemento con UNA sola auditoría", async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const ids = [e.chicoId, e.medianoId, e.vacaId];
      await archivar([], ids, false);
      const antes = new Map(await Promise.all(ids.map(async (id) => [id, (await auditoriaDe(id)).length] as const)));
      const resultados = await Promise.allSettled([archivar([], [e.chicoId, e.medianoId], true), archivar([], [e.medianoId, e.vacaId], true)]);
      expect(resultados.every((s) => s.status === "fulfilled" && s.value.ok), `vuelta ${i}`).toBe(true);
      expect(await prisma.opcionDeGrupo.count({ where: { id: { in: ids }, activa: false } })).toBe(3);
      for (const id of ids) expect((await auditoriaDe(id)).length, `vuelta ${i}: ${id}`).toBe(antes.get(id)! + 1);
    }
  });
});
