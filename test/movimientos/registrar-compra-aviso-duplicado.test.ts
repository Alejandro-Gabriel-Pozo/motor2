import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarMotivosYDestinos, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { cargarComprasParaAvisoDeDuplicado } from "../../src/server/persistencia/movimientos/cargar-validaciones-de-movimiento";

/**
 * Aviso C25 de posible factura repetida al REGISTRAR una compra: toda la empresa, ±7 días, mismo proveedor e importe; nombra la sucursal y NO bloquea. Postgres real; las compras se
 * cargan por el propio caso de uso (así el importe y el N.º salen del camino real). Las fechas son fijas y pasadas (la fecha de una compra es un día de calendario a medianoche UTC).
 * La regla pura (ventana, importe, orden, texto) la cubre `test/core/compras-posible-duplicado.propiedades.test.ts`; acá se prueba el cableado: la lectura, el mensaje que se guarda
 * para la idempotencia y que la compra se escribe igual.
 */
const AVISO = "Posible factura repetida";

describe("registrarMovimiento (Compra): aviso de posible factura repetida", () => {
  let sucursalCentral: string;
  let sucursalNorte: string;
  let seccionCentral: string;
  let seccionNorte: string;
  let usuarioCentral: string;
  let usuarioNorte: string;
  let productoId: string;
  let proveedorId: string;
  let otroProveedorId: string;

  const actor = (usuarioId: string, sucursalId: string, sucursalNombre: string) => ({ usuarioId, sucursalId, sucursalNombre, ...baseDeTest });

  const comprarEnCentral = (fecha: string, precioTotal: number | undefined, extra: { nroFactura?: string; proveedor?: string; claveIdempotencia?: string } = {}) =>
    registrarMovimientoCasoDeUso(actor(usuarioCentral, sucursalCentral, "Central"), {
      proceso: "COMPRA",
      fecha: new Date(fecha),
      seccionId: seccionCentral,
      proveedorId: extra.proveedor ?? proveedorId,
      nroFactura: extra.nroFactura,
      claveIdempotencia: extra.claveIdempotencia,
      items: [{ productoId, cantidad: 10, ...(precioTotal === undefined ? {} : { precioTotal }) }],
    });

  const comprarEnNorte = (fecha: string, precioTotal: number | undefined, extra: { nroFactura?: string; proveedor?: string; claveIdempotencia?: string } = {}) =>
    registrarMovimientoCasoDeUso(actor(usuarioNorte, sucursalNorte, "Norte"), {
      proceso: "COMPRA",
      fecha: new Date(fecha),
      seccionId: seccionNorte,
      proveedorId: extra.proveedor ?? proveedorId,
      nroFactura: extra.nroFactura,
      claveIdempotencia: extra.claveIdempotencia,
      items: [{ productoId, cantidad: 10, ...(precioTotal === undefined ? {} : { precioTotal }) }],
    });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalCentral = base.sucursal.id;
    sucursalNorte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const catalogo = await sembrarCatalogoBase();
    await sembrarMotivosYDestinos();
    seccionCentral = (await sembrarSeccion(sucursalCentral, "Depósito Central")).id;
    seccionNorte = (await sembrarSeccion(sucursalNorte, "Depósito Norte")).id;
    usuarioCentral = (await crearUsuarioConMembresia({ email: "central@test.com", sucursalId: sucursalCentral, rolId: base.admin.id })).id;
    usuarioNorte = (await crearUsuarioConMembresia({ email: "norte@test.com", sucursalId: sucursalNorte, rolId: base.admin.id })).id;
    const producto = await sembrarProductoDisponible({ codigo: "MP_ACEITE_C25", nombre: "Aceite", tipo: "MP", unidadStockId: catalogo.kg.id, unidadCompraId: catalogo.kg.id }, sucursalCentral);
    productoId = producto.id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalNorte, productoId, disponible: true } });
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_C25", nombre: "Proveedor C25" } })).id;
    otroProveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_C25_OTRO", nombre: "Otro proveedor C25" } })).id;
  });

  it("(1) otra sucursal de la empresa, 3 días después y mismo importe: sale bien y el mensaje nombra la primera sucursal y la fecha, no el número de factura", async () => {
    const primera = await comprarEnCentral("2026-09-10", 1500, { nroFactura: "1-1234" });
    expect(primera.ok).toBe(true);
    expect(primera.mensaje).not.toContain(AVISO);

    const segunda = await comprarEnNorte("2026-09-13", 1500, { nroFactura: "9-77" });
    expect(segunda.ok).toBe(true);
    expect(segunda.mensaje).toContain(AVISO);
    expect(segunda.mensaje).toContain("en la sucursal Central");
    expect(segunda.mensaje).toContain("10/09/2026");
    expect(segunda.mensaje).not.toContain("1234"); // el N.º de factura exige piso administrador: el aviso no lo filtra
    expect(segunda.mensaje).not.toContain("1500");
    expect(segunda.mensaje).toMatch(/^Se guardaron 1 movimiento\(s\)\./);
  });

  it("(1b) en la misma sucursal dice «en esta sucursal»", async () => {
    await comprarEnCentral("2026-09-10", 1500, { nroFactura: "A-1" });
    const segunda = await comprarEnCentral("2026-09-12", 1500, { nroFactura: "A-2" });
    expect(segunda.ok).toBe(true);
    expect(segunda.mensaje).toContain("en esta sucursal");
  });

  it("(2) a 8 días no avisa", async () => {
    await comprarEnCentral("2026-09-10", 1500);
    const r = await comprarEnNorte("2026-09-18", 1500);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);
  });

  it("(2b) a 7 días justos avisa (el borde cuenta)", async () => {
    await comprarEnCentral("2026-09-10", 1500);
    const r = await comprarEnNorte("2026-09-17", 1500);
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain(AVISO);
  });

  it("(3) con otro importe no avisa, ni por un centavo", async () => {
    await comprarEnCentral("2026-09-10", 1500);
    const r = await comprarEnNorte("2026-09-12", 1500.01);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);
  });

  it("(4) si la compra anterior está anulada, no avisa", async () => {
    await comprarEnCentral("2026-09-10", 1500, { nroFactura: "1-1234" });
    await prisma.operacion.updateMany({ where: { proceso: "COMPRA" }, data: { anuladaEn: new Date("2026-09-11T12:00:00Z"), anuladaPorId: usuarioCentral } });
    const r = await comprarEnNorte("2026-09-12", 1500);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);
  });

  it("(5) con otro proveedor de la misma empresa no avisa", async () => {
    await comprarEnCentral("2026-09-10", 1500);
    const r = await comprarEnNorte("2026-09-12", 1500, { proveedor: otroProveedorId });
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);
  });

  it("(5b) la lectura trae solo las compras VIGENTES del proveedor pedido, dentro de los días pedidos, con su sucursal, su importe y el día en UTC", async () => {
    await comprarEnCentral("2026-09-10", 1500.5, { nroFactura: "1-1234" });
    await comprarEnNorte("2026-09-17", 700, { nroFactura: "A-17" });
    await comprarEnNorte("2026-09-18", 700, { nroFactura: "A-18" }); // un día después de la ventana
    await comprarEnNorte("2026-09-02", 700, { nroFactura: "A-02" }); // un día antes de la ventana
    await comprarEnNorte("2026-09-12", 700, { nroFactura: "A-12", proveedor: otroProveedorId }); // otro proveedor
    await comprarEnNorte("2026-09-13", 700, { nroFactura: "A-13" });
    await prisma.operacion.updateMany({ where: { proceso: "COMPRA", nroFactura: "A-13" }, data: { anuladaEn: new Date("2026-09-14T12:00:00Z"), anuladaPorId: usuarioNorte } }); // anulada

    const leidas = await cargarComprasParaAvisoDeDuplicado(baseDeTest.db, { proveedorId, desde: "2026-09-03", hasta: "2026-09-17" });

    expect(leidas.map((c) => ({ dia: c.dia, importe: c.importe, sucursalNombre: c.sucursalNombre, anulado: c.anulado, proveedorId: c.proveedorId })).sort((a, b) => a.dia.localeCompare(b.dia))).toEqual([
      { dia: "2026-09-10", importe: 1500.5, sucursalNombre: "Central", anulado: false, proveedorId },
      { dia: "2026-09-17", importe: 700, sucursalNombre: "Norte", anulado: false, proveedorId },
    ]);
  });

  it("(6) una compra igual de OTRA empresa no se ve (aislamiento): no avisa", async () => {
    const e = "empresa_c25_b";
    await prismaAdmin.empresa.create({ data: { id: e, nombre: "Empresa C25 B", slug: "empresa-c25-b", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    const sucursalB = await prismaAdmin.sucursal.create({ data: { empresaId: e, nombre: "Sucursal B" } });
    const seccionB = await prismaAdmin.seccion.create({ data: { empresaId: e, sucursalId: sucursalB.id, nombre: "Depósito B" } });
    const unidadB = await prismaAdmin.unidad.create({ data: { empresaId: e, nombre: "kg B", magnitud: "PESO", decimales: 2 } });
    const productoB = await prismaAdmin.producto.create({ data: { empresaId: e, codigo: "MP_B_C25", nombre: "Aceite B", tipo: "MP", unidadStockId: unidadB.id } });
    const proveedorB = await prismaAdmin.proveedor.create({ data: { empresaId: e, codigo: "PRV_B_C25", nombre: "Proveedor B" } });
    const operacionB = await prismaAdmin.operacion.create({
      data: { empresaId: e, sucursalId: sucursalB.id, proceso: "COMPRA", fecha: new Date("2026-09-11"), proveedorId: proveedorB.id, nroFactura: "1-1234", usuarioId: usuarioCentral },
    });
    await prismaAdmin.movimientoStock.create({
      data: { empresaId: e, operacionId: operacionB.id, productoId: productoB.id, seccionId: seccionB.id, proceso: "COMPRA", cantidad: 10, precioTotal: 1500, precioPorUnidadStock: 150, detalle: "" },
    });

    const r = await comprarEnCentral("2026-09-12", 1500);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);
  });

  it("(7) sin precio (importe 0) nunca avisa, aunque haya otra compra sin precio", async () => {
    await comprarEnCentral("2026-09-10", undefined);
    const r = await comprarEnNorte("2026-09-12", undefined);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);
  });

  it("(8) el reintento con la misma clave devuelve el MISMO mensaje (con el aviso) y no escribe de nuevo", async () => {
    await comprarEnCentral("2026-09-10", 1500, { nroFactura: "1-1234" });
    const clave = randomUUID();
    const primera = await comprarEnNorte("2026-09-13", 1500, { claveIdempotencia: clave });
    expect(primera.ok).toBe(true);
    expect(primera.mensaje).toContain(AVISO);

    const reintento = await comprarEnNorte("2026-09-13", 1500, { claveIdempotencia: clave });
    expect(reintento.ok).toBe(true);
    expect(reintento.mensaje).toBe(primera.mensaje);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(2);
  });

  it("(9) la compra se escribe igual: la operación, la línea y el stock quedan", async () => {
    await comprarEnCentral("2026-09-10", 1500, { nroFactura: "1-1234" });
    const r = await comprarEnNorte("2026-09-13", 1500, { nroFactura: "9-77" });
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain(AVISO);
    const operaciones = await prisma.operacion.findMany({ where: { proceso: "COMPRA", sucursalId: sucursalNorte }, include: { movimientos: true } });
    expect(operaciones).toHaveLength(1);
    expect(operaciones[0]!.nroFactura).toBe("9-77");
    expect(operaciones[0]!.movimientos).toHaveLength(1);
    expect(Number(operaciones[0]!.movimientos[0]!.precioTotal)).toBe(1500);
  });
});
