import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { DIA_MS, enElPasado } from "../setup/tiempo";
import { registrarPagoConsignante } from "../../src/server/actions/reportes/consignacion";
import { generarReporteConsignacion } from "../../src/server/consultas/reportes/consignacion";
import { ZONA_ARGENTINA, diaDeCalendario, mediodiaDelDia, rangoDeDias, sumarDias } from "../../src/core/tiempo/zona-horaria";

/**
 * P1, paso 2: el formulario de pago a un consignante guarda el MEDIODÍA argentino del día elegido (`mediodiaDelDia`), y la pantalla de Consignación cierra el último día del período en la zona de la
 * empresa. Sin ese cierre, `?desde=D&hasta=D` (que la página convierte en 00:00 UTC de D) dejaba afuera un pago cargado ese mismo día D. Acá se prueba, con la base real, que el período D..D —armado como
 * lo arma `reportes/consignacion/page.tsx`— contiene al pago del día D y no a los de los días de al lado. El día es el de hace 5 días en hora argentina (calculado, no escrito a mano: no se vuelve falso con el tiempo).
 */
describe("Consignación: un pago del día D entra en el período D..D", () => {
  let sucursalId: string;
  let proveedorId: string;
  const dia = diaDeCalendario(enElPasado(5 * DIA_MS), ZONA_ARGENTINA);

  /** Igual que la página: cada extremo del filtro llega como `new Date("AAAA-MM-DD")` (00:00 UTC) y se expande al inicio / fin de ESE día en la zona de la empresa. */
  const periodoDeLaPagina = (desde: string, hasta: string, zona = ZONA_ARGENTINA) => ({
    desde: rangoDeDias(new Date(desde), new Date(desde), zona).desde,
    hasta: rangoDeDias(new Date(hasta), new Date(hasta), zona).hasta,
  });

  const pagadoEn = async (periodo?: { desde?: Date; hasta?: Date }) => {
    const rep = await generarReporteConsignacion(sucursalId, prisma, periodo);
    return rep.debidoPorConsignante.find((d) => d.proveedorId === proveedorId)?.pagado ?? 0;
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_PERIODO", nombre: "Consignante del período" } })).id;
  });

  it("el pago de mediodía del día D se guarda tal cual y aparece en D..D, no en el día anterior ni en el siguiente", async () => {
    const resultado = await registrarPagoConsignante(proveedorId, 40, mediodiaDelDia(dia, ZONA_ARGENTINA), undefined, crypto.randomUUID());
    expect(resultado.ok, resultado.mensaje).toBe(true);
    const pago = await prisma.pagoConsignante.findFirstOrThrow({ where: { proveedorId } });
    expect(pago.fecha.toISOString()).toBe(mediodiaDelDia(dia, ZONA_ARGENTINA).toISOString());

    expect(await pagadoEn(periodoDeLaPagina(dia, dia))).toBe(40);
    expect(await pagadoEn(periodoDeLaPagina(sumarDias(dia, -1), sumarDias(dia, -1)))).toBe(0);
    expect(await pagadoEn(periodoDeLaPagina(sumarDias(dia, 1), sumarDias(dia, 1)))).toBe(0);
    expect(await pagadoEn(periodoDeLaPagina(sumarDias(dia, -1), sumarDias(dia, 1)))).toBe(40);
  });

  it("solo «desde» = D o solo «hasta» = D (el filtro admite un extremo solo) también lo incluyen", async () => {
    await registrarPagoConsignante(proveedorId, 40, mediodiaDelDia(dia, ZONA_ARGENTINA), undefined, crypto.randomUUID());
    expect(await pagadoEn({ desde: periodoDeLaPagina(dia, dia).desde })).toBe(40);
    expect(await pagadoEn({ hasta: periodoDeLaPagina(dia, dia).hasta })).toBe(40);
    expect(await pagadoEn({ desde: periodoDeLaPagina(sumarDias(dia, 1), sumarDias(dia, 1)).desde })).toBe(0);
    expect(await pagadoEn({ hasta: periodoDeLaPagina(sumarDias(dia, -1), sumarDias(dia, -1)).hasta })).toBe(0);
  });

  it("los bordes del día argentino D: las 00:00 y las 23:59:59.999 entran en D..D; las 23:59:59.999 del día anterior y las 00:00 del siguiente, no", async () => {
    const propio = rangoDeDias(new Date(dia), new Date(dia), ZONA_ARGENTINA);
    const antes = new Date(propio.desde.getTime() - 1);
    const despues = new Date(propio.hasta.getTime() + 1);
    for (const [fecha, importe] of [[propio.desde, 1], [propio.hasta, 2], [antes, 4], [despues, 8]] as const) {
      const admin = await prisma.user.findFirstOrThrow();
      await prisma.pagoConsignante.create({ data: { sucursalId, proveedorId, importe, fecha, usuarioId: admin.id } });
    }
    expect(await pagadoEn(periodoDeLaPagina(dia, dia))).toBe(3);
  });

  it("lo que dejaba el formulario antes (new Date(\"AAAA-MM-DD\"), 00:00 UTC) cae en el día argentino ANTERIOR: sale en D-1..D-1 y no en D..D", async () => {
    const antes = await registrarPagoConsignante(proveedorId, 40, new Date(dia), undefined, crypto.randomUUID());
    expect(antes.ok, antes.mensaje).toBe(true);
    expect(await pagadoEn(periodoDeLaPagina(dia, dia))).toBe(0);
    expect(await pagadoEn(periodoDeLaPagina(sumarDias(dia, -1), sumarDias(dia, -1)))).toBe(40);
  });

  it("control: el período «crudo» (00:00 UTC de D en los dos extremos, como se pasaba antes de cerrar el día) NO contiene al pago de mediodía de D", async () => {
    await registrarPagoConsignante(proveedorId, 40, mediodiaDelDia(dia, ZONA_ARGENTINA), undefined, crypto.randomUUID());
    expect(await pagadoEn({ desde: new Date(dia), hasta: new Date(dia) })).toBe(0);
  });
});
