import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { copiarCartaDeSucursal } from "../../src/server/actions/carta/copiar-carta";

/**
 * Los textos EXACTOS de `copiarCartaDeSucursal`, el ORDEN de sus chequeos (confirmación, misma sucursal y origen inexistente ANTES de la transacción; carta propia
 * del destino antes que «el origen no tiene nada»), la fila de auditoría exacta, CUÁNDO invalida la carta pública y el camino del conflicto de escritura (reintento y
 * `.catch` de agotado) (Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1), ANTES de mudarla a un caso de uso. `carta-propia-por-sucursal.test.ts` cubre qué se copia y
 * a dónde, pero no los textos exactos de cada rechazo, ni la auditoría, ni cuántas veces se revalida, ni el conflicto. El conflicto se simula con un trigger de la base DE
 * PRUEBA que tira un fallo de serialización (40001) las primeras N veces que se inserta un género (la cuenta la lleva una secuencia, que NO se deshace con la transacción).
 * Verde contra el código de antes de la mudanza y después.
 */
async function limpiarTrampas() {
  await prismaAdmin.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_d13_conflicto ON "GeneroCarta"');
  await prismaAdmin.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_d13_conflicto()");
  await prismaAdmin.$executeRawUnsafe("DROP SEQUENCE IF EXISTS test_d13_intentos");
}

