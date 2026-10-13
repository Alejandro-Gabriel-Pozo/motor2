import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Proceso } from "@prisma/client";
import { limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";

/**
 * M2-2 (Paquete 2): el origen de una devolución a proveedor, `MovimientoStock.devuelveAMovimientoId` (migración 20261015121000_m2_movimiento_devuelve_a). Dos mitades: (1) la migración deja la columna,
 * el índice, la clave foránea y el CHECK puestos y validados; (2) cada regla rechaza, con el nombre de su restricción, una fila que la rompe, y el uso normal (una compra devuelta en varias partes)
 * sigue escribiendo. NO es única a propósito: el tope de lo devuelto lo controla la aplicación (Etapa C).
 *
 * La fila inválida del CHECK se arma con un UPDATE crudo del dueño sobre una fila válida para que el mensaje sea el de Postgres. Mutación: sacar el CHECK de la migración deja en rojo solo su caso.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261015121000_m2_movimiento_devuelve_a");
const CHECK = "MovimientoStock_devuelve_solo_devolucion_proveedor_chk";
const FOREIGN_KEY = "MovimientoStock_empresaId_devuelveAMovimientoId_fkey";
const INDICE = "MovimientoStock_devuelveAMovimientoId_idx";

let usuarioId: string;
let sucursalId: string;
let productoId: string;
let seccionId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  sucursalId = base.sucursal.id;
  usuarioId = (await prisma.user.create({ data: { email: "operador@test.com" } })).id;
  const unidad = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
  const insumo = await prisma.insumo.create({ data: { nombre: "Harina" } });
  productoId = (await prisma.producto.create({ data: { codigo: "MP_A", nombre: "MP_A", tipo: "MP", unidadStockId: unidad.id, insumoId: insumo.id } })).id;
  seccionId = (await prisma.seccion.create({ data: { sucursalId, nombre: "Depósito" } })).id;
});

/** Una línea de Kardex por el rol de ejecución (el camino real de la app), en una operación nueva del mismo proceso. */
async function linea(proceso: Proceso, cantidad: number, devuelveAMovimientoId?: string) {
  const operacion = await prisma.operacion.create({ data: { sucursalId, fecha: new Date(), usuarioId, proceso } });
  return prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId, seccionId, proceso, cantidad, detalle: proceso, precioTotal: 0, precioPorUnidadStock: 0, ...(devuelveAMovimientoId ? { devuelveAMovimientoId } : {}) },
  });
}

