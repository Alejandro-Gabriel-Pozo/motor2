import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { corregirImportesDeCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/corregir-importes-de-compra";
import { anularCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-compra";
import { obtenerCostoActualPorMP } from "../../src/server/lecturas/reportes/comun";
import type { ComandoCorregirImportesDeCompra } from "../../src/core/features/compras/compra.schema";

/**
 * Caso de uso `corregirImportesDeCompraCasoDeUso` (etapa C0 de la corrección por ejemplar, docs/diseno-correccion-de-compras-2026-11-06.md). Postgres real, sin mocks. Lo que importa de negocio:
 *  - la original queda CONGELADA (sus líneas no cambian; solo se marca anulada con su motivo) y un ejemplar nuevo la reemplaza con los importes corregidos;
 *  - el stock NO se mueve y corregir un importe NUNCA depende de que lo comprado siga en stock (el callejón de la maqueta del 2026-11-06);
 *  - repetir el envío no duplica (idempotencia) y dos correcciones a la vez dejan UNA sola ganadora (concurrencia);
 *  - el motivo sale del catálogo configurable (activo y de ámbito CORRECCION o TODOS).
 */
describe("corregirImportesDeCompraCasoDeUso", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let cervezaId: string;
  let aguaId: string;
  let proveedorId: string;
  let motivoId: string;

  const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
  const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, ahora: new Date("2026-11-06T15:00:00Z"), ...baseDe(sucursalId) });

  /** La factura de la maqueta: 24 cervezas a $144.000 y 48 aguas a $72.000. */
  async function factura(opciones: { cerveza?: number; proceso?: "COMPRA" | "MERMA"; anulada?: boolean } = {}) {
    const op = await prisma.operacion.create({
      data: { sucursalId, proceso: opciones.proceso ?? "COMPRA", fecha: new Date("2026-11-05T15:00:00Z"), usuarioId: adminId, proveedorId, nroFactura: "A-00003-00004567", detalleLibre: "semanal", anuladaEn: opciones.anulada ? new Date() : null },
    });
    const cerveza = await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId: cervezaId, seccionId, proceso: op.proceso, cantidad: 24, detalle: "24 unidad", precioTotal: opciones.cerveza ?? 144000, precioPorUnidadStock: (opciones.cerveza ?? 144000) / 24 },
    });
    const agua = await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId: aguaId, seccionId, proceso: op.proceso, cantidad: 48, detalle: "48 unidad", precioTotal: 72000, precioPorUnidadStock: 1500 },
    });
    return { op, cerveza, agua };
  }

  const comando = (operacionId: string, movimientoId: string, importeEnCentavos: number, extra: Partial<ComandoCorregirImportesDeCompra> = {}): ComandoCorregirImportesDeCompra => ({
    operacionId,
    importes: [{ movimientoId, importeEnCentavos }],
    motivoId,
    detalleMotivo: null,
    claveIdempotencia: randomUUID(),
    ...extra,
  });

  const saldoDe = async (productoId: string) => Number((await prisma.movimientoStock.aggregate({ where: { productoId }, _sum: { cantidad: true } }))._sum.cantidad ?? 0);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    cervezaId = (await prisma.producto.create({ data: { codigo: "MP_CERVEZA", nombre: "Cerveza Patagonia (reventa)", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    aguaId = (await prisma.producto.create({ data: { codigo: "MP_AGUA", nombre: "Agua 500 cc (reventa)", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "CORDECC" } })).id;
    motivoId = (await prisma.motivoMerma.create({ data: { nombre: "Error de tipeo", ambito: "TODOS" } })).id;
  });

  it("éxito: la original queda congelada y anulada con su motivo; el ejemplar nuevo la reemplaza con el importe corregido y el mismo número, fecha y proveedor", async () => {
    const f = await factura();
    const r = await corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, f.cerveza.id, 15_000_000, { detalleMotivo: "era 150 mil" }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mensaje).toBe("Factura A-00003-00004567 corregida: importe de Cerveza Patagonia (reventa) (de $144.000 a $150.000). La original queda en el historial.");
    expect(r.datos).toMatchObject({ compraAnteriorId: f.op.id, repetida: false });

    // Original: solo cambian las columnas de la anulación; sus líneas siguen idénticas.
    const original = await prisma.operacion.findUniqueOrThrow({ where: { id: f.op.id }, include: { movimientos: true } });
    expect(original.anuladaEn).not.toBeNull();
    expect(original.anuladaPorId).toBe(adminId);
    expect(original.motivoAnulacion).toBe("Error de tipeo: era 150 mil");
    expect(original.movimientos.map((m) => [m.id, Number(m.cantidad), Number(m.precioTotal)]).sort()).toEqual([[f.cerveza.id, 24, 144000], [f.agua.id, 48, 72000]].sort());

    // Ejemplar nuevo: COMPRA vigente, enlazada a la original, con el mismo número, fecha, proveedor y detalle.
    const nueva = await prisma.operacion.findUniqueOrThrow({ where: { id: r.datos.compraNuevaId! }, include: { movimientos: { orderBy: { id: "asc" } } } });
    expect(nueva).toMatchObject({ proceso: "COMPRA", anuladaEn: null, reemplazaAOperacionId: f.op.id, motivoId, proveedorId, nroFactura: "A-00003-00004567", detalleLibre: "semanal" });
    expect(nueva.fecha.toISOString()).toBe(original.fecha.toISOString());
    const porProducto = new Map(nueva.movimientos.map((m) => [m.productoId, m]));
    expect(Number(porProducto.get(cervezaId)!.precioTotal)).toBe(150000);
    expect(Number(porProducto.get(cervezaId)!.precioPorUnidadStock)).toBe(6250);
    expect(Number(porProducto.get(cervezaId)!.cantidad)).toBe(24);
    expect(Number(porProducto.get(aguaId)!.precioTotal)).toBe(72000);

    // El contra-asiento existe y el stock NO se movió (24 + 48 compradas, la reversión las resta y el ejemplar las vuelve a sumar).
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE", detalleLibre: { contains: f.op.id } } })).toBe(1);
    expect(await saldoDe(cervezaId)).toBe(24);
    expect(await saldoDe(aguaId)).toBe(48);

    // Un solo comprobante vigente con ese número.
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA", nroFactura: "A-00003-00004567", anuladaEn: null } })).toBe(1);

    // El costo de reposición sigue al ejemplar corregido (conserva la fecha original y es la entrada más reciente).
    const costos = await obtenerCostoActualPorMP(sucursalId, prisma);
    expect(costos.get(cervezaId)?.precioPorUnidadStock).toBe(6250);
    expect(costos.get(aguaId)?.precioPorUnidadStock).toBe(1500);

    // Auditoría: una fila por renglón corregido, de quien lo hizo.
    const filas = await prisma.registroAuditoria.findMany({ where: { entidad: "Operacion", entidadId: nueva.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ campo: "precioTotal", actorId: adminId, sucursalId });
    expect(filas[0].descripcion).toContain("Cerveza Patagonia (reventa)");
  });

  it("corregir un importe NO depende de que lo comprado siga en stock: con la mercadería ya vendida, igual se corrige y el stock no cambia", async () => {
    const f = await factura();
    const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "MERMA", fecha: new Date("2026-11-06T12:00:00Z"), usuarioId: adminId } });
    await prisma.movimientoStock.create({ data: { operacionId: venta.id, productoId: cervezaId, seccionId, proceso: "MERMA", cantidad: -22, detalle: "salió", precioTotal: 0, precioPorUnidadStock: 0 } });
    expect(await saldoDe(cervezaId)).toBe(2);

    // Anular esta compra hoy se RECHAZA (se compraron 24 y quedan 2)...
    const anular = await anularCompraCasoDeUso(actor(), { operacionId: f.op.id, claveIdempotencia: randomUUID() });
    expect(anular).toMatchObject({ ok: false, codigo: "STOCK_CONSUMIDO" });

    // ...pero corregir el importe funciona y el saldo sigue en 2.
    const r = await corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, f.cerveza.id, 15_000_000));
    expect(r.ok).toBe(true);
    expect(await saldoDe(cervezaId)).toBe(2);
  });

  it("completa un importe faltante ($0 = sin dato): el renglón pasa a fijar el costo de reposición", async () => {
    const f = await factura({ cerveza: 0 });
    expect((await obtenerCostoActualPorMP(sucursalId, prisma)).get(cervezaId)).toBeUndefined();
    const r = await corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, f.cerveza.id, 4_800_000));
    expect(r.ok).toBe(true);
    expect((await obtenerCostoActualPorMP(sucursalId, prisma)).get(cervezaId)?.precioPorUnidadStock).toBe(2000);
  });

  it("idempotencia: el mismo envío dos veces deja UN ejemplar y devuelve el mensaje original; la misma clave con otro contenido es conflicto", async () => {
    const f = await factura();
    const c = comando(f.op.id, f.cerveza.id, 15_000_000);
    const a = await corregirImportesDeCompraCasoDeUso(actor(), c);
    const b = await corregirImportesDeCompraCasoDeUso(actor(), c);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.mensaje).toBe(a.mensaje);
    expect(b.datos.repetida).toBe(true);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA", reemplazaAOperacionId: f.op.id } })).toBe(1);
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(1);

    const otro = await corregirImportesDeCompraCasoDeUso(actor(), { ...c, importes: [{ movimientoId: f.cerveza.id, importeEnCentavos: 16_000_000 }] });
    expect(otro).toMatchObject({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA" });
  });

  it("concurrencia: dos correcciones a la vez de la MISMA compra (claves distintas) dejan UNA sola ganadora; la otra se entera de que ya no es la vigente", async () => {
    const f = await factura();
    const [x, y] = await Promise.all([
      corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, f.cerveza.id, 15_000_000)),
      corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, f.cerveza.id, 16_000_000)),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    const perdedora = x.ok ? y : x;
    expect(perdedora).toMatchObject({ ok: false, codigo: "YA_REEMPLAZADA" });
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA", reemplazaAOperacionId: f.op.id } })).toBe(1);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA", nroFactura: "A-00003-00004567", anuladaEn: null } })).toBe(1);
    expect(await saldoDe(cervezaId)).toBe(24);
  });

  it("corregir de nuevo la versión vigente encadena otro ejemplar; corregir la original ya reemplazada se rechaza", async () => {
    const f = await factura();
    const primera = await corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, f.cerveza.id, 15_000_000));
    if (!primera.ok) throw new Error(primera.mensaje);
    expect(await corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, f.cerveza.id, 16_000_000))).toMatchObject({ ok: false, codigo: "YA_REEMPLAZADA" });

    const vigente = await prisma.operacion.findUniqueOrThrow({ where: { id: primera.datos.compraNuevaId! }, include: { movimientos: true } });
    const renglonVigente = vigente.movimientos.find((m) => m.productoId === cervezaId)!;
    const segunda = await corregirImportesDeCompraCasoDeUso(actor(), comando(vigente.id, renglonVigente.id, 16_000_000));
    expect(segunda.ok).toBe(true);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA", nroFactura: "A-00003-00004567", anuladaEn: null } })).toBe(1);
  });

  it("rechazos: no encontrada, de otra sucursal, no es compra, anulada, sin cambios, renglón ajeno, importe inválido", async () => {
    const f = await factura();
    expect(await corregirImportesDeCompraCasoDeUso(actor(), comando("no-existe", f.cerveza.id, 100))).toMatchObject({ ok: false, codigo: "NO_ENCONTRADA" });

    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra", empresaId: EMPRESA_POR_DEFECTO_ID } });
    const deOtra = { ...actor(), sucursalId: otraSucursal.id, ...baseDe(otraSucursal.id) };
    expect(await corregirImportesDeCompraCasoDeUso(deOtra, comando(f.op.id, f.cerveza.id, 100))).toMatchObject({ ok: false, codigo: "NO_ENCONTRADA" });

    const merma = await factura({ proceso: "MERMA" });
    expect(await corregirImportesDeCompraCasoDeUso(actor(), comando(merma.op.id, merma.cerveza.id, 100))).toMatchObject({ ok: false, codigo: "NO_ES_COMPRA" });

    const anulada = await factura({ anulada: true });
    expect(await corregirImportesDeCompraCasoDeUso(actor(), comando(anulada.op.id, anulada.cerveza.id, 100))).toMatchObject({ ok: false, codigo: "YA_ANULADA" });

    expect(await corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, f.cerveza.id, 14_400_000))).toMatchObject({ ok: false, codigo: "SIN_CAMBIOS" });
    expect(await corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, "de-otra-compra", 100))).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(await corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, f.cerveza.id, 0))).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });

    // Nada de lo rechazado escribió algo.
    expect(await prisma.operacion.count({ where: { reemplazaAOperacionId: { not: null } } })).toBe(0);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  it("el motivo sale del catálogo: uno inexistente, inactivo o de solo Merma se rechaza (y no se escribe nada)", async () => {
    const f = await factura();
    const inactivo = await prisma.motivoMerma.create({ data: { nombre: "Apagado", ambito: "CORRECCION", activo: false } });
    const soloMerma = await prisma.motivoMerma.create({ data: { nombre: "Vencido de prueba", ambito: "MERMA" } });
    for (const id of ["no-existe", inactivo.id, soloMerma.id]) {
      expect(await corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, f.cerveza.id, 15_000_000, { motivoId: id })), id).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
    }
    expect(await prisma.operacion.count({ where: { reemplazaAOperacionId: { not: null } } })).toBe(0);
    const deCorreccion = await prisma.motivoMerma.create({ data: { nombre: "Solo correcciones", ambito: "CORRECCION" } });
    expect((await corregirImportesDeCompraCasoDeUso(actor(), comando(f.op.id, f.cerveza.id, 15_000_000, { motivoId: deCorreccion.id }))).ok).toBe(true);
  });
});