describe("copiar la carta de otra sucursal: mensajes, orden de los chequeos, auditoría, revalidación y conflicto", () => {
  let centralId: string;
  let destinoId: string;
  let adminId: string;
  let seccionId: string;
  let ids: { pizza: string; coca: string };

  beforeEach(async () => {
    await limpiarTrampas();
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    destinoId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: destinoId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
    const pv = async (codigo: string, nombre: string) => {
      const p = await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", precioVenta: 1000, unidadStockId: unidadId }, centralId);
      await prisma.disponibilidadProducto.create({ data: { sucursalId: destinoId, productoId: p.id, disponible: true } });
      return p.id;
    };
    ids = { pizza: await pv("PV_PIZZA", "Pizza"), coca: await pv("PV_COCA", "Coca") };
  });
  afterEach(limpiarTrampas);

  const revalidaciones = () => {
    const n = vi.mocked(revalidarCartasPublicas).mock.calls.length;
    vi.mocked(revalidarCartasPublicas).mockClear();
    return n;
  };

  /** La carta de Central: un género, un ítem agrupado con una opción y un contenido. */
  async function armarCartaDeCentral() {
    const genero = await prisma.generoCarta.create({ data: { sucursalId: centralId, nombre: "Cervezas", orden: 2 } });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: centralId, nombre: "Gaseosas", seccionCartaId: seccionId, generoCartaId: genero.id } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: centralId, itemAgrupadoCartaId: item.id, productoId: ids.coca, orden: 0 } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: centralId, productoId: ids.pizza, visibleEnCarta: true, seccionCartaId: seccionId } });
  }

  const cartaDe = async (sucursalId: string) => ({
    generos: await prisma.generoCarta.count({ where: { sucursalId } }),
    items: await prisma.itemAgrupadoCarta.count({ where: { sucursalId } }),
    opciones: await prisma.opcionItemAgrupadoCarta.count({ where: { sucursalId } }),
    contenidos: await prisma.contenidoCartaProducto.count({ where: { sucursalId } }),
    auditoria: await prisma.registroAuditoria.count({ where: { entidad: "CartaSucursal" } }),
  });

  it("el orden de los chequeos previos: la confirmación gana sobre «la misma sucursal» y esta sobre «no se encontró»; ninguno revalida ni escribe", async () => {
    await armarCartaDeCentral();
    expect(await copiarCartaDeSucursal(destinoId, false)).toEqual({ ok: false, mensaje: "Confirmá que querés copiar la carta de otra sucursal a esta." });
    expect(await copiarCartaDeSucursal("cnoexiste000000000000000", false)).toEqual({ ok: false, mensaje: "Confirmá que querés copiar la carta de otra sucursal a esta." });
    expect(await copiarCartaDeSucursal(destinoId, true)).toEqual({ ok: false, mensaje: "Elegí otra sucursal: no se puede copiar de la misma." });
    expect(await copiarCartaDeSucursal("cnoexiste000000000000000", true)).toEqual({ ok: false, mensaje: "No se encontró esa sucursal." });
    expect(revalidaciones()).toBe(0);
    expect(await cartaDe(destinoId)).toEqual({ generos: 0, items: 0, opciones: 0, contenidos: 0, auditoria: 0 });
  });

  it("dentro de la transacción: «el destino ya tiene carta» gana sobre «el origen no tiene nada»; ninguno revalida ni audita", async () => {
    await prisma.generoCarta.create({ data: { sucursalId: destinoId, nombre: "Propio" } });
    expect(await copiarCartaDeSucursal(centralId, true)).toEqual({ ok: false, mensaje: "Esta sucursal ya tiene carta propia: solo se puede copiar sobre una carta vacía." });
    await prisma.generoCarta.deleteMany({ where: { sucursalId: destinoId } });
    expect(await copiarCartaDeSucursal(centralId, true)).toEqual({ ok: false, mensaje: "«Central» no tiene carta propia: no hay nada que copiar." });
    expect(revalidaciones()).toBe(0);
    expect(await cartaDe(destinoId)).toEqual({ generos: 0, items: 0, opciones: 0, contenidos: 0, auditoria: 0 });
  });

  it("el éxito: texto con las tres cuentas, UNA fila de auditoría exacta y UNA revalidación", async () => {
    await armarCartaDeCentral();
    expect(await copiarCartaDeSucursal(centralId, true)).toEqual({
      ok: true,
      mensaje: "Se copió la carta de «Central» a «Sucursal B»: 1 productos, 1 ítems agrupados y 1 géneros.",
    });
    expect(revalidaciones()).toBe(1);
    expect(await cartaDe(destinoId)).toEqual({ generos: 1, items: 1, opciones: 1, contenidos: 1, auditoria: 1 });
    const fila = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "CartaSucursal" } });
    expect(fila).toMatchObject({
      entidad: "CartaSucursal",
      entidadId: destinoId,
      campo: "cartaPropia",
      descripcion: "Carta de «Sucursal B»: copiada de «Central» (1 productos, 1 ítems agrupados, 1 géneros)",
      valorAnterior: null,
      valorNuevo: "copiada de Central",
      sucursalId: destinoId,
    });
    expect(fila.actorId).toBe(adminId);
  });

  it("un fallo de serialización se REINTENTA y la copia entra una sola vez: UNA fila de auditoría y UNA revalidación", async () => {
    await armarCartaDeCentral();
    await armarTrampa(1);
    expect((await copiarCartaDeSucursal(centralId, true)).ok).toBe(true);
    expect(await invocaciones()).toBe(2);
    expect(await cartaDe(destinoId)).toEqual({ generos: 1, items: 1, opciones: 1, contenidos: 1, auditoria: 1 });
    expect(revalidaciones()).toBe(1);
  });

  it("si el conflicto no cede en 5 intentos, responde «La carta cambió mientras la copiabas…» sin dejar nada escrito ni auditado ni revalidado", async () => {
    await armarCartaDeCentral();
    await armarTrampa(99);
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await copiarCartaDeSucursal(centralId, true)).toEqual({ ok: false, mensaje: "La carta cambió mientras la copiabas; recargá e intentá de nuevo." });
    } finally {
      consola.mockRestore();
    }
    expect(await invocaciones()).toBe(5);
    expect(await cartaDe(destinoId)).toEqual({ generos: 0, items: 0, opciones: 0, contenidos: 0, auditoria: 0 });
    expect(revalidaciones()).toBe(0);
  });

  async function armarTrampa(hasta: number) {
    await prismaAdmin.$executeRawUnsafe("CREATE SEQUENCE test_d13_intentos");
    await prismaAdmin.$executeRawUnsafe(`
      CREATE FUNCTION test_d13_conflicto() RETURNS trigger AS $$
      BEGIN
        IF NEW."sucursalId" = '${destinoId}' AND nextval('test_d13_intentos') <= ${hasta} THEN
          RAISE EXCEPTION 'trampa del conflicto' USING ERRCODE = '40001';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prismaAdmin.$executeRawUnsafe('CREATE TRIGGER test_d13_conflicto BEFORE INSERT ON "GeneroCarta" FOR EACH ROW EXECUTE FUNCTION test_d13_conflicto()');
  }
  const invocaciones = async () => Number((await prismaAdmin.$queryRawUnsafe<{ last_value: bigint }[]>("SELECT last_value FROM test_d13_intentos"))[0].last_value);
});