describe("la migración deja la columna, el índice, la clave foránea y la regla puestos y validados", () => {
  it("la columna es NULLABLE y sin valor por defecto, con su índice (no único), su clave foránea compuesta RESTRICT y el CHECK validado", async () => {
    const columna = await prismaAdmin.$queryRaw<Array<{ is_nullable: string; column_default: string | null }>>`
      SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'MovimientoStock' AND column_name = 'devuelveAMovimientoId'`;
    expect(columna).toEqual([{ is_nullable: "YES", column_default: null }]);

    const indice = await prismaAdmin.$queryRaw<Array<{ indisunique: boolean; definicion: string }>>`
      SELECT i.indisunique, pg_get_indexdef(i.indexrelid) AS definicion FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname::text = ${INDICE}`;
    expect(indice).toHaveLength(1);
    expect(indice[0]!.indisunique, "no es única: una compra se devuelve en varias partes").toBe(false);
    expect(indice[0]!.definicion).toMatch(/\("devuelveAMovimientoId"\)/);

    const fk = await prismaAdmin.$queryRaw<Array<{ definicion: string }>>`SELECT pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE contype = 'f' AND conname::text = ${FOREIGN_KEY}`;
    expect(fk).toHaveLength(1);
    expect(fk[0]!.definicion).toMatch(/FOREIGN KEY \("empresaId", "devuelveAMovimientoId"\) REFERENCES "MovimientoStock"\("empresaId", id\) ON UPDATE CASCADE ON DELETE RESTRICT/);

    const check = await prismaAdmin.$queryRaw<Array<{ convalidated: boolean }>>`SELECT convalidated FROM pg_constraint WHERE contype = 'c' AND conname::text = ${CHECK}`;
    expect(check).toEqual([{ convalidated: true }]);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización y que la reversa pierde el origen", () => {
    expect(readFileSync(join(CARPETA, "migration.sql"), "utf8").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(reversa).toMatch(/DESTRUCTIVA/);
    for (const nombre of [CHECK, FOREIGN_KEY, INDICE, "devuelveAMovimientoId"]) expect(reversa, `el down.sql saca ${nombre}`).toContain(nombre);
  });
});

describe("devuelveAMovimientoId: el origen de una devolución a proveedor", () => {
  it("una DEVOLUCION_PROVEEDOR apunta a la línea de compra que devuelve, y una línea sin origen queda con NULL", async () => {
    const compra = await linea("COMPRA", 10);
    const devolucion = await linea("DEVOLUCION_PROVEEDOR", -4, compra.id);
    expect(devolucion.devuelveAMovimientoId).toBe(compra.id);
    expect(compra.devuelveAMovimientoId).toBeNull();
    const conDevoluciones = await prisma.movimientoStock.findUniqueOrThrow({ where: { id: compra.id }, include: { devoluciones: true } });
    expect(conDevoluciones.devoluciones.map((d) => d.id)).toEqual([devolucion.id]);
    // Una devolución sin origen declarado (todas las anteriores a M2) sigue entrando.
    await linea("DEVOLUCION_PROVEEDOR", -1);
  });

  it("una compra puede devolverse en varias partes (la columna no es única)", async () => {
    const compra = await linea("COMPRA", 10);
    await linea("DEVOLUCION_PROVEEDOR", -3, compra.id);
    await linea("DEVOLUCION_PROVEEDOR", -3, compra.id);
    await linea("DEVOLUCION_PROVEEDOR", -4, compra.id);
    expect(await prismaAdmin.movimientoStock.count({ where: { devuelveAMovimientoId: compra.id } })).toBe(3);
  });

  it("solo una DEVOLUCION_PROVEEDOR lleva origen: cualquier otro proceso se rechaza", async () => {
    const compra = await linea("COMPRA", 10);
    for (const [proceso, cantidad] of [["COMPRA", 1], ["AJUSTE", -1], ["VENTA", -1], ["MERMA", -1], ["DEVOLUCION_CONSIGNACION", -1]] as const) {
      const otra = await linea(proceso, cantidad);
      await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "MovimientoStock" SET "devuelveAMovimientoId" = '${compra.id}' WHERE id = '${otra.id}'`), proceso).rejects.toThrow(new RegExp(CHECK));
    }
    await expect(linea("COMPRA", 1, compra.id)).rejects.toThrow(new RegExp(CHECK));
  });

  it("una línea no se devuelve a sí misma", async () => {
    const devolucion = await linea("DEVOLUCION_PROVEEDOR", -1);
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "MovimientoStock" SET "devuelveAMovimientoId" = id WHERE id = '${devolucion.id}'`)).rejects.toThrow(new RegExp(CHECK));
  });

  it("apuntar a una línea que no existe se rechaza (clave foránea)", async () => {
    await expect(linea("DEVOLUCION_PROVEEDOR", -1, "no-existe")).rejects.toThrow(new RegExp(FOREIGN_KEY));
  });

  it("aislamiento entre empresas: una devolución de la empresa A no puede apuntar a una línea de la empresa B (la clave foránea es (empresaId, id))", async () => {
    // Una compra REAL de la empresa testigo, armada con su propio cliente (su catálogo, su sucursal, su sección).
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const unidad = await testigo.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    const insumo = await testigo.insumo.create({ data: { nombre: "Harina" } });
    const producto = await testigo.producto.create({ data: { codigo: "MP_T", nombre: "MP_T", tipo: "MP", unidadStockId: unidad.id, insumoId: insumo.id } });
    const sucursal = await testigo.sucursal.create({ data: { nombre: "Testigo" } });
    const seccion = await testigo.seccion.create({ data: { sucursalId: sucursal.id, nombre: "Depósito" } });
    const operacion = await testigo.operacion.create({ data: { sucursalId: sucursal.id, fecha: new Date(), usuarioId, proceso: "COMPRA" } });
    const compraAjena = await testigo.movimientoStock.create({
      data: { operacionId: operacion.id, productoId: producto.id, seccionId: seccion.id, proceso: "COMPRA", cantidad: 5, detalle: "COMPRA", precioTotal: 0, precioPorUnidadStock: 0 },
    });
    expect(compraAjena.empresaId).toBe(EMPRESA_TESTIGO_ID);
    await expect(linea("DEVOLUCION_PROVEEDOR", -1, compraAjena.id)).rejects.toThrow(new RegExp(FOREIGN_KEY));
    // La misma referencia dentro de la propia empresa sí vale: el rechazo es por empresa, no por la línea.
    const propia = await linea("COMPRA", 5);
    await linea("DEVOLUCION_PROVEEDOR", -1, propia.id);
  });

  it("la línea de compra no se puede borrar mientras tenga devoluciones (RESTRICT): el Kardex se corrige con filas nuevas", async () => {
    const compra = await linea("COMPRA", 10);
    await linea("DEVOLUCION_PROVEEDOR", -4, compra.id);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "MovimientoStock" WHERE id = '${compra.id}'`)).rejects.toThrow(new RegExp(FOREIGN_KEY));
  });
});
