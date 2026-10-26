import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Interruptor para romper la auditoría A MITAD DE CAMINO (patrón de `opciones-auditoria-atomica.test.ts`): `fallarEnLlamada = N` hace que la N-ésima llamada a `registrarCambioAuditado` tire, DESPUÉS de que el
 * caso de uso ya escribió. Las demás delegan en la implementación real.
 */
const interruptor = vi.hoisted(() => ({ fallarEnLlamada: null as number | null, llamadas: 0 }));

vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      interruptor.llamadas++;
      if (interruptor.fallarEnLlamada !== null && interruptor.llamadas === interruptor.fallarEnLlamada) throw new Error("auditoría caída (simulada)");
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { azarDelProceso } from "../../src/lib/azar";
import type { ComandoCrearGrupoEnElProducto } from "../../src/core/features/catalogo/opciones-de-venta.schema";
import { crearGrupoEnElProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-grupo-en-el-producto";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * Fase 6, paso 6.14c: el comando compuesto «crear un grupo sin salir del producto» escribe el grupo, sus opciones con su versión 1, lo que admite el producto y TODA su auditoría en UNA transacción, con el mismo
 * `tx`: si una fila de auditoría falla, en CUALQUIER llamada (la primera del grupo, la de la segunda opción, la última de lo que admite el producto), no queda NADA — ni el grupo, ni las opciones, ni las versiones,
 * ni lo que admite el producto, ni una sola fila de auditoría. Se prueba en TODAS las llamadas, una por una, para que no haya un punto del camino que quede afuera de la transacción.
 *
 * Mutación demostrada: componer los tres pasos en transacciones separadas (el alta del grupo, la de las opciones y la admisión, cada una con la suya) deja este test en rojo.
 */
describe("crear un grupo sin salir del producto: la escritura y su auditoría son atómicas (6.14c)", () => {
  let e: EscenarioDeOpciones;
  let milanesaId: string;
  const comando = (): ComandoCrearGrupoEnElProducto => ({
    productoId: milanesaId,
    nombre: "Presentación",
    respuesta: "PRECIO_FINAL",
    prefijoEnCarta: null,
    opciones: [
      { nombre: "Simple", importe: 8000 },
      { nombre: "Doble", importe: 11000 },
      { nombre: "Triple", importe: 14000 },
    ],
  });
  const crear = () => crearGrupoEnElProductoCasoDeUso(actorDePrueba(e.usuarioId, e.sucursalA), comando(), azarDelProceso);
  const cuentas = async () => ({
    grupos: await prisma.grupoDeOpciones.count(),
    opciones: await prisma.opcionDeGrupo.count(),
    versiones: await prisma.versionDeOpcion.count(),
    admisionesDeGrupo: await prisma.productoAdmiteGrupo.count(),
    admisionesDeOpcion: await prisma.productoAdmiteOpcion.count(),
    auditorias: await prisma.registroAuditoria.count(),
  });

  beforeEach(async () => {
    interruptor.fallarEnLlamada = null;
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    milanesaId = (await prisma.producto.create({ data: { codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "0.00", modoDeVenta: "BASE_CONFIGURABLE" } })).id;
    interruptor.llamadas = 0;
  });

  afterEach(() => {
    interruptor.fallarEnLlamada = null;
  });

  it("si la auditoría falla en CUALQUIER llamada del alta compuesta (la primera, una del medio, la última), no queda NADA: 0 grupos, opciones, versiones, admisiones y auditorías nuevas", async () => {
    // Una corrida sana, sobre OTRO producto y con OTRO nombre de grupo, cuenta cuántas llamadas a la auditoría hace el alta completa (el grupo, 3 opciones con su versión y la admisión con sus 3 opciones).
    const control = await prisma.producto.create({ data: { codigo: "PV_HAMB", nombre: "Hamburguesa", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "0.00", modoDeVenta: "BASE_CONFIGURABLE" } });
    const antesDelControl = await cuentas();
    const sana = await crearGrupoEnElProductoCasoDeUso(actorDePrueba(e.usuarioId, e.sucursalA), { ...comando(), productoId: control.id, nombre: "Control" }, azarDelProceso);
    expect(sana.ok).toBe(true);
    const total = interruptor.llamadas;
    expect(total, "el alta compuesta audita el grupo, las opciones, las versiones y la admisión").toBeGreaterThan(30);
    const base = await cuentas();
    const filasDelControl = base.auditorias - antesDelControl.auditorias;

    for (let k = 1; k <= total; k++) {
      interruptor.llamadas = 0;
      interruptor.fallarEnLlamada = k;
      await expect(crear(), `llamada ${k} de ${total}`).rejects.toThrow("auditoría caída");
      expect(await cuentas(), `llamada ${k} de ${total}: quedó algo escrito`).toEqual(base);
    }

    // Sin el interruptor el mismo alta anda: deja exactamente lo que dejó la corrida sana (la misma cantidad de filas de cada cosa).
    interruptor.fallarEnLlamada = null;
    interruptor.llamadas = 0;
    expect((await crear()).ok).toBe(true);
    expect(interruptor.llamadas).toBe(total);
    const despues = await cuentas();
    expect(despues).toMatchObject({ grupos: base.grupos + 1, opciones: base.opciones + 3, versiones: base.versiones + 3, admisionesDeGrupo: base.admisionesDeGrupo + 1, admisionesDeOpcion: base.admisionesDeOpcion + 3 });
    expect(despues.auditorias - base.auditorias).toBe(filasDelControl);
  });
});
