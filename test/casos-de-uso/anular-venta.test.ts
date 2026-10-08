import { beforeEach, describe, expect, it } from "vitest";
import { DIA_MS, enElPasado } from "../setup/tiempo";
import { baseDeTest, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { anularVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-venta";
import { aResultadoAccion } from "../../src/core/resultado-caso";
import { detalleReversionDeVenta } from "../../src/core/movimientos/anulaciones";
import { registrarConteoFisicoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-conteo-fisico";
import { cancelarConteoFisicoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/cancelar-conteo-fisico";
import { registrarPagoConsignanteCasoDeUso } from "../../src/server/actions/reportes/casos-de-uso/registrar-pago-consignante";

/**
 * Caso de uso `anularVentaCasoDeUso` (src/server/actions/movimientos/casos-de-uso/anular-venta.ts; Task #41, Fase M). Postgres real,
 * sin mocks de base ni de sesión: el caso de uso recibe el actor ya resuelto (el permiso lo chequea `conPermiso` en la Server Action,
 * cubierta por test/movimientos/venta.test.ts y test/movimientos/venta-anular-auditoria.test.ts, que no se tocaron).
 *
 * Un caso por cada código de resultado (éxito, NO_ENCONTRADA, NO_ES_VENTA, YA_ANULADA), verificando también `datos`, los textos
 * exactos de antes y lo que queda escrito. Un `operacionId` que no es un string lo rechaza el guard, en
 * test/core/features/ventas/venta-guard.test.ts.
 */
describe("anularVentaCasoDeUso", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaId: string;

  const actor = () => ({ usuarioId: adminId, sucursalId, ahora: new Date(), ...baseDeTest });

  type Linea = { proceso?: "VENTA" | "CONSUMO" | "LIQUIDACION_CONSIGNACION"; cantidad: number; cantidadExacta?: number | null; precioTotal: number; precioPorUnidadStock: number; detalle: string };

  /** Una Operación con sus líneas de Kardex, armada directo por Prisma (fecha fija: 2026-08-06). */
  async function operacion(opciones: { proceso?: "VENTA" | "MERMA"; nroFactura?: string | null; promoCuentaId?: string; lineas?: Linea[] } = {}) {
    const proceso = opciones.proceso ?? "VENTA";
    const op = await prisma.operacion.create({
      data: { sucursalId, proceso, fecha: new Date("2026-08-06T12:00:00Z"), usuarioId: adminId, nroFactura: opciones.nroFactura ?? null, ...(opciones.promoCuentaId !== undefined && { promoCuentaId: opciones.promoCuentaId }) },
    });
    const lineas = opciones.lineas ?? [{ cantidad: -2, precioTotal: 200, precioPorUnidadStock: 100, detalle: "Venta de Harina" }];
    for (const l of lineas) {
      await prisma.movimientoStock.create({
        data: {
          operacionId: op.id,
          productoId: harinaId,
          seccionId,
          proceso: l.proceso ?? proceso,
          cantidad: l.cantidad,
          cantidadExacta: l.cantidadExacta ?? null,
          detalle: l.detalle,
          precioTotal: l.precioTotal,
          precioPorUnidadStock: l.precioPorUnidadStock,
        },
      });
    }
    return op;
  }

  async function promoCuenta() {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: adminId } });
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menús" } });
    const promoCarta = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: seccionCarta.id, titulo: "Menú del día", precio: 1000 } });
    return prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId: promoCarta.id, precio: 1000, titulo: "Menú del día", creadoPorId: adminId } });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
  });

  it("éxito (venta suelta): datos, mensaje, contra-asiento línea por línea, marca de anulada y auditoría como antes", async () => {
    const venta = await operacion({
      nroFactura: "F-100",
      lineas: [
        { cantidad: -2, precioTotal: 200, precioPorUnidadStock: 100, detalle: "Venta de Harina" },
        { proceso: "CONSUMO", cantidad: -0.333, cantidadExacta: -0.33333333, precioTotal: 0, precioPorUnidadStock: 12.5, detalle: "Consumo de receta" },
      ],
    });

    const r = await anularVentaCasoDeUso(actor(), { operacionId: venta.id });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const reversion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "AJUSTE", sucursalId }, include: { movimientos: { orderBy: { cantidad: "desc" } } } });
    expect(r.datos).toEqual({ ventaId: venta.id, operacionesAnuladas: [venta.id], reversionIds: [reversion.id], movimientosRevertidos: 2, huboLiquidacionConsignacion: false });
    expect(r.mensaje).toBe("Venta anulada. Se revirtieron 2 movimiento(s) de stock.");
    expect(reversion.detalleLibre).toBe(detalleReversionDeVenta(venta.id, venta.fecha));
    expect(reversion.usuarioId).toBe(adminId);

    // Una línea inversa por línea vendida: todas AJUSTE, cantidad/cantidadExacta/precioTotal invertidos, el mismo precio por unidad.
    const [delPv, delConsumo] = reversion.movimientos;
    expect(delPv).toMatchObject({ productoId: harinaId, seccionId, proceso: "AJUSTE", detalle: 'Anulación de venta: revierte "Venta de Harina".', cantidadExacta: null });
    expect(Number(delPv.cantidad)).toBe(2);
    expect(Number(delPv.precioTotal)).toBe(-200);
    expect(Number(delPv.precioPorUnidadStock)).toBe(100);
    expect(delConsumo).toMatchObject({ proceso: "AJUSTE", detalle: 'Anulación de venta: revierte "Consumo de receta".' });
    expect(Number(delConsumo.cantidad)).toBe(0.333);
    expect(Number(delConsumo.cantidadExacta)).toBe(0.33333333);
    expect(Number(delConsumo.precioPorUnidadStock)).toBe(12.5);

    const original = await prisma.operacion.findUniqueOrThrow({ where: { id: venta.id } });
    expect(original.anuladaPorId).toBe(adminId);
    expect(original.anuladaEn?.toISOString()).toBe(reversion.fecha.toISOString());

    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "Operacion", entidadId: venta.id } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      descripcion: "Venta del 2026-08-06 (factura F-100): anulación",
      campo: "anuladaEn",
      valorAnterior: null,
      valorNuevo: original.anuladaEn!.toISOString(),
      actorId: adminId,
      sucursalId,
    });
  });

  it("la hora de la anulación es la que entra por actor.ahora, no la del reloj (Pureza 1.2)", async () => {
    const venta = await operacion({ lineas: [{ cantidad: -2, precioTotal: 200, precioPorUnidadStock: 100, detalle: "Venta de Harina" }] });
    const fija = enElPasado(3 * DIA_MS); // otra hora que la del reloj: tres días atrás

    const r = await anularVentaCasoDeUso({ ...actor(), ahora: fija }, { operacionId: venta.id });

    expect(r.ok).toBe(true);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: venta.id } })).anuladaEn).toEqual(fija);
  });

  it("éxito con Liquidación de consignación: se revierte con su mismo Proceso y el mensaje lo dice (texto exacto de antes)", async () => {
    const venta = await operacion({
      lineas: [
        { cantidad: -1, precioTotal: 80, precioPorUnidadStock: 80, detalle: "Venta de Copa" },
        { proceso: "LIQUIDACION_CONSIGNACION", cantidad: 0, precioTotal: 4.5, precioPorUnidadStock: 30, detalle: "Liquidación" },
      ],
    });

    const r = await anularVentaCasoDeUso(actor(), { operacionId: venta.id });

    expect(r).toMatchObject({ ok: true, mensaje: "Venta anulada. Se revirtieron 2 movimiento(s) de stock y la liquidación de consignación." });
    expect(r.ok && r.datos.huboLiquidacionConsignacion).toBe(true);
    const liquidaciones = await prisma.movimientoStock.findMany({ where: { proceso: "LIQUIDACION_CONSIGNACION" } });
    expect(liquidaciones).toHaveLength(2);
    expect(liquidaciones.reduce((acc, l) => acc + Number(l.precioTotal), 0)).toBeCloseTo(0);
    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidadId: venta.id } });
    expect(auditoria.descripcion).toBe("Venta del 2026-08-06: anulación");
  });

  it("éxito con hermanas de promo: anula la pedida y sus hermanas VIGENTES (no la ya anulada), cada una con su AJUSTE y su auditoría", async () => {
    const promo = await promoCuenta();
    const pedida = await operacion({ promoCuentaId: promo.id });
    const hermana = await operacion({ promoCuentaId: promo.id });
    const yaAnulada = await operacion({ promoCuentaId: promo.id });
    await prisma.operacion.update({ where: { id: yaAnulada.id }, data: { anuladaEn: new Date("2026-08-07T12:00:00Z"), anuladaPorId: adminId } });
    const suelta = await operacion();

    const r = await anularVentaCasoDeUso(actor(), { operacionId: pedida.id });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mensaje).toBe("Venta anulada. Se revirtieron 2 movimiento(s) de stock. Era una promo con 2 componentes: se anularon todos juntos.");
    expect(r.datos).toMatchObject({ ventaId: pedida.id, operacionesAnuladas: [pedida.id, hermana.id], movimientosRevertidos: 2, huboLiquidacionConsignacion: false });
    const ajustes = await prisma.operacion.findMany({ where: { proceso: "AJUSTE" } });
    expect(ajustes.map((a) => a.id).sort()).toEqual([...r.datos.reversionIds].sort());
    expect(ajustes.map((a) => a.detalleLibre).sort()).toEqual([detalleReversionDeVenta(pedida.id, pedida.fecha), detalleReversionDeVenta(hermana.id, hermana.fecha)].sort());

    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "Operacion" } });
    expect(auditoria.map((f) => f.entidadId).sort()).toEqual([pedida.id, hermana.id].sort());
    for (const fila of auditoria) expect(fila.descripcion).toBe("Venta del 2026-08-06: anulación (promo, junto con sus otros componentes)");

    // La ya anulada conserva su marca original y la venta suelta no se tocó.
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: yaAnulada.id } })).anuladaEn?.toISOString()).toBe("2026-08-07T12:00:00.000Z");
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: suelta.id } })).anuladaEn).toBeNull();
  });

  it("NO_ENCONTRADA: un id inexistente, o una venta de OTRA sucursal", async () => {
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
    const venta = await operacion();

    expect(await anularVentaCasoDeUso(actor(), { operacionId: "no-existe" })).toEqual({
      ok: false,
      codigo: "NO_ENCONTRADA",
      mensaje: "No se encontró esa operación en esta sucursal.",
    });
    expect(await anularVentaCasoDeUso({ usuarioId: adminId, sucursalId: otra.id, ahora: new Date(), ...baseDeTest }, { operacionId: venta.id })).toMatchObject({ ok: false, codigo: "NO_ENCONTRADA" });
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: venta.id } })).anuladaEn).toBeNull();
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  it("NO_ES_VENTA: el mensaje nombra la operación pedida y su proceso (texto exacto de antes), sin escribir nada", async () => {
    const merma = await operacion({ proceso: "MERMA" });

    const r = await anularVentaCasoDeUso(actor(), { operacionId: merma.id });

    expect(r).toEqual({ ok: false, codigo: "NO_ES_VENTA", mensaje: `La operación "${merma.id}" no es una Venta — es "MERMA".` });
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(0);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: merma.id } })).anuladaEn).toBeNull();
  });

  it("YA_ANULADA: la segunda anulación no escribe otra reversión ni otra fila de auditoría", async () => {
    const venta = await operacion();
    expect((await anularVentaCasoDeUso(actor(), { operacionId: venta.id })).ok).toBe(true);

    const r = await anularVentaCasoDeUso(actor(), { operacionId: venta.id });

    expect(r).toEqual({ ok: false, codigo: "YA_ANULADA", mensaje: "Esta venta ya está anulada." });
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(1);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: venta.id } })).toBe(1);
  });

  /**
   * S-03 (O.52 de docs/pureza-integracion.md, tanda T1 del plan de endurecimiento; D7 decidida por el dueño el 2026-10-08): anular una venta DESHACE a ciegas
   * lo que pasó después. Con un conteo físico/ajuste del mismo producto y sección posterior, el stock ya se reconcilió con lo contado y la reversión lo desarma
   * (el saldo queda mal); con un pago al consignante posterior, se mueve una deuda que el pago ya saldó. Se RECHAZA (no pide confirmación) y el mensaje manda a
   * corregir con un ajuste. «Después» se mide con `creadoEn` (el reloj de la base), no con `fecha`, que un conteo puede fijar para atrás.
   */
  describe("S-03: no se anula una venta con un conteo/ajuste o un pago al consignante POSTERIOR", () => {
    const pausa = () => new Promise((resolver) => setTimeout(resolver, 15)); // el orden se mide en milisegundos de la base
    const comoA = () => ({ ...actor(), sucursalNombre: "Central" });

    beforeEach(async () => {
      await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: harinaId, disponible: true } });
    });

    async function nadaEscrito(operacionId: string) {
      expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(0);
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: operacionId } })).anuladaEn).toBeNull();
      expect(await prisma.registroAuditoria.count({ where: { entidadId: operacionId } })).toBe(0);
    }

    async function contar(productoId: string, conteoReal: number, extra: { fechaConteo?: Date } = {}) {
      const r = await registrarConteoFisicoCasoDeUso(comoA(), { productoId, seccionId, conteoReal, fechaConteo: extra.fechaConteo ?? new Date(), accion: "AJUSTAR" });
      expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
      return prisma.conteoFisico.findFirstOrThrow({ orderBy: { creadoEn: "desc" } });
    }

    /** Un producto en consignación del proveedor dado, con una venta que lo consumió (línea LIQUIDACION_CONSIGNACION). */
    async function ventaConConsignacion() {
      const harina = await prisma.producto.findUniqueOrThrow({ where: { id: harinaId } });
      const consignante = await prisma.proveedor.create({ data: { codigo: "PRV_CONS", nombre: "Bodega Don Pepe" } });
      const copa = await prisma.producto.create({
        data: { codigo: "MP_COPA", nombre: "Copa", tipo: "MP", unidadStockId: harina.unidadStockId, insumoId: harina.insumoId, esConsignacion: true, proveedorConsignacionId: consignante.id, precioConsignacion: 30 },
      });
      const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: adminId } });
      await prisma.movimientoStock.create({
        data: { operacionId: venta.id, productoId: copa.id, seccionId, proceso: "LIQUIDACION_CONSIGNACION", cantidad: 0, detalle: "Liquidación", precioTotal: 30, precioPorUnidadStock: 30 },
      });
      return { venta, consignante, copa };
    }

    it("ataque 1: venta de 5, conteo físico que AJUSTA al real, y anular → CONTEO_POSTERIOR sin escribir nada", async () => {
      const venta = await operacion({ lineas: [{ cantidad: -5, precioTotal: 500, precioPorUnidadStock: 100, detalle: "Venta de Harina" }] });
      await pausa();
      await contar(harinaId, 3);

      const r = await anularVentaCasoDeUso(actor(), { operacionId: venta.id });

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("CONTEO_POSTERIOR");
      expect(r.mensaje).toContain("Harina (Depósito)");
      expect(r.mensaje).toContain("ajuste");
      await nadaEscrito(venta.id);
    });

    it("ataque 1b: el conteo fechado PARA ATRÁS (antes de la venta) también cuenta: «después» es cuándo se escribió, no la fecha que se le puso", async () => {
      const venta = await operacion();
      await pausa();
      await contar(harinaId, 3, { fechaConteo: enElPasado(30 * DIA_MS) });

      const r = await anularVentaCasoDeUso(actor(), { operacionId: venta.id });

      expect(r).toMatchObject({ ok: false, codigo: "CONTEO_POSTERIOR" });
      await nadaEscrito(venta.id);
    });

    it("ataque 1c: un AJUSTE manual posterior del mismo producto y sección también frena la anulación", async () => {
      const venta = await operacion();
      await pausa();
      const ajuste = await prisma.operacion.create({ data: { sucursalId, proceso: "AJUSTE", fecha: new Date(), usuarioId: adminId } });
      await prisma.movimientoStock.create({ data: { operacionId: ajuste.id, productoId: harinaId, seccionId, proceso: "AJUSTE", cantidad: 4, detalle: "Ajuste manual", precioTotal: 0, precioPorUnidadStock: 0 } });

      const r = await anularVentaCasoDeUso(actor(), { operacionId: venta.id });

      expect(r).toMatchObject({ ok: false, codigo: "CONTEO_POSTERIOR" });
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: venta.id } })).anuladaEn).toBeNull();
      expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(1); // solo el ajuste manual
    });

    it("ataque 2: venta que consumió una MP en consignación, pago al consignante posterior, y anular → PAGO_CONSIGNANTE_POSTERIOR sin escribir nada", async () => {
      const { venta, consignante } = await ventaConConsignacion();
      await pausa();
      const pago = await registrarPagoConsignanteCasoDeUso(comoA(), { proveedorId: consignante.id, importe: 30, fecha: new Date() });
      expect(pago.ok).toBe(true);

      const r = await anularVentaCasoDeUso(actor(), { operacionId: venta.id });

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("PAGO_CONSIGNANTE_POSTERIOR");
      expect(r.mensaje).toContain("Bodega Don Pepe");
      await nadaEscrito(venta.id);
    });

    it("ataque 2b: el pago fechado PARA ATRÁS también cuenta", async () => {
      const { venta, consignante } = await ventaConConsignacion();
      await pausa();
      await prisma.pagoConsignante.create({ data: { sucursalId, proveedorId: consignante.id, importe: 30, fecha: enElPasado(30 * DIA_MS), usuarioId: adminId } });

      const r = await anularVentaCasoDeUso(actor(), { operacionId: venta.id });

      expect(r).toMatchObject({ ok: false, codigo: "PAGO_CONSIGNANTE_POSTERIOR" });
      await nadaEscrito(venta.id);
    });

    it("promo: un conteo posterior sobre el producto de una HERMANA frena la anulación de toda la promo", async () => {
      const promo = await promoCuenta();
      const pedida = await operacion({ promoCuentaId: promo.id });
      const queso = await prisma.producto.create({ data: { codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: (await prisma.producto.findUniqueOrThrow({ where: { id: harinaId } })).unidadStockId, insumoId: (await prisma.producto.findUniqueOrThrow({ where: { id: harinaId } })).insumoId } });
      await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: queso.id, disponible: true } });
      const hermana = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: adminId, promoCuentaId: promo.id } });
      await prisma.movimientoStock.create({ data: { operacionId: hermana.id, productoId: queso.id, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta de Queso", precioTotal: 100, precioPorUnidadStock: 100 } });
      await pausa();
      await contar(queso.id, 0);

      const r = await anularVentaCasoDeUso(actor(), { operacionId: pedida.id });

      expect(r).toMatchObject({ ok: false, codigo: "CONTEO_POSTERIOR" });
      expect(r.ok === false && r.mensaje).toContain("Queso");
      await nadaEscrito(pedida.id);
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: hermana.id } })).anuladaEn).toBeNull();
    });

    it("control: sin nada posterior, la venta se anula como siempre", async () => {
      const venta = await operacion();
      const r = await anularVentaCasoDeUso(actor(), { operacionId: venta.id });
      expect(r.ok).toBe(true);
    });

    it("control: un conteo ANTERIOR a la venta no la frena", async () => {
      await contar(harinaId, 3);
      await pausa();
      const venta = await operacion();

      expect((await anularVentaCasoDeUso(actor(), { operacionId: venta.id })).ok).toBe(true);
    });

    it("control: un conteo posterior de OTRO producto, o de la misma producto en OTRA sección, no la frena", async () => {
      const venta = await operacion();
      const otroProducto = await prisma.producto.create({
        data: { codigo: "MP_SAL", nombre: "Sal", tipo: "MP", unidadStockId: (await prisma.producto.findUniqueOrThrow({ where: { id: harinaId } })).unidadStockId, insumoId: (await prisma.producto.findUniqueOrThrow({ where: { id: harinaId } })).insumoId },
      });
      await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: otroProducto.id, disponible: true } });
      const otraSeccion = await sembrarSeccion(sucursalId, "Cocina");
      await pausa();
      await contar(otroProducto.id, 3);
      expect((await registrarConteoFisicoCasoDeUso(comoA(), { productoId: harinaId, seccionId: otraSeccion.id, conteoReal: 2, fechaConteo: new Date(), accion: "AJUSTAR" })).ok).toBe(true);

      expect((await anularVentaCasoDeUso(actor(), { operacionId: venta.id })).ok).toBe(true);
    });

    it("control: un conteo posterior CANCELADO (el ajuste y su reversión se anulan entre sí) no la frena", async () => {
      const venta = await operacion();
      await pausa();
      const conteo = await contar(harinaId, 3);
      expect((await cancelarConteoFisicoCasoDeUso(comoA(), conteo.id)).ok).toBe(true);

      expect((await anularVentaCasoDeUso(actor(), { operacionId: venta.id })).ok).toBe(true);
    });

    it("control: anular DOS ventas del mismo producto, una atrás de la otra: la reversión de la primera no cuenta como ajuste posterior de la segunda", async () => {
      const a = await operacion();
      const b = await operacion();
      expect((await anularVentaCasoDeUso(actor(), { operacionId: a.id })).ok).toBe(true);

      expect((await anularVentaCasoDeUso(actor(), { operacionId: b.id })).ok).toBe(true);
    });

    it("control: un pago a OTRO proveedor, o un pago ANTERIOR a la venta, no la frena", async () => {
      const antes = await prisma.proveedor.create({ data: { codigo: "PRV_ANT", nombre: "Proveedor Anterior" } });
      const otro = await prisma.proveedor.create({ data: { codigo: "PRV_OTRO", nombre: "Proveedor Ajeno" } });
      await prisma.pagoConsignante.create({ data: { sucursalId, proveedorId: antes.id, importe: 10, fecha: new Date(), usuarioId: adminId } });
      await pausa();
      const { venta, consignante } = await ventaConConsignacion();
      await prisma.pagoConsignante.deleteMany({ where: { proveedorId: consignante.id } });
      await pausa();
      await prisma.pagoConsignante.create({ data: { sucursalId, proveedorId: otro.id, importe: 10, fecha: new Date(), usuarioId: adminId } });

      expect((await anularVentaCasoDeUso(actor(), { operacionId: venta.id })).ok).toBe(true);
    });

    it("control: el pago al MISMO consignante anterior a la venta no la frena", async () => {
      const harina = await prisma.producto.findUniqueOrThrow({ where: { id: harinaId } });
      const consignante = await prisma.proveedor.create({ data: { codigo: "PRV_CONS", nombre: "Bodega Don Pepe" } });
      await prisma.pagoConsignante.create({ data: { sucursalId, proveedorId: consignante.id, importe: 10, fecha: new Date(), usuarioId: adminId } });
      await pausa();
      const copa = await prisma.producto.create({
        data: { codigo: "MP_COPA", nombre: "Copa", tipo: "MP", unidadStockId: harina.unidadStockId, insumoId: harina.insumoId, esConsignacion: true, proveedorConsignacionId: consignante.id, precioConsignacion: 30 },
      });
      const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: adminId } });
      await prisma.movimientoStock.create({ data: { operacionId: venta.id, productoId: copa.id, seccionId, proceso: "LIQUIDACION_CONSIGNACION", cantidad: 0, detalle: "Liquidación", precioTotal: 30, precioPorUnidadStock: 30 } });

      expect((await anularVentaCasoDeUso(actor(), { operacionId: venta.id })).ok).toBe(true);
    });
  });

  it("aResultadoAccion sobre el resultado del caso de uso: la pantalla recibe solo { ok, mensaje }", async () => {
    const venta = await operacion();
    const r = aResultadoAccion(await anularVentaCasoDeUso(actor(), { operacionId: venta.id }));
    expect(Object.keys(r).sort()).toEqual(["mensaje", "ok"]);
  });
});
