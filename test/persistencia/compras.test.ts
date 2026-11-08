import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { cargarCompraParaAnular } from "../../src/server/persistencia/compras/cargar-compra-para-anular";
import { escribirAnulacionDeCompra } from "../../src/server/persistencia/compras/escribir-anulacion-de-compra";
import { cargarProveedoresParaCorreccion } from "../../src/server/persistencia/compras/cargar-factura-proveedor";
import { escribirCorreccionDeFactura } from "../../src/server/persistencia/compras/escribir-factura-proveedor";
import { datosDeFactura, datosDeRenglon } from "../setup/factura-proveedor";
import { registrarResultadoIdempotente } from "../../src/server/persistencia/movimientos/idempotencia";
import { claveDeLote, construirReversion } from "../../src/core/compras/anulacion";

/**
 * `src/server/persistencia/compras/` (Task #41, Fase M) contra Postgres real. Cada función recibe el `tx` de quien la llama: acá se
 * la llama dentro de un `prisma.$transaction` propio del test, como lo hace el caso de uso con `conTransaccionSerializable`.
 */
describe("persistencia de compras", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaId: string;
  let proveedorId: string;
  const lote = new Date("2027-01-31T00:00:00.000Z");

  async function compra(opciones: { nroFactura?: string | null; proveedorId?: string | null } = {}) {
    const op = await prisma.operacion.create({
      data: {
        sucursalId,
        proceso: "COMPRA",
        fecha: new Date("2026-08-10T12:00:00Z"),
        usuarioId: adminId,
        proveedorId: opciones.proveedorId === undefined ? proveedorId : opciones.proveedorId,
        nroFactura: opciones.nroFactura === undefined ? "A-0001" : opciones.nroFactura,
        detalleLibre: "semanal",
      },
    });
    await prisma.movimientoStock.createMany({
      data: [
        { operacionId: op.id, productoId: harinaId, seccionId, proceso: "COMPRA", cantidad: 2.5, loteVencimiento: lote, detalle: "Compra con lote", precioTotal: 250.1, precioPorUnidadStock: 100.04 },
        { operacionId: op.id, productoId: harinaId, seccionId, proceso: "COMPRA", cantidad: 4, detalle: "Compra sin lote", precioTotal: 400, precioPorUnidadStock: 100 },
      ],
    });
    return op;
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } })).id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  });

  describe("cargarCompraParaAnular", () => {
    it("devuelve tipos de dominio: Decimal ya convertido a number, líneas con nombres y saldos por lote", async () => {
      const op = await compra();

      const c = await prisma.$transaction((tx) => cargarCompraParaAnular(tx, { operacionId: op.id, sucursalId }));

      expect(c).not.toBeNull();
      expect(c).toMatchObject({ id: op.id, proceso: "COMPRA", anuladaEn: null, fecha: op.fecha, nroFactura: "A-0001", proveedorNombre: "Molino SA" });
      const lineas = [...c!.lineas].sort((a, b) => a.cantidad - b.cantidad);
      expect(lineas).toEqual([
        { productoId: harinaId, productoCodigo: "MP_HARINA", productoNombre: "Harina", seccionId, seccionNombre: "Depósito", loteVencimiento: lote, cantidad: 2.5, precioTotal: 250.1, precioPorUnidadStock: 100.04, detalle: "Compra con lote" },
        { productoId: harinaId, productoCodigo: "MP_HARINA", productoNombre: "Harina", seccionId, seccionNombre: "Depósito", loteVencimiento: null, cantidad: 4, precioTotal: 400, precioPorUnidadStock: 100, detalle: "Compra sin lote" },
      ]);
      expect(typeof lineas[0].cantidad).toBe("number");
      expect(c!.saldos.get(claveDeLote(harinaId, seccionId, lote))).toBe(2.5);
      expect(c!.saldos.get(claveDeLote(harinaId, seccionId, null))).toBe(4);
    });

    it("sin proveedor: proveedorNombre null", async () => {
      const op = await compra({ proveedorId: null, nroFactura: null });
      const c = await prisma.$transaction((tx) => cargarCompraParaAnular(tx, { operacionId: op.id, sucursalId }));
      expect(c).toMatchObject({ proveedorNombre: null, nroFactura: null });
    });

    it("null si el id no existe o es de OTRA sucursal", async () => {
      const op = await compra();
      expect(await prisma.$transaction((tx) => cargarCompraParaAnular(tx, { operacionId: "no-existe", sucursalId }))).toBeNull();
      expect(await prisma.$transaction((tx) => cargarCompraParaAnular(tx, { operacionId: op.id, sucursalId: otraSucursalId }))).toBeNull();
    });
  });

  describe("escribirAnulacionDeCompra + registrarResultadoIdempotente", () => {
    it("crea el contra-asiento AJUSTE, sus líneas inversas y marca la compra; el resultado I3 queda en la reversión", async () => {
      const op = await compra();
      const clave = randomUUID();
      const ahora = new Date("2026-09-27T15:00:00.000Z");

      const escrita = await prisma.$transaction(async (tx) => {
        const c = (await cargarCompraParaAnular(tx, { operacionId: op.id, sucursalId }))!;
        const r = await escribirAnulacionDeCompra(tx, {
          compraId: op.id,
          sucursalId,
          usuarioId: adminId,
          ahora,
          detalleLibre: "detalle de prueba",
          claveIdempotencia: clave,
          payloadHash: "hash-de-prueba",
          reversion: construirReversion(c.lineas),
        });
        await registrarResultadoIdempotente(tx, r.reversionId, "mensaje de prueba");
        return r;
      });

      expect(escrita.movimientos).toBe(2);
      const reversion = await prisma.operacion.findUniqueOrThrow({ where: { id: escrita.reversionId }, include: { movimientos: true } });
      expect(reversion).toMatchObject({
        sucursalId,
        proceso: "AJUSTE",
        fecha: ahora,
        detalleLibre: "detalle de prueba",
        usuarioId: adminId,
        claveIdempotencia: clave,
        payloadHash: "hash-de-prueba",
        resultadoMensaje: "mensaje de prueba",
      });
      expect(reversion.movimientos.map((m) => [m.proceso, Number(m.cantidad), Number(m.precioTotal)]).sort()).toEqual([
        ["AJUSTE", -2.5, -250.1],
        ["AJUSTE", -4, -400],
      ]);
      const original = await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } });
      expect(original.anuladaEn).toEqual(ahora);
      expect(original.anuladaPorId).toBe(adminId);
    });

    it("sin clave: la reversión no lleva clave ni hash", async () => {
      const op = await compra();
      const escrita = await prisma.$transaction(async (tx) => {
        const c = (await cargarCompraParaAnular(tx, { operacionId: op.id, sucursalId }))!;
        return escribirAnulacionDeCompra(tx, { compraId: op.id, sucursalId, usuarioId: adminId, ahora: new Date(), detalleLibre: "x", claveIdempotencia: null, payloadHash: null, reversion: construirReversion(c.lineas) });
      });
      expect(await prisma.operacion.findUniqueOrThrow({ where: { id: escrita.reversionId } })).toMatchObject({ claveIdempotencia: null, payloadHash: null, resultadoMensaje: null });
    });

    it("corre DENTRO de la transacción de quien llama: si esa transacción aborta, no queda nada escrito", async () => {
      const op = await compra();
      await expect(
        prisma.$transaction(async (tx) => {
          const c = (await cargarCompraParaAnular(tx, { operacionId: op.id, sucursalId }))!;
          await escribirAnulacionDeCompra(tx, { compraId: op.id, sucursalId, usuarioId: adminId, ahora: new Date(), detalleLibre: "x", claveIdempotencia: null, payloadHash: null, reversion: construirReversion(c.lineas) });
          throw new Error("aborta");
        })
      ).rejects.toThrow("aborta");
      expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(0);
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).anuladaEn).toBeNull();
    });
  });

  describe("corrección de los datos de una factura", () => {
    /** Una factura de una parte (cabecera, renglón, compra y parte) con el número y el detalle de la compra. */
    async function facturaConSuCompra() {
      const op = await compra();
      const factura = await prisma.facturaProveedor.create({ data: datosDeFactura({ usuarioId: adminId, proveedorId }, { nroFactura: "A-0001", nroFacturaNormalizado: "A:1", detalleLibre: "semanal" }) as never });
      const renglon = await prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: factura.id, productoId: harinaId }) as never });
      await prisma.movimientoStock.updateMany({ where: { operacionId: op.id }, data: { facturaProveedorRenglonId: renglon.id } });
      await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: factura.id, sucursalId, porcentajeDeclaradoBp: 10000, operacionId: op.id, estadoRecepcion: "RECIBIDA", recibidaEn: new Date(), recibidaPorId: adminId } as never });
      return { op, factura };
    }

    it("cargarProveedoresParaCorreccion: nombre y activo de cada proveedor pedido; los que no existen no salen", async () => {
      await prisma.proveedor.update({ where: { id: proveedorId }, data: { activo: false } });
      const r = await prisma.$transaction((tx) => cargarProveedoresParaCorreccion(tx, [proveedorId, "no-existe"]));
      expect([...r.entries()]).toEqual([[proveedorId, { nombre: "Molino SA", activo: false }]]);
    });

    it("escribirCorreccionDeFactura: actualiza la cabecera y COPIA proveedor, número y detalle a la compra de la parte; no toca las líneas del Kardex", async () => {
      const { op, factura } = await facturaConSuCompra();
      const otro = await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Distribuidora Sur" } });
      const antes = await prisma.movimientoStock.findMany({ where: { operacionId: op.id }, orderBy: { id: "asc" } });

      await prisma.$transaction((tx) =>
        escribirCorreccionDeFactura(tx, { facturaProveedorId: factura.id, proveedorId: otro.id, nroFactura: "B-2", nroFacturaNormalizado: "B:2", detalleLibre: null, detalleAnterior: "semanal", operacionIds: [op.id] })
      );

      expect(await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: factura.id } })).toMatchObject({ proveedorId: otro.id, nroFactura: "B-2", nroFacturaNormalizado: "B:2", detalleLibre: null });
      expect(await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ proveedorId: otro.id, nroFactura: "B-2", detalleLibre: null });
      expect(await prisma.movimientoStock.findMany({ where: { operacionId: op.id }, orderBy: { id: "asc" } })).toEqual(antes);
    });

    it("el detalle se copia solo a las compras que lo tenían igual que la cabecera: la que tiene otro detalle lo conserva", async () => {
      const { op, factura } = await facturaConSuCompra();
      await prisma.operacion.update({ where: { id: op.id }, data: { detalleLibre: "otro detalle propio" } });

      await prisma.$transaction((tx) =>
        escribirCorreccionDeFactura(tx, { facturaProveedorId: factura.id, proveedorId, nroFactura: "A-0001", nroFacturaNormalizado: "A:1", detalleLibre: "nuevo", detalleAnterior: "semanal", operacionIds: [op.id] })
      );

      expect((await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: factura.id } })).detalleLibre).toBe("nuevo");
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).detalleLibre).toBe("otro detalle propio");
    });
  });
});
