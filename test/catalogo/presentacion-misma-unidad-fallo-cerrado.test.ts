import { beforeEach, describe, expect, it, vi } from "vitest";

// Corre con el interruptor ENCENDIDO (como `presentaciones.test.ts`): el fallo cerrado es lo que protege cuando las presentaciones se muestren. Apagado, la compra con una presentación ya cargada se resuelve igual (`cargarPresentacionActiva`).
vi.mock("../../src/core/catalogo/presentaciones-visibles", async (original) => ({ ...(await original<typeof import("../../src/core/catalogo/presentaciones-visibles")>()), PRESENTACIONES_VISIBLES: true }));

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { agregarPresentacionAlternativa } from "../../src/server/actions/catalogo/productos";
import { nroFacturaDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * Etapa a2-1 (el único (producto, unidad) de la presentación pasó a índice común, para que «caja x6» y «caja x12» convivan): la línea de compra todavía identifica la presentación SOLO por la unidad.
 * Con dos presentaciones ACTIVAS del mismo producto y la misma unidad la compra se RECHAZA (stock y costo no se mueven; no se elige una al azar ni se cae a la unidad por defecto), y el alta no las toca.
 * Y como la base ya no impide el duplicado, dos altas simultáneas de la misma unidad terminan en UNA sola fila (bloqueo de la fila del producto).
 */
describe("Dos presentaciones con la misma unidad: la compra falla cerrado y el alta no duplica", () => {
  let unidadKgId: string;
  let unidadGId: string;
  let productoId: string;
  let seccionId: string;
  let proveedorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    productoId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, unidadCompraId: unidadKgId, factorConversion: 1 } })).id;
    seccionId = (await sembrarSeccion(base.sucursal.id)).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: base.sucursal.id, productoId, disponible: true } });
  });

  const comprar = () =>
    registrarMovimiento({ proceso: "COMPRA", nroFactura: nroFacturaDePrueba(), fecha: new Date(), seccionId, proveedorId, items: [{ productoId, cantidad: 2, unidadCompraId: unidadGId, precioTotal: 100, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });
  const huella = async () => ({
    movimientos: await prisma.movimientoStock.count(),
    operaciones: await prisma.operacion.count(),
    vinculos: await prisma.proveedorPorProducto.count(),
    auditorias: await prisma.registroAuditoria.count(),
  });
  const sembrarDos = async (segundaActiva: boolean) => {
    await prisma.presentacion.create({ data: { productoId, unidadCompraId: unidadGId, factorConversion: 20, nombre: "Bolsa x20" } });
    await prisma.presentacion.create({ data: { productoId, unidadCompraId: unidadGId, factorConversion: 10, nombre: "Bolsa x10", activa: segundaActiva } });
  };

  it("dos activas con la misma unidad: la compra se RECHAZA y no se mueve stock, costo, vínculo ni auditoría", async () => {
    await sembrarDos(true);
    const antes = await huella();
    const r = await comprar();
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("más de una presentación activa");
    expect(await huella(), "ni stock, ni costo, ni vínculo, ni rastro").toEqual(antes);
    expect(antes.movimientos).toBe(0);
  });

  it("control: con UNA sola activa (la otra desactivada) la compra entra y convierte con su factor (2 × 20 = 40 kg)", async () => {
    await sembrarDos(false);
    const r = await comprar();
    expect(r.ok, r.mensaje).toBe(true);
    const mov = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId } });
    expect(Number(mov.cantidad)).toBe(40);
  });

  it("repetir la compra rechazada (reintento) sigue sin mover nada", async () => {
    await sembrarDos(true);
    const antes = await huella();
    expect((await comprar()).ok).toBe(false);
    expect((await comprar()).ok).toBe(false);
    expect(await huella()).toEqual(antes);
  });

  it("el alta sobre un par (producto, unidad) que ya tiene dos presentaciones no toca ninguna ni audita", async () => {
    await sembrarDos(true);
    const antes = await huella();
    const r = await agregarPresentacionAlternativa(productoId, unidadGId, 25);
    expect(r.ok).toBe(false);
    expect(await huella()).toEqual(antes);
    expect((await prisma.presentacion.findMany({ where: { productoId }, orderBy: { nombre: "asc" } })).map((p) => [p.nombre, Number(p.factorConversion), p.activa])).toEqual([["Bolsa x10", 10, true], ["Bolsa x20", 20, true]]);
  });

  it("CONCURRENCIA: dos altas simultáneas de la misma unidad dejan UNA sola presentación (la segunda la reactiva, no la duplica)", async () => {
    for (let ronda = 0; ronda < 5; ronda++) {
      await prisma.presentacion.deleteMany({ where: { productoId } });
      const [a, b] = await Promise.all([agregarPresentacionAlternativa(productoId, unidadGId, 20), agregarPresentacionAlternativa(productoId, unidadGId, 20)]);
      expect([a.ok, b.ok], `ronda ${ronda}: ${a.mensaje} / ${b.mensaje}`).toEqual([true, true]);
      expect(await prisma.presentacion.count({ where: { productoId, unidadCompraId: unidadGId } }), `ronda ${ronda}: una sola fila`).toBe(1);
    }
  });

  it("IDEMPOTENCIA: repetir el mismo alta deja la misma fila y una sola auditoría", async () => {
    expect((await agregarPresentacionAlternativa(productoId, unidadGId, 20)).ok).toBe(true);
    const fila = await prisma.presentacion.findFirstOrThrow({ where: { productoId } });
    expect((await agregarPresentacionAlternativa(productoId, unidadGId, 20)).ok).toBe(true);
    expect((await prisma.presentacion.findMany({ where: { productoId } })).map((p) => p.id)).toEqual([fila.id]);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Presentacion", entidadId: fila.id } })).toBe(1);
  });
});
