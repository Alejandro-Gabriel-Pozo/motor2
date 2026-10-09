import { randomUUID } from "node:crypto";
import { DIA_MS, enElFuturo, enElPasado } from "../setup/tiempo";
import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { anularCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-compra";
import { calcularPayloadHash, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/idempotencia";
import { aResultadoAccion } from "../../src/core/resultado-caso";
import { detalleReversionDeCompra } from "../../src/core/movimientos/anulaciones";
import { crearEnvioDirectoDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/crear-envio-directo-de-traspaso";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/** sha256 de `{ payload: { operacionId: "operacion-fija" }, procesoTag: "ANULAR_COMPRA", sucursalId: "sucursal-fija" }` (canónico, claves ordenadas). */
const HASH_ANTERIOR_DE_PAYLOAD_FIJO = "966df3691f4ce3b6a64f54e0745bbfaf3b68a970c610c8472087752636a9fe40";

/**
 * Caso de uso `anularCompraCasoDeUso` (src/server/actions/movimientos/casos-de-uso/anular-compra.ts; Task #41, Fase M). Postgres real,
 * sin mocks de base ni de sesión: el caso de uso recibe el actor ya resuelto (el permiso lo chequea `conPermiso` en la Server Action,
 * cubierto por test/movimientos/compras-anular.test.ts, que no se tocó).
 *
 * Un caso por cada código de resultado, verificando también `datos`. `ENTRADA_INVALIDA` no lo produce el caso de uso (recibe un comando
 * ya validado): lo cubre el guard, en test/core/features/compras/compra-guard.test.ts.
 */
describe("anularCompraCasoDeUso", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaId: string;
  let proveedorId: string;

  const actor = () => ({ usuarioId: adminId, sucursalId, ahora: new Date(), ...baseDeTest });

  /** Una compra con una línea de `cantidad` kg a $100/kg (el saldo del lote sale del propio Kardex). */
  async function compra(opciones: { cantidad?: number; nroFactura?: string | null; proceso?: "COMPRA" | "MERMA"; sinLineas?: boolean } = {}) {
    const proceso = opciones.proceso ?? "COMPRA";
    const op = await prisma.operacion.create({
      data: { sucursalId, proceso, fecha: new Date("2026-08-10T12:00:00Z"), usuarioId: adminId, proveedorId, nroFactura: opciones.nroFactura === undefined ? "A-0001" : opciones.nroFactura },
    });
    if (!opciones.sinLineas) {
      const cantidad = opciones.cantidad ?? 10;
      await prisma.movimientoStock.create({
        data: { operacionId: op.id, productoId: harinaId, seccionId, proceso, cantidad: proceso === "MERMA" ? -cantidad : cantidad, detalle: "Compra", precioTotal: cantidad * 100, precioPorUnidadStock: 100 },
      });
    }
    return op;
  }

  async function consumir(cantidad: number) {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "CONSUMO", fecha: new Date(), usuarioId: adminId } });
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId: harinaId, seccionId, proceso: "CONSUMO", cantidad: -cantidad, detalle: "Consumo", precioTotal: 0, precioPorUnidadStock: 0 },
    });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  });

  it("éxito: datos con la compra, el contra-asiento y cuántos movimientos revirtió; mensaje, auditoría y Kardex como antes", async () => {
    const op = await compra();

    const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const reversion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "AJUSTE", sucursalId }, include: { movimientos: true } });
    expect(r.datos).toEqual({ compraId: op.id, reversionId: reversion.id, movimientosRevertidos: 1, repetida: false });
    expect(r.mensaje).toBe("Compra anulada. Se revirtieron 1 movimiento(s) de stock y el N.º de factura A-0001 quedó libre para volver a cargarla.");
    expect(reversion.detalleLibre).toBe(detalleReversionDeCompra(op.id, op.fecha, "A-0001"));
    expect(reversion.claveIdempotencia).toBeNull();
    expect(reversion.payloadHash).toBeNull();
    expect(reversion.resultadoMensaje).toBeNull();
    expect(Number(reversion.movimientos[0].cantidad)).toBe(-10);

    const original = await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } });
    expect(original.anuladaPorId).toBe(adminId);
    expect(original.anuladaEn?.toISOString()).toBe(reversion.fecha.toISOString());

    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "Operacion", entidadId: op.id } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      descripcion: "Compra del 2026-08-10 a Molino SA, factura A-0001: anulación",
      campo: "anuladaEn",
      valorAnterior: null,
      valorNuevo: original.anuladaEn!.toISOString(),
      actorId: adminId,
      sucursalId,
    });
  });

  it("la hora de la anulación es la que entra por actor.ahora, no la del reloj (Pureza 1.2)", async () => {
    const op = await compra();
    const fija = enElPasado(3 * DIA_MS); // otra hora que la del reloj: tres días atrás

    const r = await anularCompraCasoDeUso({ ...actor(), ahora: fija }, { operacionId: op.id, claveIdempotencia: null });

    expect(r.ok).toBe(true);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).anuladaEn).toEqual(fija);
    expect((await prisma.operacion.findFirstOrThrow({ where: { proceso: "AJUSTE", sucursalId } })).fecha).toEqual(fija);
  });

  it("éxito sin N.º de factura ni proveedor: el mensaje y la auditoría no los mencionan (textos exactos de antes)", async () => {
    const op = await compra({ nroFactura: null });
    await prisma.operacion.update({ where: { id: op.id }, data: { proveedorId: null } });

    const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null });

    expect(r).toMatchObject({ ok: true, mensaje: "Compra anulada. Se revirtieron 1 movimiento(s) de stock." });
    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidadId: op.id } });
    expect(auditoria.descripcion).toBe("Compra del 2026-08-10: anulación");
  });

  it("con clave: el hash I3 guardado es el MISMO que calculaba la Server Action antes del refactor (tag ANULAR_COMPRA, payload { operacionId })", async () => {
    const op = await compra();
    const clave = randomUUID();

    const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: clave });

    expect(r.ok).toBe(true);
    const reversion = await prisma.operacion.findFirstOrThrow({ where: { claveIdempotencia: clave } });
    expect(reversion.payloadHash).toBe(calcularPayloadHash("ANULAR_COMPRA", sucursalId, { operacionId: op.id }));
    expect(reversion.resultadoMensaje).toBe(r.mensaje);
  });

  it("el hash I3 de un payload fijo no cambió (valor calculado con el código ANTERIOR al refactor, en 91f37d3)", () => {
    expect(calcularPayloadHash("ANULAR_COMPRA", "sucursal-fija", { operacionId: "operacion-fija" })).toBe(HASH_ANTERIOR_DE_PAYLOAD_FIJO);
  });

  it("repetida: reenviar la misma clave devuelve el mensaje ORIGINAL con repetida: true, sin ids nuevos y sin anular dos veces", async () => {
    const op = await compra();
    const clave = randomUUID();
    const primera = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: clave });

    const reenvio = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: clave });

    expect(reenvio).toEqual({ ok: true, mensaje: primera.mensaje, datos: { compraId: op.id, reversionId: null, movimientosRevertidos: null, repetida: true } });
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(1);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: op.id } })).toBe(1);
  });

  it("CONFLICTO_IDEMPOTENCIA: la misma clave para anular OTRA compra", async () => {
    const a = await compra({ nroFactura: "A-1" });
    const b = await compra({ nroFactura: "B-1" });
    const clave = randomUUID();
    expect((await anularCompraCasoDeUso(actor(), { operacionId: a.id, claveIdempotencia: clave })).ok).toBe(true);

    const r = await anularCompraCasoDeUso(actor(), { operacionId: b.id, claveIdempotencia: clave });

    expect(r).toEqual({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA", mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: b.id } })).anuladaEn).toBeNull();
  });

  it("NO_ENCONTRADA: un id inexistente, o una compra de OTRA sucursal", async () => {
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
    const op = await compra();

    expect(await anularCompraCasoDeUso(actor(), { operacionId: "no-existe", claveIdempotencia: null })).toEqual({
      ok: false,
      codigo: "NO_ENCONTRADA",
      mensaje: "No se encontró esa operación en esta sucursal.",
    });
    expect(await anularCompraCasoDeUso({ usuarioId: adminId, sucursalId: otra.id, ahora: new Date(), ...baseDeTest }, { operacionId: op.id, claveIdempotencia: null })).toMatchObject({
      ok: false,
      codigo: "NO_ENCONTRADA",
    });
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).anuladaEn).toBeNull();
  });

  it("NO_ES_COMPRA", async () => {
    const op = await compra({ proceso: "MERMA" });
    const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null });
    expect(r).toEqual({ ok: false, codigo: "NO_ES_COMPRA", mensaje: 'Esa operación no es una Compra — es "MERMA".' });
  });

  it("YA_ANULADA: la segunda anulación (sin clave) no escribe otra reversión", async () => {
    const op = await compra();
    expect((await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null })).ok).toBe(true);

    const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null });

    expect(r).toEqual({ ok: false, codigo: "YA_ANULADA", mensaje: "Esta compra ya está anulada." });
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(1);
  });

  it("SIN_LINEAS", async () => {
    const op = await compra({ sinLineas: true });
    const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null });
    expect(r).toEqual({ ok: false, codigo: "SIN_LINEAS", mensaje: "Esta compra no tiene líneas que anular." });
  });

  it("STOCK_CONSUMIDO: no escribe nada (ni reversión, ni marca, ni auditoría)", async () => {
    const op = await compra();
    await consumir(6);

    const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: randomUUID() });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe("STOCK_CONSUMIDO");
    expect(r.mensaje).toContain("Harina (Depósito): se compraron 10 y hoy quedan 4");
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(0);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).anuladaEn).toBeNull();
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  /**
   * S-02 (O.51 de docs/pureza-integracion.md, tanda T1 del plan de endurecimiento): el saldo TOTAL (producto, sección) también tiene que cubrir lo comprado.
   * Antes `evaluarAnulacion` miraba solo el bucket del lote: con la compra de 10 kg del lote L, un traspaso o una merma SIN lote que se llevó los 10 dejaba el
   * lote L en 10 y el total en 0, y anular escribía −10 en el lote y dejaba el total del producto en −10 (stock negativo en el Kardex).
   */
  describe("S-02: el saldo total por (producto, sección) tiene que cubrir lo comprado", () => {
    const LOTE = enElFuturo(120 * DIA_MS);

    async function compraConLote(cantidad = 10) {
      const op = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date("2026-08-10T12:00:00Z"), usuarioId: adminId, proveedorId, nroFactura: "L-0001" } });
      await prisma.movimientoStock.create({
        data: { operacionId: op.id, productoId: harinaId, seccionId, proceso: "COMPRA", cantidad, detalle: "Compra con lote", precioTotal: cantidad * 100, precioPorUnidadStock: 100, loteVencimiento: LOTE },
      });
      return op;
    }

    async function nadaEscrito(operacionId: string) {
      expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(0);
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: operacionId } })).anuladaEn).toBeNull();
      expect(await prisma.registroAuditoria.count({ where: { entidadId: operacionId } })).toBe(0);
    }

    it("ataque (traspaso): el stock salió por un envío directo SIN lote → STOCK_CONSUMIDO, saldo total intacto, ninguna Operación nueva", async () => {
      const op = await compraConLote(10);
      const otra = await prisma.sucursal.create({ data: { nombre: "Sucursal B" } });
      await prisma.disponibilidadProducto.createMany({ data: [sucursalId, otra.id].map((s) => ({ sucursalId: s, productoId: harinaId, disponible: true })) });
      const envio = await crearEnvioDirectoDeTraspasoCasoDeUso(
        { ...actor(), sucursalNombre: "Central" },
        { destinoSucursalId: otra.id, productoId: harinaId, cantidad: 10, seccionOrigenId: seccionId, detalle: null },
      );
      expect(envio.ok).toBe(true);
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);

      const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null });

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("STOCK_CONSUMIDO");
      expect(r.mensaje).toContain("Harina (Depósito)");
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);
      await nadaEscrito(op.id);
    });

    it("ataque (merma sin lote): una salida de 10 sin lote → STOCK_CONSUMIDO y el total no queda negativo", async () => {
      const op = await compraConLote(10);
      await consumir(10);

      const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null });

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("STOCK_CONSUMIDO");
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);
      await nadaEscrito(op.id);
    });

    it("salida parcial sin lote (4 de 10): el total (6) ya no cubre lo comprado → STOCK_CONSUMIDO, y el mensaje dice cuánto queda", async () => {
      const op = await compraConLote(10);
      await consumir(4);

      const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null });

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.mensaje).toContain("se compraron 10 y hoy quedan 6");
      await nadaEscrito(op.id);
    });

    it("control: con stock previo SIN lote que cubre la salida (total 20 ≥ 10) la anulación pasa y el total queda en 10, nunca negativo", async () => {
      await compra({ cantidad: 10, nroFactura: "PREVIA-1" }); // 10 sin lote (la compra común)
      const op = await compraConLote(10);
      await consumir(10); // sale del "sin lote": el lote L queda en 10 y el total en 10
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(10);

      const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null });

      expect(r.ok).toBe(true);
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);
    });

    it("control: la compra con lote sin ninguna salida se anula como siempre", async () => {
      const op = await compraConLote(10);
      const r = await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null });
      expect(r.ok).toBe(true);
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);
    });
  });

  it("aResultadoAccion sobre el resultado del caso de uso: la pantalla recibe solo { ok, mensaje }", async () => {
    const op = await compra();
    const r = aResultadoAccion(await anularCompraCasoDeUso(actor(), { operacionId: op.id, claveIdempotencia: null }));
    expect(Object.keys(r).sort()).toEqual(["mensaje", "ok"]);
  });
});

