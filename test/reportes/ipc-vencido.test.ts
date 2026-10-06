import { beforeEach, describe, expect, it, vi } from "vitest";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerReportePorPeriodo } from "../../src/core/reportes/periodo";
import { obtenerResumenOperativo } from "../../src/core/reportes/resumen-operativo";

/**
 * 5c — serie del IPC vencida. Lo que se prueba: cuando la serie está parada hace más del máximo previsto (60 días desde el fin del último
 * mes publicado), los avisos dejan de decir que el ajuste es «de hoy» y dejan de culpar al INDEC — pero NINGÚN número cambia.
 *
 * Las fechas de la serie son RELATIVAS a hoy, nunca literales: una fecha fija se vuelve «vencida» sola con el paso del tiempo y el test
 * cambiaría de significado.
 */
const ahora = new Date();
/** Primer día del mes que queda `atras` meses antes del actual (0 = el mes en curso). */
const mesRelativo = (atras: number) => new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - atras, 1));

describe("reportes con la serie del IPC vencida", () => {
  let sucursalId: string;

  /** Deja SOLO estos meses en la serie (el último es el «último publicado»). */
  async function serieConMeses(atras: number[]) {
    await prisma.indicePrecio.deleteMany();
    for (const [i, n] of atras.entries()) await prisma.indicePrecio.create({ data: { mes: mesRelativo(n), valor: 100 + i * 5 } });
  }
  const reporte = () => obtenerReportePorPeriodo(sucursalId, new Date(ahora.getTime() - 86_400_000), new Date(ahora.getTime() + 86_400_000), undefined, prisma);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    const seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    // Una venta de HOY con costo: cae en un mes que la serie no tiene (provisorio), así que el aviso del margen ajustado se arma.
    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id }, sucursalId);
    const pan = await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 1, unidadId: kg.id }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: ahora, seccionId, items: [{ productoId: harina.id, cantidad: 100, precioTotal: 500 }] });
    const r = await registrarVenta({ fecha: ahora, seccionId, ventas: [{ productoId: pan.id, cantidadVendida: 2 }] });
    expect(r.ok, r.mensaje).toBe(true);
  });

  it("serie parada hace 8 meses: el margen ajustado avisa que NO es de hoy y que falta sincronizar, sin prometer que se corrige solo", async () => {
    await serieConMeses([9, 8]);

    const { margen } = await reporte();

    expect(margen.antiguedadIPC.estado).toBe("vencida");
    expect(margen.antiguedadIPC.ultimoMes).toBe(mesRelativo(8).toISOString().slice(0, 7));
    expect(margen.ingresoProvisorioIPC, "el caso que se audita (venta de un mes sin publicar) tiene que existir").toBeGreaterThan(0);
    expect(margen.avisoIPC).toContain("no se actualiza desde");
    expect(margen.avisoIPC).toContain("NO de hoy");
    expect(margen.avisoIPC).toContain("falta sincronizar");
    expect(margen.avisoIPC).not.toContain("Se corrige solo cuando se publique");
    expect(margen.avisoIPC).not.toContain("los dos lados de la resta quedan en la misma plata");
  });

  it("rezago normal del INDEC (el último mes publicado es el anterior): sigue siendo «provisorio», con el aviso de siempre", async () => {
    await serieConMeses([2, 1]);

    const { margen } = await reporte();

    expect(margen.antiguedadIPC.estado).toBe("al-dia");
    expect(margen.avisoIPC).toContain("poder adquisitivo de hoy");
    expect(margen.avisoIPC).toContain("PROVISORIO");
    expect(margen.avisoIPC).toContain("Se corrige solo cuando se publique");
    expect(margen.avisoIPC).not.toContain("no se actualiza desde");
  });

  it("NINGÚN número cambia: el margen ajustado por IPC es el mismo con la serie vencida que al día", async () => {
    await serieConMeses([2, 1]);
    const alDia = (await reporte()).margen;
    await serieConMeses([9, 8]);
    const vencida = (await reporte()).margen;

    expect(alDia.antiguedadIPC.estado).toBe("al-dia");
    expect(vencida.antiguedadIPC.estado).toBe("vencida");
    expect(vencida.margenIPCTotal).toBe(alDia.margenIPCTotal);
    expect(vencida.ingresoAjustadoIPCTotal).toBe(alDia.ingresoAjustadoIPCTotal);
    expect(vencida.ingresoConIPC).toBe(alDia.ingresoConIPC);
    expect(vencida.ingresoProvisorioIPC).toBe(alDia.ingresoProvisorioIPC);
    expect(vencida.margenTotal).toBe(alDia.margenTotal);
  });

  it("comparativa de precios: con la serie vencida NO culpa al INDEC («lo publica a mitad del mes siguiente»), dice que falta sincronizar", async () => {
    await serieConMeses([9, 8]);
    // Período entero en un mes sin publicar (el mes en curso, la vista por defecto): la variación del IPC es «sin dato».
    const { comparativaPrecios } = await obtenerReportePorPeriodo(sucursalId, mesRelativo(0), new Date(ahora.getTime() + 86_400_000), undefined, prisma);

    expect(comparativaPrecios.variacionIPCPct, "sigue siendo «sin dato»: no cambia el número").toBeNull();
    expect(comparativaPrecios.antiguedadIPC.estado).toBe("vencida");
    expect(comparativaPrecios.avisoIPC).toContain("no se actualiza desde");
    expect(comparativaPrecios.avisoIPC).toContain("falta sincronizar");
    expect(comparativaPrecios.avisoIPC).not.toContain("mitad del mes siguiente");
  });

  it("comparativa de precios con rezago normal: sigue diciendo lo de siempre del INDEC", async () => {
    await serieConMeses([2, 1]);
    const { comparativaPrecios } = await obtenerReportePorPeriodo(sucursalId, mesRelativo(0), new Date(ahora.getTime() + 86_400_000), undefined, prisma);

    expect(comparativaPrecios.antiguedadIPC.estado).toBe("al-dia");
    expect(comparativaPrecios.avisoIPC).toContain("mitad del mes siguiente");
  });

  it("resumen operativo (tarjeta de /reportes): ipcVencido sube con la serie vencida, y «provisorio» sigue siendo independiente", async () => {
    await serieConMeses([2, 1]);
    const alDia = (await obtenerResumenOperativo(sucursalId, prisma, AHORA_DE_LA_CORRIDA)).financiero;
    await serieConMeses([9, 8]);
    const vencida = (await obtenerResumenOperativo(sucursalId, prisma, AHORA_DE_LA_CORRIDA)).financiero;

    expect(alDia.ipcVencido).toBe(false);
    expect(alDia.margenIPCProvisorio).toBe(true);
    expect(vencida.ipcVencido).toBe(true);
    expect(vencida.margenIPCProvisorio, "la venta de hoy sigue siendo de un mes sin publicar: es un dato distinto").toBe(true);
    expect(vencida.avisoMargenIPC).toContain("no se actualiza desde");
    expect(vencida.margenIPCTotal, "ningún número cambia").toBe(alDia.margenIPCTotal);
  });
});
