import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { crearMozo, crearUsuarioConRol, entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { anularItemEnviado, cerrarCuenta } from "../../src/server/actions/pos/cuenta";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";
import { calcularAlertasStock, obtenerResumenAlertasStock } from "../../src/core/stock/alertas";
import { calcularStockConsolidado } from "../../src/core/stock/consolidado";
import { obtenerMapaDeMesas } from "../../src/core/pos/mesas";
import { obtenerDetalleDeMesa } from "../../src/core/pos/cuenta";
import { obtenerBoletasRecientes } from "../../src/core/pos/boleta";

/**
 * Cierre de cuenta (src/server/actions/pos/cuenta.ts, docs/plan-tomar-pedido-2026-09-25.md paso 6): registra la venta con el núcleo
 * de la venta de mostrador, al precio congelado, y libera la mesa. Stock insuficiente NO bloquea (B6bis): la venta se registra, el
 * mensaje lo dice y queda auditado; el saldo negativo aparece en Alertas de stock y se corrige con Conteo Físico o Ajuste normales.
 */
describe("cerrarCuenta (server action)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const comprar = (productoId: string, cantidad: number) => registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: s.seccion.id, items: [{ productoId, cantidad }] });
  const ventasDeLaMesa = () =>
    prisma.operacion.findMany({ where: { proceso: "VENTA", detalleLibre: "Mesa 4" }, include: { movimientos: { orderBy: { proceso: "asc" } } }, orderBy: { creadoEn: "asc" } });

  it("registra una Operacion VENTA por línea neta, al precio congelado, con «Mesa 4», los consumos de receta, y libera la mesa", async () => {
    await comprar(s.muzzarella.id, 10);
    // Precio congelado distinto del de catálogo de hoy (la pizza hoy vale 12.000).
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.pizza.id, cantidad: 2, precioUnitario: 11000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      { productoId: s.pizza.id, cantidad: 1, precioUnitario: 11000, numeroEnvio: 2 },
    ]);

    const r = await cerrarCuenta(cuenta.id, s.seccion.id);
    expect(r).toEqual({ ok: true, mensaje: `Cuenta de la mesa 4 cerrada: se registró la venta por ${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(36000)}.` });

    const ventas = await ventasDeLaMesa();
    expect(ventas).toHaveLength(2);
    expect(ventas.every((v) => v.proveedorId === null && v.usuarioId === s.admin.id && v.sucursalId === s.sucursalId)).toBe(true);
    const lineaDe = (productoId: string) => ventas.flatMap((v) => v.movimientos).find((m) => m.proceso === "VENTA" && m.productoId === productoId)!;
    expect([Number(lineaDe(s.pizza.id).cantidad), Number(lineaDe(s.pizza.id).precioPorUnidadStock), Number(lineaDe(s.pizza.id).precioTotal)]).toEqual([-3, 11000, 33000]);
    expect([Number(lineaDe(s.flan.id).cantidad), Number(lineaDe(s.flan.id).precioPorUnidadStock)]).toEqual([-1, 3000]);
    expect(await calcularSaldoTotal(s.muzzarella.id, s.seccion.id)).toBe(10 - 3 * 0.25);

    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    const operacionDe = (productoId: string) => ventas.find((v) => v.movimientos.some((m) => m.proceso === "VENTA" && m.productoId === productoId))!.id;
    for (const item of items) expect(item.operacionId).toBe(operacionDe(item.productoId));

    const cerrada = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } });
    expect(cerrada.cerradaEn).not.toBeNull();
    expect(cerrada.cerradaPorId).toBe(s.admin.id);
    expect((await obtenerMapaDeMesas(s.sucursalId)).mesas[0]).toMatchObject({ estado: "libre", total: 0 });
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  it("las anulaciones netean: una línea anulada entera no se vende, una parcial vende lo que quedó", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 3, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
    ]);
    const [mila, flan] = cuenta.items;
    await anularItemEnviado(mila.id, 1, "Una menos", 3);
    await anularItemEnviado(flan.id, 1, "No quiso postre", 1);

    expect((await cerrarCuenta(cuenta.id, s.seccion.id)).ok).toBe(true);
    const ventas = await ventasDeLaMesa();
    expect(ventas.flatMap((v) => v.movimientos).map((m) => [m.productoId, Number(m.cantidad), Number(m.precioTotal)])).toEqual([[s.milanesa.id, -2, 18000]]);
    // El flan anulado entero queda sin Operacion; la milanesa y su espejo, enlazados a la misma venta.
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect(items.filter((i) => i.productoId === s.flan.id).every((i) => i.operacionId === null)).toBe(true);
    expect(items.filter((i) => i.productoId === s.milanesa.id).every((i) => i.operacionId === ventas[0].id)).toBe(true);
  });

  it("el mismo producto a dos precios congelados distintos sale en dos ventas, cada una a su precio", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 2, precioUnitario: 3500, numeroEnvio: 2 },
    ]);
    expect((await cerrarCuenta(cuenta.id, s.seccion.id)).ok).toBe(true);
    const lineas = (await ventasDeLaMesa()).flatMap((v) => v.movimientos).map((m) => [Number(m.cantidad), Number(m.precioPorUnidadStock)]);
    expect(lineas).toEqual([[-1, 3000], [-2, 3500]]);
  });

  it("neto cero (todo anulado): cierra la cuenta sin venta", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    await anularItemEnviado(cuenta.items[0].id, 1, "Se fueron", 1);
    expect(await cerrarCuenta(cuenta.id, s.seccion.id)).toEqual({ ok: true, mensaje: "Cuenta de la mesa 4 cerrada sin venta: no quedó nada por cobrar." });
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).not.toBeNull();
  });

  it("con ítems sin enviar, bloquea y la cuenta sigue abierta", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 },
      { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000 },
    ]);
    expect(await cerrarCuenta(cuenta.id, s.seccion.id)).toEqual({ ok: false, mensaje: "Hay 2 ítems sin enviar: envialos o quitalos." });
    expect(await prisma.operacion.count()).toBe(0);
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).toBeNull();
  });

  it("un segundo cierre devuelve «ya estaba cerrada» sin vender dos veces", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await cerrarCuenta(cuenta.id, s.seccion.id)).ok).toBe(true);
    expect(await cerrarCuenta(cuenta.id, s.seccion.id)).toEqual({ ok: true, mensaje: "La cuenta de la mesa 4 ya estaba cerrada." });
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(1);
  });

  it("una sección de otra sucursal se rechaza y la cuenta sigue abierta, sin escribir nada", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const ajena = await sembrarSeccion(norte.id, "Barra Norte");
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect(await cerrarCuenta(cuenta.id, ajena.id)).toEqual({ ok: false, mensaje: "No se encontró la sección." });
    expect(await prisma.operacion.count()).toBe(0);
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).toBeNull();
  });

  it("una cuenta de otra sucursal no se encuentra", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 1 } });
    const ajena = await sembrarCuenta(mesaNorte.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect(await cerrarCuenta(ajena.id, s.seccion.id)).toEqual({ ok: false, mensaje: "No se encontró esa cuenta en esta sucursal." });
  });

  it("sin pos_cerrar_cuenta no se puede cerrar: ni el mozo (pos_tomar_pedido) ni uno que solo lo VE", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    const mozo = await crearMozo(s.sucursalId);
    const soloVe = await crearUsuarioConRol(s.sucursalId, "cajero-solo-ve", [{ clave: "pos_cerrar_cuenta", ver: true, editar: false }]);
    for (const usuario of [mozo, soloVe]) {
      await entrarComo(usuario);
      const r = await cerrarCuenta(cuenta.id, s.seccion.id);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      expect(r.mensaje).toContain('"pos_cerrar_cuenta"');
    }
    expect(await prisma.operacion.count()).toBe(0);
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).toBeNull();
  });

  it("un cajero con solo pos_cerrar_cuenta Editar sí puede cerrar", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    const cajero = await crearUsuarioConRol(s.sucursalId, "cajero", [{ clave: "pos_cerrar_cuenta", ver: true, editar: true }]);
    await entrarComo(cajero);
    expect((await cerrarCuenta(cuenta.id, s.seccion.id)).ok).toBe(true);
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaPorId).toBe(cajero.id);
  });

  describe("stock insuficiente (B6bis): la venta se registra igual, con aviso explícito y auditoría", () => {
    it("registra la venta, cierra la cuenta, deja el insumo en negativo, lo dice en el mensaje y audita cada insumo", async () => {
      await comprar(s.muzzarella.id, 0.5);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
        { productoId: s.pizza.id, cantidad: 6, precioUnitario: 12000, numeroEnvio: 1 },
        { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      ]);

      const r = await cerrarCuenta(cuenta.id, s.seccion.id);
      expect(r.ok).toBe(true);
      expect(r.mensaje).toMatch(/^Cuenta de la mesa 4 cerrada: se registró la venta por /);
      expect(r.mensaje).toContain('⚠ Quedó stock negativo: "Muzzarella" (tenía 0,5, se consumió 1,5, quedó en -1). Corregilo con un Conteo Físico o un Ajuste.');

      expect(await calcularSaldoTotal(s.muzzarella.id, s.seccion.id)).toBe(-1);
      expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).not.toBeNull();
      const ventas = await ventasDeLaMesa();
      expect(ventas).toHaveLength(2);

      const auditoria = await prisma.registroAuditoria.findMany();
      expect(auditoria).toHaveLength(1);
      const ventaDeLaPizza = ventas.find((v) => v.movimientos.some((m) => m.proceso === "CONSUMO" && m.productoId === s.muzzarella.id))!;
      expect(auditoria[0]).toMatchObject({ entidad: "Operacion", entidadId: ventaDeLaPizza.id, campo: "saldoStock", valorAnterior: "0.5", valorNuevo: "-1", actorId: s.admin.id, sucursalId: s.sucursalId });
      expect(auditoria[0].descripcion).toBe(
        'Mesa 4: al cerrar la cuenta (admin@test.com) el stock de "Muzzarella" en «Salón» quedó en negativo — tenía 0,5, la venta consumió 1,5, faltaron 1. La venta se registró igual; corregí el saldo con un Conteo Físico o un Ajuste.'
      );
    });

    it("sin ninguna compra previa (saldo 0) también cierra, y lo que faltó es todo lo consumido", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);
      const r = await cerrarCuenta(cuenta.id, s.seccion.id);
      expect(r.mensaje).toContain('"Muzzarella" (tenía 0, se consumió 0,5, quedó en -0,5)');
      const [fila] = await prisma.registroAuditoria.findMany();
      expect(fila.descripcion).toContain("tenía 0, la venta consumió 0,5, faltaron 0,5");
    });

    it("el insumo en negativo aparece en Alertas de stock como CRÍTICO (sin romperse) y en el consolidado como NEGATIVO", async () => {
      await prisma.stockMinimoProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.muzzarella.id, minimo: 2 } });
      await comprar(s.muzzarella.id, 0.5);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 6, precioUnitario: 12000, numeroEnvio: 1 }]);
      expect((await cerrarCuenta(cuenta.id, s.seccion.id)).ok).toBe(true);

      const alertas = await calcularAlertasStock(s.sucursalId);
      const muzza = alertas.find((a) => a.productoId === s.muzzarella.id);
      expect(muzza).toMatchObject({ saldoActual: -1, stockMinimo: 2, diferencia: -3, estado: "CRITICO", seccionNombre: "Salón" });
      const resumen = await obtenerResumenAlertasStock(s.sucursalId);
      expect(resumen.criticos).toBeGreaterThanOrEqual(1);
      expect(resumen.items.some((a) => a.productoId === s.muzzarella.id)).toBe(true);

      const consolidado = await calcularStockConsolidado(s.sucursalId);
      expect(consolidado.find((f) => f.productoId === s.muzzarella.id && f.seccionId === s.seccion.id)).toMatchObject({ teorico: -1, estado: "NEGATIVO" });
    });

    it("se corrige con un Conteo Físico normal (sin caso especial): el saldo pasa a lo contado y sale de las alertas", async () => {
      await prisma.stockMinimoProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.muzzarella.id, minimo: 2 } });
      await comprar(s.muzzarella.id, 0.5);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 6, precioUnitario: 12000, numeroEnvio: 1 }]);
      await cerrarCuenta(cuenta.id, s.seccion.id);

      const r = await registrarConteoFisico({ productoId: s.muzzarella.id, seccionId: s.seccion.id, conteoReal: 3, fechaConteo: new Date(), accion: "AJUSTAR" });
      expect(r).toEqual({ ok: true, mensaje: "Conteo registrado. Diferencia: +4 (ajustada)." });
      expect(await calcularSaldoTotal(s.muzzarella.id, s.seccion.id)).toBe(3);
      expect((await calcularAlertasStock(s.sucursalId)).some((a) => a.productoId === s.muzzarella.id)).toBe(false);
      const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: s.muzzarella.id } });
      expect([Number(conteo.saldoSistema), Number(conteo.diferencia), conteo.estado]).toEqual([-1, 4, "RESUELTO"]);
    });

    it("también se corrige con un Ajuste normal (sin caso especial)", async () => {
      await comprar(s.muzzarella.id, 0.5);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 6, precioUnitario: 12000, numeroEnvio: 1 }]);
      await cerrarCuenta(cuenta.id, s.seccion.id);

      const r = await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId: s.seccion.id, items: [{ productoId: s.muzzarella.id, cantidad: 1.5 }] });
      expect(r.ok).toBe(true);
      expect(await calcularSaldoTotal(s.muzzarella.id, s.seccion.id)).toBe(0.5);
    });
  });

  it("importes exactos (plan de precisión, Paso 5): 0,3 kg × $1.234,55 = 370,365 → la mesa, el mensaje de cierre y la VENTA dicen 370,37", async () => {
    const jamon = await sembrarProductoDisponible({ codigo: "PV_JAMON", nombre: "Jamón crudo por kg", tipo: "PV", unidadStockId: s.kg.id, precioVenta: 1234.55 }, s.sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: jamon.id, version: 1, ingredientes: { create: [{ insumoProductoId: s.muzzarella.id, cantidad: 1, unidadId: s.kg.id }] } } });
    await comprar(s.muzzarella.id, 10);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: jamon.id, cantidad: 0.3, precioUnitario: 1234.55, numeroEnvio: 1 }]);

    expect.soft((await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id))?.cuenta?.total).toBe(370.37);
    expect.soft((await obtenerMapaDeMesas(s.sucursalId)).mesas[0].total).toBe(370.37);

    const r = await cerrarCuenta(cuenta.id, s.seccion.id);
    const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
    expect.soft(r.mensaje).toContain(MONEDA.format(370.37));
    const [venta] = await ventasDeLaMesa();
    expect.soft(Number(venta.movimientos.find((m) => m.proceso === "VENTA")!.precioTotal)).toBe(370.37);
  });

  it("el total del mensaje de cierre y de la boleta es la suma de las líneas VENTA registradas, centavo a centavo (Paso 6)", async () => {
    const jamon = await sembrarProductoDisponible({ codigo: "PV_JAMON", nombre: "Jamón crudo por kg", tipo: "PV", unidadStockId: s.kg.id, precioVenta: 1234.55 }, s.sucursalId);
    const queso = await sembrarProductoDisponible({ codigo: "PV_QUESO", nombre: "Queso por kg", tipo: "PV", unidadStockId: s.kg.id, precioVenta: 1234.57 }, s.sucursalId);
    for (const pv of [jamon, queso]) {
      await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: s.muzzarella.id, cantidad: 1, unidadId: s.kg.id }] } } });
    }
    await comprar(s.muzzarella.id, 10);
    // 0,3 × 1234,55 = 370,365 → 370,37 y 0,5 × 1234,57 = 617,285 → 617,29: registradas suman 987,66; la suma cruda redondeada, 987,65.
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: jamon.id, cantidad: 0.3, precioUnitario: 1234.55, numeroEnvio: 1 },
      { productoId: queso.id, cantidad: 0.5, precioUnitario: 1234.57, numeroEnvio: 1 },
    ]);

    const r = await cerrarCuenta(cuenta.id, s.seccion.id);
    const registrado = (await ventasDeLaMesa()).flatMap((v) => v.movimientos).filter((m) => m.proceso === "VENTA").map((m) => Number(m.precioTotal));
    expect(registrado.sort((a, b) => a - b)).toEqual([370.37, 617.29]);
    const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
    expect.soft(r.mensaje).toContain(MONEDA.format(987.66));
    const [boleta] = await obtenerBoletasRecientes(s.sucursalId, s.mesa.id);
    expect.soft(boleta.total).toBe(987.66);
  });
});
