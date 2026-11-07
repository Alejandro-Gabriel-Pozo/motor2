import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { corregirFacturaProveedor } from "../../src/server/actions/movimientos/facturas-proveedor";
import { anularCompraDeTest } from "../setup/anular-compra-de-prueba";
import { corregirCompraDeTest } from "../setup/corregir-compra-de-prueba";
import { nroFacturaDePrueba } from "../setup/comprobante-de-prueba";
import { MENSAJE_FACTURA_DUPLICADA } from "../../src/core/movimientos/factura-unica";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * K1b, ahora U1 de «una sola compra»: corregir los datos (proveedor, N.º de factura, detalle) de una compra confirmada = corregir su FACTURA (`corregirFacturaProveedor`). Postgres real, sin mocks de base. Reemplaza a la batería de
 * `corregirCompra` (la acción se retiró): conserva sus reglas (factura repetida, guardas, idempotencia por estado, concurrencia) sobre la factura; las del caso de uso (notas de crédito, permisos por sucursal, I-NUM) están en
 * `test/casos-de-uso/corregir-factura-proveedor.test.ts` y `test/movimientos/factura-corregir-concurrencia.test.ts`. «Completar una compra sin proveedor» ya no existe: toda compra nace con proveedor.
 */
describe("corregir los datos de una compra (= corregir su factura)", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let operadorId: string;
  let harinaId: string;
  let molinoId: string;
  let otroProveedorId: string;

  /** Una compra de una sucursal por el camino real (factura de una parte). Devuelve la `Operacion` de la compra. */
  async function compra(opciones: { proveedorId?: string; nroFactura?: string; detalleLibre?: string } = {}) {
    const r = await registrarMovimiento({
      proceso: "COMPRA",
      fecha: new Date("2026-08-10T12:00:00Z"),
      seccionId,
      proveedorId: opciones.proveedorId ?? molinoId,
      nroFactura: opciones.nroFactura ?? nroFacturaDePrueba(),
      detalleLibre: opciones.detalleLibre,
      items: [{ productoId: harinaId, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
      claveIdempotencia: randomUUID(),
    });
    expect(r.ok, r.mensaje).toBe(true);
    return prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA", sucursalId }, orderBy: { creadoEn: "desc" } });
  }
  const facturaDe = async (operacionId: string) => (await prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { operacionId }, include: { facturaProveedor: true } })).facturaProveedor;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    molinoId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
    otroProveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Distribuidora Sur" } })).id;
  });

  it("cambia el proveedor, y su Kardex queda EXACTAMENTE igual", async () => {
    const op = await compra({ nroFactura: "A-00001-00000001" });
    const antes = await prisma.movimientoStock.findMany({ where: { operacionId: op.id }, orderBy: { id: "asc" } });

    const r = await corregirCompraDeTest(op.id, { proveedorId: otroProveedorId });

    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toContain("proveedor");
    expect((await facturaDe(op.id)).proveedorId).toBe(otroProveedorId);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).proveedorId, "la compra de la parte lleva el proveedor de su factura").toBe(otroProveedorId);
    // Append-only: ni una línea del Kardex cambió (precio, cantidad, lote, fecha de creación).
    expect(await prisma.movimientoStock.findMany({ where: { operacionId: op.id }, orderBy: { id: "asc" } })).toEqual(antes);
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } }), "no se escribe ningún contra-asiento").toBe(0);
  });

  it("corrige el N.º de factura y el detalle, y deja una fila de auditoría POR CAMPO que cambió (ninguna por los que no)", async () => {
    const op = await compra({ nroFactura: "A-00001-00000001", detalleLibre: "tipeo mal" });
    const factura = await facturaDe(op.id);

    const r = await corregirCompraDeTest(op.id, { nroFactura: "A-00001-00000002", detalleLibre: "compra de la semana" });

    expect(r.ok, r.mensaje).toBe(true);
    const filas = await prisma.registroAuditoria.findMany({ where: { entidad: "FacturaProveedor", entidadId: factura.id, campo: { in: ["proveedorId", "nroFactura", "detalleLibre"] } }, orderBy: { campo: "asc" } });
    expect(filas.map((f) => f.campo)).toEqual(["detalleLibre", "nroFactura"]); // el proveedor no cambió: sin fila
    const numero = filas.find((f) => f.campo === "nroFactura")!;
    expect(numero).toMatchObject({ valorAnterior: "A-00001-00000001", valorNuevo: "A-00001-00000002", actorId: adminId, sucursalId });
    expect(numero.descripcion).toContain("2026-08-10");
    expect(numero.descripcion).toContain("N.º de factura");
    expect(await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ nroFactura: "A-00001-00000002", detalleLibre: "compra de la semana" });
  });

  it("el proveedor se audita con su NOMBRE (no su id), tanto el anterior como el nuevo", async () => {
    const op = await compra();
    await corregirCompraDeTest(op.id, { proveedorId: otroProveedorId });

    const fila = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "FacturaProveedor", campo: "proveedorId" } });
    expect(fila.valorAnterior).toBe("Molino SA");
    expect(fila.valorNuevo).toBe("Distribuidora Sur");
  });

  describe("factura repetida", () => {
    it("se rechaza si OTRA compra vigente del mismo proveedor ya usa ese número, y no cambia nada", async () => {
      await compra({ nroFactura: "A-00001-00000001" });
      const otra = await compra({ nroFactura: "A-00001-00000009" });

      const r = await corregirCompraDeTest(otra.id, { nroFactura: "A-00001-00000001" });

      expect(r.ok).toBe(false);
      expect(r.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
      expect((await facturaDe(otra.id)).nroFactura).toBe("A-00001-00000009");
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: otra.id } })).nroFactura).toBe("A-00001-00000009");
      expect(await prisma.registroAuditoria.count({ where: { entidad: "FacturaProveedor", campo: "nroFactura" } })).toBe(0);
    });

    it("el MISMO número con OTRO proveedor no es un choque", async () => {
      await compra({ nroFactura: "A-00001-00000001" });
      const otra = await compra({ proveedorId: otroProveedorId, nroFactura: "A-00002-00000001" });
      const r = await corregirCompraDeTest(otra.id, { nroFactura: "A-00001-00000001" });
      expect(r.ok, r.mensaje).toBe(true);
    });

    it("cambiar el PROVEEDOR de una compra a uno que ya tiene ese número también choca", async () => {
      await compra({ proveedorId: otroProveedorId, nroFactura: "A-00001-00000001" });
      const op = await compra({ nroFactura: "A-00001-00000001" });
      const r = await corregirCompraDeTest(op.id, { proveedorId: otroProveedorId });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
    });

    it("el número de una compra ANULADA queda libre: se puede usar en otra", async () => {
      const vieja = await compra({ nroFactura: "A-00001-00000001" });
      expect((await anularCompraDeTest(vieja.id)).ok).toBe(true);
      const otra = await compra({ nroFactura: "A-00001-00000009" });

      const r = await corregirCompraDeTest(otra.id, { nroFactura: "A-00001-00000001" });
      expect(r.ok, r.mensaje).toBe(true);
    });

    it("la corrección ocupa el número: después no se puede cargar otra compra con ese proveedor y factura", async () => {
      const op = await compra();
      expect((await corregirCompraDeTest(op.id, { nroFactura: "A-00014-00000077" })).ok).toBe(true);

      const carga = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: molinoId, nroFactura: "A-00014-00000077", items: [{ productoId: harinaId, cantidad: 1, precioTotal: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID() });
      expect(carga.ok).toBe(false);
      expect(carga.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
    });
  });

  describe("guardas", () => {
    it("una compra ANULADA no se corrige", async () => {
      const op = await compra({ nroFactura: "A-00001-00000001" });
      expect((await anularCompraDeTest(op.id)).ok).toBe(true);

      const r = await corregirCompraDeTest(op.id, { nroFactura: "A-00001-00000002" });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("anulada");
      expect((await facturaDe(op.id)).nroFactura).toBe("A-00001-00000001");
    });

    it("guarda optimista: si la compra cambió mientras se editaba, no se pisa y se avisa", async () => {
      const op = await compra({ nroFactura: "A-00001-00000001" });
      const factura = await facturaDe(op.id);
      const vistaVieja = { proveedorId: factura.proveedorId, nroFactura: factura.nroFactura, detalleLibre: factura.detalleLibre };
      // Otra persona la corrige primero.
      expect((await corregirCompraDeTest(op.id, { nroFactura: "A-00001-00000002" })).ok).toBe(true);

      // La primera persona, con lo que veía antes, intenta otra cosa.
      const r = await corregirFacturaProveedor(factura.id, { proveedorId: otroProveedorId, nroFactura: "A-00001-00000001", detalleLibre: "" }, vistaVieja);

      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("cambió mientras la editabas");
      const guardada = await facturaDe(op.id);
      expect(guardada.nroFactura).toBe("A-00001-00000002");
      expect(guardada.proveedorId).toBe(molinoId);
    });

    it("es idempotente: reenviar la misma corrección (se perdió la respuesta) no falla ni duplica la auditoría", async () => {
      const op = await compra({ nroFactura: "A-00001-00000001" });
      const factura = await facturaDe(op.id);
      const vistaOriginal = { proveedorId: factura.proveedorId, nroFactura: factura.nroFactura, detalleLibre: factura.detalleLibre };
      const pedido = { proveedorId: molinoId, nroFactura: "A-00001-00000002", detalleLibre: "" };

      expect((await corregirFacturaProveedor(factura.id, pedido, vistaOriginal)).ok).toBe(true);
      const reenvio = await corregirFacturaProveedor(factura.id, pedido, vistaOriginal);

      expect(reenvio.ok, reenvio.mensaje).toBe(true);
      expect(reenvio.mensaje).toContain("nada que corregir");
      expect(await prisma.registroAuditoria.count({ where: { entidad: "FacturaProveedor", entidadId: factura.id, campo: "nroFactura" } })).toBe(1);
    });

    it("sin ningún cambio no escribe nada", async () => {
      const op = await compra({ nroFactura: "A-00001-00000001", detalleLibre: "nota" });
      const auditoria = await prisma.registroAuditoria.count();
      const r = await corregirCompraDeTest(op.id, {});
      expect(r.ok).toBe(true);
      expect(r.mensaje).toContain("nada que corregir");
      expect(await prisma.registroAuditoria.count()).toBe(auditoria);
    });

    it("un proveedor inactivo o inexistente se rechaza", async () => {
      const op = await compra();
      const inactivo = await prisma.proveedor.create({ data: { codigo: "PRV_3", nombre: "Ya no existe SA", activo: false } });

      const a = await corregirCompraDeTest(op.id, { proveedorId: inactivo.id });
      expect(a.ok).toBe(false);
      expect(a.mensaje).toContain("inactivo");

      const b = await corregirCompraDeTest(op.id, { proveedorId: "no-existe" });
      expect(b.ok).toBe(false);
      expect(b.mensaje).toContain("no existe");
      expect((await facturaDe(op.id)).proveedorId).toBe(molinoId);
    });

    it("un proveedor que ya estaba en la compra y hoy está inactivo no traba corregir OTRO campo", async () => {
      const op = await compra({ nroFactura: "A-00001-00000001" });
      await prisma.proveedor.update({ where: { id: molinoId }, data: { activo: false } });
      const r = await corregirCompraDeTest(op.id, { nroFactura: "A-00001-00000002" });
      expect(r.ok, r.mensaje).toBe(true);
    });

    it("un detalle viejo largo que no se toca no traba la corrección", async () => {
      const larga = "x".repeat(300);
      const op = await compra({ nroFactura: "A-00001-00000001" });
      const factura = await facturaDe(op.id);
      await prisma.facturaProveedor.update({ where: { id: factura.id }, data: { detalleLibre: larga } });

      const r = await corregirCompraDeTest(op.id, { nroFactura: "A-00001-00000002" });
      expect(r.ok, r.mensaje).toBe(true);
    });

    it("sin el permiso corregir_compra (el operador arranca sin él) no se puede, y no se escribe nada", async () => {
      const op = await compra({ nroFactura: "A-00001-00000001" });
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      const auditoria = await prisma.registroAuditoria.count();

      const r = await corregirCompraDeTest(op.id, { nroFactura: "A-00001-00000002" });

      expect(r.ok).toBe(false);
      expect((await facturaDe(op.id)).nroFactura).toBe("A-00001-00000001");
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).nroFactura).toBe("A-00001-00000001");
      expect(await prisma.registroAuditoria.count()).toBe(auditoria);
    });
  });

  describe("concurrencia", () => {
    it("dos correcciones simultáneas que dejarían el MISMO par proveedor + N.º de factura en dos facturas distintas: exactamente una gana, ninguna llamada rechaza", async () => {
      for (let i = 0; i < 5; i++) {
        const a = await compra();
        const b = await compra();
        const factura = `A-00020-${String(i + 1).padStart(8, "0")}`;

        const settled = await Promise.allSettled([corregirCompraDeTest(a.id, { nroFactura: factura }), corregirCompraDeTest(b.id, { nroFactura: factura })]);

        expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: ninguna llamada debe rechazar: ${JSON.stringify(settled)}`).toBe(true);
        const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false, mensaje: "rejected" }));
        expect(resultados.filter((r) => r.ok), `iteración ${i}: exactamente una corrección exitosa`).toHaveLength(1);
        expect(resultados.find((r) => !r.ok)?.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
        expect(await prisma.operacion.count({ where: { proveedorId: molinoId, nroFactura: factura, anuladaEn: null } }), `iteración ${i}: una sola con ese número`).toBe(1);
        expect(await prisma.facturaProveedor.count({ where: { proveedorId: molinoId, nroFactura: factura, anuladaEn: null } }), `iteración ${i}: una sola factura con ese número`).toBe(1);
      }
    });
  });
});
