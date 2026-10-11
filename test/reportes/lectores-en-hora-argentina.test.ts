import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, sembrarCompraDeKardex, prisma } from "../setup/test-db";
import { ZONA_UTC } from "../../src/core/tiempo/zona-horaria";
import { listarComprasRegistradas } from "../../src/server/consultas/reportes/compras-registradas";
import { generarReportePerdidas } from "../../src/server/consultas/reportes/perdidas";
import { generarReporteDevoluciones } from "../../src/server/consultas/reportes/devoluciones";
import { obtenerHistorialProducto } from "../../src/server/consultas/reportes/historial-producto";
import { generarReporteLotesProximosAVencer, obtenerReporteVencimientosDatos } from "../../src/server/consultas/reportes/vencimientos";

/**
 * P1, paso 5: los lectores «de a un día» (Compras, Pérdidas, Devoluciones, Historial, Vencimientos; Rotación de mesas, en `rotacion-mesas.test.ts`) cortan el día en la zona de la empresa, el mismo corte
 * que Tickets. El borde de cada uno es la noche argentina: a las 22:30 del 30/9 el reloj UTC ya marca el 1/10, y un corte en UTC pone ese dato en el día equivocado.
 *
 * Todos los datos se siembran DIRECTO con `prisma` en instantes pasados y fijos (sin pasar por las acciones: su tope de 400 días hacia atrás haría caducar el test con el tiempo).
 * `desde`/`hasta` van como los entregan las páginas: fechas «de solo día» (`new Date("AAAA-MM-DD")`, 00:00 UTC).
 */

/** 22:30 argentinas del 30/9/2026 (= 01:30Z del 1/10): día 30 en Argentina, día 1 en UTC. */
const NOCHE_DEL_30 = new Date("2026-09-30T22:30:00-03:00");
/** 00:30 argentinas del 1/10/2026 (= 03:30Z): el día siguiente, también en UTC. */
const MADRUGADA_DEL_1 = new Date("2026-10-01T00:30:00-03:00");
/** 22:30 argentinas del 29/9/2026 (= 01:30Z del 30/9). */
const NOCHE_DEL_29 = new Date("2026-09-29T22:30:00-03:00");

