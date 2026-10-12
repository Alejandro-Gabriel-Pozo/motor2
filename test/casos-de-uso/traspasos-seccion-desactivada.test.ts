import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { aceptarTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/aceptar-traspaso";
import { aprobarYEnviarTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/aprobar-y-enviar-traspaso";
import { confirmarReingresoDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/confirmar-reingreso-de-traspaso";
import { crearEnvioDirectoDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/crear-envio-directo-de-traspaso";
import { crearSolicitudDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/crear-solicitud-de-traspaso";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/**
 * P17 (decisión del dueño, 2026-10-11) en los TRASPASOS entre sucursales: una sección dada de baja solo admite sacar mercadería. Postgres real, sin mocks (mismo molde que
 * `traspasos-recepcion.test.ts`, `traspasos-creacion.test.ts` y `traspasos-solicitud.test.ts`; archivo aparte para no mezclarse con los casos de cada caso de uso).
 *
 *  - Como DESTINO se rechaza (`SECCION_INACTIVA`): aceptar un envío y pedir un traspaso. Nada se escribe: el envío sigue ENVIADO y se acepta eligiendo otra sección.
 *  - Como ORIGEN se permite: el envío directo y la aprobación de una solicitud sacan de ella (sin cambios en el servidor).
 *  - El REINGRESO de un traspaso rechazado a su sección de origen dada de baja se PERMITE: la mercadería vuelve a donde estaba, no es mercadería nueva, y el reingreso no deja elegir sección
 *    (si se rechazara, el traspaso quedaría trabado).
 */
describe("P17: traspasos y secciones dadas de baja", () => {
  let sucursalAId: string; // Origen
  let sucursalBId: string; // Destino
  let seccionAId: string;
  let seccionBId: string;
  let seccionB2Id: string;
  let adminAId: string;
  let adminBId: string;
  let kgId: string;
  let insumoId: string;

  const comoA = () => ({ usuarioId: adminAId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: sucursalAId, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest });
  const comoB = () => ({ usuarioId: adminBId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: sucursalBId, sucursalNombre: "Sucursal B", ahora: new Date(), ...baseDeTest });
  const MENSAJE = (nombre: string) =>
    `La sección «${nombre}» está desactivada: solo se puede sacar mercadería de ella (transferir, mermar o consumir) hasta vaciarla. Elegí otra sección o activala.`;
  const darDeBaja = (seccionId: string) => prisma.seccion.update({ where: { id: seccionId }, data: { activa: false } });

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
    seccionB2Id = (await sembrarSeccion(sucursalBId, "Depósito B2")).id;
    adminAId = (await crearUsuarioConMembresia({ email: "admin-a@test.com", sucursalId: sucursalAId, rolId: base.admin.id })).id;
    adminBId = (await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: sucursalBId, rolId: base.admin.id })).id;
  });

  /** Asiento de Kardex armado directo por Prisma en la sección A (una COMPRA o la SALIDA de un envío). */
  async function asiento(productoId: string, proceso: "COMPRA" | "TRANSFERENCIA_SALIDA_SUCURSAL", cantidad: number, traspasoSucursalId?: string) {
    const op = await prisma.operacion.create({ data: { sucursalId: sucursalAId, proceso, fecha: new Date(), usuarioId: adminAId } });
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId, seccionId: seccionAId, proceso, cantidad, detalle: proceso, precioTotal: 0, precioPorUnidadStock: 0, ...(traspasoSucursalId !== undefined && { traspasoSucursalId }) },
    });
  }

  /** Producto con `stock` kg en la sección A, disponible en las dos sucursales. */
  async function producto(stock: number) {
    const mp = await prisma.producto.create({ data: { codigo: `MP_${Math.random().toString(36).slice(2, 8)}`, nombre: "Harina", tipo: "MP", unidadStockId: kgId, insumoId } });
    await prisma.disponibilidadProducto.createMany({ data: [sucursalAId, sucursalBId].map((sucursalId) => ({ sucursalId, productoId: mp.id, disponible: true })) });
    if (stock) await asiento(mp.id, "COMPRA", stock);
    return mp;
  }

  /** Un envío PUSH de A a B, ENVIADA, con su SALIDA ya escrita en A. */
  async function envio(productoId: string, cantidad: number) {
    const t = await prisma.traspasoSucursal.create({
      data: {
        origenSucursalId: sucursalAId,
        destinoSucursalId: sucursalBId,
        productoId,
        cantidad,
        seccionOrigenId: seccionAId,
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

  describe("como DESTINO se rechaza", () => {
    it("aceptar un envío en una sección dada de baja: SECCION_INACTIVA con el texto único, nada escrito y el envío sigue ENVIADO; con otra sección se acepta", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);
      await darDeBaja(seccionBId);

      const r = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionBId, claveIdempotencia: null });

      expect(r).toEqual({ ok: false, codigo: "SECCION_INACTIVA", mensaje: MENSAJE("Depósito B") });
      expect(await prisma.operacion.count({ where: { proceso: "TRANSFERENCIA_ENTRADA_SUCURSAL" } })).toBe(0);
      expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: env.id } })).estado).toBe("ENVIADA");
      expect(await calcularSaldoTotal(mp.id, seccionBId, prisma)).toBe(0);

      const otra = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionB2Id, claveIdempotencia: null });
      expect(otra.ok).toBe(true);
      expect(await calcularSaldoTotal(mp.id, seccionB2Id, prisma)).toBe(4);
    });

    it("aceptar: la clave I3 se evalúa ANTES — reintentar lo ya aceptado después de dar de baja la sección devuelve «repetida», no un rechazo, y no suma de nuevo", async () => {
      const mp = await producto(10);
      const env = await envio(mp.id, 4);
      const clave = randomUUID();
      const r1 = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionBId, claveIdempotencia: clave });
      expect(r1.ok && r1.datos.repetida).toBe(false);
      await darDeBaja(seccionBId);

      const r2 = await aceptarTraspasoCasoDeUso(comoB(), { traspasoId: env.id, seccionDestinoId: seccionBId, claveIdempotencia: clave });

      expect(r2).toEqual({ ok: true, mensaje: 'Recibido de "Central".', datos: { traspasoId: env.id, operacionId: null, repetida: true } });
      expect(await prisma.operacion.count({ where: { proceso: "TRANSFERENCIA_ENTRADA_SUCURSAL" } })).toBe(1);
      expect(await calcularSaldoTotal(mp.id, seccionBId, prisma)).toBe(4);
    });

    it("pedir un traspaso hacia una sección dada de baja: SECCION_INACTIVA con el texto único y nada escrito", async () => {
      const mp = await producto(0);
      await darDeBaja(seccionAId);

      const r = await crearSolicitudDeTraspasoCasoDeUso(comoA(), { origenSucursalId: sucursalBId, productoId: mp.id, cantidad: 3, seccionDestinoId: seccionAId, detalle: null });

      expect(r).toEqual({ ok: false, codigo: "SECCION_INACTIVA", mensaje: MENSAJE("Depósito A") });
      expect(await prisma.traspasoSucursal.count()).toBe(0);
    });
  });

  describe("como ORIGEN se permite", () => {
    it("el envío directo sale de una sección dada de baja y la deja vacía", async () => {
      const mp = await producto(10);
      await darDeBaja(seccionAId);

      const r = await crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), { destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 10, seccionOrigenId: seccionAId, detalle: null });

      expect(r.ok, r.mensaje).toBe(true);
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(0);
      expect(await prisma.traspasoSucursal.count({ where: { estado: "ENVIADA" } })).toBe(1);
    });

    it("aprobar una solicitud sale de una sección dada de baja", async () => {
      const mp = await producto(10);
      const sol = await prisma.traspasoSucursal.create({
        data: { origenSucursalId: sucursalAId, destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionDestinoId: seccionBId, iniciadoPor: "DESTINO", estado: "SOLICITADA", creadoPorId: adminBId },
      });
      await darDeBaja(seccionAId);

      const r = await aprobarYEnviarTraspasoCasoDeUso(comoA(), { traspasoId: sol.id, seccionOrigenId: seccionAId });

      expect(r.ok, r.mensaje).toBe(true);
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(6);
      expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } })).estado).toBe("ENVIADA");
    });
  });

  it("el REINGRESO de un traspaso rechazado se PERMITE aunque su sección de origen esté dada de baja: la mercadería vuelve a donde estaba y el traspaso se cierra", async () => {
    const mp = await producto(10);
    const env = await envio(mp.id, 4);
    await prisma.traspasoSucursal.update({ where: { id: env.id }, data: { estado: "RECHAZADA_DESTINO" } });
    await darDeBaja(seccionAId);
    expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(6);

    const r = await confirmarReingresoDeTraspasoCasoDeUso(comoA(), { traspasoId: env.id, claveIdempotencia: null });

    expect(r.ok, r.mensaje).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(10);
    expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: env.id } })).estado).toBe("CERRADA");
  });
});
