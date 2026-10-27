import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { aceptarTransferencia, crearEnvioDirectoTransferencia } from "../../src/server/actions/traspasos/traspasos";
import { obtenerCostoActualPorMP } from "../../src/server/lecturas/reportes/comun";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";
import { calcularValuacionInventario } from "../../src/server/consultas/reportes/valuacion";

/**
 * E2 «el costo viaja con el traspaso» (docs/diseno-costo-en-el-traspaso-2026-10-27.md, ADR-040): LÍNEA DE BASE de los reportes sobre datos YA CARGADOS.
 *
 * Se escribió ANTES de tocar el código (commit de línea de base) y fija, sobre un mundo sembrado directo en el Kardex como lo dejaron las versiones anteriores
 * (compras y ventas en dos sucursales y un traspaso VIEJO con sus líneas a precio 0), el ratio compras/ventas, `totalGastado`, el costo de reposición y la
 * valuación de las dos sucursales. Lo que dice cada prueba:
 *  1. Datos viejos: después de E2 los cuatro números dan EXACTAMENTE lo mismo (el traspaso viejo sigue sin costo: el filtro `> 0` lo excluye).
 *  2. Un traspaso NUEVO, por las acciones reales: el gasto y el ratio de las dos sucursales NO se mueven (el traspaso no es gasto); el costo y la valuación del
 *     destino son lo único que cambia (antes de E2, «sin costo»; después, el costo del origen).
 */
