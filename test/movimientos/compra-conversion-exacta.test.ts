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
 * guardan tal cual en `MovimientoStock` (Decimal(14,4)). La regla de redondeo (empate alejándose del cero para la cantidad y para los precios;
 * antes de A1b, 2026-11-16, la cantidad iba hacia +∞ y se redondeaba a los decimales de la unidad, ahora son 4 decimales fijos) se prueba en `test/core/conversion-compra-exacta.test.ts` contra un oráculo BigInt; acá se prueba que lo calculado
 * es lo que queda en la base, y que la idempotencia y la anulación se comportan igual con estas cuentas.
 */
describe("compra con factor de conversión decimal: cuentas exactas de punta a punta", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string; // kg: 2 decimales (desde A1b, 2026-11-16, el stock se guarda igual a 4 decimales fijos)
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

  // A1b 2026-11-16: stock con 4 decimales fijos y cuenta exacta; antes este test usaba 1 × 1,005 en kg (2 decimales) → 1,01 con el empate
  // a los decimales de la unidad. Ahora 1,005 se guarda tal cual (1,0050): el empate relevante está en el 5.º decimal. Se usa 0,3 × 1,0025
  // = 0,30075 → 0,3008 (empate alejándose del cero); el float (0,3 × 1,0025 = 0,30074999999999996) lo dejaba en 0,3007.
  it("empate que el float redondeaba mal: 0,3 × 1,0025 = 0,30075 guarda 0,3008 (con float daba 0,3007) y el precio por unidad exacto", async () => {
    const mp = await crearMP("Empate", "1.0025");
    expect(Math.round(0.3 * 1.0025 * 1e4) / 1e4).toBe(0.3007); // referencia: así lo guardaba el código viejo (float) — 0,3 × 1,0025 = 0,30074999999999996

    const r = await comprar(mp.id, 0.3, 10);
    expect(r.ok, r.mensaje).toBe(true);

    const linea = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id } });
    expect(linea.cantidad.toFixed(4)).toBe("0.3008");
    expect(linea.precioTotal.toFixed(2)).toBe("10.00");
    // El precio por unidad COMPRADA (10 ÷ 0,3) ya no se guarda en el vínculo (poda 2026-11-06): se deriva del renglón de la factura (precio total ÷ cantidad comprada; la compra es una factura de una parte).
    const renglon = await prisma.facturaProveedorRenglon.findFirstOrThrow({ where: { productoId: mp.id } });
    expect(renglon.precioTotal.div(renglon.cantidadCompra!).toFixed(4)).toBe("33.3333");
    expect(linea.precioPorUnidadStock.toFixed(4)).toBe("33.2447"); // 10 ÷ 0,3008 = 33,24468… → 33,2447
    expect(linea.detalle).toBe("0.3 × 1.0025 = 0.30075 kg");
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(0.3008);
  });

  // A1b 2026-11-16 (prueba nueva): el comportamiento que cambió de verdad. Con kg de 2 decimales 1 × 1,005 se redondeaba a 1,01; con 4
  // decimales fijos entra exacto, sin redondeo.
  it("1 × 1,005 en una unidad de 2 decimales guarda 1,0050 exacto (4 decimales fijos; antes 1,01) y el precio por unidad 10 ÷ 1,005", async () => {
    const mp = await crearMP("Exacto4", "1.005");
    const r = await comprar(mp.id, 1, 10);
    expect(r.ok, r.mensaje).toBe(true);
    const linea = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id } });
    expect(linea.cantidad.toFixed(4)).toBe("1.0050");
    expect(linea.precioPorUnidadStock.toFixed(4)).toBe("9.9502"); // 10 ÷ 1,005 = 9,950248… → 9,9502
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(1.005);
  });

  it("sin ruido de float: 3 × 0,1 guarda 0,3 y el detalle dice «= 0.3» (no 0.30000000000000004); 100,10 ÷ 0,3 = 333,6667", async () => {
    const mp = await crearMP("Ruido", "0.1");
    expect(3 * 0.1).not.toBe(0.3); // referencia: el ruido existe en JS

    const r = await comprar(mp.id, 3, 100.1);
    expect(r.ok, r.mensaje).toBe(true);

    const linea = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id } });
    expect(linea.cantidad.toFixed(4)).toBe("0.3000");
    const renglon = await prisma.facturaProveedorRenglon.findFirstOrThrow({ where: { productoId: mp.id } });
    expect(renglon.precioTotal.div(renglon.cantidadCompra!).toFixed(4)).toBe("33.3667"); // 100,10 ÷ 3, derivado del renglón (el vínculo ya no guarda el precio)
    expect(linea.precioPorUnidadStock.toFixed(4)).toBe("333.6667"); // 100,10 ÷ 0,3
    expect(linea.detalle).toBe("3 × 0.1 = 0.3 kg");
  });

  it("idempotencia: repetir la compra con la MISMA clave de reintento no duplica ni stock ni filas", async () => {
    const mp = await crearMP("Idem", "1.0025"); // A1b 2026-11-16: antes 1,005 con 1 comprada (1,01); ahora el empate está en el 5.º decimal (0,3 × 1,0025 → 0,3008)
    const clave = crypto.randomUUID();
    const nroFactura = nroFacturaDePrueba();

    const primera = await comprar(mp.id, 0.3, 10, clave, nroFactura);
    expect(primera.ok, primera.mensaje).toBe(true);
    const segunda = await comprar(mp.id, 0.3, 10, clave, nroFactura);
    expect(segunda.ok, segunda.mensaje).toBe(true);
    expect(segunda.mensaje).toBe(primera.mensaje); // el mensaje ORIGINAL

    expect(await prisma.facturaProveedor.count({ where: { claveIdempotencia: clave } }), "la clave vive en la cabecera de la factura").toBe(1);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(1);
    const lineas = await prisma.movimientoStock.findMany({ where: { productoId: mp.id } });
    expect(lineas).toHaveLength(1);
    expect(lineas[0].cantidad.toFixed(4)).toBe("0.3008");
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(0.3008);
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
    const mp = await crearMP("AnulaEmpate", "1.0025"); // A1b 2026-11-16: el empate pasó al 5.º decimal (0,3 × 1,0025 = 0,30075 → 0,3008)
    const r = await comprar(mp.id, 0.3, 10);
    expect(r.ok, r.mensaje).toBe(true);
    const compra = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA", sucursalId } });

    const anulada = await anularCompraDeTest(compra.id);
    expect(anulada.ok, anulada.mensaje).toBe(true);

    const reversion = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id, proceso: "AJUSTE" } });
    expect(reversion.cantidad.toFixed(4)).toBe("-0.3008");
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(0);
  });

  /**
   * A1b 2026-11-16 («Pasar a cuenta exacta como Pedernal» y «4 decimales fijos como Pedernal»): ANTES esta prueba caracterizaba una
   * asimetría (el empate iba hacia +∞ como `Math.round`: +0,125 → +0,13 pero −0,125 → −0,12 con los 2 decimales de kg, así que no se
   * compensaban y quedaba 1 centésima). Ahora el stock es a 4 decimales fijos y el empate se aleja del cero, SIMÉTRICO: +0,125 y −0,125
   * entran exactos y se compensan; y un empate verdadero (5.º decimal) también es simétrico: +0,00005 → +0,0001 y −0,00005 → −0,0001.
   */
  it("un AJUSTE de +0,125 y otro de −0,125 en kg se compensan exacto (4 decimales fijos); y el empate del 5.º decimal es simétrico: ±0,00005 → ±0,0001", async () => {
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
    expect(filas.map((f) => f.cantidad.toFixed(4))).toEqual(["0.1250", "-0.1250"]); // A1b: antes ["0.1300", "-0.1200"]
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(10); // A1b: antes 10,01 (quedaba 1 centésima de diferencia)

    // El empate del 5.º decimal: alejándose del cero, igual para el positivo que para el negativo.
    expect((await ajustar(0.00005)).ok).toBe(true);
    expect((await ajustar(-0.00005)).ok).toBe(true);
    const filasEmpate = await prisma.movimientoStock.findMany({ where: { productoId: mp.id, proceso: "AJUSTE" }, orderBy: { creadoEn: "asc" } });
    expect(filasEmpate.slice(2).map((f) => f.cantidad.toFixed(4))).toEqual(["0.0001", "-0.0001"]);
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(10);
  });
});
