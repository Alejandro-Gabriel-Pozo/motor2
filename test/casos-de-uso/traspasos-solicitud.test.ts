import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { aprobarYEnviarTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/aprobar-y-enviar-traspaso";
import { cancelarSolicitudDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/cancelar-solicitud-de-traspaso";
import { rechazarSolicitudDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/rechazar-solicitud-de-traspaso";
import { aResultadoAccion } from "../../src/core/resultado-caso";
import { calcularSaldoTotal } from "../../src/server/lecturas/movimientos/saldos";

/**
 * Casos de uso de la SOLICITUD de traspaso (src/server/actions/traspasos/casos-de-uso/; Task #41, Fase M11a): aprobar y enviar,
 * cancelar, rechazar. Postgres real, sin mocks de base ni de sesión: el caso de uso recibe el actor ya resuelto (el permiso lo chequea
 * `conPermiso` en la Server Action, cubierta de punta a punta por test/traspasos/traspasos.test.ts y
 * test/auditoria/traspasos-en-transito.test.ts, que no se tocaron).
 *
 * Un caso por cada código de resultado, verificando `datos`, los textos exactos de antes y lo que queda escrito. El formato del
 * comando (id vacío, sección que no es string) lo cubre test/core/features/traspasos/traspaso-comandos-guard.test.ts.
 */
describe("casos de uso de la solicitud de traspaso", () => {
  let sucursalAId: string; // Origen
  let sucursalBId: string; // Destino
  let seccionAId: string;
  let seccionBId: string;
  let adminAId: string;
  let adminBId: string;
  let kgId: string;
  let insumoId: string;

  const comoA = () => ({ usuarioId: adminAId, sucursalId: sucursalAId, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest });
  /** La hora de entrada, tres días atrás: si el caso de uso leyera el reloj, no coincidiría con lo que queda guardado (Pureza 1.2; auditoría de la Fase 1: faltaban 10 de los 13 tests de hora fija). */
  const fijaHaceTresDias = () => new Date(Date.now() - 3 * 24 * 3_600_000);
  const comoB = () => ({ usuarioId: adminBId, sucursalId: sucursalBId, sucursalNombre: "Sucursal B", ahora: new Date(), ...baseDeTest });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalAId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;
    adminAId = (await crearUsuarioConMembresia({ email: "admin-a@test.com", sucursalId: sucursalAId, rolId: base.admin.id })).id;
    adminBId = (await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: sucursalBId, rolId: base.admin.id })).id;
  });

  /** Producto con `stock` kg en la sección A (una COMPRA armada directo por Prisma), disponible en las sucursales dadas. */
  async function producto(stock: number, disponibleEn: string[] = [sucursalAId, sucursalBId]) {
    const mp = await prisma.producto.create({ data: { codigo: `MP_${Math.random().toString(36).slice(2, 8)}`, nombre: "Harina", tipo: "MP", unidadStockId: kgId, insumoId } });
    if (disponibleEn.length) {
      await prisma.disponibilidadProducto.createMany({ data: disponibleEn.map((sucursalId) => ({ sucursalId, productoId: mp.id, disponible: true })) });
    }
    if (stock) {
      const op = await prisma.operacion.create({ data: { sucursalId: sucursalAId, proceso: "COMPRA", fecha: new Date(), usuarioId: adminAId } });
      await prisma.movimientoStock.create({
        data: { operacionId: op.id, productoId: mp.id, seccionId: seccionAId, proceso: "COMPRA", cantidad: stock, detalle: "Compra", precioTotal: 0, precioPorUnidadStock: 0 },
      });
    }
    return mp;
  }

  /** Una solicitud PULL de B a A, SOLICITADA (lo que deja `crearSolicitudTransferencia`). */
  async function solicitud(productoId: string, cantidad: number) {
    return prisma.traspasoSucursal.create({
      data: { origenSucursalId: sucursalAId, destinoSucursalId: sucursalBId, productoId, cantidad, seccionDestinoId: seccionBId, iniciadoPor: "DESTINO", estado: "SOLICITADA", creadoPorId: adminBId },
    });
  }

  describe("aprobarYEnviarTraspasoCasoDeUso", () => {
    it("éxito: datos, mensaje, SALIDA en el Kardex de origen y traspaso ENVIADO (como antes)", async () => {
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);

      const r = await aprobarYEnviarTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, seccionOrigenId: seccionAId });

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.mensaje).toBe('Aprobado y enviado a "Sucursal B".');
      const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "TRANSFERENCIA_SALIDA_SUCURSAL" }, include: { movimientos: true } });
      expect(r.datos).toEqual({ traspasoId: sol.id, operacionId: operacion.id, seccionOrigenId: seccionAId, cantidad: 4 });
      expect(operacion).toMatchObject({ sucursalId: sucursalAId, usuarioId: adminAId, claveIdempotencia: null, payloadHash: null });
      expect(operacion.movimientos).toHaveLength(1);
      expect(operacion.movimientos[0]).toMatchObject({ productoId: mp.id, seccionId: seccionAId, detalle: 'Transferencia a sucursal "Sucursal B".', traspasoSucursalId: sol.id });
      expect(Number(operacion.movimientos[0].cantidad)).toBe(-4);
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(6);

      const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } });
      expect(traspaso).toMatchObject({ estado: "ENVIADA", seccionOrigenId: seccionAId, decididoPorOrigenId: adminAId });
      expect(traspaso.fechaDecisionOrigen?.toISOString()).toBe(operacion.fecha.toISOString());
    });

    it("SECCION_NO_PROPIA: una sección de otra sucursal, antes de abrir la transacción", async () => {
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      const r = await aprobarYEnviarTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, seccionOrigenId: seccionBId });
      expect(r).toEqual({ ok: false, codigo: "SECCION_NO_PROPIA", mensaje: "Elegí de qué sección propia sale." });
    });

    it("NO_ENCONTRADO", async () => {
      const r = await aprobarYEnviarTraspasoCasoDeUso(comoA(), { traspasoId: "no-existe", seccionOrigenId: seccionAId });
      expect(r).toEqual({ ok: false, codigo: "NO_ENCONTRADO", mensaje: "No se encontró ese traspaso." });
    });

    it("LADO: el destino no puede aprobar su propia solicitud", async () => {
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      const r = await aprobarYEnviarTraspasoCasoDeUso(comoB(), { traspasoId: sol.id, seccionOrigenId: seccionBId });
      expect(r).toEqual({ ok: false, codigo: "LADO", mensaje: "Este traspaso no está dirigido a esta sucursal como origen." });
    });

    it("ESTADO: una segunda aprobación no vuelve a descontar", async () => {
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      expect((await aprobarYEnviarTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, seccionOrigenId: seccionAId })).ok).toBe(true);
      const r = await aprobarYEnviarTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, seccionOrigenId: seccionAId });
      expect(r).toEqual({ ok: false, codigo: "ESTADO", mensaje: 'Este traspaso ya está en estado "ENVIADA" — no se puede aprobar de nuevo.' });
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(6);
    });

    it("PRODUCTO_NO_TRANSFERIBLE: dejó de estar disponible en destino desde la solicitud", async () => {
      const mp = await producto(10, [sucursalAId]);
      const sol = await solicitud(mp.id, 4);
      const r = await aprobarYEnviarTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, seccionOrigenId: seccionAId });
      expect(r).toEqual({ ok: false, codigo: "PRODUCTO_NO_TRANSFERIBLE", mensaje: "«Harina» no está disponible en «Sucursal B»: activalo allá antes de enviar." });
      expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } })).estado).toBe("SOLICITADA");
    });

    it("STOCK_INSUFICIENTE: el texto exacto de antes, sin escribir nada", async () => {
      const mp = await producto(3);
      const sol = await solicitud(mp.id, 4);
      const r = await aprobarYEnviarTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, seccionOrigenId: seccionAId });
      expect(r).toEqual({ ok: false, codigo: "STOCK_INSUFICIENTE", mensaje: 'Stock insuficiente de "Harina" en "Depósito A". Actual: 3, requerido: 4.' });
      expect(await prisma.operacion.count({ where: { proceso: "TRANSFERENCIA_SALIDA_SUCURSAL" } })).toBe(0);
    });

    it("aResultadoAccion deja solo { ok, mensaje } para la pantalla", async () => {
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      expect(aResultadoAccion(await aprobarYEnviarTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, seccionOrigenId: seccionAId }))).toEqual({
        ok: true,
        mensaje: 'Aprobado y enviado a "Sucursal B".',
      });
    });
  });

  describe("cancelarSolicitudDeTraspasoCasoDeUso", () => {
    it("éxito: CANCELADA con fecha y autor de cierre, sin tocar stock", async () => {
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      const r = await cancelarSolicitudDeTraspasoCasoDeUso(comoB(), { traspasoId: sol.id });
      expect(r).toEqual({ ok: true, mensaje: "Solicitud cancelada.", datos: { traspasoId: sol.id, estadoNuevo: "CANCELADA" } });
      const t = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } });
      expect(t).toMatchObject({ estado: "CANCELADA", cerradoPorId: adminBId });
      expect(t.fechaCierre).not.toBeNull();
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(10);
    });

    it("NO_ENCONTRADO / LADO / ESTADO con los textos de antes", async () => {
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      expect(await cancelarSolicitudDeTraspasoCasoDeUso(comoB(), { traspasoId: "no-existe" })).toEqual({ ok: false, codigo: "NO_ENCONTRADO", mensaje: "No se encontró ese traspaso." });
      expect(await cancelarSolicitudDeTraspasoCasoDeUso(comoA(), { traspasoId: sol.id })).toEqual({ ok: false, codigo: "LADO", mensaje: "Esta solicitud no la creó esta sucursal." });
      await cancelarSolicitudDeTraspasoCasoDeUso(comoB(), { traspasoId: sol.id });
      expect(await cancelarSolicitudDeTraspasoCasoDeUso(comoB(), { traspasoId: sol.id })).toEqual({
        ok: false,
        codigo: "ESTADO",
        mensaje: 'Este traspaso ya está en estado "CANCELADA" — no se puede cancelar desde acá.',
      });
    });
  });

  describe("rechazarSolicitudDeTraspasoCasoDeUso", () => {
    it("éxito: RECHAZADA_ORIGEN con decisión de Origen y el motivo ya normalizado", async () => {
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      const r = await rechazarSolicitudDeTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, motivo: "No tenemos" });
      expect(r).toEqual({ ok: true, mensaje: "Solicitud rechazada.", datos: { traspasoId: sol.id, estadoNuevo: "RECHAZADA_ORIGEN" } });
      const t = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } });
      expect(t).toMatchObject({ estado: "RECHAZADA_ORIGEN", decididoPorOrigenId: adminAId, motivoRechazoOrigen: "No tenemos" });
      expect(t.fechaDecisionOrigen).not.toBeNull();
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(10);
    });

    it("sin motivo: queda en null", async () => {
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      expect((await rechazarSolicitudDeTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, motivo: null })).ok).toBe(true);
      expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } })).motivoRechazoOrigen).toBeNull();
    });

    it("NO_ENCONTRADO / LADO / ESTADO con los textos de antes", async () => {
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      expect(await rechazarSolicitudDeTraspasoCasoDeUso(comoA(), { traspasoId: "no-existe", motivo: null })).toEqual({ ok: false, codigo: "NO_ENCONTRADO", mensaje: "No se encontró ese traspaso." });
      expect(await rechazarSolicitudDeTraspasoCasoDeUso(comoB(), { traspasoId: sol.id, motivo: null })).toEqual({
        ok: false,
        codigo: "LADO",
        mensaje: "Este traspaso no está dirigido a esta sucursal como origen.",
      });
      await aprobarYEnviarTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, seccionOrigenId: seccionAId });
      expect(await rechazarSolicitudDeTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, motivo: null })).toEqual({
        ok: false,
        codigo: "ESTADO",
        mensaje: 'Este traspaso ya está en estado "ENVIADA" — no se puede rechazar desde acá.',
      });
    });
  });

  describe("la hora entra por actor.ahora, no por el reloj (Pureza 1.2)", () => {
    it("aprobar y enviar: la decisión de Origen y la fecha de la SALIDA del Kardex son la hora de entrada", async () => {
      const fija = fijaHaceTresDias();
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      const r = await aprobarYEnviarTraspasoCasoDeUso({ ...comoA(), ahora: fija }, { traspasoId: sol.id, seccionOrigenId: seccionAId });
      expect(r.ok).toBe(true);
      expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } })).fechaDecisionOrigen?.getTime()).toBe(fija.getTime());
      const salida = await prisma.operacion.findFirstOrThrow({ where: { proceso: "TRANSFERENCIA_SALIDA_SUCURSAL" } });
      expect(salida.fecha.getTime()).toBe(fija.getTime());
    });

    it("cancelar una solicitud: el cierre es la hora de entrada", async () => {
      const fija = fijaHaceTresDias();
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      expect((await cancelarSolicitudDeTraspasoCasoDeUso({ ...comoB(), ahora: fija }, { traspasoId: sol.id })).ok).toBe(true);
      expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } })).fechaCierre?.getTime()).toBe(fija.getTime());
    });

    it("rechazar una solicitud: la decisión de Origen es la hora de entrada", async () => {
      const fija = fijaHaceTresDias();
      const mp = await producto(10);
      const sol = await solicitud(mp.id, 4);
      expect((await rechazarSolicitudDeTraspasoCasoDeUso({ ...comoA(), ahora: fija }, { traspasoId: sol.id, motivo: "No hay" })).ok).toBe(true);
      expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } })).fechaDecisionOrigen?.getTime()).toBe(fija.getTime());
    });
  });
});
