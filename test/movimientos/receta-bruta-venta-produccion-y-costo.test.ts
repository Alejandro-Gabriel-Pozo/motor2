import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { calcularCostosYMargenes } from "../../src/server/lecturas/reportes/costos";
import { comprobanteDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { sumaExacta } from "../setup/suma-exacta";

/**
 * M3a, parte 2 (2026-11-17; `docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md` §7.2): el descuento de stock y el costo LEEN la marca de la versión de la receta.
 * - Receta NETA (todo lo ya cargado): la cantidad es lo que llega al plato; sale del stock y se costea la cantidad más su merma (`cantidad × (1 + merma/100)`), igual que antes.
 * - Receta BRUTA: la cantidad YA es lo que sale del stock: se descuenta y se costea tal cual, SIN multiplicar por la merma.
 * Hoy ningún camino de la aplicación escribe BRUTA (llega con M3b): la versión se crea directo en la base (`prisma.recetaVersion.create`) para probar los dos lados.
 *
 * Fixture: una MP «Carne» (kg) comprada a $50/kg y cuatro platos con la MISMA línea de receta (0,2 kg con 25 % de merma), dos NETA y dos BRUTA, para vender y para producir.
 * Números: NETA 3 × 0,2 × 1,25 = 0,75 kg ($37,5); BRUTA 3 × 0,2 = 0,6 kg ($30). Producción de 2: NETA 0,5 kg, BRUTA 0,4 kg.
 */
describe("la receta BRUTA se descuenta y se costea sin multiplicar por la merma (M3a)", () => {
  let seccionId: string;
  let sucursalId: string;
  let carne: { id: string };
  let milanesaNeta: { id: string };
  let milanesaBruta: { id: string };
  let tartaNeta: { id: string };
  let tartaBruta: { id: string };
  const fecha = new Date("2026-03-10T12:00:00Z");

  const consumoDe = async (productoId: string, proceso: "VENTA" | "PRODUCCION") => {
    const filas = await prisma.movimientoStock.findMany({ where: { productoId: carne.id, proceso: "CONSUMO", operacion: { proceso } } });
    return filas;
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(base.sucursal.id, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    carne = await sembrarProductoDisponible({ codigo: "MP_CARNE", nombre: "Carne", tipo: "MP", unidadStockId: kg.id }, base.sucursal.id);
    milanesaNeta = await sembrarProductoDisponible({ codigo: "PV_MIL_N", nombre: "Milanesa neta", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, base.sucursal.id);
    milanesaBruta = await sembrarProductoDisponible({ codigo: "PV_MIL_B", nombre: "Milanesa bruta", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, base.sucursal.id);
    tartaNeta = await sembrarProductoDisponible({ codigo: "PV_TAR_N", nombre: "Tarta neta", tipo: "PV", unidadStockId: kg.id, seProduce: true, precioVenta: 100 }, base.sucursal.id);
    tartaBruta = await sembrarProductoDisponible({ codigo: "PV_TAR_B", nombre: "Tarta bruta", tipo: "PV", unidadStockId: kg.id, seProduce: true, precioVenta: 100 }, base.sucursal.id);

    for (const [producto, baseDeCantidad] of [[milanesaNeta, "NETA"], [milanesaBruta, "BRUTA"], [tartaNeta, "NETA"], [tartaBruta, "BRUTA"]] as const) {
      await prisma.recetaVersion.create({
        data: { productoId: producto.id, version: 1, baseDeCantidad, ingredientes: { create: [{ insumoProductoId: carne.id, cantidad: 0.2, mermaPorcentaje: 25, unidadId: kg.id }] } },
      });
    }
    const compra = await registrarMovimiento({
      proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha, seccionId,
      items: [{ productoId: carne.id, cantidad: 20, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
      claveIdempotencia: crypto.randomUUID(), // $50/kg
    });
    expect(compra.ok, compra.mensaje).toBe(true);
  });

  it("venta: la receta NETA descuenta 0,75 kg (con la merma) y la BRUTA 0,6 kg (la cantidad tal cual) por 3 unidades", async () => {
    const neta = await registrarVenta({ fecha, seccionId, ventas: [{ productoId: milanesaNeta.id, cantidadVendida: 3 }] });
    expect(neta.ok, neta.mensaje).toBe(true);
    expect(sumaExacta((await consumoDe(milanesaNeta.id, "VENTA")).map((f) => Number(f.cantidad)))).toBe(-0.75);

    const bruta = await registrarVenta({ fecha, seccionId, ventas: [{ productoId: milanesaBruta.id, cantidadVendida: 3 }] });
    expect(bruta.ok, bruta.mensaje).toBe(true);
    // Las dos ventas juntas: 0,75 + 0,6 = 1,35 kg; la BRUTA aportó exactamente 0,6.
    expect(sumaExacta((await consumoDe(milanesaBruta.id, "VENTA")).map((f) => Number(f.cantidad)))).toBe(-1.35);
  });

  it("venta repetida con la misma clave de idempotencia no descuenta dos veces la receta BRUTA", async () => {
    const clave = crypto.randomUUID();
    const una = await registrarVenta({ fecha, seccionId, ventas: [{ productoId: milanesaBruta.id, cantidadVendida: 3 }], claveIdempotencia: clave });
    const dos = await registrarVenta({ fecha, seccionId, ventas: [{ productoId: milanesaBruta.id, cantidadVendida: 3 }], claveIdempotencia: clave });
    expect(una.ok && dos.ok).toBe(true);
    expect(sumaExacta((await consumoDe(milanesaBruta.id, "VENTA")).map((f) => Number(f.cantidad)))).toBe(-0.6);
  });

  it("producción: 2 unidades de la tarta NETA consumen 0,5 kg y las de la BRUTA 0,4 kg", async () => {
    const neta = await registrarMovimiento({ proceso: "PRODUCCION", fecha, seccionId, items: [{ productoId: tartaNeta.id, cantidad: 2 }], claveIdempotencia: crypto.randomUUID() });
    expect(neta.ok, neta.mensaje).toBe(true);
    expect(sumaExacta((await consumoDe(tartaNeta.id, "PRODUCCION")).map((f) => Number(f.cantidad)))).toBe(-0.5);

    const bruta = await registrarMovimiento({ proceso: "PRODUCCION", fecha, seccionId, items: [{ productoId: tartaBruta.id, cantidad: 2 }], claveIdempotencia: crypto.randomUUID() });
    expect(bruta.ok, bruta.mensaje).toBe(true);
    expect(sumaExacta((await consumoDe(tartaBruta.id, "PRODUCCION")).map((f) => Number(f.cantidad)))).toBe(-0.9); // 0,5 + 0,4
  });

  it("costo de la receta: NETA $50 × 0,2 × 1,25 = $12,50 por unidad; BRUTA $50 × 0,2 = $10 (sin la merma)", async () => {
    const costos = await calcularCostosYMargenes(sucursalId, prisma);
    const costoDe = (nombre: string) => costos.find((c) => c.productoNombre === nombre)?.costo;
    expect(costoDe("Milanesa neta")).toBe(12.5);
    expect(costoDe("Milanesa bruta")).toBe(10);
    expect(costoDe("Tarta bruta")).toBe(10);
  });
});
