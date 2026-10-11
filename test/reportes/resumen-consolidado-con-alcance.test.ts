import { beforeEach, describe, expect, it, vi } from "vitest";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion, crearUsuarioConMembresia } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { crearMembresia } from "../setup/membresia";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerResumenConsolidado } from "../../src/server/consultas/reportes/resumen-consolidado";

/**
 * Plan M.3 §9 (paquete 1): `reportes/periodo.ts` (`cargarLineasDelPeriodoDeSucursales`, la lectura de las líneas de Kardex de VARIAS sucursales) no ensancha nada por su cuenta: lee con la `db` que le
 * pasa quien la llama, y su único llamador con varias sucursales es el Consolidado (`obtenerResumenConsolidado`), cuya página ya la llama con `lecturaEnSucursalesVisibles(ctx, "reporte_consolidado").db`
 * (`test/arquitectura/lectores-de-varias-sucursales.test.ts`, `test/auth/alcance-de-lectores.test.tsx`). Por eso el lector es correcto y no se cambia. Lo que faltaba es una prueba con una base que SÍ tiene
 * alcance (las otras usan el cliente de los fixtures, que está fuera de las políticas): acá el consolidado corre con `baseDeTest(alcance)`, el mismo cliente de producción.
 *  - con lectura en A y B trae las ventas de las dos sucursales, con o sin políticas;
 *  - con lectura solo en A (un lector al que se le pasó `ctx.db` a secas) trae el real de A, y las líneas de B solo desaparecen si la base tiene las políticas (el motivo por el que la página ensancha).
 */
describe("el Consolidado (periodo.ts, varias sucursales) bajo el alcance de la base", () => {
  let A: string;
  let B: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    A = base.sucursal.id;
    B = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const catalogo = await sembrarCatalogoBase();
    const seccionA = await sembrarSeccion(A);
    const seccionB = await sembrarSeccion(B);
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: A, rolId: base.admin.id });
    await crearMembresia({ usuarioId: admin.id, sucursalId: B, rolId: base.admin.id, activo: true });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const pvA = await sembrarProductoDisponible({ codigo: "PV_A", nombre: "Pan Central", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 }, A);
    const pvB = await sembrarProductoDisponible({ codigo: "PV_B", nombre: "Pan Norte", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 50 }, B);
    __setCookieDeTestParaSucursal(A);
    await registrarVenta({ fecha: AHORA_DE_LA_CORRIDA, seccionId: seccionA.id, ventas: [{ productoId: pvA.id, cantidadVendida: 2 }] });
    __setCookieDeTestParaSucursal(B);
    await registrarVenta({ fecha: AHORA_DE_LA_CORRIDA, seccionId: seccionB.id, ventas: [{ productoId: pvB.id, cantidadVendida: 3 }] });
    __setCookieDeTestParaSucursal(undefined);
  });

  async function hayPoliticasDeSucursal(): Promise<boolean> {
    const [fila] = await prismaAdmin.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_policies WHERE policyname = 'alcance_sucursal_select' AND tablename = 'MovimientoStock'`;
    return Number(fila.n) > 0;
  }

  const ventas = async (alcance: { lectura: string[]; escritura: string[] }) => {
    const filas = await obtenerResumenConsolidado([{ id: A, nombre: "Central" }, { id: B, nombre: "Norte" }], baseDeTest(alcance).db, AHORA_DE_LA_CORRIDA);
    return Object.fromEntries(filas.map((f) => [f.sucursalId, f.ventasTotal]));
  };

  it("con lectura ensanchada a A y B (lo que hace la página del Consolidado) suma las ventas de cada una: 2 × 100 y 3 × 50", async () => {
    expect(await ventas({ lectura: [A, B], escritura: [A] })).toEqual({ [A]: 200, [B]: 150 });
  });

  it("con la lectura de la sucursal activa a secas, B queda en 0 si la base tiene las políticas (por eso la página ensancha) y con su venta real si no", async () => {
    const conPoliticas = await hayPoliticasDeSucursal();
    expect(await ventas({ lectura: [A], escritura: [A] })).toEqual({ [A]: 200, [B]: conPoliticas ? 0 : 150 });
  });
});
