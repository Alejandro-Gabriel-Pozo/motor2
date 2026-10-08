import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

/**
 * Qué hace la escritura de «agregar opción» justo ANTES de insertar: un hook que corre una vez (lo arma cada test). Así se reproduce la carrera con una fila ganadora REAL: el
 * pedido ya hizo sus lecturas previas (que no vieron nada), y entre ellas y el INSERT otro admin agrupó el producto y CONFIRMÓ su escritura (cliente administrador, otra conexión).
 */
const antesDeInsertar = vi.hoisted(() => ({ hook: null as null | (() => Promise<void>) }));

vi.mock("../../src/server/persistencia/carta/items-agrupados", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server/persistencia/carta/items-agrupados")>();
  return {
    ...original,
    crearOpcionDeItemAgrupado: async (...args: Parameters<typeof original.crearOpcionDeItemAgrupado>) => {
      const hook = antesDeInsertar.hook;
      antesDeInsertar.hook = null;
      if (hook) await hook();
      return original.crearOpcionDeItemAgrupado(...args);
    },
  };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { agregarOpcionItemAgrupadoCarta } from "../../src/server/actions/carta/items-agrupados";

/**
 * O.49 (`docs/pureza-integracion.md`, Hito 5): la carrera de «agregar una opción» con una fila ganadora REAL. El test de `items-agrupados-carrera.test.ts` la simula con un
 * TRIGGER que inserta la «ganadora» DENTRO de la misma sentencia que después falla, así que esa fila se deshace con el INSERT fallido y el re-leer del mensaje no tiene nada que
 * encontrar: de ahí su texto de reserva («ya está en un ítem agrupado»). Eso es un artefacto del trigger, no un defecto de la acción. Acá la ganadora está confirmada de verdad
 * (otra conexión, antes del INSERT) y el INSERT choca con el índice único real `OpcionItemAgrupadoCarta(sucursalId, productoId)`: el perdedor tiene que leer, ya con la fila
 * confirmada, en QUÉ ítem quedó el producto.
 */
describe("agregar una opción: la carrera contra una fila ganadora real", () => {
  let sucursalId: string;
  let seccionId: string;
  let cocaId: string;

  beforeEach(async () => {
    antesDeInsertar.hook = null;
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } })).id;
    cocaId = (await sembrarProductoDisponible({ codigo: "PV_COCA", nombre: "Coca-Cola 500cc", tipo: "PV", precioVenta: 5000, unidadStockId: unidadId }, sucursalId)).id;
  });

  it("otro lo agrupó en OTRO ítem entre la lectura y el INSERT → el mensaje nombra ese ítem («quitalo de ahí primero»), no escribe nada más ni revalida", async () => {
    const mio = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Gaseosa", seccionCartaId: seccionId } });
    const delGanador = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Bebidas frías", seccionCartaId: seccionId } });
    antesDeInsertar.hook = async () => {
      await prismaAdmin.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: delGanador.id, productoId: cocaId, orden: 0 } });
    };
    expect(await agregarOpcionItemAgrupadoCarta(mio.id, cocaId)).toEqual({ ok: false, mensaje: "«Coca-Cola 500cc» ya está en «Bebidas frías»: quitalo de ahí primero." });
    expect(antesDeInsertar.hook).toBeNull(); // el hook corrió: la carrera ocurrió de verdad
    expect(await prisma.opcionItemAgrupadoCarta.findMany({ select: { itemAgrupadoCartaId: true } })).toEqual([{ itemAgrupadoCartaId: delGanador.id }]);
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
  });

  it("otro lo agrupó en el MISMO ítem entre la lectura y el INSERT → «ya está en «ese ítem»»", async () => {
    const mio = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Gaseosa", seccionCartaId: seccionId } });
    antesDeInsertar.hook = async () => {
      await prismaAdmin.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: mio.id, productoId: cocaId, orden: 0 } });
    };
    expect(await agregarOpcionItemAgrupadoCarta(mio.id, cocaId)).toEqual({ ok: false, mensaje: "«Coca-Cola 500cc» ya está en «Gaseosa»." });
    expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(1);
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
  });
});
