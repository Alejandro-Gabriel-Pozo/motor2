import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { aceptarTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/aceptar-traspaso";
import { rechazarEnvioDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/rechazar-envio-de-traspaso";
import { confirmarReingresoDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/confirmar-reingreso-de-traspaso";
import { aResultadoAccion } from "../../src/core/resultado-caso";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

/**
 * Casos de uso de la RECEPCIÓN de un envío (src/server/actions/traspasos/casos-de-uso/; Task #41, Fase M11b): aceptar, rechazar el
 * envío, confirmar el reingreso. Postgres real, sin mocks de base ni de sesión: el caso de uso recibe el actor ya resuelto (el permiso
 * lo chequea `conPermiso` en la Server Action, cubierta de punta a punta por test/traspasos/traspasos.test.ts,
 * test/auditoria/traspasos-en-transito.test.ts y test/auditoria/idempotencia-i3-mecanismo.test.ts, que no se tocaron).
 *
 * Un caso por cada código de resultado, verificando `datos`, los textos exactos de antes y lo que queda escrito (I3 incluida). El
 * formato del comando lo cubre test/core/features/traspasos/traspaso-comandos-guard.test.ts.
 */
describe("casos de uso de la recepción de un traspaso", () => {
  let sucursalAId: string; // Origen
  let sucursalBId: string; // Destino
  let seccionAId: string;
  let seccionBId: string;
  let adminAId: string;
  let adminBId: string;
  let kgId: string;
  let insumoId: string;

  const comoA = () => ({ usuarioId: adminAId, sucursalId: sucursalAId, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest });
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

  /** Asiento de Kardex armado directo por Prisma (una COMPRA o la SALIDA de un envío). */
  async function asiento(productoId: string, proceso: "COMPRA" | "TRANSFERENCIA_SALIDA_SUCURSAL", cantidad: number, traspasoSucursalId?: string) {
    const op = await prisma.operacion.create({ data: { sucursalId: sucursalAId, proceso, fecha: new Date(), usuarioId: adminAId } });
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId, seccionId: seccionAId, proceso, cantidad, detalle: proceso, precioTotal: 0, precioPorUnidadStock: 0, ...(traspasoSucursalId !== undefined && { traspasoSucursalId }) },
    });
  }

  /** Producto con `stock` kg en la sección A, disponible en las sucursales dadas. */
  async function producto(stock: number, disponibleEn: string[] = [sucursalAId, sucursalBId]) {
    const mp = await prisma.producto.create({ data: { codigo: `MP_${Math.random().toString(36).slice(2, 8)}`, nombre: "Harina", tipo: "MP", unidadStockId: kgId, insumoId } });
    if (disponibleEn.length) {
      await prisma.disponibilidadProducto.createMany({ data: disponibleEn.map((sucursalId) => ({ sucursalId, productoId: mp.id, disponible: true })) });
    }
    if (stock) await asiento(mp.id, "COMPRA", stock);
    return mp;
  }

  /** Un envío PUSH de A a B, ENVIADA, con su SALIDA ya escrita en A (lo que deja `crearEnvioDirectoTransferencia`). */
  async function envio(productoId: string, cantidad: number, opciones: { seccionOrigenId?: string | null } = {}) {
    const t = await prisma.traspasoSucursal.create({
      data: {
        origenSucursalId: sucursalAId,
        destinoSucursalId: sucursalBId,
        productoId,
        cantidad,
        seccionOrigenId: opciones.seccionOrigenId === undefined ? seccionAId : opciones.seccionOrigenId,
        iniciadoPor: "ORIGEN",
        estado: "ENVIADA",
        creadoPorId: adminAId,
        fechaDecisionOrigen: new Date(),
        decididoPorOrigenId: adminAId,
      },
    });
    await asiento(productoId, "TRANSFERENCIA_SALIDA_SUCURSAL", -cantidad, t.id);
    return t;
  }

  describe("aceptarTraspasoCasoDeUso", () => {
    it("éxito sin clave: datos, mensaje, ENTRADA en el Kardex de destino y traspaso ACEPTADO (como antes)", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);

      const r = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionBId, claveIdempotencia: null });

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.mensaje).toBe('Recibido de "Central".');
      const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "TRANSFERENCIA_ENTRADA_SUCURSAL" }, include: { movimientos: true } });
      expect(r.datos).toEqual({ traspasoId: env.id, operacionId: operacion.id, repetida: false });
      expect(operacion).toMatchObject({ sucursalId: sucursalBId, usuarioId: adminBId, claveIdempotencia: null, payloadHash: null, resultadoMensaje: null });
      expect(operacion.movimientos).toHaveLength(1);
      expect(operacion.movimientos[0]).toMatchObject({ productoId: mp.id, seccionId: seccionBId, detalle: 'Transferencia recibida de sucursal "Central".', traspasoSucursalId: env.id });
      expect(Number(operacion.movimientos[0].cantidad)).toBe(4);
      expect(await calcularSaldoTotal(mp.id, seccionBId, prisma)).toBe(4);

      const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: env.id } });
      expect(traspaso).toMatchObject({ estado: "ACEPTADA", seccionDestinoId: seccionBId, decididoPorDestinoId: adminBId });
      expect(traspaso.fechaDecisionDestino?.toISOString()).toBe(operacion.fecha.toISOString());
    });

    it("I3: con clave guarda clave, hash y mensaje; el reenvío exacto devuelve el mismo mensaje (repetida) sin volver a sumar", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);
      const clave = randomUUID();

      const r1 = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionBId, claveIdempotencia: clave });
      const r2 = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionBId, claveIdempotencia: clave });

      expect(r1.ok && r1.datos.repetida).toBe(false);
      expect(r2).toEqual({ ok: true, mensaje: 'Recibido de "Central".', datos: { traspasoId: env.id, operacionId: null, repetida: true } });
      const operaciones = await prisma.operacion.findMany({ where: { proceso: "TRANSFERENCIA_ENTRADA_SUCURSAL" } });
      expect(operaciones).toHaveLength(1);
      expect(operaciones[0]).toMatchObject({ claveIdempotencia: clave, resultadoMensaje: 'Recibido de "Central".' });
      expect(operaciones[0].payloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(await calcularSaldoTotal(mp.id, seccionBId, prisma)).toBe(4);
    });

    it("CONFLICTO_IDEMPOTENCIA: la misma clave con otra sección de destino", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);
      const clave = randomUUID();
      const seccionB2Id = (await sembrarSeccion(sucursalBId, "Depósito B2")).id;
      await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionBId, claveIdempotencia: clave });
      const r = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionB2Id, claveIdempotencia: clave });
      expect(r).toEqual({
        ok: false,
        codigo: "CONFLICTO_IDEMPOTENCIA",
        mensaje: "Esta operación ya se había enviado con datos distintos — recargá la página e intentalo de nuevo.",
      });
    });

    it("SECCION_NO_PROPIA: una sección de otra sucursal, antes de abrir la transacción", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);
      const r = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionAId, claveIdempotencia: null });
      expect(r).toEqual({ ok: false, codigo: "SECCION_NO_PROPIA", mensaje: "Elegí a qué sección propia entra." });
    });

    it("NO_ENCONTRADO", async () => {
      const r = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: "no-existe", seccionDestinoId: seccionBId, claveIdempotencia: null });
      expect(r).toEqual({ ok: false, codigo: "NO_ENCONTRADO", mensaje: "No se encontró ese traspaso." });
    });

    it("LADO: el origen no puede aceptar su propio envío", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);
      const r = await aceptarTraspasoCasoDeUso(comoA(), { traspasoId: env.id, seccionDestinoId: seccionAId, claveIdempotencia: null });
      expect(r).toEqual({ ok: false, codigo: "LADO", mensaje: "Este traspaso no está dirigido a esta sucursal como destino." });
    });

    it("ESTADO: una segunda aceptación sin clave no vuelve a sumar", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);
      expect((await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionBId, claveIdempotencia: null })).ok).toBe(true);
      const r = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionBId, claveIdempotencia: null });
      expect(r).toEqual({ ok: false, codigo: "ESTADO", mensaje: 'Este traspaso está en estado "ACEPTADA" — no se puede aceptar.' });
      expect(await calcularSaldoTotal(mp.id, seccionBId, prisma)).toBe(4);
    });

    it("PRODUCTO_NO_TRANSFERIBLE: dejó de estar disponible en destino desde el envío", async () => {
      const mp = await producto(10, [sucursalAId]);
      const env = await envio(mp.id, 4);
      const r = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionBId, claveIdempotencia: null });
      expect(r).toEqual({ ok: false, codigo: "PRODUCTO_NO_TRANSFERIBLE", mensaje: "«Harina» no está disponible en «Sucursal B»: activalo allá antes de enviar." });
      expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: env.id } })).estado).toBe("ENVIADA");
      expect(await prisma.operacion.count({ where: { proceso: "TRANSFERENCIA_ENTRADA_SUCURSAL" } })).toBe(0);
    });

    it("aResultadoAccion deja solo { ok, mensaje } para la pantalla", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);
      expect(aResultadoAccion(await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionBId, claveIdempotencia: null }))).toEqual({
        ok: true,
        mensaje: 'Recibido de "Central".',
      });
    });
  });

  describe("rechazarEnvioDeTraspasoCasoDeUso", () => {
    it("éxito: RECHAZADA_DESTINO con decisión de Destino y el motivo, sin tocar stock", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);
      const r = await rechazarEnvioDeTraspasoCasoDeUso(comoB(), { traspasoId: env.id, motivo: "No lo pedimos" });
      expect(r).toEqual({
        ok: true,
        mensaje: "Transferencia rechazada — queda pendiente que el origen confirme el reingreso a su stock.",
        datos: { traspasoId: env.id, estadoNuevo: "RECHAZADA_DESTINO" },
      });
      const t = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: env.id } });
      expect(t).toMatchObject({ estado: "RECHAZADA_DESTINO", decididoPorDestinoId: adminBId, motivoRechazoDestino: "No lo pedimos" });
      expect(t.fechaDecisionDestino).not.toBeNull();
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(6);
      expect(await calcularSaldoTotal(mp.id, seccionBId, prisma)).toBe(0);
    });

    it("sin motivo: queda en null", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);
      expect((await rechazarEnvioDeTraspasoCasoDeUso(comoB(), { traspasoId: env.id, motivo: null })).ok).toBe(true);
      expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: env.id } })).motivoRechazoDestino).toBeNull();
    });

    it("NO_ENCONTRADO / LADO / ESTADO con los textos de antes", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);
      expect(await rechazarEnvioDeTraspasoCasoDeUso(comoB(), { traspasoId: "no-existe", motivo: null })).toEqual({ ok: false, codigo: "NO_ENCONTRADO", mensaje: "No se encontró ese traspaso." });
      expect(await rechazarEnvioDeTraspasoCasoDeUso(comoA(), { traspasoId: env.id, motivo: null })).toEqual({
        ok: false,
        codigo: "LADO",
        mensaje: "Este traspaso no está dirigido a esta sucursal como destino.",
      });
      await rechazarEnvioDeTraspasoCasoDeUso(comoB(), { traspasoId: env.id, motivo: "primero" });
      expect(await rechazarEnvioDeTraspasoCasoDeUso(comoB(), { traspasoId: env.id, motivo: "segundo" })).toEqual({
        ok: false,
        codigo: "ESTADO",
        mensaje: 'Este traspaso está en estado "RECHAZADA_DESTINO" — no se puede rechazar desde acá.',
      });
      expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: env.id } })).motivoRechazoDestino).toBe("primero");
    });
  });

  describe("confirmarReingresoDeTraspasoCasoDeUso", () => {
    async function rechazado(cantidad: number, opciones: { seccionOrigenId?: string | null; productoId?: string } = {}) {
      const mp = opciones.productoId ? { id: opciones.productoId } : await producto(10);
      const env = await envio(mp.id, cantidad, opciones);
      await prisma.traspasoSucursal.update({ where: { id: env.id }, data: { estado: "RECHAZADA_DESTINO" } });
      return { mp, env };
    }

    it("éxito sin clave: datos, mensaje, REINGRESO en la sección de origen y traspaso CERRADO (como antes)", async () => {
      const { mp, env } = await rechazado(4);
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(6);

      const r = await confirmarReingresoDeTraspasoCasoDeUso(comoA(), { traspasoId: env.id, claveIdempotencia: null });

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.mensaje).toBe('Reingreso confirmado: se sumó de nuevo 4 de "Harina" en "Depósito A".');
      const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "REINGRESO_TRANSFERENCIA_SUCURSAL" }, include: { movimientos: true } });
      expect(r.datos).toEqual({ traspasoId: env.id, operacionId: operacion.id, repetida: false });
      expect(operacion).toMatchObject({ sucursalId: sucursalAId, usuarioId: adminAId, claveIdempotencia: null, payloadHash: null, resultadoMensaje: null });
      expect(operacion.movimientos).toHaveLength(1);
      expect(operacion.movimientos[0]).toMatchObject({ productoId: mp.id, seccionId: seccionAId, detalle: 'Reingreso — rechazado por sucursal "Sucursal B".', traspasoSucursalId: env.id });
      expect(Number(operacion.movimientos[0].cantidad)).toBe(4);
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(10);

      const t = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: env.id } });
      expect(t).toMatchObject({ estado: "CERRADA", cerradoPorId: adminAId });
      expect(t.fechaCierre?.toISOString()).toBe(operacion.fecha.toISOString());
    });

    it("I3: el reenvío exacto devuelve el mismo mensaje (repetida) sin volver a sumar; la misma clave en otro traspaso es conflicto", async () => {
      const { mp, env } = await rechazado(4);
      const clave = randomUUID();

      await confirmarReingresoDeTraspasoCasoDeUso(comoA(), { traspasoId: env.id, claveIdempotencia: clave });
      const r2 = await confirmarReingresoDeTraspasoCasoDeUso(comoA(), { traspasoId: env.id, claveIdempotencia: clave });

      const mensaje = 'Reingreso confirmado: se sumó de nuevo 4 de "Harina" en "Depósito A".';
      expect(r2).toEqual({ ok: true, mensaje, datos: { traspasoId: env.id, operacionId: null, repetida: true } });
      const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "REINGRESO_TRANSFERENCIA_SUCURSAL" } });
      expect(operacion).toMatchObject({ claveIdempotencia: clave, resultadoMensaje: mensaje });
      expect(await prisma.operacion.count({ where: { proceso: "REINGRESO_TRANSFERENCIA_SUCURSAL" } })).toBe(1);
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(10);

      const otro = await rechazado(2, { productoId: mp.id });
      expect(await confirmarReingresoDeTraspasoCasoDeUso(comoA(), { traspasoId: otro.env.id, claveIdempotencia: clave })).toMatchObject({
        ok: false,
        codigo: "CONFLICTO_IDEMPOTENCIA",
      });
    });

    it("SIN_SECCION_ORIGEN: el texto exacto de antes, sin escribir nada", async () => {
      const { env } = await rechazado(4, { seccionOrigenId: null });
      const r = await confirmarReingresoDeTraspasoCasoDeUso(comoA(), { traspasoId: env.id, claveIdempotencia: null });
      expect(r).toEqual({ ok: false, codigo: "SIN_SECCION_ORIGEN", mensaje: "Este traspaso no tiene una sección de origen registrada — no se puede reingresar." });
      expect(await prisma.operacion.count({ where: { proceso: "REINGRESO_TRANSFERENCIA_SUCURSAL" } })).toBe(0);
    });

    it("NO_ENCONTRADO / LADO / ESTADO con los textos de antes", async () => {
      const mp = await producto(10);
      const enviado = await envio(mp.id, 4);
      expect(await confirmarReingresoDeTraspasoCasoDeUso(comoA(), { traspasoId: "no-existe", claveIdempotencia: null })).toEqual({
        ok: false,
        codigo: "NO_ENCONTRADO",
        mensaje: "No se encontró ese traspaso.",
      });
      expect(await confirmarReingresoDeTraspasoCasoDeUso(comoB(), { traspasoId: enviado.id, claveIdempotencia: null })).toEqual({
        ok: false,
        codigo: "LADO",
        mensaje: "Este traspaso no está dirigido a esta sucursal como origen.",
      });
      expect(await confirmarReingresoDeTraspasoCasoDeUso(comoA(), { traspasoId: enviado.id, claveIdempotencia: null })).toEqual({
        ok: false,
        codigo: "ESTADO",
        mensaje: 'Este traspaso está en estado "ENVIADA" — no hay ningún reingreso pendiente.',
      });
    });
  });
});
