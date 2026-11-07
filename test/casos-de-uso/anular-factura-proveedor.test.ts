import { randomUUID } from "node:crypto";
import { DIA_MS, enElFuturo, enElPasado } from "../setup/tiempo";
import type { ContextoDeAccion } from "../../src/server/actions/tipos";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { anularFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-factura-proveedor";
import { cargarCompraDeUnaParte } from "../setup/compra-de-prueba";
import { calcularPayloadHash, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/idempotencia";
import { aResultadoAccion } from "../../src/core/resultado-caso";
import { detalleReversionDeCompra } from "../../src/core/movimientos/anulaciones";
import { crearEnvioDirectoDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/crear-envio-directo-de-traspaso";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/** sha256 de `{ payload: { facturaId: "factura-fija", motivo: "motivo fijo" }, procesoTag: "ANULAR_FACTURA_PROVEEDOR", sucursalId: "sucursal-fija" }` (canónico, claves ordenadas): la huella de la anulación no cambia sin que se note. */
const HASH_DE_PAYLOAD_FIJO = "725173fd3ab398eb895be926855796604ddd284ec47cbfd9be8bd8fd9e5422d7";

/**
 * Caso de uso `anularFacturaProveedorCasoDeUso` aplicado a la compra de UNA sucursal (U1 de «una sola compra»: toda compra es una factura, y su anulación es la de la factura entera, con motivo). Postgres real, sin mocks de base ni de
 * sesión: recibe el actor ya resuelto (el permiso de la sucursal activa lo pide `conPermiso` en la Server Action; el de las demás sucursales de la factura, el propio caso de uso — ver `test/movimientos/factura-proveedor-repartida.test.ts`).
 * Reemplaza a `anular-compra.test.ts` (el caso de uso `anularCompra` se retiró): conserva TODAS las reglas de stock que probaba (lote, saldo total, conteos posteriores, guía del saldo negativo).
 */
describe("anularFacturaProveedorCasoDeUso (la compra de una sucursal)", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaId: string;
  let proveedorId: string;

  /** La base del actor con el alcance que le da la producción: su sucursal activa, para lectura y escritura (ADR-028). Sin él, las políticas por sucursal no le dejan ver ni escribir nada. */
  const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
  // El caso de uso pide un contexto completo; el test arma solo lo que usa (para una sola sucursal no hace falta más).
  const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, sucursalNombre: "Central", ahora: new Date(), ...baseDe(sucursalId) }) as unknown as ContextoDeAccion;
  type Compra = { operacionId: string; facturaId: string };

  /** Una compra de `cantidad` kg a $100/kg, cargada por el camino real (factura de una parte): el saldo del lote sale del propio Kardex. */
  const compra = (opciones: { fecha?: Date; cantidad?: number; nroFactura?: string; loteVencimiento?: Date } = {}): Promise<Compra> =>
    cargarCompraDeUnaParte(actor(), { seccionId, proveedorId, productoId: harinaId, cantidad: opciones.cantidad ?? 10, precioTotal: (opciones.cantidad ?? 10) * 100, nroFactura: opciones.nroFactura ?? "A-00001-00000001", fecha: opciones.fecha ?? new Date("2026-08-10T12:00:00Z"), loteVencimiento: opciones.loteVencimiento });
  /** Anula la factura de la compra con motivo; sin clave, una nueva (la clave es obligatoria). */
  const anular = (c: Pick<Compra, "facturaId">, claveIdempotencia: string = randomUUID(), motivo = "Prueba") => anularFacturaProveedorCasoDeUso(actor(), { facturaId: c.facturaId, motivo, claveIdempotencia });
  const reversiones = () => prisma.operacion.count({ where: { proceso: "AJUSTE" } });

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
    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  });

  it("éxito: datos con la factura, mensaje, contra-asiento de la compra, marca de la compra y la factura, y auditoría con el motivo", async () => {
    const c = await compra();
    const operacion = await prisma.operacion.findUniqueOrThrow({ where: { id: c.operacionId } });

    const r = await anular(c, randomUUID(), "Se tipeó mal el precio");

    expect(r).toEqual({
      ok: true,
      mensaje: "Factura anulada (A-00001-00000001): se revirtieron 1 movimiento(s) en 1 sucursal(es) y las partes que faltaba aceptar ya no se pueden aceptar. El número queda libre para volver a cargarla.",
      datos: { repetida: false, facturaId: c.facturaId },
    });
    const reversion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "AJUSTE", sucursalId }, include: { movimientos: true } });
    expect(reversion.detalleLibre).toBe(detalleReversionDeCompra(c.operacionId, operacion.fecha, "A-00001-00000001"));
    expect(Number(reversion.movimientos[0]!.cantidad)).toBe(-10);
    expect(Number(reversion.movimientos[0]!.precioTotal)).toBe(-1000);

    const original = await prisma.operacion.findUniqueOrThrow({ where: { id: c.operacionId } });
    expect(original.anuladaPorId).toBe(adminId);
    const factura = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: c.facturaId }, include: { anulaciones: true } });
    expect([Boolean(factura.anuladaEn), factura.anuladaPorId, factura.anulaciones.map((a) => a.motivo)]).toEqual([true, adminId, ["Se tipeó mal el precio"]]);

    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "FacturaProveedor", entidadId: c.facturaId, campo: "anuladaEn" } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ descripcion: "Factura de proveedor A-00001-00000001 anulada. Motivo: Se tipeó mal el precio", valorAnterior: null, actorId: adminId, sucursalId });
  });

  it("P1 paso 7: el día de los textos guardados es el argentino — una compra de las 22:30 argentinas del 10/8 (01:30Z del 11/8) es «del 2026-08-10» en el contra-asiento", async () => {
    const c = await compra({ fecha: new Date("2026-08-11T01:30:00Z") });

    expect((await anular(c)).ok).toBe(true);

    const reversion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "AJUSTE", sucursalId } });
    expect(reversion.detalleLibre).toBe(`Anulación de la compra ${c.operacionId} (2026-08-10, factura A-00001-00000001).`);
  });

  it("la hora de la anulación es la que entra por actor.ahora, no la del reloj (Pureza 1.2)", async () => {
    const c = await compra();
    const fija = enElPasado(3 * DIA_MS); // otra hora que la del reloj: tres días atrás

    const r = await anularFacturaProveedorCasoDeUso({ ...actor(), ahora: fija }, { facturaId: c.facturaId, motivo: "Prueba", claveIdempotencia: randomUUID() });

    expect(r.ok).toBe(true);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: c.operacionId } })).anuladaEn).toEqual(fija);
    expect((await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: c.facturaId } })).anuladaEn).toEqual(fija);
    expect((await prisma.operacion.findFirstOrThrow({ where: { proceso: "AJUSTE", sucursalId } })).fecha).toEqual(fija);
  });

  it("con clave: el hash I3 guardado en el registro de anulación es el de la huella del comando (tag ANULAR_FACTURA_PROVEEDOR, payload { facturaId, motivo })", async () => {
    const c = await compra();
    const clave = randomUUID();

    const r = await anular(c, clave, "Motivo de la prueba");

    expect(r.ok).toBe(true);
    const registro = await prisma.anulacionDeFacturaProveedor.findUniqueOrThrow({ where: { claveIdempotencia: clave } });
    expect(registro.payloadHash).toBe(calcularPayloadHash("ANULAR_FACTURA_PROVEEDOR", sucursalId, { facturaId: c.facturaId, motivo: "Motivo de la prueba" }));
    expect(registro.resultadoMensaje).toBe(r.mensaje);
  });

  it("el hash I3 de un payload fijo no cambia sin que se note", () => {
    expect(calcularPayloadHash("ANULAR_FACTURA_PROVEEDOR", "sucursal-fija", { facturaId: "factura-fija", motivo: "motivo fijo" })).toBe(HASH_DE_PAYLOAD_FIJO);
  });

  it("repetida: reenviar la misma clave devuelve el mensaje ORIGINAL con repetida: true, sin anular dos veces", async () => {
    const c = await compra();
    const clave = randomUUID();
    const primera = await anular(c, clave);

    const reenvio = await anular(c, clave);

    expect(reenvio).toEqual({ ok: true, mensaje: primera.mensaje, datos: { repetida: true, facturaId: c.facturaId } });
    expect(await reversiones()).toBe(1);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: c.facturaId, campo: "anuladaEn" } })).toBe(1);
  });

  it("CONFLICTO_IDEMPOTENCIA: la misma clave para anular OTRA factura", async () => {
    const a = await compra({ nroFactura: "A-00001-00000001" });
    const b = await compra({ nroFactura: "B-00001-00000001" });
    const clave = randomUUID();
    expect((await anular(a, clave)).ok).toBe(true);

    const r = await anular(b, clave);

    expect(r).toEqual({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA", mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: b.operacionId } })).anuladaEn).toBeNull();
  });

  it("NO_ENCONTRADA: una factura inexistente", async () => {
    expect(await anular({ facturaId: "no-existe" })).toEqual({ ok: false, codigo: "NO_ENCONTRADA", mensaje: "No se encontró esa factura de proveedor." });
  });

  it("YA_ANULADA: la segunda anulación (con otra clave) no escribe otra reversión", async () => {
    const c = await compra();
    expect((await anular(c)).ok).toBe(true);

    const r = await anular(c);

    expect(r).toEqual({ ok: false, codigo: "YA_ANULADA", mensaje: "La factura ya está anulada." });
    expect(await reversiones()).toBe(1);
  });

  it("STOCK_CONSUMIDO: no escribe nada (ni reversión, ni marca, ni auditoría)", async () => {
    const c = await compra();
    await consumir(6);
    const auditoriaAntes = await prisma.registroAuditoria.count({ where: { campo: "anuladaEn" } });

    const r = await anular(c);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe("STOCK_CONSUMIDO");
    expect(r.mensaje).toContain("Harina (Depósito): se compraron 10 y hoy quedan 4");
    expect(await reversiones()).toBe(0);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: c.operacionId } })).anuladaEn).toBeNull();
    expect((await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: c.facturaId } })).anuladaEn).toBeNull();
    expect(await prisma.registroAuditoria.count({ where: { campo: "anuladaEn" } })).toBe(auditoriaAntes);
  });

  it("el motivo es obligatorio en el comando, pero lo valida el guard de la acción (el caso de uso recibe un comando ya validado)", async () => {
    const c = await compra();
    // El caso de uso no vuelve a validar el formato: lo que se prueba acá es que el motivo llega a la anulación y a la auditoría tal cual.
    const r = await anular(c, randomUUID(), "x");
    expect(r.ok).toBe(true);
    expect((await prisma.anulacionDeFacturaProveedor.findFirstOrThrow({ where: { facturaProveedorId: c.facturaId } })).motivo).toBe("x");
  });

  /**
   * S-02 (O.51 de docs/pureza-integracion.md, tanda T1 del plan de endurecimiento): el saldo TOTAL (producto, sección) también tiene que cubrir lo comprado.
   * Antes `evaluarAnulacion` miraba solo el bucket del lote: con la compra de 10 kg del lote L, un traspaso o una merma SIN lote que se llevó los 10 dejaba el
   * lote L en 10 y el total en 0, y anular escribía −10 en el lote y dejaba el total del producto en −10 (stock negativo en el Kardex).
   */
  describe("S-02: el saldo total por (producto, sección) tiene que cubrir lo comprado", () => {
    const LOTE = enElFuturo(120 * DIA_MS);
    const compraConLote = (cantidad = 10) => compra({ cantidad, nroFactura: "C-00001-00000001", loteVencimiento: LOTE });

    async function nadaEscrito(c: Compra) {
      expect(await reversiones()).toBe(0);
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: c.operacionId } })).anuladaEn).toBeNull();
      expect(await prisma.registroAuditoria.count({ where: { entidadId: c.facturaId, campo: "anuladaEn" } })).toBe(0);
    }

    it("ataque (traspaso): el stock salió por un envío directo SIN lote → STOCK_CONSUMIDO, saldo total intacto, ninguna Operación nueva", async () => {
      const c = await compraConLote(10);
      const otra = await prisma.sucursal.create({ data: { nombre: "Sucursal B" } });
      await prisma.disponibilidadProducto.create({ data: { sucursalId: otra.id, productoId: harinaId, disponible: true } });
      const envio = await crearEnvioDirectoDeTraspasoCasoDeUso(
        { ...actor(), sucursalNombre: "Central" },
        { destinoSucursalId: otra.id, productoId: harinaId, cantidad: 10, seccionOrigenId: seccionId, detalle: null },
      );
      expect(envio.ok).toBe(true);
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);

      const r = await anular(c);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("STOCK_CONSUMIDO");
      expect(r.mensaje).toContain("Harina (Depósito)");
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);
      await nadaEscrito(c);
    });

    it("ataque (merma sin lote): una salida de 10 sin lote → STOCK_CONSUMIDO y el total no queda negativo", async () => {
      const c = await compraConLote(10);
      await consumir(10);

      const r = await anular(c);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("STOCK_CONSUMIDO");
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);
      await nadaEscrito(c);
    });

    it("salida parcial sin lote (4 de 10): el total (6) ya no cubre lo comprado → STOCK_CONSUMIDO, y el mensaje dice cuánto queda", async () => {
      const c = await compraConLote(10);
      await consumir(4);

      const r = await anular(c);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.mensaje).toContain("se compraron 10 y hoy quedan 6");
      await nadaEscrito(c);
    });

    it("control: con stock previo SIN lote que cubre la salida (total 20 ≥ 10) la anulación pasa y el total queda en 10, nunca negativo", async () => {
      await compra({ cantidad: 10, nroFactura: "X-00001-00000001" }); // 10 sin lote (la compra común)
      const c = await compraConLote(10);
      await consumir(10); // sale del "sin lote": el lote L queda en 10 y el total en 10
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(10);

      const r = await anular(c);

      expect(r.ok).toBe(true);
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);
    });

    it("control: la compra con lote sin ninguna salida se anula como siempre", async () => {
      const c = await compraConLote(10);
      expect((await anular(c)).ok).toBe(true);
      expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);
    });
  });

  /**
   * M-3 / D7 (decidida por el dueño el 2026-10-08; la misma regla que ya cumple `anularVenta`, S-03 y I-1): una compra NO se anula si después hubo un conteo físico (con o sin movimiento) o un ajuste
   * del mismo producto en la misma sección. El stock ya se reconcilió contra lo contado y la reversión restaría de nuevo lo que el conteo absorbió. Antes solo se miraba si el stock alcanzaba.
   */
  describe("M-3: un conteo o un ajuste POSTERIOR frena la anulación", () => {
    async function conteoPosterior(opciones: { estado: "PENDIENTE" | "RESUELTO" | "DESCARTADO" | "CANCELADO"; accion: "AJUSTAR" | "FALTA_MOVIMIENTO" | "DESCARTAR"; productoId?: string; creadoEn?: Date; diferencia?: number }) {
      return prisma.conteoFisico.create({
        data: {
          sucursalId, fecha: new Date(), productoId: opciones.productoId ?? harinaId, seccionId, saldoSistema: 10, conteoReal: 10 + (opciones.diferencia ?? 0), diferencia: opciones.diferencia ?? 0,
          accion: opciones.accion, estado: opciones.estado, usuarioId: adminId, ...(opciones.creadoEn ? { creadoEn: opciones.creadoEn } : {}),
        },
      });
    }

    async function ajusteManual(cantidad: number) {
      const op = await prisma.operacion.create({ data: { sucursalId, proceso: "AJUSTE", fecha: new Date(), usuarioId: adminId, detalleLibre: "Ajuste de inventario" } });
      await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: harinaId, seccionId, proceso: "AJUSTE", cantidad, detalle: "Ajuste manual", precioTotal: 0, precioPorUnidadStock: 0 } });
    }

    async function nadaEscrito(c: Compra, ajustesEsperados = 0) {
      expect(await reversiones()).toBe(ajustesEsperados);
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: c.operacionId } })).anuladaEn).toBeNull();
      expect(await prisma.registroAuditoria.count({ where: { entidadId: c.facturaId, campo: "anuladaEn" } })).toBe(0);
    }

    it.each([
      ["un conteo sin diferencia (el stock ya coincidía)", { estado: "RESUELTO", accion: "AJUSTAR" }],
      ["un conteo «Falta movimiento» (queda pendiente)", { estado: "PENDIENTE", accion: "FALTA_MOVIMIENTO" }],
      ["un conteo «Descartar»", { estado: "DESCARTADO", accion: "DESCARTAR" }],
    ] as const)("ataque: %s, posterior a la compra, la frena con CONTEO_POSTERIOR y no escribe nada", async (_nombre, conteo) => {
      const c = await compra();
      await conteoPosterior(conteo);

      const r = await anular(c);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("CONTEO_POSTERIOR");
      expect(r.mensaje).toBe(
        "En «Central»: No se puede anular esta compra: después de hacerse hubo un conteo físico de Harina (Depósito), y anularla ahora desharía a ciegas un stock que ya se reconcilió. Para corregirlo, cargá un Ajuste de stock (Movimientos → Registrar movimiento → Ajuste) por la diferencia: suma si en el sistema falta mercadería y resta si sobra. Si no ves esa opción, pedile a un administrador que lo cargue.",
      );
      await nadaEscrito(c);
    });

    it("ataque: un conteo que SÍ ajustó el stock (escribió su movimiento de CONTROL) después de la compra también la frena", async () => {
      const c = await compra({ cantidad: 10 });
      // Un sobrante (+3): con un faltante el stock «no alcanzaría» y el rechazo sería STOCK_CONSUMIDO (se evalúa antes).
      const conteo = await conteoPosterior({ estado: "RESUELTO", accion: "AJUSTAR", diferencia: 3 });
      const control = await prisma.operacion.create({ data: { sucursalId, proceso: "CONTROL", fecha: new Date(), usuarioId: adminId } });
      await prisma.movimientoStock.create({
        data: { operacionId: control.id, productoId: harinaId, seccionId, proceso: "CONTROL", cantidad: 3, detalle: "Ajuste de conteo", precioTotal: 0, precioPorUnidadStock: 0, conteoFisicoId: conteo.id },
      });

      const r = await anular(c);

      expect(r).toMatchObject({ ok: false, codigo: "CONTEO_POSTERIOR" });
      await nadaEscrito(c);
    });

    it("control: un ajuste MANUAL de stock posterior (un delta, el remedio que dice el rechazo) NO frena la anulación", async () => {
      const c = await compra();
      await ajusteManual(2);

      expect((await anular(c)).ok).toBe(true);
    });

    /**
     * M-7 (decidido por el dueño): el POS vende en negativo por diseño. Si hay saldo negativo SIN lote y después entra una compra CON lote, la compra no se puede anular (el total no cubre lo comprado, S-02).
     * El rechazo dice cómo resolverlo; acá se recorre la guía de punta a punta: el ajuste que lleva el sin lote a cero la destraba, un conteo no (lo frenaría M-3).
     */
    describe("M-7: la guía del rechazo por saldo negativo sin lote funciona", () => {
      const LOTE = enElFuturo(120 * DIA_MS);

      async function ventaEnNegativaYDespuesCompraConLote() {
        await consumir(3); // el POS vendió 3 sin stock: sin lote en -3
        return compra({ cantidad: 10, nroFactura: "E-00001-00000001", loteVencimiento: LOTE });
      }

      it("el rechazo es STOCK_CONSUMIDO y trae la guía; un Ajuste de +3 sin lote (el que dice el mensaje) destraba la anulación y deja el stock en 0", async () => {
        const c = await ventaEnNegativaYDespuesCompraConLote();

        const rechazo = await anular(c);

        expect(rechazo.ok).toBe(false);
        if (rechazo.ok) return;
        expect(rechazo.codigo).toBe("STOCK_CONSUMIDO");
        expect(rechazo.mensaje).toContain("Ajuste de stock de +3 de Harina en Depósito, sin lote");
        expect(rechazo.mensaje).toContain("no uses un conteo físico");

        await ajusteManual(3); // lo que dice el mensaje
        const r = await anular(c);

        expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
        expect(await calcularSaldoTotal(harinaId, seccionId, prisma)).toBe(0);
      });

      it("lo que el mensaje desaconseja es cierto: un CONTEO físico posterior no destraba la anulación, la frena con CONTEO_POSTERIOR", async () => {
        const c = await ventaEnNegativaYDespuesCompraConLote();
        await ajusteManual(3);
        await conteoPosterior({ estado: "RESUELTO", accion: "AJUSTAR" });

        expect(await anular(c)).toMatchObject({ ok: false, codigo: "CONTEO_POSTERIOR" });
      });
    });

    it("control: un conteo ANTERIOR a la compra no la frena", async () => {
      await conteoPosterior({ estado: "RESUELTO", accion: "AJUSTAR", creadoEn: new Date(Date.now() - 2 * DIA_MS) });
      const c = await compra();
      expect((await anular(c)).ok).toBe(true);
    });

    it("control: un conteo CANCELADO posterior no la frena (no reconcilió nada)", async () => {
      const c = await compra();
      await conteoPosterior({ estado: "CANCELADO", accion: "AJUSTAR" });
      expect((await anular(c)).ok).toBe(true);
    });

    it("control: un conteo posterior de OTRO producto no la frena", async () => {
      const c = await compra();
      const otro = await prisma.producto.create({ data: { codigo: "MP_AZUCAR", nombre: "Azúcar", tipo: "MP", unidadStockId: (await prisma.unidad.findFirstOrThrow()).id } });
      await conteoPosterior({ estado: "RESUELTO", accion: "AJUSTAR", productoId: otro.id });
      expect((await anular(c)).ok).toBe(true);
    });

    it("control: la reversión de OTRA compra anulada (un AJUSTE interno) no cuenta como ajuste posterior", async () => {
      const a = await compra({ nroFactura: "A-00001-00000001" });
      const b = await compra({ nroFactura: "B-00001-00000001" });
      expect((await anular(b)).ok).toBe(true);
      expect((await anular(a)).ok).toBe(true);
    });
  });

  it("aResultadoAccion sobre el resultado del caso de uso: la pantalla recibe solo { ok, mensaje }", async () => {
    const c = await compra();
    const r = aResultadoAccion(await anular(c));
    expect(Object.keys(r).sort()).toEqual(["mensaje", "ok"]);
  });
});
