import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { renombrarOFusionarInsumoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/renombrar-o-fusionar-insumo";

/**
 * D-9, cierre del Hito 4 (observación menor 2 de la auditoría independiente): la fusión de dos insumos SIEMPRE deja su fila de auditoría, aunque los dos tengan
 * el MISMO nombre. Antes la fila llevaba los nombres como anterior y nuevo, y `registrarCambioAuditado` no escribe cuando son textualmente iguales: con dos
 * insumos «Harina» la fusión reasignaba los productos y borraba uno sin dejar rastro. Ahora, cuando los nombres coinciden, cada valor lleva además el id de su
 * insumo (el que desaparece → el que queda); cuando difieren, la fila es la de siempre (`insumo-auditado.test.ts`, sin cambios).
 *
 * Hoy la base NO deja que convivan dos insumos de nombre idéntico en una empresa (índice único `Insumo_nombre_lower_key` sobre `(empresaId, lower(nombre))`; una
 * carrera en `crearInsumo` termina en el P2002 del segundo, no en un duplicado), así que el duplicado se SIMULA: el caso de uso corre con la base real de la
 * empresa (`baseDeTest`: su transacción, sus escrituras y la tabla de auditoría son las de verdad) salvo `insumo.findFirst` —la lectura que encuentra el insumo
 * de destino—, que devuelve la fila real de «Harina premium» con el nombre «Harina», como si el índice no estuviera. ROJO contra `39425653` (sin fila).
 */
describe("D-9: la fusión de dos insumos de nombre idéntico deja su fila", () => {
  let adminId: string;
  let harinaId: string;
  let premiumId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    harinaId = catalogo.insumo.id; // «Harina»
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
    premiumId = (await prisma.insumo.create({ data: { nombre: "Harina premium" } })).id;
    await sembrarProductoDisponible({ codigo: "MP_HARINA_A", nombre: "Harina A", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: harinaId }, base.sucursal.id);
  });

  /** La base de la empresa, pero el insumo de destino que encuentra la fusión se llama igual que el de origen («Harina»). */
  const dbConNombreRepetido = new Proxy(baseDeTest.db, {
    get(destino, propiedad) {
      const valor = Reflect.get(destino, propiedad);
      if (propiedad !== "insumo") return valor;
      return new Proxy(valor, {
        get(insumo, metodo) {
          const original = Reflect.get(insumo, metodo);
          if (metodo !== "findFirst") return original;
          return async (args: unknown) => {
            const fila = await (original as (a: unknown) => Promise<{ nombre: string } | null>).call(insumo, args);
            return fila && { ...fila, nombre: "Harina" };
          };
        },
      });
    },
  });

  it("fusiona y la fila existe, del id que desaparece al que queda, con los nombres en la descripción", async () => {
    const r = await renombrarOFusionarInsumoCasoDeUso(
      { db: dbConNombreRepetido, transaccion: baseDeTest.transaccion, usuarioId: adminId },
      { insumoId: harinaId, nombre: "Harina premium", confirmarFusion: true },
    );
    expect(r).toMatchObject({ ok: true, mensaje: '"Harina" se fusionó con el insumo existente "Harina".' });
    expect(await prisma.insumo.findUnique({ where: { id: harinaId } })).toBeNull();
    expect(await prisma.producto.count({ where: { insumoId: premiumId } })).toBe(1);
    expect(
      await prismaAdmin.registroAuditoria.findMany({
        select: { entidad: true, entidadId: true, campo: true, descripcion: true, valorAnterior: true, valorNuevo: true, actorId: true, sucursalId: true },
      }),
    ).toEqual([
      {
        entidad: "Insumo",
        entidadId: harinaId,
        campo: "fusion",
        descripcion: 'Insumo "Harina" fusionado con "Harina" (1 producto reasignado)',
        valorAnterior: `Harina (${harinaId})`,
        valorNuevo: `Harina (${premiumId})`,
        actorId: adminId,
        sucursalId: null,
      },
    ]);
  });
});
