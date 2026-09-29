import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { registrarVentaEnTx, type ActorVenta } from "../../src/core/movimientos/registrar-venta";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

/**
 * Núcleo de la Venta extraído de `registrarVenta` (src/core/movimientos/registrar-venta.ts, docs/plan-tomar-pedido-2026-09-25.md,
 * B6/B6bis): el override interno de precio, el orden de `operacionIds`, `permitirStockNegativo`, y que la Server Action pública
 * no deja colar ninguno de los dos (mapea cada línea a mano).
 */
describe("registrarVentaEnTx y su frontera con registrarVenta", () => {
  let sucursalId: string;
  let seccionId: string;
  let actor: ActorVenta;
  let pvPanId: string;
  let pvGaseosaId: string;
  let mpHarinaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    actor = { usuarioId: admin.id, sucursalId, sucursalNombre: "Central" };

    mpHarinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    pvPanId = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 }, sucursalId)).id;
    pvGaseosaId = (await sembrarProductoDisponible({ codigo: "PV_GASEOSA", nombre: "Gaseosa", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 50 }, sucursalId)).id;
    await prisma.recetaVersion.create({
      data: { productoId: pvPanId, version: 1, ingredientes: { create: [{ insumoProductoId: mpHarinaId, cantidad: 0.5, unidadId: catalogo.kg.id, mermaPorcentaje: 0 }] } },
    });
  });

  const lineaVenta = (operacionId: string) => prisma.movimientoStock.findFirstOrThrow({ where: { operacionId, proceso: "VENTA" } });

  it("un precioUnitario colado en el payload de registrarVenta se ignora: se registra el precio de CATÁLOGO", async () => {
    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pvGaseosaId, cantidadVendida: 2, precioUnitario: 1 } as never] });
    expect(r.ok).toBe(true);
    const venta = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "VENTA", productoId: pvGaseosaId } });
    expect(Number(venta.precioPorUnidadStock)).toBe(50);
    expect(Number(venta.precioTotal)).toBe(100);
  });

  it("con override de precio, cobra ese precio y devuelve una Operacion por línea, en el orden de las líneas", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpHarinaId, cantidad: 10 }] });
    const r = await prisma.$transaction((tx) =>
      registrarVentaEnTx(tx, actor, {
        fecha: new Date(),
        origen: { tipo: "seccion", seccionId },
        detalle: "Mesa 4",
        lineas: [
          { productoId: pvGaseosaId, cantidadVendida: 1, precioUnitario: 77 },
          { productoId: pvPanId, cantidadVendida: 2, precioUnitario: 123.45 },
        ],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avisosStockNegativo).toEqual([]);
    expect(r.operacionIds).toHaveLength(2);
    const [gaseosa, pan] = await Promise.all(r.operacionIds.map(lineaVenta));
    expect([gaseosa.productoId, Number(gaseosa.precioPorUnidadStock)]).toEqual([pvGaseosaId, 77]);
    expect([pan.productoId, Number(pan.precioPorUnidadStock), Number(pan.precioTotal)]).toEqual([pvPanId, 123.45, 246.9]);
    const operacion = await prisma.operacion.findUniqueOrThrow({ where: { id: r.operacionIds[0] } });
    expect(operacion.detalleLibre).toBe("Mesa 4");
  });

  it("sección de otra sucursal → «No se encontró la sección.» sin escribir nada", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const ajena = await sembrarSeccion(norte.id, "Barra Norte");
    const r = await prisma.$transaction((tx) => registrarVentaEnTx(tx, actor, { fecha: new Date(), origen: { tipo: "seccion", seccionId: ajena.id }, lineas: [{ productoId: pvGaseosaId, cantidadVendida: 1 }] }));
    expect(r).toEqual({ ok: false, mensaje: "No se encontró la sección." });
    expect(await prisma.operacion.count()).toBe(0);
  });

  describe("permitirStockNegativo (B6bis)", () => {
    it("ausente o false: con stock insuficiente rechaza exactamente como antes y no escribe nada", async () => {
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpHarinaId, cantidad: 0.5 }] });
      for (const opciones of [undefined, { permitirStockNegativo: false }]) {
        const r = await prisma.$transaction((tx) => registrarVentaEnTx(tx, actor, { fecha: new Date(), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: pvPanId, cantidadVendida: 3 }] }, opciones));
        expect(r).toEqual({ ok: false, mensaje: 'Stock insuficiente para "Harina". Actual: 0.5, requerido: 1.5. Tiene stock en: Depósito.' });
      }
      // registrarVenta (la Server Action pública) tampoco lo permite.
      const publica = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pvPanId, cantidadVendida: 3 }] });
      expect(publica).toEqual({ ok: false, mensaje: 'Stock insuficiente para "Harina". Actual: 0.5, requerido: 1.5. Tiene stock en: Depósito.' });
      expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
      expect(await calcularSaldoTotal(mpHarinaId, seccionId, prisma)).toBe(0.5);
    });

    it("true: la venta se registra igual, el insumo queda en negativo y el aviso trae el detalle", async () => {
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpHarinaId, cantidad: 0.5 }] });
      const r = await prisma.$transaction((tx) =>
        registrarVentaEnTx(tx, actor, { fecha: new Date(), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: pvPanId, cantidadVendida: 3 }, { productoId: pvGaseosaId, cantidadVendida: 1 }] }, { permitirStockNegativo: true })
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.operacionIds).toHaveLength(2);
      expect(r.avisosStockNegativo).toEqual([{ productoId: mpHarinaId, nombre: "Harina", seccionId, seccionNombre: "Depósito", actual: 0.5, requerido: 1.5, resultante: -1 }]);
      expect(await calcularSaldoTotal(mpHarinaId, seccionId, prisma)).toBe(-1);
      expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(2);
    });

    it("con hermanos que no alcanzan: toma lo de los hermanos y el rechazo/aviso nombra SOLO lo que le falta al producto de la receta", async () => {
      const catalogo = await prisma.producto.findUniqueOrThrow({ where: { id: mpHarinaId } });
      const hermana = await sembrarProductoDisponible({ codigo: "MP_HARINA_000", nombre: "Harina 000", tipo: "MP", unidadStockId: catalogo.unidadStockId, insumoId: catalogo.insumoId }, sucursalId);
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpHarinaId, cantidad: 0.5 }, { productoId: hermana.id, cantidad: 0.4 }] });
      const venta = { fecha: new Date(), origen: { tipo: "seccion" as const, seccionId }, lineas: [{ productoId: pvPanId, cantidadVendida: 3 }] };

      // Se piden 1,5: 0,5 de Harina + 0,4 de su hermana, y a Harina le falta el resto (0,6): se le cargan 1,1 contra 0,5.
      const rechazo = await prisma.$transaction((tx) => registrarVentaEnTx(tx, actor, venta));
      expect(rechazo).toEqual({ ok: false, mensaje: 'Stock insuficiente para "Harina". Actual: 0.5, requerido: 1.1. Tiene stock en: Depósito.' });
      expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);

      const r = await prisma.$transaction((tx) => registrarVentaEnTx(tx, actor, venta, { permitirStockNegativo: true }));
      expect(r).toMatchObject({ ok: true, avisosStockNegativo: [{ productoId: mpHarinaId, nombre: "Harina", seccionId, seccionNombre: "Depósito", actual: 0.5, requerido: 1.1, resultante: -0.6 }] });
      expect(await calcularSaldoTotal(mpHarinaId, seccionId, prisma)).toBe(-0.6);
      expect(await calcularSaldoTotal(hermana.id, seccionId, prisma)).toBe(0);
    });

    it("true pero con stock suficiente: sin avisos", async () => {
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpHarinaId, cantidad: 5 }] });
      const r = await prisma.$transaction((tx) => registrarVentaEnTx(tx, actor, { fecha: new Date(), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: pvPanId, cantidadVendida: 3 }] }, { permitirStockNegativo: true }));
      expect(r).toMatchObject({ ok: true, avisosStockNegativo: [] });
      expect(await calcularSaldoTotal(mpHarinaId, seccionId, prisma)).toBe(3.5);
    });
  });

  /** Task #16 (promo-combo, docs/plan-promo-combo-2026-09-26.md, paso 7): promoCuentaId opcional por línea, sin romper el
   *  arrastre de redondeo de la Task #27 (las líneas de arriba, con receta y consumo fraccionado, siguen pasando). */
  describe("promoCuentaId por línea (Task #16)", () => {
    async function sembrarPromoCuenta() {
      const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 99 } });
      const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: actor.usuarioId } });
      const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menús E2E promoCuentaId" } });
      const promoCarta = await prisma.promoCarta.create({ data: { sucursalId, seccionCartaId: seccionCarta.id, titulo: "Menú del día", precio: 150 } });
      return prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId: promoCarta.id, precio: 150, titulo: "Menú del día", creadoPorId: actor.usuarioId } });
    }

    it("una línea con promoCuentaId escribe la Operacion enlazada a esa PromoCuenta; sin el campo, queda null (igual que siempre)", async () => {
      const promoCuenta = await sembrarPromoCuenta();
      const r = await prisma.$transaction((tx) =>
        registrarVentaEnTx(tx, actor, {
          fecha: new Date(),
          origen: { tipo: "seccion", seccionId },
          lineas: [
            { productoId: pvGaseosaId, cantidadVendida: 1, promoCuentaId: promoCuenta.id },
            { productoId: pvGaseosaId, cantidadVendida: 1 }, // suelto, mismo producto: Operacion aparte igual (una por línea)
          ],
        })
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.operacionIds).toHaveLength(2);
      const [conPromo, suelto] = await Promise.all(r.operacionIds.map((id) => prisma.operacion.findUniqueOrThrow({ where: { id } })));
      expect(conPromo.promoCuentaId).toBe(promoCuenta.id);
      expect(suelto.promoCuentaId).toBeNull();
    });

    it("promoCuentaId null/ausente es EXACTAMENTE lo mismo: Operacion.promoCuentaId queda null", async () => {
      const r = await prisma.$transaction((tx) =>
        registrarVentaEnTx(tx, actor, { fecha: new Date(), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: pvGaseosaId, cantidadVendida: 1, promoCuentaId: null }] })
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const operacion = await prisma.operacion.findUniqueOrThrow({ where: { id: r.operacionIds[0] } });
      expect(operacion.promoCuentaId).toBeNull();
    });

    it("convive con el arrastre de redondeo de la Task #27: una venta con promoCuentaId y consumo fraccionado sigue arrastrando el resto igual que un suelto", async () => {
      // Unidad de 0 decimales (mismo escenario que arrastre-redondeo/venta-fraccionada-consumo-mp): dos partes de 0,5 del mismo
      // insumo consumen 1 en total, no 2 — con o sin promo de por medio.
      const catalogo = await prisma.producto.findUniqueOrThrow({ where: { id: mpHarinaId }, include: { unidadStock: true } });
      await prisma.unidad.update({ where: { id: catalogo.unidadStockId }, data: { decimales: 0 } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpHarinaId, cantidad: 10 }] });
      const promoCuenta = await sembrarPromoCuenta();

      // Receta de pvPanId pide 0,5 de harina por unidad (ver beforeEach) — dos ventas de 1 unidad cada una, la primera con
      // promoCuentaId, la segunda suelta: el arrastre es por (sucursal, producto CONSUMIDO), no por promo, así que las dos
      // páginas comparten la MISMA deuda.
      const r1 = await prisma.$transaction((tx) => registrarVentaEnTx(tx, actor, { fecha: new Date(), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: pvPanId, cantidadVendida: 1, promoCuentaId: promoCuenta.id }] }));
      expect(r1.ok).toBe(true);
      const r2 = await prisma.$transaction((tx) => registrarVentaEnTx(tx, actor, { fecha: new Date(), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: pvPanId, cantidadVendida: 1 }] }));
      expect(r2.ok).toBe(true);

      // 2 × 0,5 = 1 exacto, aunque cada parte redondeada individualmente (a 0 decimales) diera 1 + 0 o 0 + 1 según el arrastre.
      expect(await calcularSaldoTotal(mpHarinaId, seccionId, prisma)).toBe(9);
      if (!r1.ok || !r2.ok) return;
      const operacionConPromo = await prisma.operacion.findUniqueOrThrow({ where: { id: r1.operacionIds[0] } });
      expect(operacionConPromo.promoCuentaId).toBe(promoCuenta.id);
    });
  });

  /** D7 (mismo criterio que Task #14 con clienteId): la venta de MOSTRADOR nunca deja pasar un promoCuentaId. */
  it("registrarVenta (mostrador): un promoCuentaId colado en el payload se ignora, Operacion.promoCuentaId queda null (D7)", async () => {
    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pvGaseosaId, cantidadVendida: 1, promoCuentaId: "id-bogus-colado" } as never] });
    expect(r.ok).toBe(true);
    const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", movimientos: { some: { productoId: pvGaseosaId } } } });
    expect(operacion.promoCuentaId).toBeNull();
  });
});
