import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma, prismaAdmin, prismaSinEmpresa } from "../setup/test-db";
import { crearEmpresa } from "../setup/crear-empresa";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { actualizarActivoSucursal } from "../../src/server/actions/auth/sucursales";
import { actualizarActivoSucursalCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/actualizar-activo-sucursal";

/**
 * P15 (decisión del dueño, 2026-10-11): NO se puede apagar una sucursal con mercadería en camino ni con mesas abiertas. Quien no tiene una sucursal activa no tiene contexto para operarla: el destino de un
 * traspaso ENVIADA no podría recibirlo ni rechazarlo, el origen no podría confirmar el reingreso de uno RECHAZADA_DESTINO, y la cuenta de una mesa abierta no se podría cerrar. El servidor bloquea con
 * `TIENE_PENDIENTES` y el mensaje dice qué falta. Reactivar nunca se bloquea. Una SOLICITADA pendiente NO bloquea (no movió stock).
 *
 * Todo pasa por la Server Action (`actualizarActivoSucursal`, con la sesión simulada): si el día de mañana las políticas por sucursal de la RLS (Fase B4/B5 de M.3) hacen que la transacción del apagado deje de
 * ver los traspasos y las cuentas de la sucursal que se apaga, la comprobación pasaría sin avisar (falla ABIERTO): estos tests se ponen en rojo y funcionan de alarma. Las fechas son fijas y pasadas.
 *
 * Mutaciones demostradas (cada una pone en rojo su test; ver el informe del paso P15-1): quitar cada cláusula del `OR` de traspasos, agregar SOLICITADA al filtro, quitar el filtro por sucursal de las cuentas, sacar el
 * chequeo de `sucursal.activo`.
 */
const CIERRE_FIJO = new Date("2020-01-01T12:00:00Z");

describe("actualizarActivoSucursal: no se apaga una sucursal con traspasos en camino ni mesas abiertas (P15)", () => {
  let adminId: string;
  let centralId: string; // la sucursal del que actúa
  let norteId: string; // la que se quiere apagar
  let surId: string; // otra sucursal de la misma empresa
  let harinaId: string;
  let rolOperadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    rolOperadorId = base.operador.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    surId = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
    const catalogo = await sembrarCatalogoBase();
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  afterEach(() => {
    __setCookieDeTestParaSucursal(undefined);
  });

  async function traspaso(estado: "SOLICITADA" | "ENVIADA" | "ACEPTADA" | "RECHAZADA_ORIGEN" | "RECHAZADA_DESTINO" | "CERRADA" | "CANCELADA", origenSucursalId: string, destinoSucursalId: string, cantidad = 4) {
    return prisma.traspasoSucursal.create({
      data: { origenSucursalId, destinoSucursalId, productoId: harinaId, cantidad, iniciadoPor: "ORIGEN", estado, creadoPorId: adminId },
    });
  }

  async function mesaConCuenta(sucursalId: string, numero: number, cerrada = false) {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero } });
    await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: adminId, comensales: 2, cerradaEn: cerrada ? CIERRE_FIJO : null, cerradaPorId: cerrada ? adminId : null } });
    return mesa;
  }

  const rechazo = (partes: string) => `No se puede desactivar "Norte": todavía tiene mercadería en camino o mesas abiertas. Antes: ${partes}.`;
  const activo = async (id: string) => (await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id } })).activo;
  const filasDeAuditoria = (id: string) => prismaAdmin.registroAuditoria.count({ where: { entidad: "Sucursal", entidadId: id } });

  /** Rechazado: la sucursal sigue activa y no quedó ni una fila de auditoría (nada cambia). */
  async function expectRechazo(mensaje: string) {
    const r = await actualizarActivoSucursal(norteId, false);
    expect(r).toEqual({ ok: false, mensaje });
    expect(await activo(norteId)).toBe(true);
    expect(await filasDeAuditoria(norteId)).toBe(0);
  }

  it("camino feliz: sin pendientes se apaga, con UNA fila de auditoría de Sucursal.activo a nombre de quien la apagó", async () => {
    const r = await actualizarActivoSucursal(norteId, false);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await activo(norteId)).toBe(false);
    const filas = await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Sucursal", entidadId: norteId } });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ campo: "activo", actorId: adminId });
  });

  describe("bloquea (el mensaje dice qué falta y no cambia nada)", () => {
    it("ENVIADA hacia la sucursal: el destino tiene que recibirlo o rechazarlo", async () => {
      await traspaso("ENVIADA", surId, norteId);
      await expectRechazo(rechazo('recibí o rechazá el traspaso de 4 kg de "Harina" que mandó "Sur"'));
    });

    it("ENVIADA desde la sucursal: el destino tiene que recibirlo o rechazarlo", async () => {
      await traspaso("ENVIADA", norteId, surId, 2.5);
      await expectRechazo(rechazo('"Sur" tiene que recibir o rechazar el traspaso de 2.5 kg de "Harina"'));
    });

    it("RECHAZADA_DESTINO desde la sucursal: falta confirmar el reingreso", async () => {
      await traspaso("RECHAZADA_DESTINO", norteId, surId);
      await expectRechazo(rechazo('confirmá el reingreso del traspaso de 4 kg de "Harina" que rechazó "Sur"'));
    });

    it("una mesa abierta (cuenta sin cerrar)", async () => {
      await mesaConCuenta(norteId, 7);
      await expectRechazo(rechazo("cerrá o liberá la mesa 7"));
    });

    it("varias mesas abiertas, ordenadas por número y sin contar las cerradas", async () => {
      await mesaConCuenta(norteId, 3);
      await mesaConCuenta(norteId, 1);
      await mesaConCuenta(norteId, 2, true);
      await expectRechazo(rechazo("cerrá o liberá las mesas 1 y 3"));
    });

    it("traspasos y mesas juntos: los traspasos primero (por antigüedad), las mesas al final", async () => {
      await traspaso("ENVIADA", norteId, surId);
      await traspaso("ENVIADA", surId, norteId, 1);
      await mesaConCuenta(norteId, 2);
      await expectRechazo(rechazo('"Sur" tiene que recibir o rechazar el traspaso de 4 kg de "Harina"; recibí o rechazá el traspaso de 1 kg de "Harina" que mandó "Sur"; cerrá o liberá la mesa 2'));
    });

    it("con más de 4 traspasos nombra 4 y resume el resto", async () => {
      for (const cantidad of [1, 2, 3, 4, 5, 6]) await traspaso("ENVIADA", surId, norteId, cantidad);
      const q = (c: number) => `recibí o rechazá el traspaso de ${c} kg de "Harina" que mandó "Sur"`;
      await expectRechazo(rechazo([q(1), q(2), q(3), q(4), "y 2 traspasos más"].join("; ")));
    });
  });

  describe("NO bloquea", () => {
    it.each([
      ["una SOLICITADA pendiente (no movió stock; la aprobación rechaza si el destino está apagado)", "SOLICITADA", "sur", "norte"],
      ["una SOLICITADA hecha desde la sucursal", "SOLICITADA", "norte", "sur"],
      ["RECHAZADA_DESTINO con la sucursal como DESTINO (el origen confirma el reingreso sin ella)", "RECHAZADA_DESTINO", "sur", "norte"],
      ["un traspaso ACEPTADA", "ACEPTADA", "sur", "norte"],
      ["un traspaso CERRADA", "CERRADA", "norte", "sur"],
      ["un traspaso CANCELADA", "CANCELADA", "sur", "norte"],
      ["un traspaso RECHAZADA_ORIGEN", "RECHAZADA_ORIGEN", "norte", "sur"],
    ] as const)("%s", async (_nombre, estado, origen, destino) => {
      // Los ids se asignan en el beforeEach: la tabla de arriba se arma al cargar el archivo, antes de que existan.
      const ids = { sur: surId, norte: norteId };
      await traspaso(estado, ids[origen], ids[destino]);
      const r = await actualizarActivoSucursal(norteId, false);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await activo(norteId)).toBe(false);
    });

    it("una cuenta ya cerrada", async () => {
      await mesaConCuenta(norteId, 1, true);
      const r = await actualizarActivoSucursal(norteId, false);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await activo(norteId)).toBe(false);
    });

    it("pendientes de OTRA sucursal de la misma empresa (traspaso entre Central y Sur, mesa de Sur)", async () => {
      await traspaso("ENVIADA", centralId, surId);
      await traspaso("RECHAZADA_DESTINO", surId, centralId);
      await mesaConCuenta(surId, 1);
      const r = await actualizarActivoSucursal(norteId, false);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await activo(norteId)).toBe(false);
    });
  });

  describe("idempotencia y datos de antes", () => {
    it("apagar dos veces da ok las dos veces y deja UNA sola fila de auditoría", async () => {
      const primera = await actualizarActivoSucursal(norteId, false);
      const segunda = await actualizarActivoSucursal(norteId, false);
      expect(primera.ok, primera.mensaje).toBe(true);
      expect(segunda.ok, segunda.mensaje).toBe(true);
      expect(await activo(norteId)).toBe(false);
      expect(await filasDeAuditoria(norteId)).toBe(1);
    });

    it("repetir el apagado de una sucursal YA apagada que tiene un traspaso trabado (datos de antes del arreglo) no se bloquea ni toca nada", async () => {
      await prisma.sucursal.update({ where: { id: norteId }, data: { activo: false } });
      await traspaso("ENVIADA", surId, norteId);
      const r = await actualizarActivoSucursal(norteId, false);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await filasDeAuditoria(norteId)).toBe(0);
    });

    it("datos de antes del arreglo: reactivar una sucursal apagada con un traspaso trabado se permite, y volver a apagarla se bloquea", async () => {
      await prisma.sucursal.update({ where: { id: norteId }, data: { activo: false } });
      await traspaso("ENVIADA", surId, norteId);

      const reactivar = await actualizarActivoSucursal(norteId, true);
      expect(reactivar.ok, reactivar.mensaje).toBe(true);
      expect(await activo(norteId)).toBe(true);

      const apagar = await actualizarActivoSucursal(norteId, false);
      expect(apagar).toEqual({ ok: false, mensaje: rechazo('recibí o rechazá el traspaso de 4 kg de "Harina" que mandó "Sur"') });
      expect(await activo(norteId)).toBe(true);
    });
  });

  it("permisos: quien no tiene activar_sucursal recibe el mensaje de la puerta, no la lista de pendientes", async () => {
    await traspaso("ENVIADA", surId, norteId);
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: centralId, rolId: rolOperadorId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

    const r = await actualizarActivoSucursal(norteId, false);
    expect(r.ok).toBe(false);
    expect(r.mensaje).not.toContain("todavía tiene mercadería en camino");
    expect(r.mensaje).not.toContain("Harina");
    expect(await activo(norteId)).toBe(true);
  });

  it("aislamiento: un admin de otra empresa que intenta apagar una sucursal con pendientes recibe «No se encontró esa sucursal.», no la lista (lo garantiza la RLS por empresa: el test lo deja como evidencia)", async () => {
    await traspaso("ENVIADA", surId, norteId);
    await mesaConCuenta(norteId, 1);
    const otra = await crearEmpresa(
      prismaSinEmpresa,
      { nombre: "Pizzería Oeste", slug: "oeste", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", emailPrimerAdmin: "gerente@oeste.com" },
      [],
    );
    const actorDeLaOtra = { ...baseDeEmpresa(otra.empresaId), usuarioId: otra.usuarioId, empresaId: otra.empresaId, sucursalId: otra.sucursalId };

    const r = await actualizarActivoSucursalCasoDeUso(actorDeLaOtra, { sucursalId: norteId, activo: false });

    expect(r).toMatchObject({ ok: false, codigo: "SUCURSAL_NO_ENCONTRADA", mensaje: "No se encontró esa sucursal." });
    expect(await activo(norteId)).toBe(true);
    expect(await filasDeAuditoria(norteId)).toBe(0);
  });
});
