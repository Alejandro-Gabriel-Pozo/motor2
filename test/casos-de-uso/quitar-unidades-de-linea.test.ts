import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// Se envuelve (sin cambiar lo que hace) para poder hacer fallar el ÚLTIMO paso de una corrección y probar que no queda nada a medias.
vi.mock("../../src/server/persistencia/pos/escribir-ejemplar-corregido", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server/persistencia/pos/escribir-ejemplar-corregido")>();
  return { ...original, escribirEjemplarCorregido: vi.fn(original.escribirEjemplarCorregido) };
});

import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { crearUsuarioConRol, entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { cerrarCuenta, corregirLineaDeTicket, quitarUnidadesDeLinea } from "../../src/server/actions/pos/cuenta-cierre";
import { quitarUnidadesDeLineaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/quitar-unidades-de-linea";
import { corregirLineaDeTicketCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/corregir-linea-de-ticket";
import { escribirEjemplarCorregido } from "../../src/server/persistencia/pos/escribir-ejemplar-corregido";
import { obtenerTicketsRecientes } from "../../src/server/consultas/pos/tickets";
import { Prisma } from "@prisma/client";

/**
 * «Quitar unidades de una línea» de una cuenta cerrada (E1 de la corrección por ajuste; docs/diseno-correccion-por-ajuste-2026-11-06.md, oráculo en
 * docs/oraculo-combinaciones-correccion-e1-2026-11-06.md). Postgres real. La cuenta se cierra con `cerrarCuenta` (ventas, Kardex y ticket 1-A reales). Cubre: éxito,
 * lo congelado, repetición, misma clave con otro contenido, otra clave con lo viejo en pantalla, 8 correcciones a la vez, 8 envíos con la misma clave, corrección contra una
 * venta a la vez, correcciones sucesivas, D7, unidades inválidas o todas, todo-o-nada, invariancia de totales y permisos.
 */
describe("quitar unidades de una línea de una cuenta cerrada", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
  const actor = () => ({ usuarioId: s.admin.id, sucursalId: s.sucursalId, ahora: new Date(), ...baseDe(s.sucursalId) });
  const clave = () => crypto.randomUUID();
  const pausa = () => new Promise((r) => setTimeout(r, 15)); // el ticket A se emite en el cierre: la corrección tiene que ser POSTERIOR

  beforeEach(async () => {
    await limpiarBaseDeTest();
    vi.mocked(escribirEjemplarCorregido).mockClear();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  /** Mesa 4 cerrada: 3 milanesas a $9.000 y 1 flan a $3.000 (ticket 1-A, $30.000). */
  async function cerrarMilanesas() {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 3, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
    ]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const ventaDe = async (productoId: string) => (await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id, productoId } })).operacionId!;
    await pausa();
    return { cuenta, ventaMila: await ventaDe(s.milanesa.id), ventaFlan: await ventaDe(s.flan.id) };
  }
  const comandoDe = (cuentaId: string, operacionId: string, extra: Partial<{ unidadesAQuitar: number; unidadesVistas: number; motivo: string; ejemplarVisto: number; totalVisto: number; claveIdempotencia: string }> = {}) => ({
    cuentaId,
    operacionId,
    unidadesAQuitar: 1,
    unidadesVistas: 3,
    motivo: "La mesa tomó una menos",
    ejemplarVisto: 1,
    totalVisto: 30000,
    claveIdempotencia: clave(),
    ...extra,
  });
  const ejemplaresDe = (cuentaId: string) => prisma.ejemplarTicket.findMany({ where: { cuentaId }, orderBy: { ejemplar: "asc" } });
  const reversionesDe = (operacionId: string) => prisma.operacion.count({ where: { revierteAOperacionId: operacionId } });
  const reemplazosDe = (operacionId: string) => prisma.operacion.findMany({ where: { reemplazaAOperacionId: operacionId }, include: { movimientos: { orderBy: [{ creadoEn: "asc" }, { id: "asc" }] } } });
  const saldoMila = () => calcularSaldoTotal(s.milanesaReventa.id, s.seccion.id, prisma);
  const ventasVigentes = async () =>
    Number((await prisma.movimientoStock.aggregate({ _sum: { precioTotal: true }, where: { proceso: "VENTA", operacion: { anuladaEn: null } } }))._sum.precioTotal ?? 0);

  it("éxito: A queda marcada con el motivo, R la revierte (enlazada), B la reemplaza con 2 milanesas, la unidad vuelve al stock y sale el 1-B corregido, todo en un paso", async () => {
    const { cuenta, ventaMila } = await cerrarMilanesas();
    expect(await saldoMila()).toBe(997);
    const fechaA = (await prisma.operacion.findUniqueOrThrow({ where: { id: ventaMila } })).fecha;

    const r = await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila));

    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.datos).toMatchObject({ numero: 1, ejemplar: 2, unidadesQueQuedan: 2, repetida: false });
    const a = await prisma.operacion.findUniqueOrThrow({ where: { id: ventaMila } });
    expect(a).toMatchObject({ anuladaPorId: s.admin.id, motivoAnulacion: "La mesa tomó una menos" });
    expect(await reversionesDe(ventaMila)).toBe(1);
    const [b, ...otras] = await reemplazosDe(ventaMila);
    expect(otras).toHaveLength(0);
    expect(b).toMatchObject({ id: r.datos.ventaNuevaId, proceso: "VENTA", anuladaEn: null, usuarioId: a.usuarioId, promoCuentaId: null, operacionPadreId: null });
    expect(b.fecha.getTime()).toBe(fechaA.getTime());
    const venta = b.movimientos.find((m) => m.proceso === "VENTA")!;
    expect(Number(venta.cantidad)).toBe(-2);
    expect(Number(venta.precioTotal)).toBe(18000);
    expect(Number(venta.precioPorUnidadStock)).toBe(9000);
    expect(b.movimientos.filter((m) => m.proceso === "CONSUMO").reduce((x, m) => x + Number(m.cantidad), 0)).toBe(-2);
    expect(await saldoMila()).toBe(998);

    const [ticketA, ticketB] = await ejemplaresDe(cuenta.id);
    expect(ticketB).toMatchObject({ numero: 1, ejemplar: 2, corrigeAId: ticketA.id, motivo: "La mesa tomó una menos", emitidoPorId: s.admin.id });
    const [ticket] = await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, prisma, undefined, new Date());
    expect(ticket).toMatchObject({ estado: "vigente", numero: { numero: 1, ejemplar: 2 }, total: 21000, ventaAnulada: false });
    expect(ticket.lineas.find((l) => l.producto === "Milanesa")).toMatchObject({ cantidad: 2, subtotal: 18000 });
    expect(ticket.corregibles.find((c) => c.texto.includes("Milanesa"))).toMatchObject({ operacionId: b.id, texto: "2 × Milanesa", subtotal: 18000 });
    // Trazabilidad: unidades antes y después, la anulación de A y el ejemplar nuevo.
    expect(await prisma.registroAuditoria.findFirst({ where: { entidad: "Operacion", entidadId: ventaMila, campo: "unidadesVendidas" } })).toMatchObject({ valorAnterior: "3", valorNuevo: "2", actorId: s.admin.id });
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion", entidadId: ventaMila, campo: "anuladaEn" } })).toBe(1);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Cuenta", entidadId: cuenta.id, campo: "ejemplarTicket" } })).toBe(1);
  });

  it("congelado: B copia el costo de la venta y el precio de lista de A sin recalcular, y un costo vacío sigue vacío", async () => {
    const { cuenta, ventaMila, ventaFlan } = await cerrarMilanesas();
    await prisma.movimientoStock.updateMany({ where: { operacionId: ventaMila, proceso: "VENTA" }, data: { costoUnitarioVenta: 4123.5, precioListaUnitario: 9500 } });
    await prisma.movimientoStock.updateMany({ where: { operacionId: ventaFlan, proceso: "VENTA" }, data: { costoUnitarioVenta: null } });

    expect((await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila))).ok).toBe(true);

    const [b] = await reemplazosDe(ventaMila);
    const venta = b.movimientos.find((m) => m.proceso === "VENTA")!;
    expect(Number(venta.costoUnitarioVenta)).toBe(4123.5);
    expect(Number(venta.precioListaUnitario)).toBe(9500);
    // El flan no se tocó: su venta sigue sin dato y nadie la revalúa.
    expect((await prisma.movimientoStock.findFirstOrThrow({ where: { operacionId: ventaFlan, proceso: "VENTA" } })).costoUnitarioVenta).toBeNull();
  });

  it("repetición (doble clic / reintento con la MISMA clave y el mismo contenido): devuelve el mensaje original y no escribe nada más", async () => {
    const { cuenta, ventaMila } = await cerrarMilanesas();
    const comando = comandoDe(cuenta.id, ventaMila);
    const primera = await quitarUnidadesDeLineaCasoDeUso(actor(), comando);
    const segunda = await quitarUnidadesDeLineaCasoDeUso(actor(), comando);

    expect(primera.ok && segunda.ok).toBe(true);
    if (!primera.ok || !segunda.ok) return;
    expect(segunda.mensaje).toBe(primera.mensaje);
    expect(segunda.datos).toMatchObject({ repetida: true, numero: 1, ejemplar: 2 });
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(2);
    expect(await reversionesDe(ventaMila)).toBe(1);
    expect(await reemplazosDe(ventaMila)).toHaveLength(1);
    expect(await saldoMila()).toBe(998);
  });

  it("la misma clave con OTRO contenido es un conflicto y no escribe nada", async () => {
    const { cuenta, ventaMila } = await cerrarMilanesas();
    const comando = comandoDe(cuenta.id, ventaMila);
    expect((await quitarUnidadesDeLineaCasoDeUso(actor(), comando)).ok).toBe(true);

    const r = await quitarUnidadesDeLineaCasoDeUso(actor(), { ...comando, unidadesAQuitar: 2 });
    expect(r).toMatchObject({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA" });
    expect(await reemplazosDe(ventaMila)).toHaveLength(1);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(2);
  });

  it("la misma línea con OTRA clave y lo viejo en pantalla (otra pestaña): «la cuenta cambió», sin segunda venta nueva ni segundo ejemplar", async () => {
    const { cuenta, ventaMila } = await cerrarMilanesas();
    expect((await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila))).ok).toBe(true);

    const r = await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila));
    expect(r).toMatchObject({ ok: false, codigo: expect.stringMatching(/LA_CUENTA_CAMBIO|LINEA_DE_OTRA_CUENTA/) });
    expect(await reemplazosDe(ventaMila)).toHaveLength(1);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(2);
    expect(await reversionesDe(ventaMila)).toBe(1);
  });

  it("8 correcciones SIMULTÁNEAS de la misma venta (8 claves distintas) dejan exactamente 1 venta nueva: 1 contra-asiento, 1 ejemplar, 1 auditoría, y la unidad vuelve UNA sola vez", async () => {
    const { cuenta, ventaMila } = await cerrarMilanesas();
    const resultados = await Promise.all(Array.from({ length: 8 }, () => quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila))));

    expect(resultados.filter((r) => r.ok), JSON.stringify(resultados)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok).every((r) => !r.ok && ["LA_CUENTA_CAMBIO", "LA_VENTA_CAMBIO", "YA_ANULADA", "LINEA_DE_OTRA_CUENTA"].includes(r.codigo)), JSON.stringify(resultados)).toBe(true);
    expect(await reemplazosDe(ventaMila)).toHaveLength(1);
    expect(await reversionesDe(ventaMila)).toBe(1);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(2);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion", entidadId: ventaMila, campo: "unidadesVendidas" } })).toBe(1);
    expect(await saldoMila()).toBe(998);
    expect(await ventasVigentes()).toBe(18000 + 3000);
  }, 90_000);

  it("8 envíos SIMULTÁNEOS con la MISMA clave: una sola corrección y todos reciben el mismo mensaje", async () => {
    const { cuenta, ventaMila } = await cerrarMilanesas();
    const comando = comandoDe(cuenta.id, ventaMila);
    const resultados = await Promise.all(Array.from({ length: 8 }, () => quitarUnidadesDeLineaCasoDeUso(actor(), comando)));

    expect(resultados.every((r) => r.ok), JSON.stringify(resultados)).toBe(true);
    expect(new Set(resultados.map((r) => r.mensaje)).size).toBe(1);
    expect(await reemplazosDe(ventaMila)).toHaveLength(1);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(2);
    expect(await saldoMila()).toBe(998);
  }, 90_000);

  it("corrección y una venta nueva SIMULTÁNEAS: el stock termina exacto (cada unidad cuenta una vez) y nunca negativo por la corrección", async () => {
    const { cuenta, ventaMila } = await cerrarMilanesas();
    // Se deja el stock justo: 997 → 3. La corrección devuelve 1; la venta nueva se lleva 1.
    const ajuste = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "AJUSTE", fecha: new Date(Date.now() - 3_600_000), usuarioId: s.admin.id } });
    await prisma.movimientoStock.create({ data: { operacionId: ajuste.id, productoId: s.milanesaReventa.id, seccionId: s.seccion.id, proceso: "AJUSTE", cantidad: -994, detalle: "Ajuste previo", precioTotal: 0, precioPorUnidadStock: 0 } });
    await prisma.operacion.update({ where: { id: ajuste.id }, data: { creadoEn: new Date(Date.now() - 3_600_000) } });
    expect(await saldoMila()).toBe(3);
    const otra = await sembrarCuenta((await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } })).id, s.admin.id, [{ productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, numeroEnvio: 1 }]);

    const [correccion] = await Promise.all([quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila)), cerrarCuenta(otra.id)]);

    expect(correccion.ok, JSON.stringify(correccion)).toBe(true);
    expect(await saldoMila()).toBe(3 + 1 - 1);
    expect(await saldoMila()).toBeGreaterThanOrEqual(0);
  }, 90_000);

  it("correcciones SUCESIVAS (3 → 2 → 1): la segunda se hace sobre la venta vigente, la cadena queda enlazada y «Corregir línea» entera también se hace sobre ella", async () => {
    const { cuenta, ventaMila } = await cerrarMilanesas();
    const primera = await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila));
    expect(primera.ok, JSON.stringify(primera)).toBe(true);
    if (!primera.ok) return;
    await pausa();
    const b = primera.datos.ventaNuevaId!;

    // La venta original ya no es la vigente: pedir la A de nuevo no es de la línea.
    expect(await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila, { ejemplarVisto: 2, totalVisto: 21000, unidadesVistas: 2 }))).toMatchObject({ ok: false, codigo: "LINEA_DE_OTRA_CUENTA" });

    const segunda = await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, b, { ejemplarVisto: 2, totalVisto: 21000, unidadesVistas: 2 }));
    expect(segunda.ok, JSON.stringify(segunda)).toBe(true);
    if (!segunda.ok) return;
    expect(segunda.datos).toMatchObject({ ejemplar: 3, unidadesQueQuedan: 1 });
    await pausa();
    const c = segunda.datos.ventaNuevaId!;
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: c } })).reemplazaAOperacionId).toBe(b);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: b } })).anuladaEn).not.toBeNull();
    expect(await saldoMila()).toBe(999);
    let [ticket] = await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, prisma, undefined, new Date());
    expect(ticket).toMatchObject({ estado: "vigente", numero: { ejemplar: 3 }, total: 12000 });
    expect(ticket.corregibles.find((x) => x.texto.includes("Milanesa"))).toMatchObject({ operacionId: c, texto: "1 × Milanesa" });

    // Y quitar la última unidad es corregir la línea entera (E0), sobre la venta vigente.
    const entera = await corregirLineaDeTicketCasoDeUso(actor(), { cuentaId: cuenta.id, operacionId: c, motivo: "Se anula la línea", ejemplarVisto: 3, totalVisto: 12000, claveIdempotencia: clave() });
    expect(entera.ok, JSON.stringify(entera)).toBe(true);
    expect(await saldoMila()).toBe(1000);
    [ticket] = await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, prisma, undefined, new Date());
    expect(ticket).toMatchObject({ total: 3000, estado: "vigente" });
  }, 90_000);

  it("D7: con un ajuste/conteo POSTERIOR del mismo producto y sección se rechaza y no escribe nada", async () => {
    const { cuenta, ventaMila } = await cerrarMilanesas();
    const ajuste = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "AJUSTE", fecha: new Date(), usuarioId: s.admin.id } });
    await prisma.movimientoStock.create({ data: { operacionId: ajuste.id, productoId: s.milanesaReventa.id, seccionId: s.seccion.id, proceso: "AJUSTE", cantidad: -1, detalle: "Ajuste manual", precioTotal: 0, precioPorUnidadStock: 0 } });
    const r = await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila));
    expect(r).toMatchObject({ ok: false, codigo: "CONTEO_POSTERIOR" });
    expect(await reversionesDe(ventaMila)).toBe(0);
    expect(await reemplazosDe(ventaMila)).toHaveLength(0);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);
  });

  it("unidades inválidas o todas: se rechaza sin escribir nada (quitar todas es anular la línea entera)", async () => {
    const { cuenta, ventaMila } = await cerrarMilanesas();
    expect(await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila, { unidadesAQuitar: 3 }))).toMatchObject({ ok: false, codigo: "ALCANCE_TOTAL" });
    expect(await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila, { unidadesAQuitar: 4 }))).toMatchObject({ ok: false, codigo: "UNIDADES_INVALIDAS" });
    expect(await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila, { unidadesAQuitar: 1.5 }))).toMatchObject({ ok: false, codigo: "UNIDADES_INVALIDAS" });
    expect(await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila, { unidadesVistas: 5 }))).toMatchObject({ ok: false, codigo: "LA_VENTA_CAMBIO" });
    expect(await reversionesDe(ventaMila)).toBe(0);
    expect(await reemplazosDe(ventaMila)).toHaveLength(0);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);
  });

  it("una venta que no es de esta cuenta, o una cuenta de otra sucursal, se rechaza sin escribir", async () => {
    const { cuenta } = await cerrarMilanesas();
    const ajena = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id } });
    expect(await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ajena.id))).toMatchObject({ ok: false, codigo: "LINEA_DE_OTRA_CUENTA" });
    expect(await quitarUnidadesDeLineaCasoDeUso({ ...actor(), sucursalId: "sucursal-ajena" }, comandoDe(cuenta.id, ajena.id))).toMatchObject({ ok: false, codigo: "NO_ENCONTRADA" });
    expect(await reversionesDe(ajena.id)).toBe(0);
  });

  it("todo o nada: si falla el último paso (el ejemplar del ticket) no queda NADA — ni contra-asiento, ni venta nueva, ni marca, ni auditoría, ni stock devuelto", async () => {
    const { cuenta, ventaMila } = await cerrarMilanesas();
    const auditoriaAntes = await prisma.registroAuditoria.count();
    vi.mocked(escribirEjemplarCorregido).mockImplementationOnce(async () => {
      throw new Error("falla simulada al escribir el ejemplar");
    });

    await expect(quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila))).rejects.toThrow("falla simulada");

    const a = await prisma.operacion.findUniqueOrThrow({ where: { id: ventaMila } });
    expect(a.anuladaEn).toBeNull();
    expect(a.motivoAnulacion).toBeNull();
    expect(await reversionesDe(ventaMila)).toBe(0);
    expect(await reemplazosDe(ventaMila)).toHaveLength(0);
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);
    expect(await prisma.registroAuditoria.count()).toBe(auditoriaAntes);
    expect(await saldoMila()).toBe(997);
  });

  it("invariancia: la corrección mueve exactamente lo pedido — ventas −$9.000, stock +1, pérdidas y el resto de las ventas sin cambio, y A + R suman 0", async () => {
    const { cuenta, ventaMila, ventaFlan } = await cerrarMilanesas();
    const mermas = () => prisma.operacion.count({ where: { proceso: { in: ["MERMA", "CONSUMO"] } } });
    const [ventasAntes, stockAntes, mermasAntes, flanAntes] = [await ventasVigentes(), await saldoMila(), await mermas(), await calcularSaldoTotal(s.flanReventa.id, s.seccion.id, prisma)];

    expect((await quitarUnidadesDeLineaCasoDeUso(actor(), comandoDe(cuenta.id, ventaMila))).ok).toBe(true);

    expect(await ventasVigentes()).toBe(ventasAntes - 9000);
    expect(await saldoMila()).toBe(stockAntes + 1);
    expect(await mermas()).toBe(mermasAntes);
    expect(await calcularSaldoTotal(s.flanReventa.id, s.seccion.id, prisma)).toBe(flanAntes);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: ventaFlan } })).anuladaEn).toBeNull();
    // A + R = 0 exacto: cantidades e importes de la venta original y su contra-asiento se cancelan.
    const reversion = await prisma.operacion.findFirstOrThrow({ where: { revierteAOperacionId: ventaMila } });
    const sumas = await prisma.movimientoStock.aggregate({ _sum: { cantidad: true, precioTotal: true }, where: { operacionId: { in: [ventaMila, reversion.id] } } });
    expect(new Prisma.Decimal(sumas._sum.cantidad ?? 0).toNumber()).toBe(0);
    expect(new Prisma.Decimal(sumas._sum.precioTotal ?? 0).toNumber()).toBe(0);
  });

  describe("permisos (Server Action)", () => {
    it("sin anular_venta o sin pos_emitir_ticket_corregido se rechaza y no escribe nada; con las dos, corrige; sin motivo o con unidades en 0 lo rechaza el guard", async () => {
      const { cuenta, ventaMila } = await cerrarMilanesas();
      const soloAnular = await crearUsuarioConRol(s.sucursalId, "soloanula", [{ clave: "anular_venta", ver: true, editar: true }]);
      await entrarComo(soloAnular);
      expect((await quitarUnidadesDeLinea(cuenta.id, ventaMila, 1, 3, "Una menos", 1, 30000, clave())).ok).toBe(false);

      const soloEmitir = await crearUsuarioConRol(s.sucursalId, "soloemite", [{ clave: "pos_emitir_ticket_corregido", ver: true, editar: true }]);
      await entrarComo(soloEmitir);
      expect((await quitarUnidadesDeLinea(cuenta.id, ventaMila, 1, 3, "Una menos", 1, 30000, clave())).ok).toBe(false);
      expect(await reemplazosDe(ventaMila)).toHaveLength(0);
      expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);

      await entrarComo(s.admin);
      expect(await quitarUnidadesDeLinea(cuenta.id, ventaMila, 1, 3, "  ", 1, 30000, clave())).toMatchObject({ ok: false });
      expect(await quitarUnidadesDeLinea(cuenta.id, ventaMila, 0, 3, "Una menos", 1, 30000, clave())).toMatchObject({ ok: false });
      expect(await reemplazosDe(ventaMila)).toHaveLength(0);
      expect(await quitarUnidadesDeLinea(cuenta.id, ventaMila, 1, 3, "Una menos", 1, 30000, clave())).toMatchObject({ ok: true, numero: 1, ejemplar: 2 });
      expect(await reemplazosDe(ventaMila)).toHaveLength(1);
    });
  });
});