describe("E2: reportes sobre datos existentes y con un traspaso nuevo", () => {
  let sucursalAId: string;
  let sucursalBId: string;
  let seccionAId: string;
  let seccionBId: string;
  let harinaId: string;
  let azucarId: string;
  let adminAId: string;
  let adminBId: string;

  const DESDE = new Date("2026-08-01T03:00:00.000Z");

  const comoA = () => mockearUsuarioActual({ id: adminAId, email: "admin-a@test.com", nombre: null });
  const comoB = () => mockearUsuarioActual({ id: adminBId, email: "admin-b@test.com", nombre: null });

  async function linea(sucursalId: string, seccionId: string, proceso: "COMPRA" | "VENTA", fecha: string, productoId: string, cantidad: number, precioTotal: number) {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso, fecha: new Date(fecha), usuarioId: adminAId } });
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId, seccionId, proceso, cantidad, detalle: proceso, precioTotal, precioPorUnidadStock: precioTotal / Math.abs(cantidad) },
    });
  }

  /** Un traspaso como los que dejó el código anterior a E2: ACEPTADO, salida y entrada a precio 0. */
  async function traspasoViejo(productoId: string, cantidad: number) {
    const t = await prisma.traspasoSucursal.create({
      data: {
        origenSucursalId: sucursalAId, destinoSucursalId: sucursalBId, productoId, cantidad, seccionOrigenId: seccionAId, seccionDestinoId: seccionBId,
        iniciadoPor: "ORIGEN", estado: "ACEPTADA", creadoPorId: adminAId, fechaDecisionOrigen: new Date("2026-08-10T15:00:00Z"), decididoPorOrigenId: adminAId,
        fechaDecisionDestino: new Date("2026-08-10T16:00:00Z"), decididoPorDestinoId: adminBId,
      },
    });
    for (const [sucursalId, seccionId, proceso, signo, fecha] of [
      [sucursalAId, seccionAId, "TRANSFERENCIA_SALIDA_SUCURSAL", -1, "2026-08-10T15:00:00Z"],
      [sucursalBId, seccionBId, "TRANSFERENCIA_ENTRADA_SUCURSAL", 1, "2026-08-10T16:00:00Z"],
    ] as const) {
      const op = await prisma.operacion.create({ data: { sucursalId, proceso, fecha: new Date(fecha), usuarioId: adminAId } });
      await prisma.movimientoStock.create({
        data: { operacionId: op.id, productoId, seccionId, proceso, cantidad: signo * cantidad, detalle: "Traspaso viejo", precioTotal: 0, precioPorUnidadStock: 0, traspasoSucursalId: t.id },
      });
    }
  }

  async function foto(hasta: Date) {
    const porSucursal = async (sucursalId: string) => {
      const periodo = await obtenerReportePorPeriodo(sucursalId, DESDE, hasta, {}, prisma, hasta);
      const costos = await obtenerCostoActualPorMP(sucursalId, prisma);
      const valuacion = await calcularValuacionInventario(sucursalId, prisma);
      return {
        totalGastado: periodo.compras.totalGastado,
        totalFacturado: periodo.ventas.totalFacturado,
        ratio: periodo.ratioGastoVentas.porcentaje,
        costoHarina: costos.get(harinaId)?.precioPorUnidadStock ?? null,
        costoAzucar: costos.get(azucarId)?.precioPorUnidadStock ?? null,
        valuacionTotal: valuacion.totalValorizado,
        sinCosto: valuacion.cantidadSinCosto,
        harina: valuacion.filas.find((f) => f.productoId === harinaId) ?? null,
      };
    };
    return { A: await porSucursal(sucursalAId), B: await porSucursal(sucursalBId) };
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalAId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;
    adminAId = (await crearUsuarioConMembresia({ email: "admin-a@test.com", sucursalId: sucursalAId, rolId: base.admin.id })).id;
    adminBId = (await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: sucursalBId, rolId: base.admin.id })).id;

    const harina = await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } });
    const azucar = await prisma.producto.create({ data: { codigo: "MP_AZUCAR", nombre: "Azúcar", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } });
    const pan = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 500 } });
    harinaId = harina.id;
    azucarId = azucar.id;
    await prisma.disponibilidadProducto.createMany({
      data: [harina.id, azucar.id, pan.id].flatMap((productoId) => [sucursalAId, sucursalBId].map((sucursalId) => ({ sucursalId, productoId, disponible: true }))),
    });

    // A compra harina dos veces (la más reciente, 120 el kg) y vende; B compra azúcar y vende.
    await linea(sucursalAId, seccionAId, "COMPRA", "2026-08-02T12:00:00Z", harinaId, 10, 1000);
    await linea(sucursalAId, seccionAId, "COMPRA", "2026-08-05T12:00:00Z", harinaId, 4, 480);
    await linea(sucursalAId, seccionAId, "VENTA", "2026-08-06T12:00:00Z", pan.id, -3, 1500);
    await linea(sucursalBId, seccionBId, "COMPRA", "2026-08-03T12:00:00Z", azucarId, 5, 250);
    await linea(sucursalBId, seccionBId, "VENTA", "2026-08-07T12:00:00Z", pan.id, -2, 1000);
    await traspasoViejo(harinaId, 3);
  });

  it("datos viejos: gasto, ratio, costo y valuación de las dos sucursales (el traspaso viejo no tiene costo y sigue sin tenerlo)", async () => {
    const f = await foto(new Date("2026-08-31T12:00:00Z"));
    expect(f.A).toMatchObject({ totalGastado: 1480, totalFacturado: 1500, ratio: 98.7, costoHarina: 120, costoAzucar: null, valuacionTotal: 1320, sinCosto: 0 });
    expect(f.A.harina).toMatchObject({ saldo: 11, costoUnitario: 120, valor: 1320, sinCosto: false });
    expect(f.B).toMatchObject({ totalGastado: 250, totalFacturado: 1000, ratio: 25, costoHarina: null, costoAzucar: 50, valuacionTotal: 250, sinCosto: 1 });
    expect(f.B.harina).toMatchObject({ saldo: 3, costoUnitario: null, valor: null, sinCosto: true });
  });

  it("traspaso NUEVO por las acciones: el gasto y el ratio no se mueven; solo cambian el costo y la valuación del destino", async () => {
    const hasta = new Date();
    const antes = await foto(hasta);

    await comoA();
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: harinaId, cantidad: 2.5, seccionOrigenId: seccionAId });
    expect(envio.ok, envio.ok ? "" : envio.mensaje).toBe(true);
    if (!envio.ok) return;
    await comoB();
    const aceptar = await aceptarTransferencia(envio.id, seccionBId, crypto.randomUUID());
    expect(aceptar.ok, aceptar.ok ? "" : aceptar.mensaje).toBe(true);

    const despues = await foto(hasta);
    for (const s of ["A", "B"] as const) {
      expect(despues[s].totalGastado, `${s}: gasto`).toBe(antes[s].totalGastado);
      expect(despues[s].totalFacturado, `${s}: facturado`).toBe(antes[s].totalFacturado);
      expect(despues[s].ratio, `${s}: ratio`).toBe(antes[s].ratio);
      expect(despues[s].costoAzucar, `${s}: costo de lo que no viajó`).toBe(antes[s].costoAzucar);
    }
    // El origen: mismo costo, menos stock.
    expect(despues.A.costoHarina).toBe(120);
    expect(despues.A.harina).toMatchObject({ saldo: 8.5, costoUnitario: 120, valor: 1020 });
    // El destino (LÍNEA DE BASE, antes de E2): la harina recibida sigue sin costo.
    expect(despues.B.costoHarina).toBeNull();
    expect(despues.B.harina).toMatchObject({ saldo: 5.5, costoUnitario: null, valor: null, sinCosto: true });
    expect(despues.B.valuacionTotal).toBe(250);
  });
});
