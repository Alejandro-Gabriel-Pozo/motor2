import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { anularCompraDeTest } from "../setup/anular-compra-de-prueba";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { nroFacturaDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * Conversión de una compra en decimal EXACTO, de punta a punta con Postgres real: la cantidad de stock y los precios por unidad se
 * calculan en `armarLineaMovimiento` con `convertirCantidadAUnidadDeStock`/`precioPorUnidad` (src/core/movimientos/transiciones.ts) y se
 * guardan tal cual en `MovimientoStock` (Decimal(14,4)). La regla de redondeo (empate hacia +∞ para la cantidad, alejándose del cero
 * para los precios) se prueba en `test/core/conversion-compra-exacta.test.ts` contra un oráculo BigInt; acá se prueba que lo calculado
 * es lo que queda en la base, y que la idempotencia y la anulación se comportan igual con estas cuentas.
 */
describe("compra con factor de conversión decimal: cuentas exactas de punta a punta", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string; // kg: 2 decimales
  let insumoId: string;
  let proveedorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  });

  const crearMP = (nombre: string, factorConversion: string) =>
    sembrarProductoDisponible({ codigo: `MP_${nombre.toUpperCase()}`, nombre, tipo: "MP", unidadStockId: unidadKgId, insumoId, factorConversion }, sucursalId);

  // Misma fecha en toda la prueba: la huella de idempotencia incluye la fecha, y un reintento real reenvía el mismo formulario.
  const FECHA = new Date();
  // Desde la etapa 1 de Compras el proveedor y el número de factura son obligatorios, y «cómo lo llama el proveedor» también en la primera compra de cada producto.
  // Un reintento real reenvía el mismo formulario, con el mismo número: la prueba de idempotencia lo pasa explícito.
  const comprar = (productoId: string, cantidad: number, precioTotal: number, clave: string = crypto.randomUUID(), nroFactura: string = nroFacturaDePrueba()) =>
    registrarMovimiento({ proceso: "COMPRA", fecha: FECHA, seccionId, proveedorId, nroFactura, items: [{ productoId, cantidad, precioTotal, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: clave });

  it("empate que el float redondeaba mal: 1 × 1,005 en una unidad de 2 decimales guarda 1,01 (antes 1,00) y el precio por unidad exacto", async () => {
    const mp = await crearMP("Empate", "1.005");
    expect(Math.round(1 * 1.005 * 100) / 100).toBe(1); // referencia: así lo guardaba el código viejo (float) — 1,005 × 100 = 100,49999999999999

    const r = await comprar(mp.id, 1, 10);
    expect(r.ok, r.mensaje).toBe(true);

    const linea = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id } });
    expect(linea.cantidad.toFixed(4)).toBe("1.0100");
    expect(linea.precioTotal.toFixed(2)).toBe("10.00");
    // `precioUnitario` (10 ÷ 1 comprada) no vive en MovimientoStock: lo guarda el vínculo con el proveedor.
    const vinculo = await prisma.proveedorPorProducto.findFirstOrThrow({ where: { productoId: mp.id, proveedorId } });
    expect(vinculo.precioUnitario.toFixed(4)).toBe("10.0000");
    expect(vinculo.precioPorUnidadStock.toFixed(4)).toBe("9.9010");
    expect(linea.precioPorUnidadStock.toFixed(4)).toBe("9.9010"); // 10 ÷ 1,01 = 9,900990… → 9,9010
    expect(linea.detalle).toBe("1 × 1.005 = 1.005 kg");
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(1.01);
  });

  it("sin ruido de float: 3 × 0,1 guarda 0,3 y el detalle dice «= 0.3» (no 0.30000000000000004); 100,10 ÷ 0,3 = 333,6667", async () => {
    const mp = await crearMP("Ruido", "0.1");
    expect(3 * 0.1).not.toBe(0.3); // referencia: el ruido existe en JS

    const r = await comprar(mp.id, 3, 100.1);
    expect(r.ok, r.mensaje).toBe(true);

    const linea = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id } });
    expect(linea.cantidad.toFixed(4)).toBe("0.3000");
    const vinculo = await prisma.proveedorPorProducto.findFirstOrThrow({ where: { productoId: mp.id, proveedorId } });
    expect(vinculo.precioUnitario.toFixed(4)).toBe("33.3667"); // 100,10 ÷ 3
    expect(vinculo.precioPorUnidadStock.toFixed(4)).toBe("333.6667");
    expect(linea.precioPorUnidadStock.toFixed(4)).toBe("333.6667"); // 100,10 ÷ 0,3
    expect(linea.detalle).toBe("3 × 0.1 = 0.3 kg");
  });

  it("idempotencia: repetir la compra con la MISMA clave de reintento no duplica ni stock ni filas", async () => {
    const mp = await crearMP("Idem", "1.005");
    const clave = crypto.randomUUID();
    const nroFactura = nroFacturaDePrueba();

    const primera = await comprar(mp.id, 1, 10, clave, nroFactura);
    expect(primera.ok, primera.mensaje).toBe(true);
    const segunda = await comprar(mp.id, 1, 10, clave, nroFactura);
    expect(segunda.ok, segunda.mensaje).toBe(true);
    expect(segunda.mensaje).toBe(primera.mensaje); // el mensaje ORIGINAL

    expect(await prisma.facturaProveedor.count({ where: { claveIdempotencia: clave } }), "la clave vive en la cabecera de la factura").toBe(1);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(1);
    const lineas = await prisma.movimientoStock.findMany({ where: { productoId: mp.id } });
    expect(lineas).toHaveLength(1);
    expect(lineas[0].cantidad.toFixed(4)).toBe("1.0100");
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(1.01);
  });

  it("anular la compra (sin empate) revierte el stock a cero exacto y el contra-asiento lleva el precio de la compra", async () => {
    const mp = await crearMP("Anula", "0.1");
    const r = await comprar(mp.id, 3, 100.1);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(0.3);
    const compra = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA", sucursalId } });

    const anulada = await anularCompraDeTest(compra.id);
    expect(anulada.ok, anulada.mensaje).toBe(true);

    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(0);
    const reversion = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id, proceso: "AJUSTE" } });
    expect(reversion.cantidad.toFixed(4)).toBe("-0.3000");
    expect(reversion.precioTotal.toFixed(2)).toBe("-100.10");
    expect(reversion.precioPorUnidadStock.toFixed(4)).toBe("333.6667");
  });

  it("anular una compra CON empate también cierra en cero: la reversión es el opuesto exacto de lo guardado (no se vuelve a redondear)", async () => {
    const mp = await crearMP("AnulaEmpate", "1.005");
    const r = await comprar(mp.id, 1, 10);
    expect(r.ok, r.mensaje).toBe(true);
    const compra = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA", sucursalId } });

    const anulada = await anularCompraDeTest(compra.id);
    expect(anulada.ok, anulada.mensaje).toBe(true);

    const reversion = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id, proceso: "AJUSTE" } });
    expect(reversion.cantidad.toFixed(4)).toBe("-1.0100");
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(0);
  });

  /**
   * CARACTERIZACIÓN DEL COMPORTAMIENTO ACTUAL (no es una regla aprobada): el empate de redondeo va hacia +∞ (la regla heredada de
   * `Math.round`), así que un mismo valor con empate se redondea distinto según el signo: 0,125 → 0,13 pero −0,125 → −0,12 con 2
   * decimales. Hoy solo un movimiento que llega FIRMADO a `armarLineaMovimiento` (un AJUSTE manual) redondea un negativo; Compra,
   * Consumo, Merma, etc. redondean la MAGNITUD positiva y recién después aplican el signo. Si el dueño decide que el empate sea
   * simétrico, estas aserciones van a fallar a propósito, para que el cambio quede a la vista.
   */
  it("CARACTERIZACIÓN del comportamiento actual: un AJUSTE de +0,125 y otro de −0,125 en kg (2 decimales) NO se compensan: +0,13 y −0,12", async () => {
    const mp = await crearMP("Asimetria", "1");
    expect((await comprar(mp.id, 10, 0)).ok).toBe(true);
    const ajustar = (cantidad: number) =>
      registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad }], claveIdempotencia: crypto.randomUUID() });

    // `validarCantidad` rechaza 3 decimales en una unidad de 2, pero el AJUSTE no pasa por ese guard (solo la compra): se prueba lo que pasa hoy.
    const sube = await ajustar(0.125);
    const baja = await ajustar(-0.125);
    expect(sube.ok, sube.mensaje).toBe(true);
    expect(baja.ok, baja.mensaje).toBe(true);

    const filas = await prisma.movimientoStock.findMany({ where: { productoId: mp.id, proceso: "AJUSTE" }, orderBy: { creadoEn: "asc" } });
    expect(filas.map((f) => f.cantidad.toFixed(4))).toEqual(["0.1300", "-0.1200"]);
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(10.01); // 10 + 0,13 − 0,12: queda 1 centésima de diferencia
  });
});
