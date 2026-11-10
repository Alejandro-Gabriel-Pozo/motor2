import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { DATOS_EMPRESA_TESTIGO, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { copiarCartaDeSucursal, reemplazarCartaDeSucursal } from "../../src/server/actions/carta/copiar-carta";

/**
 * «Reemplazar con la carta de otra sucursal» (2026-11-10; `docs/diseno-reemplazar-carta-de-sucursal-2026-11-10.md`), contra Postgres real: el reemplazo correcto (y lo que NO se toca), la auditoría con la foto
 * de lo eliminado, el destino vacío (igual que copiar), el origen sin carta, el mismo pedido repetido, dos reemplazos a la vez, el fallo a mitad (todo o nada), el origen de otra empresa y sin acceso, y el nombre
 * escrito. Que la copia sobre carta vacía NO cambió lo cubren `copiar-carta-mensajes.test.ts` y `carta-propia-por-sucursal.test.ts` (siguen verdes sin tocarlos).
 */
async function limpiarTrampas() {
  await prismaAdmin.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_reemplazo_falla ON "ContenidoCartaProducto"');
  await prismaAdmin.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_reemplazo_falla()");
}

describe("reemplazar la carta con la de otra sucursal", () => {
  let centralId: string;
  let destinoId: string;
  let adminId: string;
  let seccionId: string;
  let baseAdminId: string;
  let ids: { pizza: string; coca: string; bife: string; jugo: string };

  beforeEach(async () => {
    await limpiarTrampas();
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    baseAdminId = base.admin.id;
    centralId = base.sucursal.id;
    destinoId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: destinoId, rolId: base.admin.id });
    adminId = admin.id;
    await crearMembresia({ usuarioId: admin.id, sucursalId: centralId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
    const pv = async (codigo: string, nombre: string) => {
      const p = await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", precioVenta: 1000, unidadStockId: unidadId }, centralId);
      await prisma.disponibilidadProducto.create({ data: { sucursalId: destinoId, productoId: p.id, disponible: true } });
      return p.id;
    };
    ids = { pizza: await pv("PV_PIZZA", "Pizza"), coca: await pv("PV_COCA", "Coca"), bife: await pv("PV_BIFE", "Bife"), jugo: await pv("PV_JUGO", "Jugo Fresli") };
  });
  afterEach(limpiarTrampas);

  /** Carta de Central: género «Cervezas», ítem «Gaseosas» (opción Coca, con el género) y la Pizza con descripción. */
  async function armarCartaDeCentral() {
    const genero = await prisma.generoCarta.create({ data: { sucursalId: centralId, nombre: "Cervezas", orden: 2 } });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: centralId, nombre: "Gaseosas", seccionCartaId: seccionId, generoCartaId: genero.id, orden: 3 } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: centralId, itemAgrupadoCartaId: item.id, productoId: ids.coca, orden: 0 } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: centralId, productoId: ids.pizza, visibleEnCarta: true, seccionCartaId: seccionId, descripcion: "De Central", generoCartaId: genero.id, orden: 5, nombreEnCarta: "Pizza grande" } });
  }

  /** Carta PROPIA del destino, distinta a propósito: otro género, otro ítem agrupado y otros productos (el Bife y el Jugo). */
  async function armarCartaPropiaDelDestino() {
    const genero = await prisma.generoCarta.create({ data: { sucursalId: destinoId, nombre: "Del destino", orden: 1 } });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: destinoId, nombre: "Jugos", seccionCartaId: seccionId, generoCartaId: genero.id } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: destinoId, itemAgrupadoCartaId: item.id, productoId: ids.jugo, orden: 0 } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: destinoId, productoId: ids.bife, visibleEnCarta: true, seccionCartaId: seccionId, descripcion: "Del destino" } });
  }

  const cartaDe = async (sucursalId: string) => ({
    generos: (await prisma.generoCarta.findMany({ where: { sucursalId }, orderBy: { nombre: "asc" } })).map((g) => ({ id: g.id, nombre: g.nombre, orden: g.orden })),
    items: (await prisma.itemAgrupadoCarta.findMany({ where: { sucursalId }, include: { opciones: true }, orderBy: { nombre: "asc" } })).map((i) => ({ id: i.id, nombre: i.nombre, orden: i.orden, genero: i.generoCartaId, opciones: i.opciones.map((o) => o.productoId) })),
    contenidos: (await prisma.contenidoCartaProducto.findMany({ where: { sucursalId }, orderBy: { productoId: "asc" } })).map((c) => ({ id: c.id, productoId: c.productoId, descripcion: c.descripcion, genero: c.generoCartaId, orden: c.orden, nombreEnCarta: c.nombreEnCarta })),
  });
  const auditoria = () => prisma.registroAuditoria.findMany({ where: { entidad: "CartaSucursal" }, orderBy: { creadoEn: "asc" } });
  const revalidaciones = () => vi.mocked(revalidarCartasPublicas).mock.calls.length;

  it("reemplaza la carta del destino con la del origen: lo que tenía de más desaparece y el género se reapunta", async () => {
    await armarCartaDeCentral();
    await armarCartaPropiaDelDestino();
    const origenAntes = await cartaDe(centralId);

    const r = await reemplazarCartaDeSucursal(centralId, "Sucursal B");
    expect(r).toEqual({
      ok: true,
      mensaje: "Se reemplazó la carta de «Sucursal B» con la de «Central»: se eliminaron 1 productos, 1 ítems agrupados y 1 géneros; se copiaron 1 productos, 1 ítems agrupados y 1 géneros.",
    });
    const d = await cartaDe(destinoId);
    expect(d.generos.map((g) => [g.nombre, g.orden])).toEqual([["Cervezas", 2]]);
    expect(d.items.map((i) => [i.nombre, i.orden, i.opciones])).toEqual([["Gaseosas", 3, [ids.coca]]]);
    expect(d.items[0].genero).toBe(d.generos[0].id);
    expect(d.contenidos.map((c) => [c.productoId, c.descripcion, c.orden, c.nombreEnCarta])).toEqual([[ids.pizza, "De Central", 5, "Pizza grande"]]);
    expect(d.contenidos[0].genero).toBe(d.generos[0].id);
    // El Bife y el Jugo del destino salieron de la carta del destino.
    expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId: destinoId, productoId: ids.bife } })).toBe(0);
    expect(await prisma.opcionItemAgrupadoCarta.count({ where: { sucursalId: destinoId, productoId: ids.jugo } })).toBe(0);
    // El origen quedó igual (mismas filas, mismos ids).
    expect(await cartaDe(centralId)).toEqual(origenAntes);
    expect(revalidaciones()).toBe(1);
  });

  it("NO toca promos, cupos, secciones, disponibilidad, precios ni productos", async () => {
    await armarCartaDeCentral();
    await armarCartaPropiaDelDestino();
    const promo = await prisma.promoCarta.create({ data: { seccionCartaId: seccionId, titulo: "Promo del día", precio: 5000 } });
    await prisma.promoCartaSucursal.create({ data: { promoCartaId: promo.id, sucursalId: destinoId, activa: true, precioLocal: 4000 } });
    await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, seccionCartaId: seccionId, cantidadMinima: 1, cantidadMaxima: 2 } });
    const foto = async () => ({
      seccion: await prisma.seccionCarta.findMany({ orderBy: { id: "asc" } }),
      promos: await prisma.promoCarta.findMany({ orderBy: { id: "asc" } }),
      promoSucursal: await prisma.promoCartaSucursal.findMany({ orderBy: { id: "asc" } }),
      cupos: await prisma.promoCartaCupo.findMany({ orderBy: { id: "asc" } }),
      disponibilidad: await prisma.disponibilidadProducto.findMany({ orderBy: { id: "asc" } }),
      productos: await prisma.producto.findMany({ orderBy: { id: "asc" } }),
    });
    const antes = await foto();
    expect((await reemplazarCartaDeSucursal(centralId, "Sucursal B")).ok).toBe(true);
    expect(await foto()).toEqual(antes);
  });

  it("la auditoría guarda quién, cuándo, el origen, las cuentas y la FOTO de lo eliminado (con el nombre de cada producto)", async () => {
    await armarCartaDeCentral();
    await armarCartaPropiaDelDestino();
    await reemplazarCartaDeSucursal(centralId, "sucursal b ");
    const filas = await auditoria();
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(fila).toMatchObject({
      entidad: "CartaSucursal",
      entidadId: destinoId,
      campo: "cartaPropia",
      descripcion: "Carta de «Sucursal B»: reemplazada con la de «Central» (eliminó 1 productos, 1 ítems agrupados, 1 géneros; copió 1 productos, 1 ítems agrupados, 1 géneros)",
      valorNuevo: `reemplazada con la de Central (sucursal ${centralId})`,
      sucursalId: destinoId,
    });
    expect(fila.actorId).toBe(adminId);
    const foto = JSON.parse(fila.valorAnterior ?? "null") as { generos: { nombre: string }[]; itemsAgrupados: { nombre: string; genero: string; opciones: { producto: string }[] }[]; productos: { producto: string; descripcion: string }[] };
    expect(foto.generos.map((g) => g.nombre)).toEqual(["Del destino"]);
    expect(foto.itemsAgrupados.map((i) => [i.nombre, i.genero, i.opciones.map((o) => o.producto)])).toEqual([["Jugos", "Del destino", ["Jugo Fresli"]]]);
    expect(foto.productos.map((p) => [p.producto, p.descripcion])).toEqual([["Bife", "Del destino"]]);
  });

  it("sobre una carta VACÍA se comporta como copiar: no elimina nada y la auditoría no tiene «valor anterior»", async () => {
    await armarCartaDeCentral();
    const r = await reemplazarCartaDeSucursal(centralId, "Sucursal B");
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain("se eliminaron 0 productos, 0 ítems agrupados y 0 géneros; se copiaron 1 productos, 1 ítems agrupados y 1 géneros");
    expect((await cartaDe(destinoId)).contenidos).toHaveLength(1);
    expect((await auditoria())[0].valorAnterior).toBeNull();
  });

  it("un origen SIN carta propia rechaza sin tocar nada del destino", async () => {
    await armarCartaPropiaDelDestino();
    const antes = await cartaDe(destinoId);
    expect(await reemplazarCartaDeSucursal(centralId, "Sucursal B")).toEqual({ ok: false, mensaje: "«Central» no tiene carta propia: no hay nada que copiar." });
    expect(await cartaDe(destinoId)).toEqual(antes);
    expect(await auditoria()).toHaveLength(0);
    expect(revalidaciones()).toBe(0);
  });

  it("IDEMPOTENCIA: repetir el mismo pedido con el origen sin cambios no escribe, no audita ni revalida", async () => {
    await armarCartaDeCentral();
    await armarCartaPropiaDelDestino();
    expect((await reemplazarCartaDeSucursal(centralId, "Sucursal B")).ok).toBe(true);
    const despues = await cartaDe(destinoId);
    vi.mocked(revalidarCartasPublicas).mockClear();

    const otra = await reemplazarCartaDeSucursal(centralId, "Sucursal B");
    expect(otra).toEqual({ ok: true, mensaje: "La carta de «Sucursal B» ya era igual a la de «Central»: no hay nada que reemplazar." });
    expect(await cartaDe(destinoId)).toEqual(despues); // mismos ids: no se borró ni se volvió a insertar
    expect(await auditoria()).toHaveLength(1);
    expect(revalidaciones()).toBe(0);
  });

  it("si el origen CAMBIÓ entre dos pedidos, el segundo vuelve a reemplazar (y audita otra vez)", async () => {
    await armarCartaDeCentral();
    await reemplazarCartaDeSucursal(centralId, "Sucursal B");
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: centralId, productoId: ids.bife, visibleEnCarta: true, seccionCartaId: seccionId } });
    const r = await reemplazarCartaDeSucursal(centralId, "Sucursal B");
    expect(r.ok).toBe(true);
    expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId: destinoId } })).toBe(2);
    expect(await auditoria()).toHaveLength(2);
  });

  it("CONCURRENCIA: dos reemplazos a la vez no duplican ni mezclan (queda la carta del origen, auditada una sola vez)", async () => {
    await armarCartaDeCentral();
    await armarCartaPropiaDelDestino();
    const resultados = await Promise.all([reemplazarCartaDeSucursal(centralId, "Sucursal B"), reemplazarCartaDeSucursal(centralId, "Sucursal B")]);
    expect(resultados.map((r) => r.ok)).toEqual([true, true]);
    const d = await cartaDe(destinoId);
    expect(d.generos.map((g) => g.nombre)).toEqual(["Cervezas"]);
    expect(d.items.map((i) => i.nombre)).toEqual(["Gaseosas"]);
    expect(d.contenidos.map((c) => c.productoId)).toEqual([ids.pizza]);
    expect(await prisma.opcionItemAgrupadoCarta.count({ where: { sucursalId: destinoId } })).toBe(1);
    expect(await auditoria()).toHaveLength(1);
  });

  it("ATOMICIDAD: si la copia falla a mitad, el borrado se deshace y la auditoría no queda", async () => {
    await armarCartaDeCentral();
    await armarCartaPropiaDelDestino();
    const antes = await cartaDe(destinoId);
    await prismaAdmin.$executeRawUnsafe(`CREATE FUNCTION test_reemplazo_falla() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falla de prueba' USING ERRCODE = 'P0001'; END; $$ LANGUAGE plpgsql`);
    await prismaAdmin.$executeRawUnsafe(`CREATE TRIGGER test_reemplazo_falla BEFORE INSERT ON "ContenidoCartaProducto" FOR EACH ROW WHEN (NEW."sucursalId" = '${destinoId}') EXECUTE FUNCTION test_reemplazo_falla()`);
    await expect(reemplazarCartaDeSucursal(centralId, "Sucursal B")).rejects.toThrow();
    expect(await cartaDe(destinoId)).toEqual(antes);
    expect(await auditoria()).toHaveLength(0);
    expect(revalidaciones()).toBe(0);
  });

  it("el nombre escrito: vacío o distinto al de la sucursal rechaza antes de leer nada", async () => {
    await armarCartaDeCentral();
    await armarCartaPropiaDelDestino();
    const antes = await cartaDe(destinoId);
    expect(await reemplazarCartaDeSucursal(centralId, "")).toEqual({ ok: false, mensaje: "Para reemplazar la carta escribí el nombre de esta sucursal." });
    expect(await reemplazarCartaDeSucursal(centralId, "Central")).toEqual({ ok: false, mensaje: "El nombre escrito no coincide con el de esta sucursal: no se reemplazó nada." });
    expect(await reemplazarCartaDeSucursal(destinoId, "Sucursal B")).toEqual({ ok: false, mensaje: "Elegí otra sucursal: no se puede reemplazar con la misma." });
    expect(await reemplazarCartaDeSucursal("cnoexiste000000000000000", "Sucursal B")).toEqual({ ok: false, mensaje: "No se encontró esa sucursal." });
    expect(await cartaDe(destinoId)).toEqual(antes);
    expect(await auditoria()).toHaveLength(0);
  });

  it("un origen SIN acceso (sin membresía allá) rechaza sin escribir ni nombrar nada del origen", async () => {
    await armarCartaDeCentral();
    await armarCartaPropiaDelDestino();
    const solo = await crearUsuarioConMembresia({ email: "solo-b@test.com", sucursalId: destinoId, rolId: baseAdminId });
    await mockearUsuarioActual({ id: solo.id, email: solo.email, nombre: null });
    const antes = await cartaDe(destinoId);
    expect(await reemplazarCartaDeSucursal(centralId, "Sucursal B")).toEqual({ ok: false, mensaje: "No tenés acceso a esa sucursal." });
    expect(await cartaDe(destinoId)).toEqual(antes);
    expect(await auditoria()).toHaveLength(0);
  });

  it("un origen de OTRA EMPRESA no se ve ni se copia", async () => {
    await armarCartaPropiaDelDestino();
    await prismaAdmin.empresa.upsert({ where: { id: EMPRESA_TESTIGO_ID }, update: { estado: "ACTIVE" }, create: DATOS_EMPRESA_TESTIGO });
    const ajena = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "Sucursal ajena" } });
    const antes = await cartaDe(destinoId);
    expect(await reemplazarCartaDeSucursal(ajena.id, "Sucursal B")).toEqual({ ok: false, mensaje: "No se encontró esa sucursal." });
    expect(await cartaDe(destinoId)).toEqual(antes);
    await prismaAdmin.sucursal.deleteMany({ where: { id: ajena.id } });
    await prismaAdmin.empresa.deleteMany({ where: { id: EMPRESA_TESTIGO_ID } });
  });

  it("la copia sobre carta vacía sigue igual y sobre carta con contenido sigue rechazando (la acción de siempre no cambió)", async () => {
    await armarCartaDeCentral();
    await armarCartaPropiaDelDestino();
    expect(await copiarCartaDeSucursal(centralId, true)).toEqual({ ok: false, mensaje: "Esta sucursal ya tiene carta propia: solo se puede copiar sobre una carta vacía." });
  });
});
