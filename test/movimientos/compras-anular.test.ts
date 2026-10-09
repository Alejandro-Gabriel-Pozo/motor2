import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { anularCompra } from "../../src/server/actions/movimientos/compras";
import { anularVenta, registrarVenta } from "../../src/server/actions/movimientos/venta";
import { calcularSaldoPorLote, calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";
import { MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/idempotencia";
import { MENSAJE_FACTURA_DUPLICADA } from "../../src/core/movimientos/factura-unica";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/** K1c: anular una compra ya confirmada (Postgres real, sin mocks de base). */
describe("anularCompra", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let adminId: string;
  let operadorId: string;
  let harinaId: string;
  let proveedorId: string;

  const hoy = () => new Date();

  async function comprar(opciones: { cantidad?: number; precioTotal?: number; nroFactura?: string; lote?: Date; productoId?: string } = {}) {
    const r = await registrarMovimiento({
      proceso: "COMPRA",
      fecha: hoy(),
      seccionId,
      proveedorId,
      nroFactura: opciones.nroFactura,
      items: [{ productoId: opciones.productoId ?? harinaId, cantidad: opciones.cantidad ?? 10, precioTotal: opciones.precioTotal ?? 1000, loteVencimiento: opciones.lote }],
    });
    expect(r.ok, r.mensaje).toBe(true);
    // La operación de compra más reciente de esa factura.
    return prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA", sucursalId, ...(opciones.nroFactura ? { nroFactura: opciones.nroFactura } : {}) }, orderBy: { creadoEn: "desc" } });
  }

  async function consumir(cantidad: number, opciones: { lote?: Date | null; productoId?: string } = {}) {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "CONSUMO", fecha: hoy(), usuarioId: adminId } });
    await prisma.movimientoStock.create({
      data: {
        operacionId: op.id,
        productoId: opciones.productoId ?? harinaId,
        seccionId,
        proceso: "CONSUMO",
        cantidad: -cantidad,
        loteVencimiento: opciones.lote ?? null,
        detalle: "Consumo",
        precioTotal: 0,
        precioPorUnidadStock: 0,
      },
    });
  }

  const comoAdmin = () => mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    await comoAdmin();
    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId)).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  });

  it("anula la compra: el stock vuelve a lo de antes, la original queda marcada y se escribe el contra-asiento", async () => {
    const compra = await comprar({ nroFactura: "A-0001" });
    expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(10);

    const r = await anularCompra(compra.id);
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toContain("Compra anulada");
    expect(r.mensaje).toContain("A-0001");

    expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);

    const original = await prisma.operacion.findUniqueOrThrow({ where: { id: compra.id } });
    expect(original.anuladaEn).not.toBeNull();
    expect(original.anuladaPorId).toBe(adminId);

    // Append-only: la compra original y su línea siguen ahí, sin editar.
    const lineaOriginal = await prisma.movimientoStock.findFirstOrThrow({ where: { operacionId: compra.id } });
    expect(lineaOriginal.proceso).toBe("COMPRA");
    expect(Number(lineaOriginal.cantidad)).toBe(10);
    expect(Number(lineaOriginal.precioTotal)).toBe(1000);

    // El contra-asiento: una operación AJUSTE con una línea inversa.
    const reversion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "AJUSTE", sucursalId }, include: { movimientos: true } });
    expect(reversion.detalleLibre).toContain(compra.id);
    expect(reversion.detalleLibre).toContain("A-0001");
    expect(reversion.movimientos).toHaveLength(1);
    expect(reversion.movimientos[0].proceso).toBe("AJUSTE");
    expect(Number(reversion.movimientos[0].cantidad)).toBe(-10);
    expect(Number(reversion.movimientos[0].precioTotal)).toBe(-1000);
    expect(Number(reversion.movimientos[0].precioPorUnidadStock)).toBe(100); // el precio de la propia compra
  });

  it("queda una fila de auditoría con quién anuló y cuándo", async () => {
    const compra = await comprar({ nroFactura: "A-0002" });
    await anularCompra(compra.id);

    const filas = await prisma.registroAuditoria.findMany({ where: { entidad: "Operacion", entidadId: compra.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ campo: "anuladaEn", valorAnterior: null, actorId: adminId, sucursalId });
    expect(filas[0].descripcion).toContain("Molino SA");
    expect(filas[0].descripcion).toContain("A-0002");
    expect(filas[0].valorNuevo).not.toBeNull();
  });

  it("original + reversión netean EXACTAMENTE a cero, en cantidad y en centavos (con decimales que en coma flotante no cierran)", async () => {
    const compra = await comprar({ cantidad: 3, precioTotal: 100.1 });
    await comprar({ cantidad: 7, precioTotal: 200.2, nroFactura: "otra" }); // otra compra que NO se anula
    await anularCompra(compra.id);

    const lineas = await prisma.movimientoStock.findMany({ where: { OR: [{ operacionId: compra.id }, { operacion: { detalleLibre: { contains: compra.id } } }] } });
    expect(lineas).toHaveLength(2);
    const centavos = lineas.reduce((suma, l) => suma + Math.round(Number(l.precioTotal) * 100), 0);
    expect(centavos).toBe(0);
    expect(lineas.reduce((suma, l) => suma + Number(l.cantidad), 0)).toBe(0);
    expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(7); // solo queda la otra
  });

  it("el gasto del período deja de contar la compra anulada, y solo esa", async () => {
    const compra = await comprar({ precioTotal: 1000, nroFactura: "G-1" });
    await comprar({ precioTotal: 300, nroFactura: "G-2" });
    const desde = new Date(Date.now() - 86_400_000);
    const hasta = new Date(Date.now() + 86_400_000);

    expect((await obtenerReportePorPeriodo(sucursalId, desde, hasta, undefined, prisma, AHORA_DE_LA_CORRIDA)).compras.totalGastado).toBe(1300);
    await anularCompra(compra.id);
    expect((await obtenerReportePorPeriodo(sucursalId, desde, hasta, undefined, prisma, AHORA_DE_LA_CORRIDA)).compras.totalGastado).toBe(300);
  });

  describe("stock ya consumido", () => {
    it("se bloquea si parte de lo comprado ya se consumió, con un mensaje que dice qué falta y ofrece la salida; no escribe nada", async () => {
      const compra = await comprar();
      await consumir(6);

      const r = await anularCompra(compra.id);

      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("Harina");
      expect(r.mensaje).toContain("se compraron 10 y hoy quedan 4");
      expect(r.mensaje).toContain("Devolución a proveedor");
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: compra.id } })).anuladaEn).toBeNull();
      expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(0);
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(4);
      expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion" } })).toBe(0);
    });

    it("es POR LOTE: si el lote de la compra ya se vendió, se bloquea aunque haya stock de otro lote del mismo producto", async () => {
      const loteViejo = new Date("2026-12-01T00:00:00.000Z");
      const loteNuevo = new Date("2027-06-01T00:00:00.000Z");
      await comprar({ cantidad: 50, lote: loteViejo, nroFactura: "L-1" }); // stock previo de OTRO lote
      const compra = await comprar({ cantidad: 10, lote: loteNuevo, nroFactura: "L-2" });
      await consumir(10, { lote: loteNuevo }); // el lote de esta compra se agotó

      // Hay 50 kg en total: contra el total pasaría; por lote no.
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(50);
      expect(await calcularSaldoPorLote(harinaId, seccionId, loteNuevo, prisma)).toBe(0);

      const r = await anularCompra(compra.id);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("lote que vence el 2027-06-01");
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: compra.id } })).anuladaEn).toBeNull();
    });

    it("con stock de sobra (había stock previo del mismo lote), se puede anular", async () => {
      await comprar({ cantidad: 20, nroFactura: "S-1" });
      const compra = await comprar({ cantidad: 10, nroFactura: "S-2" });
      await consumir(15); // quedan 15: alcanza para revertir los 10 de S-2

      const r = await anularCompra(compra.id);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(5);
    });
  });

  describe("guardas", () => {
    it("una compra ya anulada no se anula dos veces", async () => {
      const compra = await comprar();
      expect((await anularCompra(compra.id)).ok).toBe(true);
      const otra = await anularCompra(compra.id);
      expect(otra.ok).toBe(false);
      expect(otra.mensaje).toContain("ya está anulada");
      expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } }), "una sola reversión").toBe(1);
    });

    it("una operación que no es una Compra no se anula con esta acción", async () => {
      const mp = harinaId;
      await comprar({ cantidad: 20 });
      const pv = await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
      await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp, cantidad: 1, unidadId: unidadKgId }] } } });
      expect((await registrarVenta({ fecha: hoy(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] })).ok).toBe(true);
      const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });

      const r = await anularCompra(venta.id);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("no es una Compra");
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: venta.id } })).anuladaEn).toBeNull();
    });

    it("una compra de OTRA sucursal no se puede anular solo conociendo su id", async () => {
      const otra = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
      const seccionOtra = await sembrarSeccion(otra.id, "Depósito Otra");
      const operacionAjena = await prisma.operacion.create({ data: { sucursalId: otra.id, proceso: "COMPRA", fecha: hoy(), usuarioId: adminId } });
      await prisma.movimientoStock.create({
        data: { operacionId: operacionAjena.id, productoId: harinaId, seccionId: seccionOtra.id, proceso: "COMPRA", cantidad: 5, detalle: "Compra", precioTotal: 50, precioPorUnidadStock: 10 },
      });

      const r = await anularCompra(operacionAjena.id);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("No se encontró");
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: operacionAjena.id } })).anuladaEn).toBeNull();
    });

    it("un id inexistente da «no se encontró», no un error", async () => {
      const r = await anularCompra("no-existe");
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("No se encontró");
    });

    it("sin el permiso anular_compra (el operador arranca sin él) no se puede, y no se escribe nada", async () => {
      const compra = await comprar();
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });

      const r = await anularCompra(compra.id);

      expect(r.ok).toBe(false);
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: compra.id } })).anuladaEn).toBeNull();
      expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(0);
    });

    it("una clave de reintento que no es un UUID se rechaza antes de tocar nada", async () => {
      const compra = await comprar();
      const r = await anularCompra(compra.id, "no-es-un-uuid");
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("Clave de reintento inválida");
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: compra.id } })).anuladaEn).toBeNull();
    });
  });

  describe("idempotencia", () => {
    it("reenviar la misma clave devuelve el mensaje ORIGINAL (no «ya está anulada») y no anula dos veces", async () => {
      const compra = await comprar({ nroFactura: "I-1" });
      const clave = randomUUID();

      const primera = await anularCompra(compra.id, clave);
      const reenvio = await anularCompra(compra.id, clave);

      expect(primera.ok).toBe(true);
      expect(reenvio.ok).toBe(true);
      expect(reenvio.mensaje).toBe(primera.mensaje);
      expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(1);
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);
    });

    it("la misma clave usada para anular OTRA compra es un conflicto, no un duplicado silencioso", async () => {
      const a = await comprar({ nroFactura: "I-2" });
      const b = await comprar({ nroFactura: "I-3" });
      const clave = randomUUID();

      expect((await anularCompra(a.id, clave)).ok).toBe(true);
      const r = await anularCompra(b.id, clave);

      expect(r.ok).toBe(false);
      expect(r.mensaje).toBe(MENSAJE_CONFLICTO_IDEMPOTENCIA);
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: b.id } })).anuladaEn).toBeNull();
    });
  });

  describe("concurrencia", () => {
    it("dos anulaciones simultáneas de la misma compra: exactamente una reversión, ninguna llamada rechaza", async () => {
      for (let i = 0; i < 5; i++) {
        const compra = await comprar({ nroFactura: `C-${i}`, cantidad: 4, precioTotal: 40 });

        const settled = await Promise.allSettled([anularCompra(compra.id), anularCompra(compra.id)]);

        expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: ninguna llamada debe rechazar: ${JSON.stringify(settled)}`).toBe(true);
        const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false, mensaje: "rejected" }));
        expect(resultados.filter((r) => r.ok), `iteración ${i}: exactamente una anulación exitosa`).toHaveLength(1);
        expect(resultados.filter((r) => !r.ok)[0].mensaje).toContain("ya está anulada");
        expect(await prisma.operacion.count({ where: { proceso: "AJUSTE", detalleLibre: { contains: compra.id } } }), `iteración ${i}: una sola reversión`).toBe(1);
      }
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma), "el saldo no quedó doblemente revertido").toBe(0);
    });
  });

  describe("anular y recargar", () => {
    it("se puede volver a cargar la compra con el MISMO N.º de factura, y el gasto es solo el de la recarga", async () => {
      const compra = await comprar({ cantidad: 10, precioTotal: 1000, nroFactura: "F-9" }); // se cargó con un precio mal tipeado
      await anularCompra(compra.id);

      const recarga = await comprar({ cantidad: 10, precioTotal: 100, nroFactura: "F-9" }); // el precio correcto
      expect(recarga.id).not.toBe(compra.id);

      const desde = new Date(Date.now() - 86_400_000);
      const hasta = new Date(Date.now() + 86_400_000);
      const rep = await obtenerReportePorPeriodo(sucursalId, desde, hasta, undefined, prisma, AHORA_DE_LA_CORRIDA);
      expect(rep.compras.totalGastado).toBe(100);
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(10);

      // Y la recarga, ya vigente, vuelve a ocupar el número.
      const repetida = await registrarMovimiento({ proceso: "COMPRA", fecha: hoy(), seccionId, proveedorId, nroFactura: "F-9", items: [{ productoId: harinaId, cantidad: 1, precioTotal: 10 }] });
      expect(repetida.ok).toBe(false);
      expect(repetida.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
    });

    it("el costo de reposición vuelve a valer el de la compra que quedó vigente, no el de la anulada", async () => {
      const { obtenerCostoActualPorMP } = await import("../../src/server/lecturas/reportes/comun");
      await comprar({ cantidad: 10, precioTotal: 100, nroFactura: "R-1" }); // $10/kg
      const cara = await comprar({ cantidad: 10, precioTotal: 1000, nroFactura: "R-2" }); // $100/kg, más reciente
      expect((await obtenerCostoActualPorMP(sucursalId, prisma)).get(harinaId)?.precioPorUnidadStock).toBe(100);

      await anularCompra(cara.id);
      expect((await obtenerCostoActualPorMP(sucursalId, prisma)).get(harinaId)?.precioPorUnidadStock).toBe(10);
    });
  });

  it("anularVenta no cambió: sigue anulando ventas", async () => {
    // Guardia de regresión: esta fase tocó la marca `anuladaEn` y los reportes, no la anulación de ventas.
    await comprar({ cantidad: 20 });
    const pv = await sembrarProductoDisponible({ codigo: "PV_PAN2", nombre: "Pan 2", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: harinaId, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarVenta({ fecha: hoy(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });
    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });
    expect((await anularVenta(venta.id)).ok).toBe(true);
  });
});
