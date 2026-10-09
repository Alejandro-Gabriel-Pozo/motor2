import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

/**
 * Qué error tira la escritura simulada (o ninguno). Con el adaptador `pg` de Prisma 7 el mismo choque de índice único puede llegar como `P2002` o como el `DriverAdapterError`
 * CRUDO (`cause.kind === "UniqueConstraintViolation"`): la forma que reconoce `core/datos/errores-de-base` (Pureza 1.6/1.7). Mismo patrón que `test/pos/choque-de-unicidad-del-driver.test.ts`.
 */
const falla = vi.hoisted(() => ({ kind: null as string | null }));
const errorDelDriver = (kind: string) => Object.assign(new Error("driver"), { name: "DriverAdapterError", cause: { kind } });

vi.mock("../../src/server/persistencia/carta/items-agrupados", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server/persistencia/carta/items-agrupados")>();
  return {
    ...original,
    crearItemAgrupadoDeCarta: (...args: Parameters<typeof original.crearItemAgrupadoDeCarta>) => {
      if (falla.kind) throw errorDelDriver(falla.kind);
      return original.crearItemAgrupadoDeCarta(...args);
    },
    crearOpcionDeItemAgrupado: (...args: Parameters<typeof original.crearOpcionDeItemAgrupado>) => {
      if (falla.kind) throw errorDelDriver(falla.kind);
      return original.crearOpcionDeItemAgrupado(...args);
    },
  };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { agregarOpcionItemAgrupadoCarta, guardarItemAgrupadoCarta } from "../../src/server/actions/carta/items-agrupados";

/**
 * O.48 (`docs/pureza-integracion.md`, Hito 5): el alta de un ítem agrupado y «agregar opción» reconocían el choque del índice único con `esErrorDeUnicidad`, que solo veía `P2002`.
 * Un choque que llegaba con la forma cruda del driver no se traducía al mensaje amable: la acción lanzaba. Ahora `esErrorDeUnicidad` usa la misma clasificación que
 * `esChoqueDeIndiceUnico`. Otro error del driver NO se disfraza de choque: sigue lanzando.
 */
describe("ítems agrupados: el choque de unicidad con la forma del driver (DriverAdapterError)", () => {
  let sucursalId: string;
  let seccionId: string;
  let cocaId: string;

  beforeEach(async () => {
    falla.kind = null;
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

  it("alta: «Ya existe el ítem agrupado», no crea nada y no revalida", async () => {
    falla.kind = "UniqueConstraintViolation";
    expect(await guardarItemAgrupadoCarta({ nombre: "Carrera", seccionCartaId: seccionId })).toEqual({ ok: false, mensaje: 'Ya existe el ítem agrupado "Carrera".' });
    expect(await prisma.itemAgrupadoCarta.count()).toBe(0);
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
  });

  it("agregar opción: «ya está en un ítem agrupado» (no hay fila ganadora que releer: texto de reserva), no escribe ni revalida", async () => {
    const agrupado = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Gaseosa", seccionCartaId: seccionId } });
    falla.kind = "UniqueConstraintViolation";
    expect(await agregarOpcionItemAgrupadoCarta(agrupado.id, cocaId)).toEqual({ ok: false, mensaje: "«Coca-Cola 500cc» ya está en un ítem agrupado." });
    expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(0);
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
  });

  it("otro error del driver no se toma por un choque: las dos siguen lanzando", async () => {
    const agrupado = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Gaseosa", seccionCartaId: seccionId } });
    falla.kind = "ConnectionClosed";
    await expect(guardarItemAgrupadoCarta({ nombre: "Otro", seccionCartaId: seccionId })).rejects.toThrow("driver");
    await expect(agregarOpcionItemAgrupadoCarta(agrupado.id, cocaId)).rejects.toThrow("driver");
  });
});
