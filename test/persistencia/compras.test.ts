import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { cargarCompraParaAnular } from "../../src/server/persistencia/compras/cargar-compra-para-anular";
import { escribirAnulacionDeCompra } from "../../src/server/persistencia/compras/escribir-anulacion-de-compra";
import { cargarCompraParaCorregir, cargarProveedorParaCorreccion, hayOtraCompraVigenteConFactura } from "../../src/server/persistencia/compras/cargar-compra-para-corregir";
import { escribirCorreccionDeCompra } from "../../src/server/persistencia/compras/escribir-correccion-de-compra";
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

  describe("corrección", () => {
    it("cargarCompraParaCorregir: cabecera actual y nombre del proveedor; null si es de otra sucursal", async () => {
      const op = await compra();
      const c = await prisma.$transaction((tx) => cargarCompraParaCorregir(tx, { operacionId: op.id, sucursalId }));
      expect(c).toEqual({
        id: op.id,
        proceso: "COMPRA",
        anuladaEn: null,
        fecha: op.fecha,
        cabecera: { proveedorId, nroFactura: "A-0001", detalleLibre: "semanal" },
        proveedorNombre: "Molino SA",
      });
      expect(await prisma.$transaction((tx) => cargarCompraParaCorregir(tx, { operacionId: op.id, sucursalId: otraSucursalId }))).toBeNull();
    });

    it("cargarProveedorParaCorreccion: nombre y activo, o null", async () => {
      await prisma.proveedor.update({ where: { id: proveedorId }, data: { activo: false } });
      expect(await prisma.$transaction((tx) => cargarProveedorParaCorreccion(tx, proveedorId))).toEqual({ nombre: "Molino SA", activo: false });
      expect(await prisma.$transaction((tx) => cargarProveedorParaCorreccion(tx, "no-existe"))).toBeNull();
    });

    it("hayOtraCompraVigenteConFactura: solo cuenta OTRA compra vigente de esta sucursal con el mismo proveedor + N.º", async () => {
      const a = await compra({ nroFactura: "F-1" });
      const hay = (excluir: string) =>
        prisma.$transaction((tx) => hayOtraCompraVigenteConFactura(tx, { sucursalId, proveedorId, nroFactura: "F-1", excluirOperacionId: excluir }));

      expect(await hay(a.id), "la propia compra no cuenta").toBe(false);
      expect(await hay("otra-cualquiera")).toBe(true);
      await prisma.operacion.update({ where: { id: a.id }, data: { anuladaEn: new Date() } });
      expect(await hay("otra-cualquiera"), "una anulada deja libre el número").toBe(false);
    });

    it("escribirCorreccionDeCompra: actualiza los tres campos de la cabecera y no toca las líneas", async () => {
      const op = await compra();
      const antes = await prisma.movimientoStock.findMany({ where: { operacionId: op.id }, orderBy: { id: "asc" } });

      await prisma.$transaction((tx) => escribirCorreccionDeCompra(tx, op.id, { proveedorId: null, nroFactura: "B-2", detalleLibre: null }));

      expect(await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ proveedorId: null, nroFactura: "B-2", detalleLibre: null });
      expect(await prisma.movimientoStock.findMany({ where: { operacionId: op.id }, orderBy: { id: "asc" } })).toEqual(antes);
    });
  });
});
