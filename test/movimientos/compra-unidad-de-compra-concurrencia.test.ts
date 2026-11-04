import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { MENSAJE_FACTURA_DUPLICADA } from "../../src/core/movimientos/factura-unica";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";
import type { DatosMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";

/**
 * Compras, etapa 2a — operaciones críticas con la unidad de compra: IDEMPOTENCIA (la misma clave repetida es UNA operación) y CONCURRENCIA (dos cargas simultáneas), contra Postgres real, en compra simple y en factura
 * repartida. Producto: stock en kg, se compra en cajas de 25 kg (3 cajas = 75 kg). La regla de qué se guarda está en el oráculo (`docs/oraculo-combinaciones-compras-etapa-2a-2026-11-04.md`); acá se prueba que
 * lo guardado no se duplica ni se pierde cuando el pedido llega dos veces o a la vez.
 *
 * Mutaciones (anotadas en el commit): sin copiar `unidadCompraId`/`cantidadCompra` en `armarFilasDeMovimiento` → rojo «guarda lo comprado»; escribir las columnas en la parte además del renglón → rojo «la parte queda en NULL».
 */
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let central: string, seccionId: string, adminId: string, proveedorId: string, cajaId: string, productoId: string;

const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: central, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest({ lectura: [central], escritura: [central] }) });

const compra = (nroFactura: string, claveIdempotencia: string): DatosMovimientoInput => ({
  proceso: "COMPRA", fecha: mediodiaDeHoy(), seccionId, proveedorId, nroFactura,
  items: [{ productoId, cantidad: 3, precioTotal: 1500, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia,
}) as DatosMovimientoInput;

const factura = (nroFactura: string, claveIdempotencia: string) => ({
  fecha: mediodiaDeHoy(), proveedorId, nroFactura, seccionId,
  items: [{ productoId, cantidad: 3, precioTotal: 1500, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
  reparto: { modo: "IMPORTE" as const, partes: [{ sucursalId: central, valor: 1500 }] }, claveIdempotencia,
});

const guardado = async () => ({
  operaciones: await prisma.operacion.count({ where: { proceso: "COMPRA" } }),
  movimientos: await prisma.movimientoStock.findMany({ where: { productoId, proceso: "COMPRA" }, select: { cantidad: true, unidadCompraId: true, cantidadCompra: true } }),
  facturas: await prisma.facturaProveedor.count(),
  renglones: await prisma.facturaProveedorRenglon.findMany({ select: { unidadCompraId: true, cantidadCompra: true } }),
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  central = base.sucursal.id;
  seccionId = (await sembrarSeccion(central)).id;
  adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: central, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  cajaId = (await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } })).id;
  productoId = (await sembrarProductoDisponible({ codigo: "MP_CAJA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id, unidadCompraId: cajaId, factorConversion: "25" }, central)).id;
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
});

describe("compra simple con unidad de compra", () => {
  it("guarda la unidad y lo comprado (3 cajas) junto al stock de siempre (75 kg)", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra("A-1-500001", randomUUID()));
    expect(r.ok, r.mensaje).toBe(true);
    const g = await guardado();
    expect(g.movimientos).toHaveLength(1);
    expect(g.movimientos[0]!.unidadCompraId).toBe(cajaId);
    expect(g.movimientos[0]!.cantidadCompra?.toFixed(4)).toBe("3.0000");
    expect(Number(g.movimientos[0]!.cantidad)).toBe(75);
  });

  it("IDEMPOTENCIA: la misma clave repetida 5 veces (clic doble, reintento) es UNA operación con UNA unidad y UNA cantidad", async () => {
    const clave = randomUUID();
    const resultados = [];
    for (let i = 0; i < 5; i++) resultados.push(await registrarMovimientoCasoDeUso(actor(), compra("A-1-500002", clave)));
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(resultados.filter((r) => r.ok && r.datos.repetida)).toHaveLength(4);
    const g = await guardado();
    expect(g.operaciones).toBe(1);
    expect(g.movimientos).toHaveLength(1);
    expect(g.movimientos[0]!.cantidadCompra?.toFixed(4)).toBe("3.0000");
  });

  it("CONCURRENCIA, misma clave: tres envíos a la vez escriben UNA sola compra (sin duplicar la unidad ni la cantidad)", async () => {
    const clave = randomUUID();
    const rs = await Promise.all([1, 2, 3].map(() => registrarMovimientoCasoDeUso(actor(), compra("A-1-500003", clave))));
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    const g = await guardado();
    expect(g.operaciones).toBe(1);
    expect(g.movimientos).toHaveLength(1);
    expect(g.movimientos[0]!.unidadCompraId).toBe(cajaId);
    expect(g.movimientos[0]!.cantidadCompra?.toFixed(4)).toBe("3.0000");
  });

  it("CONCURRENCIA, mismo comprobante con claves distintas: gana una, la otra se rechaza como duplicada y NO queda nada a medias", async () => {
    const rs = await Promise.all([registrarMovimientoCasoDeUso(actor(), compra("A-1-500004", randomUUID())), registrarMovimientoCasoDeUso(actor(), compra("A-1-500004", randomUUID()))]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toMatchObject({ codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
    const g = await guardado();
    expect(g.operaciones).toBe(1);
    expect(g.movimientos).toHaveLength(1);
    expect(g.movimientos[0]!.cantidadCompra?.toFixed(4)).toBe("3.0000");
  });

  it("CONCURRENCIA, comprobantes distintos: las dos se guardan, cada una con su propia unidad y cantidad", async () => {
    const rs = await Promise.all([registrarMovimientoCasoDeUso(actor(), compra("A-1-500005", randomUUID())), registrarMovimientoCasoDeUso(actor(), compra("A-1-500006", randomUUID()))]);
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    const g = await guardado();
    expect(g.operaciones).toBe(2);
    expect(g.movimientos.map((m) => m.cantidadCompra?.toFixed(4))).toEqual(["3.0000", "3.0000"]);
  });
});

describe("factura repartida con unidad de compra", () => {
  it("guarda lo comprado en el renglón y deja la parte (el movimiento) en NULL", async () => {
    const r = await registrarFacturaProveedorCasoDeUso(actor(), factura("A-1-500011", randomUUID()));
    expect(r.ok, r.mensaje).toBe(true);
    const g = await guardado();
    expect(g.renglones).toHaveLength(1);
    expect(g.renglones[0]!.unidadCompraId).toBe(cajaId);
    expect(g.renglones[0]!.cantidadCompra?.toFixed(4)).toBe("3.0000");
    expect(g.movimientos[0]!.unidadCompraId).toBeNull();
    expect(g.movimientos[0]!.cantidadCompra).toBeNull();
    expect(Number(g.movimientos[0]!.cantidad)).toBe(75);
  });

  it("IDEMPOTENCIA y CONCURRENCIA, misma clave: cuatro envíos a la vez son UNA factura con UN renglón", async () => {
    const clave = randomUUID();
    const rs = await Promise.all([1, 2, 3, 4].map(() => registrarFacturaProveedorCasoDeUso(actor(), factura("A-1-500012", clave))));
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    const g = await guardado();
    expect(g.facturas).toBe(1);
    expect(g.renglones).toHaveLength(1);
    expect(g.renglones[0]!.cantidadCompra?.toFixed(4)).toBe("3.0000");
    expect(g.movimientos).toHaveLength(1);
  });
});
