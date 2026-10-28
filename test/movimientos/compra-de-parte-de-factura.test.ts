import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { anularCompra, corregirCompra } from "../../src/server/actions/movimientos/compras";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { datosDeFactura, datosDeRenglon } from "../setup/factura-proveedor";

/**
 * E3a, paso 6 (docs/diseno-factura-de-proveedor-e3a-2026-10-27.md, invariante D8): la compra de UNA parte de una factura de proveedor (sus líneas del Kardex salen de un renglón,
 * `MovimientoStock.facturaProveedorRenglonId`) no se anula ni se corrige suelta: `anularCompra` y `corregirCompra` la rechazan, no escriben nada y mandan a la factura. Una compra
 * simple (sin renglón) sigue como siempre.
 *
 * La factura se arma a mano (cabecera, renglón, compra y línea con el renglón) porque el caso de uso que la carga llega en un paso posterior; es la misma forma que deja ese caso de uso.
 *
 * Mutación (anotada en el commit): sacar el `if (deFactura) return …` de `anular-compra.ts` → rojo «anularCompra rechaza…» (la compra se anula y el stock vuelve a 0); sacarlo de
 * `corregir-compra.ts` → rojo «corregirCompra rechaza…» (el número cambia); que el cargador de la anulación devuelva siempre `esDeFactura: false` → rojo igual.
 */
describe("la compra de una parte de factura no se anula ni se corrige suelta (E3a, D8)", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaId: string;
  let proveedorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg, insumo } = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id }, sucursalId)).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  });

  /** Una factura de 10 kg a $100 con su parte RECIBIDA en esta sucursal: cabecera, renglón, compra y la línea del Kardex con el renglón. */
  async function compraDeUnaFactura() {
    const factura = await prisma.facturaProveedor.create({ data: datosDeFactura({ usuarioId: adminId, proveedorId }, { nroFactura: "A-0001-00000077", nroFacturaNormalizado: "1-77" }) as never });
    const renglon = await prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: factura.id, productoId: harinaId }) as never });
    const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: adminId, proveedorId, nroFactura: "A-0001-00000077" } });
    await prisma.movimientoStock.create({
      data: { operacionId: operacion.id, productoId: harinaId, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "COMPRA", precioTotal: 100, precioPorUnidadStock: 10, facturaProveedorRenglonId: renglon.id },
    });
    await prisma.facturaProveedorSucursal.create({
      data: { facturaProveedorId: factura.id, sucursalId, porcentajeDeclaradoBp: 10000, operacionId: operacion.id, estadoRecepcion: "RECIBIDA", recibidaEn: new Date(), recibidaPorId: adminId } as never,
    });
    return operacion;
  }

  it("anularCompra rechaza la compra de una parte, sin escribir nada, y manda a anular la factura", async () => {
    const compra = await compraDeUnaFactura();
    const operacionesAntes = await prisma.operacion.count();

    const r = await anularCompra(compra.id, randomUUID());

    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("parte de una factura de proveedor");
    expect(r.mensaje).toContain("anulá la factura entera");
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: compra.id } })).anuladaEn).toBeNull();
    expect(await prisma.operacion.count()).toBe(operacionesAntes);
    expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(10);
  });

  it("corregirCompra rechaza la compra de una parte sin tocar su número ni su proveedor", async () => {
    const compra = await compraDeUnaFactura();

    const r = await corregirCompra(compra.id, { proveedorId, nroFactura: "A-0001-00000078", detalleLibre: "" }, { proveedorId, nroFactura: "A-0001-00000077", detalleLibre: null });

    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("parte de una factura de proveedor");
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: compra.id } })).nroFactura).toBe("A-0001-00000077");
  });

  it("una compra simple (sin renglón de factura) se sigue anulando como siempre", async () => {
    const r1 = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId, items: [{ productoId: harinaId, cantidad: 10, precioTotal: 100 }], claveIdempotencia: randomUUID() });
    expect(r1.ok, r1.mensaje).toBe(true);
    const compra = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA", sucursalId }, orderBy: { creadoEn: "desc" } });

    const r = await anularCompra(compra.id, randomUUID());

    expect(r.ok, r.mensaje).toBe(true);
    expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);
  });
});
