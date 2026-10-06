import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { emitirTicketCorregidoCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/emitir-ticket-corregido";

/**
 * Caso de uso `emitirTicketCorregidoCasoDeUso` (src/server/actions/pos/casos-de-uso/emitir-ticket-corregido.ts; Task #41, Fase M12b).
 * Postgres real, sin mocks de base ni de sesión: el caso de uso recibe el actor ya resuelto (el permiso lo chequea `conPermiso` en la
 * Server Action, cubierta por test/pos/emitir-ticket-corregido-action.test.ts, que no se tocó).
 *
 * La cuenta cerrada se siembra directo (sin `cerrarCuenta` ni `anularVenta`) para controlar las fechas: el ejemplar A se emitió hace una
 * hora y la anulación de una línea fue hace un minuto — así `estadoDeTicket` da «desactualizada» sin depender de milisegundos. Un caso
 * por el éxito (B y luego C, siempre corrigiendo al A) y uno por cada código de fracaso, con los textos exactos de antes y verificando que
 * un rechazo no escribe nada. Un `cuentaId` que no es un string lo rechaza el guard (test/core/features/cuentas/cuenta-guard.test.ts).
 */
describe("emitirTicketCorregidoCasoDeUso", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  const actor = () => ({ usuarioId: s.admin.id, sucursalId: s.sucursalId, ...baseDeTest });
  const haceUnaHora = () => new Date(Date.now() - 60 * 60 * 1000);
  const haceUnMinuto = () => new Date(Date.now() - 60 * 1000);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
  });

  /** Mesa 4 cerrada con dos líneas (milanesa y flan), una Operacion VENTA por línea y el ticket N.º `numero`-A emitida hace una hora. */
  async function cuentaCerradaConTicket(numero = 566) {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
    ]);
    const nuevaVenta = () => prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "VENTA", fecha: haceUnaHora(), usuarioId: s.admin.id } });
    const ventaMila = await nuevaVenta();
    const ventaFlan = await nuevaVenta();
    await prisma.cuentaItem.update({ where: { id: cuenta.items[0].id }, data: { operacionId: ventaMila.id } });
    await prisma.cuentaItem.update({ where: { id: cuenta.items[1].id }, data: { operacionId: ventaFlan.id } });
    await prisma.cuenta.update({ where: { id: cuenta.id }, data: { cerradaEn: haceUnaHora(), cerradaPorId: s.admin.id } });
    const a = await prisma.ejemplarTicket.create({ data: { sucursalId: s.sucursalId, cuentaId: cuenta.id, numero, ejemplar: 1, emitidoEn: haceUnaHora(), emitidoPorId: s.admin.id } });
    return { cuenta, a, ventaMila, ventaFlan };
  }
  const anular = (operacionId: string) => prisma.operacion.update({ where: { id: operacionId }, data: { anuladaEn: haceUnMinuto() } });
  const nadaEscrito = async (cuentaId: string, ejemplares: number) => {
    expect(await prisma.ejemplarTicket.count({ where: { cuentaId } })).toBe(ejemplares);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  };

  it("éxito: emite el B con el MISMO número, corrige al A, motivo recortado; datos, mensaje y auditoría como antes", async () => {
    const { cuenta, a, ventaFlan } = await cuentaCerradaConTicket();
    await anular(ventaFlan.id);

    const r = await emitirTicketCorregidoCasoDeUso(actor(), { cuentaId: cuenta.id, motivo: "  No quiso el flan  " });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mensaje).toBe("Ticket N.º 566-B emitida: reemplaza a N.º 566-A.");
    expect(r.datos).toEqual({ numero: 566, ejemplar: 2, ejemplarId: expect.any(String), corrigeAId: a.id });
    const b = await prisma.ejemplarTicket.findUniqueOrThrow({ where: { id: r.datos.ejemplarId } });
    expect(b).toMatchObject({ sucursalId: s.sucursalId, cuentaId: cuenta.id, numero: 566, ejemplar: 2, corrigeAId: a.id, motivo: "No quiso el flan", emitidoPorId: s.admin.id });
    const [fila] = await prisma.registroAuditoria.findMany();
    expect(fila).toMatchObject({
      entidad: "Cuenta",
      entidadId: cuenta.id,
      campo: "ejemplarTicket",
      valorAnterior: "566-A",
      valorNuevo: "566-B",
      actorId: s.admin.id,
      sucursalId: s.sucursalId,
      descripcion: "Mesa 4: ticket corregido N.º 566-B (reemplaza a N.º 566-A). Motivo: No quiso el flan",
    });
  });

  it("el C (otra anulación después del B) corrige también al A, nunca al B; la auditoría va de B a C", async () => {
    const { cuenta, a, ventaFlan } = await cuentaCerradaConTicket(7);
    await anular(ventaFlan.id);
    // Un B emitido hace media hora (antes de la anulación de hace un minuto): el ticket sigue desactualizado.
    await prisma.ejemplarTicket.create({
      data: { sucursalId: s.sucursalId, cuentaId: cuenta.id, numero: 7, ejemplar: 2, emitidoEn: new Date(Date.now() - 30 * 60 * 1000), emitidoPorId: s.admin.id, corrigeAId: a.id, motivo: "x" },
    });

    const r = await emitirTicketCorregidoCasoDeUso(actor(), { cuentaId: cuenta.id, motivo: "Otra vez" });

    expect(r).toMatchObject({ ok: true, mensaje: "Ticket N.º 7-C emitida: reemplaza a N.º 7-A.", datos: { numero: 7, ejemplar: 3, corrigeAId: a.id } });
    expect(await prisma.registroAuditoria.findFirstOrThrow()).toMatchObject({ valorAnterior: "7-B", valorNuevo: "7-C" });
  });

  it("NO_ENCONTRADA: un id que no existe o una cuenta de OTRA sucursal", async () => {
    const { cuenta, ventaFlan } = await cuentaCerradaConTicket();
    await anular(ventaFlan.id);
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });

    expect(await emitirTicketCorregidoCasoDeUso(actor(), { cuentaId: "no-existe", motivo: "x" })).toEqual({ ok: false, codigo: "NO_ENCONTRADA", mensaje: "No se encontró esa cuenta en esta sucursal." });
    expect(await emitirTicketCorregidoCasoDeUso({ usuarioId: s.admin.id, sucursalId: norte.id, ...baseDeTest }, { cuentaId: cuenta.id, motivo: "x" })).toEqual({
      ok: false,
      codigo: "NO_ENCONTRADA",
      mensaje: "No se encontró esa cuenta en esta sucursal.",
    });
    await nadaEscrito(cuenta.id, 1);
  });

  it("CUENTA_ABIERTA: todavía no tiene ticket", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect(await emitirTicketCorregidoCasoDeUso(actor(), { cuentaId: cuenta.id, motivo: "x" })).toEqual({
      ok: false,
      codigo: "CUENTA_ABIERTA",
      mensaje: "La cuenta de la mesa 4 todavía está abierta: no tiene ticket que corregir.",
    });
    await nadaEscrito(cuenta.id, 0);
  });

  it("SIN_NUMERACION: cerrada antes de la numeración (sin ejemplar A)", async () => {
    const { cuenta, a, ventaFlan } = await cuentaCerradaConTicket();
    await anular(ventaFlan.id);
    await prisma.ejemplarTicket.delete({ where: { id: a.id } });
    expect(await emitirTicketCorregidoCasoDeUso(actor(), { cuentaId: cuenta.id, motivo: "x" })).toEqual({
      ok: false,
      codigo: "SIN_NUMERACION",
      mensaje: "La cuenta de la mesa 4 se cerró antes de la numeración de tickets: no tiene ticket que corregir.",
    });
    await nadaEscrito(cuenta.id, 0);
  });

  it("VENTA_ANULADA: con todas las líneas anuladas no hay ticket que corregir", async () => {
    const { cuenta, ventaMila, ventaFlan } = await cuentaCerradaConTicket();
    await anular(ventaMila.id);
    await anular(ventaFlan.id);
    expect(await emitirTicketCorregidoCasoDeUso(actor(), { cuentaId: cuenta.id, motivo: "x" })).toEqual({
      ok: false,
      codigo: "VENTA_ANULADA",
      mensaje: "La venta se anuló entera: no hay ticket que corregir.",
    });
    await nadaEscrito(cuenta.id, 1);
  });

  it("TICKET_VIGENTE: sin anulaciones posteriores — y el estado se chequea ANTES que el motivo (un motivo vacío no cambia el mensaje)", async () => {
    const { cuenta } = await cuentaCerradaConTicket();
    for (const motivo of ["Algo", ""]) {
      expect(await emitirTicketCorregidoCasoDeUso(actor(), { cuentaId: cuenta.id, motivo })).toEqual({
        ok: false,
        codigo: "TICKET_VIGENTE",
        mensaje: "El ticket N.º 566-A ya refleja las anulaciones.",
      });
    }
    await nadaEscrito(cuenta.id, 1);
  });

  it("MOTIVO_INVALIDO: vacío, ausente o demasiado largo (validarMotivoAnulacion), sin escribir nada", async () => {
    const { cuenta, ventaFlan } = await cuentaCerradaConTicket();
    await anular(ventaFlan.id);
    for (const motivo of ["   ", undefined, null]) {
      expect(await emitirTicketCorregidoCasoDeUso(actor(), { cuentaId: cuenta.id, motivo })).toEqual({ ok: false, codigo: "MOTIVO_INVALIDO", mensaje: "Escribí el motivo de la anulación." });
    }
    const largo = await emitirTicketCorregidoCasoDeUso(actor(), { cuentaId: cuenta.id, motivo: "x".repeat(201) });
    expect(largo).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
    expect(largo.mensaje).toMatch(/^El motivo no puede superar los \d+ caracteres\.$/);
    await nadaEscrito(cuenta.id, 1);
  });
});
