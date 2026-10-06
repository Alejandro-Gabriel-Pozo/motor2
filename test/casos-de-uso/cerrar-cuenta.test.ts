import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, prisma, sembrarSeccion } from "../setup/test-db";
import { sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { cerrarCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/cerrar-cuenta";
import { aResultadoAccion } from "../../src/core/resultado-caso";

/**
 * Caso de uso `cerrarCuentaCasoDeUso` (src/server/actions/pos/casos-de-uso/cerrar-cuenta.ts; Task #41, Fase M12a). Postgres real, sin
 * mocks de base ni de sesión: el caso de uso recibe el actor ya resuelto (el permiso lo chequea `conPermiso` en la Server Action,
 * cubierta por test/pos/cerrar-cuenta-*.test.ts y cuenta-concurrencia.test.ts, que no se tocaron).
 *
 * Un caso por cada desenlace de éxito (CON_VENTA, SIN_VENTA, YA_CERRADA) y por cada código de fracaso (NO_ENCONTRADA, ITEMS_SIN_ENVIAR,
 * VENTA_RECHAZADA), verificando `datos`, los textos exactos de antes y lo que queda (o NO queda) escrito. Un `cuentaId` que no es un
 * string lo rechaza el guard, en test/core/features/cuentas/cuenta-guard.test.ts.
 */
describe("cerrarCuentaCasoDeUso", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  const actor = () => ({ usuarioId: s.admin.id, sucursalId: s.sucursalId, sucursalNombre: s.sucursal.nombre, email: "admin@test.com", ahora: new Date(), ...baseDeTest });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
  });

  it("CON_VENTA: una Operacion por línea neta, ejemplar A numerado, ítems enlazados, cuenta cerrada; datos y mensaje como antes", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
    ]);
    // Ya hay un ticket N.º 41 en la sucursal: la siguiente es la 42 (max + 1).
    const mesa5 = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
    const otra = await prisma.cuenta.create({ data: { mesaId: mesa5.id, abiertaPorId: s.admin.id, cerradaEn: new Date(), cerradaPorId: s.admin.id } });
    await prisma.ejemplarTicket.create({ data: { sucursalId: s.sucursalId, cuentaId: otra.id, numero: 41, ejemplar: 1, emitidoEn: new Date(), emitidoPorId: s.admin.id } });

    const r = await cerrarCuentaCasoDeUso(actor(), { cuentaId: cuenta.id });

    const total = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(21000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mensaje).toBe(`Cuenta de la mesa 4 cerrada: se registró la venta por ${total}.`);
    expect(r.datos).toMatchObject({ desenlace: "CON_VENTA", numeroTicket: 42, insumosEnNegativo: 0 });
    expect(r.datos.operacionIds).toHaveLength(2);
    expect(aResultadoAccion(r)).toEqual({ ok: true, mensaje: r.mensaje });

    const ventas = await prisma.operacion.findMany({ where: { id: { in: r.datos.operacionIds } } });
    expect(ventas.every((v) => v.proceso === "VENTA" && v.detalleLibre === "Mesa 4" && v.sucursalId === s.sucursalId)).toBe(true);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id }, orderBy: { creadoEn: "asc" } });
    expect(items.map((i) => i.operacionId)).toEqual(r.datos.operacionIds);
    const ejemplar = await prisma.ejemplarTicket.findFirstOrThrow({ where: { cuentaId: cuenta.id } });
    expect(ejemplar).toMatchObject({ numero: 42, ejemplar: 1, emitidoPorId: s.admin.id, corrigeAId: null });
    const cerrada = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } });
    expect(cerrada.cerradaPorId).toBe(s.admin.id);
    expect(cerrada.cerradaEn).toEqual(ejemplar.emitidoEn);
  });

  it("CON_VENTA con cliente: cobra con el % congelado de la cuenta y lo dice en el mensaje", async () => {
    const cliente = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 50 } });
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    // El snapshot de la cuenta (10 %) manda, no el % actual del cliente (50 %).
    await prisma.cuenta.update({ where: { id: cuenta.id }, data: { clienteId: cliente.id, descuentoPorcentaje: 10 } });

    const r = await cerrarCuentaCasoDeUso(actor(), { cuentaId: cuenta.id });

    const total = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(2700);
    expect(r).toMatchObject({ ok: true, mensaje: `Cuenta de la mesa 4 cerrada: se registró la venta por ${total} (con 10% de descuento a «Fulano»).` });
    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });
    expect(venta.clienteId).toBe(cliente.id);
  });

  it("CON_VENTA con stock negativo: cuenta los insumos auditados en datos", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);

    const r = await cerrarCuentaCasoDeUso(actor(), { cuentaId: cuenta.id });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos).toMatchObject({ desenlace: "CON_VENTA", numeroTicket: 1, insumosEnNegativo: 1 });
    expect(r.mensaje).toContain('⚠ Quedó stock negativo: "Muzzarella" en «Salón» (tenía 0, se consumió 0,5, quedó en -0,5).');
    const [fila] = await prisma.registroAuditoria.findMany();
    expect(fila).toMatchObject({ entidad: "Operacion", entidadId: r.datos.operacionIds[0], campo: "saldoStock", actorId: s.admin.id });
  });

  it("SIN_VENTA: neto cero cierra sin venta ni número de ticket", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: -1, precioUnitario: 3000, numeroEnvio: 1 },
    ]);

    const r = await cerrarCuentaCasoDeUso(actor(), { cuentaId: cuenta.id });

    expect(r).toEqual({
      ok: true,
      mensaje: "Cuenta de la mesa 4 cerrada sin venta: no quedó nada por cobrar.",
      datos: { desenlace: "SIN_VENTA", operacionIds: [], numeroTicket: null, insumosEnNegativo: 0 },
    });
    expect(await prisma.operacion.count()).toBe(0);
    expect(await prisma.ejemplarTicket.count()).toBe(0);
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).not.toBeNull();
  });

  it("YA_CERRADA (idempotente por estado): ok sin escribir nada", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await cerrarCuentaCasoDeUso(actor(), { cuentaId: cuenta.id })).ok).toBe(true);
    const antes = { operaciones: await prisma.operacion.count(), tickets: await prisma.ejemplarTicket.count(), cuenta: await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } }) };

    const r = await cerrarCuentaCasoDeUso(actor(), { cuentaId: cuenta.id });

    expect(r).toEqual({
      ok: true,
      mensaje: "La cuenta de la mesa 4 ya estaba cerrada.",
      datos: { desenlace: "YA_CERRADA", operacionIds: [], numeroTicket: null, insumosEnNegativo: 0 },
    });
    expect(await prisma.operacion.count()).toBe(antes.operaciones);
    expect(await prisma.ejemplarTicket.count()).toBe(antes.tickets);
    expect(await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).toEqual(antes.cuenta);
  });

  it("NO_ENCONTRADA: un id que no existe o una cuenta de OTRA sucursal", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 1 } });
    const ajena = await sembrarCuenta(mesaNorte.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);

    for (const cuentaId of ["no-existe", ajena.id]) {
      expect(await cerrarCuentaCasoDeUso(actor(), { cuentaId })).toEqual({ ok: false, codigo: "NO_ENCONTRADA", mensaje: "No se encontró esa cuenta en esta sucursal." });
    }
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: ajena.id } })).cerradaEn).toBeNull();
  });

  it("ITEMS_SIN_ENVIAR: singular y plural, sin escribir nada", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 },
    ]);
    expect(await cerrarCuentaCasoDeUso(actor(), { cuentaId: cuenta.id })).toEqual({ ok: false, codigo: "ITEMS_SIN_ENVIAR", mensaje: "Hay 1 ítem sin enviar: envialo o quitalo." });

    await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, creadoPorId: s.admin.id } });
    expect(await cerrarCuentaCasoDeUso(actor(), { cuentaId: cuenta.id })).toEqual({ ok: false, codigo: "ITEMS_SIN_ENVIAR", mensaje: "Hay 2 ítems sin enviar: envialos o quitalos." });

    expect(await prisma.operacion.count()).toBe(0);
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).toBeNull();
  });

  it("VENTA_RECHAZADA: el núcleo rechaza (sin sección activa), no se gasta número de ticket y la cuenta sigue abierta", async () => {
    await prisma.seccion.update({ where: { id: s.seccion.id }, data: { activa: false } });
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    await sembrarSeccion(norte.id, "Barra Norte");
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);

    expect(await cerrarCuentaCasoDeUso(actor(), { cuentaId: cuenta.id })).toEqual({
      ok: false,
      codigo: "VENTA_RECHAZADA",
      mensaje: "Esta sucursal no tiene ninguna sección activa: pedile a un admin que cree una.",
    });
    expect(await prisma.operacion.count()).toBe(0);
    expect(await prisma.ejemplarTicket.count()).toBe(0);
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).toBeNull();
  });
});
