import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularStockPorFamilia } from "../../src/server/consultas/stock/por-familia";
import type { Db } from "../../src/lib/db-tipos";

/**
 * Pureza Fase 3 — stock por familia. La cadena del grupo (`Bebidas > Gaseosas`) se arma sobre el árbol de grupos leído UNA vez, no con una consulta por
 * grupo y por nivel (antes: un `findFirst` por grupo y un `findUnique` por cada nivel de su cadena). El resultado no cambia.
 */
describe("calcularStockPorFamilia: la cadena de grupos sale de una sola lectura", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    unidadKgId = (await sembrarCatalogoBase()).kg.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  async function insumoConStock(nombre: string, grupoId: string | null, codigo: string) {
    const insumo = await prisma.insumo.create({ data: { nombre, grupoId } });
    const p = await sembrarProductoDisponible({ codigo, nombre: `${nombre} (MP)`, tipo: "MP", unidadStockId: unidadKgId, insumoId: insumo.id }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: p.id, cantidad: 3 }] });
    return insumo;
  }

  it("arma las cadenas de tres niveles, de un nivel y sin grupo, y lo hace con UNA operación sobre grupo", async () => {
    const raiz = await prisma.grupo.create({ data: { nombre: "Bebidas" } });
    const medio = await prisma.grupo.create({ data: { nombre: "Sin alcohol", grupoPadreId: raiz.id } });
    const hoja = await prisma.grupo.create({ data: { nombre: "Gaseosas", grupoPadreId: medio.id } });
    const otraRaiz = await prisma.grupo.create({ data: { nombre: "Secos" } });
    await insumoConStock("Insumo Cola", hoja.id, "MP_COLA");
    await insumoConStock("Insumo Agua", medio.id, "MP_AGUA");
    await insumoConStock("Insumo Harina", otraRaiz.id, "MP_HARINA");
    await insumoConStock("Insumo Sal", null, "MP_SAL");

    const operaciones: string[] = [];
    const dbContado = prisma.$extends({
      query: {
        grupo: {
          $allOperations({ operation, args, query }) {
            operaciones.push(operation);
            return query(args);
          },
        },
      },
    }) as unknown as Db;

    const filas = await calcularStockPorFamilia(sucursalId, dbContado);

    expect(filas.map((f) => [f.insumoNombre, f.grupoCadena])).toEqual([
      ["Insumo Agua", "Bebidas > Sin alcohol"],
      ["Insumo Cola", "Bebidas > Sin alcohol > Gaseosas"],
      ["Insumo Harina", "Secos"],
      ["Insumo Sal", ""],
    ]);
    expect(operaciones, "la cadena de grupos tiene que salir de UNA lectura del árbol").toEqual(["findMany"]);
  });
});