describe("los lectores de un día cortan en la zona de la empresa (P1, paso 5)", () => {
  let sucursalId: string;
  let seccionId: string;
  let usuarioId: string;
  let unidadKgId: string;
  let insumoId: string;
  let motivoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    motivoId = (await sembrarMotivosYDestinos()).motivos.get("Vencido")!;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
  });

  const harina = () => sembrarProductoDisponible({ codigo: "MP_HORA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);

  /** Una operación de `proceso` en `fecha` con una línea de `cantidad` (con signo) del producto, escrita directo. */
  async function sembrarOperacion(proceso: "COMPRA" | "MERMA" | "DEVOLUCION_CLIENTE", fecha: Date, productoId: string, cantidad: number, extra: { nroFactura?: string; lote?: Date } = {}) {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso, fecha, usuarioId, nroFactura: extra.nroFactura ?? null, ...(proceso === "MERMA" ? { motivoId } : {}) } });
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId, seccionId, proceso, cantidad, detalle: "x", loteVencimiento: extra.lote ?? null } });
    return op;
  }

  describe("Compras registradas", () => {
    it("una compra de las 22:30 del 30/9 aparece en el 30/9 (no en el 1/10), con `desde`, con `hasta` o con los dos", async () => {
      const mp = await harina();
      await sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId, productoId: mp.id, proveedorId: null, fecha: NOCHE_DEL_30.toISOString(), precioPorUnidadStock: 5 });
      const idMadrugada = (await sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId, productoId: mp.id, proveedorId: null, fecha: MADRUGADA_DEL_1.toISOString(), precioPorUnidadStock: 7 })).id;
      const fechas = async (f: Parameters<typeof listarComprasRegistradas>[1]) => (await listarComprasRegistradas(sucursalId, f, prisma)).items.map((c) => c.fecha.toISOString()).sort();

      const dia30 = new Date("2026-09-30");
      const dia1 = new Date("2026-10-01");
      expect(await fechas({ desde: dia30, hasta: dia30 })).toEqual([NOCHE_DEL_30.toISOString()]);
      expect(await fechas({ desde: dia1, hasta: dia1 })).toEqual([MADRUGADA_DEL_1.toISOString()]);
      expect(await fechas({ hasta: dia30 })).toEqual([NOCHE_DEL_30.toISOString()]); // solo `hasta`: el día 30 entero, hasta las 23:59:59.999 argentinas
      expect(await fechas({ desde: dia1 })).toEqual([MADRUGADA_DEL_1.toISOString()]); // solo `desde`: desde las 00:00 argentinas del 1/10, no desde las 21:00 del 30/9
      expect((await listarComprasRegistradas(sucursalId, { desde: dia1, hasta: dia1 }, prisma)).items[0].idOperacion).toBe(idMadrugada);
    });

    it("la zona se puede pasar: con la zona UTC el mismo dato cae en el 1/10 (el parámetro se respeta)", async () => {
      const mp = await harina();
      await sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId, productoId: mp.id, proveedorId: null, fecha: NOCHE_DEL_30.toISOString(), precioPorUnidadStock: 5 });
      const dia1 = new Date("2026-10-01");
      expect((await listarComprasRegistradas(sucursalId, { desde: dia1, hasta: dia1 }, prisma, ZONA_UTC)).items).toHaveLength(1);
      expect((await listarComprasRegistradas(sucursalId, { desde: dia1, hasta: dia1 }, prisma)).items).toHaveLength(0);
    });
  });

  describe("Pérdidas y Devoluciones: el «hace N días» se cuenta en días de la zona", () => {
    // ahora = 22:30 argentinas del 30/9: «hace 1 día» arranca a las 00:00 argentinas del 29/9 (03:00Z), no a las 00:00 UTC del 30/9.
    const AHORA = NOCHE_DEL_30;
    const INICIO_ARGENTINO_DEL_29 = new Date("2026-09-29T03:00:00.000Z");

    it("pérdidas: una merma de las 17:00 del 29/9 (20:00Z) entra en «hace 1 día»; una de las 23:59:59.999 del 28/9 no, y la de las 00:00 del 29/9 sí", async () => {
      const mp = await harina();
      await sembrarOperacion("MERMA", new Date("2026-09-29T20:00:00.000Z"), mp.id, -2);
      await sembrarOperacion("MERMA", new Date(INICIO_ARGENTINO_DEL_29.getTime() - 1), mp.id, -3); // 23:59:59.999 del 28/9 argentino
      await sembrarOperacion("MERMA", INICIO_ARGENTINO_DEL_29, mp.id, -5); // 00:00:00.000 del 29/9 argentino

      const rep = await generarReportePerdidas(sucursalId, 1, prisma, AHORA);
      expect(rep.desde).toEqual(INICIO_ARGENTINO_DEL_29);
      expect(rep.mermas.map((m) => m.cantidad).sort()).toEqual([2, 5]);
    });

    it("devoluciones: lo mismo, con el mismo corte", async () => {
      const mp = await harina();
      await sembrarOperacion("DEVOLUCION_CLIENTE", new Date("2026-09-29T20:00:00.000Z"), mp.id, 2);
      await sembrarOperacion("DEVOLUCION_CLIENTE", new Date(INICIO_ARGENTINO_DEL_29.getTime() - 1), mp.id, 3);
      await sembrarOperacion("DEVOLUCION_CLIENTE", INICIO_ARGENTINO_DEL_29, mp.id, 5);

      const rep = await generarReporteDevoluciones(sucursalId, 1, prisma, AHORA);
      expect(rep.desde).toEqual(INICIO_ARGENTINO_DEL_29);
      expect(rep.clientes.map((c) => c.cantidad)).toEqual([7]); // 2 + 5 del mismo producto
    });

    it("cambio de año: a las 22:30 del 31/12 «hace 1 día» arranca el 30/12 a las 00:00 argentinas", async () => {
      const ahora = new Date("2025-12-31T22:30:00-03:00");
      expect((await generarReportePerdidas(sucursalId, 1, prisma, ahora)).desde).toEqual(new Date("2025-12-30T03:00:00.000Z"));
      expect((await generarReporteDevoluciones(sucursalId, 1, prisma, ahora)).desde).toEqual(new Date("2025-12-30T03:00:00.000Z"));
    });
  });

  describe("Historial de un producto: los DOS lados del rango se expanden en la zona", () => {
    it("`desde` y `hasta` del 30/9: se ve solo lo del día argentino 30 (la compra de las 22:30), y el saldo inicial arrastra la del 29", async () => {
      const mp = await harina();
      await sembrarOperacion("COMPRA", NOCHE_DEL_29, mp.id, 1);
      await sembrarOperacion("COMPRA", NOCHE_DEL_30, mp.id, 1);
      await sembrarOperacion("COMPRA", MADRUGADA_DEL_1, mp.id, 1);

      const dia30 = new Date("2026-09-30");
      const h = await obtenerHistorialProducto(sucursalId, mp.id, undefined, dia30, dia30, prisma);
      expect(h!.eventos.map((e) => e.fecha.toISOString())).toEqual([NOCHE_DEL_30.toISOString()]);
      expect(h!.eventos[0].saldoCorriente).toBe(2); // 1 de saldo inicial (la del 29) + 1
      expect(h!.totalMovimientos).toBe(3);
      expect(h!.saldoActual).toBe(3);
    });

    it("solo `desde` del 1/10 deja afuera la de las 22:30 del 30/9 (antes entraba: el `desde` pasaba crudo, 00:00Z); solo `hasta` del 30/9 la incluye y deja afuera la del 1/10", async () => {
      const mp = await harina();
      await sembrarOperacion("COMPRA", NOCHE_DEL_30, mp.id, 1);
      await sembrarOperacion("COMPRA", MADRUGADA_DEL_1, mp.id, 1);
      const dias = async (desde: Date | undefined, hasta: Date | undefined) => (await obtenerHistorialProducto(sucursalId, mp.id, undefined, desde, hasta, prisma))!.eventos.map((e) => e.fecha.toISOString());

      expect(await dias(new Date("2026-10-01"), undefined)).toEqual([MADRUGADA_DEL_1.toISOString()]);
      expect(await dias(undefined, new Date("2026-09-30"))).toEqual([NOCHE_DEL_30.toISOString()]);
    });

    it("los conteos físicos del rango también se cortan en la zona", async () => {
      const mp = await harina();
      const conteo = (fecha: Date) =>
        prisma.conteoFisico.create({ data: { sucursalId, fecha, productoId: mp.id, seccionId, saldoSistema: 0, conteoReal: 0, diferencia: 0, accion: "DESCARTAR", estado: "DESCARTADO", usuarioId } });
      await conteo(NOCHE_DEL_30);
      await conteo(MADRUGADA_DEL_1);
      const dia30 = new Date("2026-09-30");
      const h = await obtenerHistorialProducto(sucursalId, mp.id, undefined, dia30, dia30, prisma);
      expect(h!.eventos.map((e) => [e.tipo, e.fecha.toISOString()])).toEqual([["conteo", NOCHE_DEL_30.toISOString()]]);
    });
  });

  describe("Vencimientos: «hoy» es el día argentino", () => {
    it("a las 22:30 del 30/9 un lote que vence el 1/10 vence en 1 día (no hoy) y el del 30/9 vence hoy (0 días, no -1)", async () => {
      const mp = await harina();
      await sembrarOperacion("COMPRA", new Date("2026-09-20T15:00:00.000Z"), mp.id, 5, { lote: new Date("2026-10-01") });
      await sembrarOperacion("COMPRA", new Date("2026-09-20T15:00:00.000Z"), mp.id, 3, { lote: new Date("2026-09-30") });

      const filas = await generarReporteLotesProximosAVencer(sucursalId, 7, prisma, NOCHE_DEL_30);
      expect(filas.map((f) => [f.loteVencimiento.toISOString().slice(0, 10), f.diasParaVencer])).toEqual([
        ["2026-09-30", 0],
        ["2026-10-01", 1],
      ]);
      // La composición de la pantalla pasa la misma zona por defecto.
      expect((await obtenerReporteVencimientosDatos(sucursalId, 7, prisma, NOCHE_DEL_30)).proximosAVencer.map((f) => f.diasParaVencer)).toEqual([0, 1]);
    });

    it("el límite de la ventana también sale del día argentino: con 1 día, a las 22:30 del 30/9 entra el lote del 1/10 y no el del 2/10", async () => {
      const mp = await harina();
      await sembrarOperacion("COMPRA", new Date("2026-09-20T15:00:00.000Z"), mp.id, 5, { lote: new Date("2026-10-01") });
      await sembrarOperacion("COMPRA", new Date("2026-09-20T15:00:00.000Z"), mp.id, 3, { lote: new Date("2026-10-02") });
      const filas = await generarReporteLotesProximosAVencer(sucursalId, 1, prisma, NOCHE_DEL_30);
      expect(filas.map((f) => f.loteVencimiento.toISOString().slice(0, 10))).toEqual(["2026-10-01"]);
    });
  });
});
