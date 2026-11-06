import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { crearUsuarioConRol, entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { cerrarCuenta, corregirLineaDeTicket } from "../../src/server/actions/pos/cuenta-cierre";
import { corregirLineaDeTicketCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/corregir-linea-de-ticket";
import { anularVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-venta";
import { obtenerTicketsRecientes } from "../../src/server/consultas/pos/tickets";

/**
 * «Corregir una línea» de una cuenta cerrada (E0 de la corrección por ajuste; docs/diseno-correccion-por-ajuste-2026-11-06.md). Postgres real. La cuenta se cierra con
 * `cerrarCuenta` (ventas, Kardex y ticket 1-A reales). Tabla «¿qué pasa si…?»: éxito, repetición (misma clave), misma clave con otro contenido, doble clic con otra
 * clave, 8 correcciones a la vez, corrección contra anulación a la vez, motivo faltante, cuenta sin numeración, última línea (se deshace todo), línea de otra cuenta,
 * conteo posterior (D7), promo entera y permisos.
 */
describe("corregir una línea de una cuenta cerrada", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
  const actor = () => ({ usuarioId: s.admin.id, sucursalId: s.sucursalId, ahora: new Date(), ...baseDe(s.sucursalId) });
  const clave = () => crypto.randomUUID();
  const pausa = () => new Promise((r) => setTimeout(r, 15)); // el ticket A se emite en el cierre: la corrección tiene que ser POSTERIOR

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  /** Mesa 4 cerrada: 2 milanesas a 9.000, 1 flan a 3.000 y 1 milanesa a 9.500 (ticket 1-A, $30.500). */
  async function cerrarTresLineas() {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9500, numeroEnvio: 2 },
    ]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const ventaDe = async (productoId: string, precioUnitario: number) => (await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id, productoId, precioUnitario } })).operacionId!;
    await pausa();
    return { cuenta, ventaMila: await ventaDe(s.milanesa.id, 9000), ventaFlan: await ventaDe(s.flan.id, 3000), ventaMila2: await ventaDe(s.milanesa.id, 9500) };
  }
  const comandoDe = (cuentaId: string, operacionId: string, extra: Partial<{ motivo: string; ejemplarVisto: number; totalVisto: number; claveIdempotencia: string }> = {}) => ({
    cuentaId,
    operacionId,
    motivo: "Se cobró de más",
    ejemplarVisto: 1,
    totalVisto: 30500,
    claveIdempotencia: clave(),
    ...extra,
  });
  const ejemplaresDe = (cuentaId: string) => prisma.ejemplarTicket.findMany({ where: { cuentaId }, orderBy: { ejemplar: "asc" } });
  const reversionesDe = (operacionId: string) => prisma.operacion.count({ where: { revierteAOperacionId: operacionId } });

  it("éxito: anula la línea entera con su motivo, enlaza el contra-asiento y emite el 1-B corregido (mismo número, corrige al A) en un solo paso", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();

    const r = await corregirLineaDeTicketCasoDeUso(actor(), comandoDe(cuenta.id, ventaFlan));

    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.datos).toEqual({ numero: 1, ejemplar: 2, operacionesAnuladas: [ventaFlan], repetida: false });
    const anulada = await prisma.operacion.findUniqueOrThrow({ where: { id: ventaFlan } });
    expect(anulada).toMatchObject({ anuladaPorId: s.admin.id, motivoAnulacion: "Se cobró de más" });
    expect(await reversionesDe(ventaFlan)).toBe(1);
    const [a, b] = await ejemplaresDe(cuenta.id);
    expect(b).toMatchObject({ numero: 1, ejemplar: 2, corrigeAId: a.id, motivo: "Se cobró de más", emitidoPorId: s.admin.id });
    const [ticket] = await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, prisma, undefined, new Date());
    expect(ticket).toMatchObject({ estado: "vigente", numero: { numero: 1, ejemplar: 2 }, total: 27500 });
    // Trazabilidad: la anulación de la venta y el ejemplar nuevo.
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion", entidadId: ventaFlan } })).toBe(1);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Cuenta", entidadId: cuenta.id, campo: "ejemplarTicket" } })).toBe(1);
  });

  it("repetición (doble clic / reintento con la MISMA clave y el mismo contenido): devuelve el mensaje original y no escribe nada más", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    const comando = comandoDe(cuenta.id, ventaFlan);
    const primera = await corregirLineaDeTicketCasoDeUso(actor(), comando);
    const segunda = await corregirLineaDeTicketCasoDeUso(actor(), comando);

    expect(primera.ok && segunda.ok).toBe(true);
    if (!primera.ok || !segunda.ok) return;
    expect(segunda.mensaje).toBe(primera.mensaje);
    expect(segunda.datos).toMatchObject({ repetida: true, numero: 1, ejemplar: 2 });
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(2);
    expect(await reversionesDe(ventaFlan)).toBe(1);
  });

  it("la misma clave con OTRO contenido es un conflicto y no escribe nada", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    const comando = comandoDe(cuenta.id, ventaFlan);
    expect((await corregirLineaDeTicketCasoDeUso(actor(), comando)).ok).toBe(true);

    const r = await corregirLineaDeTicketCasoDeUso(actor(), { ...comando, motivo: "Otro motivo distinto" });
    expect(r).toMatchObject({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA" });
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(2);
  });

  it("la misma línea con OTRA clave (otra pestaña con lo viejo en pantalla): «la cuenta cambió», sin segundo contra-asiento ni segundo ejemplar", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    expect((await corregirLineaDeTicketCasoDeUso(actor(), comandoDe(cuenta.id, ventaFlan))).ok).toBe(true);

    const r = await corregirLineaDeTicketCasoDeUso(actor(), comandoDe(cuenta.id, ventaFlan));
    expect(r).toMatchObject({ ok: false, codigo: "LA_CUENTA_CAMBIO" });
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(2);
    expect(await reversionesDe(ventaFlan)).toBe(1);
  });

  it("lo que la persona vio no coincide con lo guardado (total viejo): se rechaza sin escribir nada", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    const r = await corregirLineaDeTicketCasoDeUso(actor(), comandoDe(cuenta.id, ventaFlan, { totalVisto: 99999 }));
    expect(r).toMatchObject({ ok: false, codigo: "LA_CUENTA_CAMBIO" });
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);
    expect(await reversionesDe(ventaFlan)).toBe(0);
  });

  it("8 correcciones SIMULTÁNEAS de la misma línea (8 claves distintas) dejan exactamente 1 corrección: 1 contra-asiento, 1 ejemplar nuevo, 1 auditoría", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    const resultados = await Promise.all(Array.from({ length: 8 }, () => corregirLineaDeTicketCasoDeUso(actor(), comandoDe(cuenta.id, ventaFlan))));

    expect(resultados.filter((r) => r.ok), JSON.stringify(resultados)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok).every((r) => !r.ok && ["LA_CUENTA_CAMBIO", "YA_ANULADA", "TICKET_VIGENTE"].includes(r.codigo))).toBe(true);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(2);
    expect(await reversionesDe(ventaFlan)).toBe(1);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion", entidadId: ventaFlan } })).toBe(1);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Cuenta", entidadId: cuenta.id, campo: "ejemplarTicket" } })).toBe(1);
  }, 90_000);

  it("8 envíos SIMULTÁNEOS con la MISMA clave: una sola corrección y todos reciben el mismo mensaje", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    const comando = comandoDe(cuenta.id, ventaFlan);
    const resultados = await Promise.all(Array.from({ length: 8 }, () => corregirLineaDeTicketCasoDeUso(actor(), comando)));

    expect(resultados.every((r) => r.ok), JSON.stringify(resultados)).toBe(true);
    expect(new Set(resultados.map((r) => r.mensaje)).size).toBe(1);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(2);
    expect(await reversionesDe(ventaFlan)).toBe(1);
  }, 90_000);

  it("corrección y anulación SIMULTÁNEAS de la misma venta: se anula una sola vez y, si gana la anulación, no queda ningún ejemplar nuevo", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    const [correccion] = await Promise.all([
      corregirLineaDeTicketCasoDeUso(actor(), comandoDe(cuenta.id, ventaFlan)),
      anularVentaCasoDeUso(actor(), { operacionId: ventaFlan, motivo: "La anulé yo" }),
    ]);

    expect(await reversionesDe(ventaFlan)).toBe(1);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(correccion.ok ? 2 : 1);
    if (!correccion.ok) expect(correccion.codigo).toMatch(/YA_ANULADA|LA_CUENTA_CAMBIO/);
  }, 60_000);

  it("motivo faltante: lo rechaza el guard (la Server Action no escribe nada)", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    for (const motivo of ["", "   "]) expect(await corregirLineaDeTicket(cuenta.id, ventaFlan, motivo, 1, 30500, clave())).toEqual({ ok: false, mensaje: "Escribí el motivo de la anulación." });
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);
    expect(await reversionesDe(ventaFlan)).toBe(0);
  });

  it("cuenta cerrada antes de la numeración (sin ejemplar A): se rechaza sin escribir nada", async () => {
    const venta = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id } });
    const vieja = await prisma.cuenta.create({
      data: { mesaId: s.mesa.id, abiertaPorId: s.admin.id, cerradaEn: new Date(Date.now() - 60_000), cerradaPorId: s.admin.id, items: { create: [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, operacionId: venta.id }] } },
    });
    const r = await corregirLineaDeTicketCasoDeUso(actor(), comandoDe(vieja.id, venta.id, { totalVisto: 3000 }));
    expect(r).toMatchObject({ ok: false, codigo: "SIN_NUMERACION" });
    expect(await reversionesDe(venta.id)).toBe(0);
  });

  it("la ÚLTIMA línea vigente no se puede corregir y TODO se deshace (ni contra-asiento, ni motivo, ni auditoría)", async () => {
    const { cuenta, ventaMila, ventaFlan, ventaMila2 } = await cerrarTresLineas();
    expect((await corregirLineaDeTicketCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila))).ok).toBe(true);
    await pausa();
    expect((await corregirLineaDeTicketCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila2, { ejemplarVisto: 2, totalVisto: 12500 }))).ok).toBe(true);
    await pausa();
    const auditoriaAntes = await prisma.registroAuditoria.count();

    const r = await corregirLineaDeTicketCasoDeUso(actor(), comandoDe(cuenta.id, ventaFlan, { ejemplarVisto: 3, totalVisto: 3000 }));

    expect(r).toMatchObject({ ok: false, codigo: "ULTIMA_LINEA" });
    const flan = await prisma.operacion.findUniqueOrThrow({ where: { id: ventaFlan } });
    expect(flan.anuladaEn).toBeNull();
    expect(flan.motivoAnulacion).toBeNull();
    expect(await reversionesDe(ventaFlan)).toBe(0);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(3);
    expect(await prisma.registroAuditoria.count()).toBe(auditoriaAntes);
  }, 60_000);

  it("una venta que no es de esta cuenta se rechaza", async () => {
    const { cuenta } = await cerrarTresLineas();
    const ajena = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id } });
    expect(await corregirLineaDeTicketCasoDeUso(actor(), comandoDe(cuenta.id, ajena.id))).toMatchObject({ ok: false, codigo: "LINEA_DE_OTRA_CUENTA" });
    expect(await reversionesDe(ajena.id)).toBe(0);
  });

  it("D7: con un ajuste/conteo POSTERIOR del mismo producto y sección se rechaza y no escribe nada", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    const ajuste = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "AJUSTE", fecha: new Date(), usuarioId: s.admin.id } });
    await prisma.movimientoStock.create({ data: { operacionId: ajuste.id, productoId: s.flanReventa.id, seccionId: s.seccion.id, proceso: "AJUSTE", cantidad: -1, detalle: "Ajuste manual", precioTotal: 0, precioPorUnidadStock: 0 } });
    const r = await corregirLineaDeTicketCasoDeUso(actor(), comandoDe(cuenta.id, ventaFlan));
    expect(r).toMatchObject({ ok: false, codigo: "CONTEO_POSTERIOR" });
    expect(await reversionesDe(ventaFlan)).toBe(0);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);
  });

  describe("permisos (Server Action)", () => {
    it("sin anular_venta (mozo) o sin pos_emitir_ticket_corregido se rechaza y no escribe nada; con las dos, corrige", async () => {
      const { cuenta, ventaFlan } = await cerrarTresLineas();
      const soloAnular = await crearUsuarioConRol(s.sucursalId, "soloanula", [{ clave: "anular_venta", ver: true, editar: true }]);
      await entrarComo(soloAnular);
      const sinEmitir = await corregirLineaDeTicket(cuenta.id, ventaFlan, "Se cobró de más", 1, 30500, clave());
      expect(sinEmitir.ok).toBe(false);

      const soloEmitir = await crearUsuarioConRol(s.sucursalId, "soloemite", [{ clave: "pos_emitir_ticket_corregido", ver: true, editar: true }]);
      await entrarComo(soloEmitir);
      expect((await corregirLineaDeTicket(cuenta.id, ventaFlan, "Se cobró de más", 1, 30500, clave())).ok).toBe(false);
      expect(await reversionesDe(ventaFlan)).toBe(0);
      expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);

      await entrarComo(s.admin);
      expect(await corregirLineaDeTicket(cuenta.id, ventaFlan, "Se cobró de más", 1, 30500, clave())).toMatchObject({ ok: true, numero: 1, ejemplar: 2 });
    });
  });
});
