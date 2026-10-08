import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { agregarOpcionItemAgrupadoCarta, guardarItemAgrupadoCarta } from "../../src/server/actions/carta/items-agrupados";

/**
 * La CARRERA de los ítems agrupados (Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1), ANTES de mudarlos a casos de uso: dos pedidos a la vez pasan los dos el
 * chequeo previo y al segundo lo frena el índice único (`ItemAgrupadoCarta(sucursalId, nombre)` en el alta, `OpcionItemAgrupadoCarta(sucursalId, productoId)` al agregar
 * una opción). Ningún test pasaba por esos `catch` (la concurrencia real casi nunca los alcanza). Se simula la carrera con un trigger de la base DE PRUEBA, que antes de
 * cada INSERT de un caso puntual mete una fila ganadora con la misma clave: el INSERT de la acción choca con el índice único y llega el error de unicidad real del
 * driver, no uno inventado. Los triggers se borran siempre (también si el test falla). Verde contra el código de antes de la mudanza y después.
 */
async function limpiarTrampas() {
  await prismaAdmin.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_d9_carrera_item ON "ItemAgrupadoCarta"');
  await prismaAdmin.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_d9_carrera_opcion ON "OpcionItemAgrupadoCarta"');
  await prismaAdmin.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_d9_carrera_item()");
  await prismaAdmin.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_d9_carrera_opcion()");
}

describe("ítems agrupados: la carrera del índice único (el segundo en llegar pierde)", () => {
  let sucursalId: string;
  let seccionId: string;
  let ids: Record<string, string>;

  beforeEach(async () => {
    await limpiarTrampas();
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } })).id;
    ids = { coca: (await sembrarProductoDisponible({ codigo: "PV_COCA", nombre: "Coca-Cola 500cc", tipo: "PV", precioVenta: 5000, unidadStockId: unidadId }, sucursalId)).id };
  });
  afterEach(limpiarTrampas);

  /** Antes de insertar la fila que cumple `condicion` (SQL sobre NEW), mete otra igual con otro id: la de la acción choca con el índice único. */
  async function armarCarrera(tabla: "ItemAgrupadoCarta" | "OpcionItemAgrupadoCarta", nombre: "item" | "opcion", condicion: string) {
    await prismaAdmin.$executeRawUnsafe(`
      CREATE FUNCTION test_d9_carrera_${nombre}() RETURNS trigger AS $$
      BEGIN
        IF pg_trigger_depth() = 1 AND ${condicion} THEN
          INSERT INTO "${tabla}" SELECT * FROM jsonb_populate_record(NULL::"${tabla}", to_jsonb(NEW) || jsonb_build_object('id', 'ganador-d9'));
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prismaAdmin.$executeRawUnsafe(`CREATE TRIGGER test_d9_carrera_${nombre} BEFORE INSERT ON "${tabla}" FOR EACH ROW EXECUTE FUNCTION test_d9_carrera_${nombre}()`);
  }

  it("alta: otro tomó el nombre entre el chequeo y la escritura → «Ya existe el ítem agrupado», no crea nada y no revalida", async () => {
    await armarCarrera("ItemAgrupadoCarta", "item", `NEW."nombre" = 'Carrera'`);
    expect(await guardarItemAgrupadoCarta({ nombre: "Carrera", seccionCartaId: seccionId })).toEqual({ ok: false, mensaje: 'Ya existe el ítem agrupado "Carrera".' });
    expect(await prisma.itemAgrupadoCarta.count()).toBe(0);
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
    // Otro nombre no pasa por la trampa: el alta sigue andando.
    expect((await guardarItemAgrupadoCarta({ nombre: "Otro", seccionCartaId: seccionId })).ok).toBe(true);
  });

  it("agregar una opción: otro agrupó el producto entre el chequeo y la escritura → «ya está en un ítem agrupado» (el re-leer no ve al ganador: su fila se deshizo con el INSERT fallido), no deja nada escrito ni revalida", async () => {
    const agrupado = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Gaseosa", seccionCartaId: seccionId } });
    await armarCarrera("OpcionItemAgrupadoCarta", "opcion", `NEW."productoId" = '${ids.coca}'`);
    expect(await agregarOpcionItemAgrupadoCarta(agrupado.id, ids.coca)).toEqual({ ok: false, mensaje: "«Coca-Cola 500cc» ya está en un ítem agrupado." });
    expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(0);
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
  });
});
