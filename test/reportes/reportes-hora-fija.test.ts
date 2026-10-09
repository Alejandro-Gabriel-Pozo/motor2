import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { AHORA_DE_LA_CORRIDA, DIA_MS, enElFuturo, enElPasado } from "../setup/tiempo";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { setFrecuenciaConteo } from "../../src/server/actions/stock/frecuencia-conteo";
import { generarReportePerdidas } from "../../src/server/consultas/reportes/perdidas";
import { generarReporteDevoluciones } from "../../src/server/consultas/reportes/devoluciones";
import { generarReporteLotesProximosAVencer, obtenerReporteVencimientosDatos } from "../../src/server/consultas/reportes/vencimientos";
import { generarReporteDiferenciasAjustes } from "../../src/server/consultas/reportes/diferencias-ajustes";
import { generarReporteSaludPorProducto } from "../../src/server/consultas/reportes/salud-por-producto";

/**
 * D.3a (docs/pureza-integracion.md): los reportes de pérdidas, devoluciones, vencimientos, diferencias de ajuste (y Salud por producto, que la usa) miden
 * el tiempo contra el `ahora` que reciben, no contra un reloj que leen por su cuenta. Cada caso arma un dato que entra con una hora y queda afuera con otra:
 * si el reporte volviera a leer `new Date()` adentro, el resultado con la hora fija sería el del reloj real y el caso daría rojo (lo mismo vigila, por AST,
 * `reloj-y-azar-en-el-servidor.test.ts`).
 */
describe("los reportes de la sucursal miden el tiempo contra el `ahora` que reciben (D.3a)", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let motivoVencidoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    motivoVencidoId = (await sembrarMotivosYDestinos()).motivos.get("Vencido")!;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const harina = () => sembrarProductoDisponible({ codigo: "MP_HORA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);

  it("pérdidas: una merma de hace 35 días entra en «últimos 30 días» con ahora = hace 10 días, y queda afuera con el reloj real", async () => {
    const mp = await harina();
    await registrarMovimiento({ proceso: "COMPRA", fecha: enElPasado(40 * DIA_MS), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] });
    await registrarMovimiento({ proceso: "MERMA", fecha: enElPasado(35 * DIA_MS), seccionId, motivoId: motivoVencidoId, items: [{ productoId: mp.id, cantidad: 2 }] });

    const conHoraFija = await generarReportePerdidas(sucursalId, 30, prisma, enElPasado(10 * DIA_MS));
    expect(conHoraFija.mermas.map((m) => m.motivo)).toEqual(["Vencido"]);
    expect(conHoraFija.totalMerma).toBe(20);

    const conRelojReal = await generarReportePerdidas(sucursalId, 30, prisma, AHORA_DE_LA_CORRIDA);
    expect(conRelojReal.mermas).toEqual([]);
  });

  it("devoluciones: una devolución de hace 35 días entra con ahora = hace 10 días, y queda afuera con el reloj real", async () => {
    const mp = await harina();
    await registrarMovimiento({ proceso: "COMPRA", fecha: enElPasado(40 * DIA_MS), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] });
    await registrarMovimiento({ proceso: "DEVOLUCION_CLIENTE", fecha: enElPasado(35 * DIA_MS), seccionId, items: [{ productoId: mp.id, cantidad: 2 }] });

    const conHoraFija = await generarReporteDevoluciones(sucursalId, 30, prisma, enElPasado(10 * DIA_MS));
    expect(conHoraFija.clientes.map((c) => [c.producto, c.cantidad])).toEqual([["Harina", 2]]);

    const conRelojReal = await generarReporteDevoluciones(sucursalId, 30, prisma, AHORA_DE_LA_CORRIDA);
    expect(conRelojReal.clientes).toEqual([]);
  });

  it("vencimientos: un lote que vence dentro de 20 días entra en «próximos 7 días» con ahora = dentro de 15 días, y queda afuera con el reloj real", async () => {
    const mp = await harina();
    const lote = new Date(enElFuturo(20 * DIA_MS).toISOString().slice(0, 10));
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5, loteVencimiento: lote }] });

    const enQuinceDias = enElFuturo(15 * DIA_MS);
    const conHoraFija = await generarReporteLotesProximosAVencer(sucursalId, 7, prisma, enQuinceDias);
    expect(conHoraFija.map((f) => f.loteVencimiento.toISOString().slice(0, 10))).toEqual([lote.toISOString().slice(0, 10)]);
    expect(conHoraFija[0].diasParaVencer).toBeGreaterThanOrEqual(4);
    expect(conHoraFija[0].diasParaVencer).toBeLessThanOrEqual(6);
    // La composición de la pantalla pasa el mismo `ahora`.
    expect((await obtenerReporteVencimientosDatos(sucursalId, 7, prisma, enQuinceDias)).proximosAVencer).toHaveLength(1);

    expect(await generarReporteLotesProximosAVencer(sucursalId, 7, prisma, AHORA_DE_LA_CORRIDA)).toEqual([]);
    expect((await obtenerReporteVencimientosDatos(sucursalId, 7, prisma, AHORA_DE_LA_CORRIDA)).proximosAVencer).toEqual([]);
  });

  it("diferencias de ajuste (y Salud, que la recibe): un conteo de hace 3 días con agenda semanal está al día con el reloj real y vencido con ahora = dentro de 10 días", async () => {
    const mp = await harina();
    await setFrecuenciaConteo(mp.id, 7);
    const haceTresDias = enElPasado(3 * DIA_MS);
    await registrarMovimiento({ proceso: "COMPRA", fecha: haceTresDias, seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
    await registrarConteoFisico({ productoId: mp.id, seccionId, conteoReal: 8, fechaConteo: haceTresDias, accion: "AJUSTAR" });

    const alDia = (await generarReporteDiferenciasAjustes(sucursalId, prisma, AHORA_DE_LA_CORRIDA)).find((f) => f.productoId === mp.id)!;
    expect(alDia.conteoVencido).toBe(false);
    const vencida = (await generarReporteDiferenciasAjustes(sucursalId, prisma, enElFuturo(10 * DIA_MS))).find((f) => f.productoId === mp.id)!;
    expect(vencida.conteoVencido).toBe(true);

    // Salud por producto le pasa su `ahora` a Diferencias (antes le pasaba `undefined` y Diferencias leía el reloj), pero de Diferencias solo toma el
    // `estado`, que no depende de la hora: su resultado es el mismo con las dos horas (se fija acá para que un cambio en eso se vea).
    const saludReal = await generarReporteSaludPorProducto(sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    const saludFija = await generarReporteSaludPorProducto(sucursalId, prisma, enElFuturo(10 * DIA_MS));
    expect(saludReal.find((f) => f.productoId === mp.id)).toBeDefined();
    expect(saludFija).toEqual(saludReal);
  });
});
