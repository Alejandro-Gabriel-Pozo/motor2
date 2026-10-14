import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { cerrarConexiones, conexionComoApp, intentar } from "../setup/gasto";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { MENSAJE_SUCURSAL_CAMBIADA } from "../../src/core/features/catalogo/opciones-por-sucursal.guard";
import { apagarOpcionEnSucursal, fijarPrecioLocalDeOpcion } from "../../src/server/actions/catalogo/opciones-por-sucursal";

/**
 * GO-2a, paso 10: lo que decide cada SUCURSAL sobre las opciones (ADR-030 §5). Contra Postgres real, por las Server Actions (sesión simulada, gate real) y como `motor2_app`:
 *  - apagar o prender (`opcion_apagar_en_sucursal`, piso operario, semilla admin, delegable): «llevar al estado X», sin fila = prendida, auditoría con la sucursal;
 *  - la grilla (`precio_local`, con su capacidad): solo una MEDIDA en ABSOLUTO admitida, el precio esperado, la baja es `habilitado = false`;
 *  - el eco de la sucursal (la que vio la pantalla tiene que ser la activa) y, por debajo, la RLS por sucursal: escribir en B desde el alcance de A da 42501.
 */
describe("opciones de venta en la sucursal (GO-2a)", () => {
  let e: EscenarioDeOpciones;
  let operadorId: string;
  let operadorRolId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    const adminRol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    operadorRolId = (await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } })).id;
    await crearMembresia({ usuarioId: e.usuarioId, sucursalId: e.sucursalA, rolId: adminRol.id });
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: e.sucursalA, rolId: operadorRolId })).id;
    await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: e.cafeId, grupoId: e.grupoMedidaId }, data: { modoPrecio: "ABSOLUTO" } });
    await prisma.productoAdmiteOpcion.updateMany({ where: { productoId: e.cafeId, opcionId: { in: [e.chicoId, e.medianoId, e.grandeId] } }, data: { precioAbsoluto: "1500.00" } });
  });

  afterEach(async () => {
    await cerrarConexiones();
  });

  const auditoria = (entidad: string) => prisma.registroAuditoria.findMany({ where: { entidad }, orderBy: [{ creadoEn: "asc" }, { campo: "asc" }], select: { entidadId: true, campo: true, valorAnterior: true, valorNuevo: true, sucursalId: true } });

  describe("apagar o prender", () => {
    it("apaga en la sucursal ACTIVA (sin fila = prendida, así que va de false a true), repetir no cambia nada, prender vuelve; cada cambio con la sucursal en la auditoría", async () => {
      expect(await apagarOpcionEnSucursal({ sucursalId: e.sucursalA, opcionId: e.almendrasId, apagada: true })).toMatchObject({ ok: true, mensaje: "«Almendras» quedó agotada en «Central»." });
      const fila = await prisma.opcionApagadaEnSucursal.findUniqueOrThrow({ where: { sucursalId_opcionId: { sucursalId: e.sucursalA, opcionId: e.almendrasId } } });
      expect(fila).toMatchObject({ apagada: true, actualizadoPorId: e.usuarioId });
      expect(await apagarOpcionEnSucursal({ sucursalId: e.sucursalA, opcionId: e.almendrasId, apagada: true })).toMatchObject({ ok: true, mensaje: "«Almendras» ya estaba agotada en «Central»." });
      expect(await apagarOpcionEnSucursal({ sucursalId: e.sucursalA, opcionId: e.almendrasId, apagada: false })).toMatchObject({ ok: true });
      expect(await apagarOpcionEnSucursal({ sucursalId: e.sucursalA, opcionId: e.vacaId, apagada: false })).toMatchObject({ ok: true, mensaje: "«De vaca» ya estaba disponible en «Central»." });
      expect(await auditoria("OpcionApagadaEnSucursal")).toEqual([
        { entidadId: `${e.sucursalA}:${e.almendrasId}`, campo: "apagada", valorAnterior: "false", valorNuevo: "true", sucursalId: e.sucursalA },
        { entidadId: `${e.sucursalA}:${e.almendrasId}`, campo: "apagada", valorAnterior: "true", valorNuevo: "false", sucursalId: e.sucursalA },
      ]);
      expect(await prisma.opcionApagadaEnSucursal.count()).toBe(1);
    });

    it("eco: si la pantalla venía de OTRA sucursal (no la activa), se rechaza antes de tocar la base; y una opción que no existe, «No se encontró la opción.»", async () => {
      expect(await apagarOpcionEnSucursal({ sucursalId: e.sucursalB, opcionId: e.almendrasId, apagada: true })).toEqual({ ok: false, mensaje: MENSAJE_SUCURSAL_CAMBIADA });
      expect(await apagarOpcionEnSucursal({ sucursalId: e.sucursalA, opcionId: "no-existe", apagada: true })).toEqual({ ok: false, mensaje: "No se encontró la opción." });
      expect(await prisma.opcionApagadaEnSucursal.count()).toBe(0);
    });

    it("la clave: el operador no la tiene de fábrica (clase O, semilla solo admin); si el gerente se la delega a su rol, puede (piso operario)", async () => {
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      const sinClave = await apagarOpcionEnSucursal({ sucursalId: e.sucursalA, opcionId: e.almendrasId, apagada: true });
      expect(sinClave.ok).toBe(false);
      expect(sinClave.mensaje).toMatch(/opcion_apagar_en_sucursal/);
      await prisma.permisoRol.updateMany({ where: { rolId: operadorRolId, accionClave: "opcion_apagar_en_sucursal" }, data: { puedeVer: true, puedeEditar: true } });
      expect(await apagarOpcionEnSucursal({ sucursalId: e.sucursalA, opcionId: e.almendrasId, apagada: true })).toMatchObject({ ok: true });
    });

    it("por debajo, la RLS por sucursal: como motor2_app con el alcance de A, escribir el apagado de B da 42501 (aunque el caso de uso se equivocara de id)", async () => {
      const comoA = await conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
      const r = await intentar(comoA, `INSERT INTO "OpcionApagadaEnSucursal" ("id", "sucursalId", "opcionId", "apagada", "actualizadoPorId") VALUES ($1, $2, $3, true, $4)`, [randomUUID(), e.sucursalB, e.almendrasId, e.usuarioId]);
      expect(r).toMatchObject({ codigo: "42501" });
      expect(await intentar(comoA, `INSERT INTO "OpcionApagadaEnSucursal" ("id", "sucursalId", "opcionId", "apagada", "actualizadoPorId") VALUES ($1, $2, $3, true, $4)`, [randomUUID(), e.sucursalA, e.almendrasId, e.usuarioId])).toBeNull();
    });
  });

  describe("la grilla de precios de una opción", () => {
    const fijar = (extra: Record<string, unknown> = {}) => fijarPrecioLocalDeOpcion({ sucursalId: e.sucursalA, productoId: e.cafeId, opcionId: e.grandeId, esperado: null, precio: 1800, ...extra });

    it("fija el precio de una MEDIDA en ABSOLUTO admitida; repetir no cambia nada; con el precio visto viejo, desactualizado; dar de baja deja la fila con habilitado = false", async () => {
      expect(await fijar()).toMatchObject({ ok: true });
      const fila = await prisma.precioLocalDeOpcion.findUniqueOrThrow({ where: { sucursalId_productoId_opcionId: { sucursalId: e.sucursalA, productoId: e.cafeId, opcionId: e.grandeId } } });
      expect([Number(fila.precio), fila.habilitado]).toEqual([1800, true]);
      expect(await fijar()).toMatchObject({ ok: true, mensaje: expect.stringMatching(/no tenía cambios/) });
      expect(await fijar({ precio: 1900 })).toMatchObject({ ok: false, mensaje: expect.stringMatching(/cambió mientras lo editabas/) });
      expect(await fijar({ esperado: { precio: 1800, habilitado: true }, precio: 1900 })).toMatchObject({ ok: true });
      expect(await fijar({ esperado: { precio: 1900, habilitado: true }, precio: null })).toMatchObject({ ok: true, mensaje: expect.stringMatching(/vuelve a regir el precio de la empresa/) });
      const baja = await prisma.precioLocalDeOpcion.findUniqueOrThrow({ where: { id: fila.id } });
      expect([Number(baja.precio), baja.habilitado]).toEqual([1900, false]);
      const entidadId = `${e.sucursalA}:${e.cafeId}:${e.grandeId}`;
      const filas = await auditoria("PrecioLocalDeOpcion");
      expect(filas.every((f) => f.entidadId === entidadId && f.sucursalId === e.sucursalA)).toBe(true);
      expect(filas.map((f) => [f.campo, f.valorAnterior, f.valorNuevo]).sort()).toEqual([
        ["habilitado", "true", "false"],
        ["habilitado", null, "true"],
        ["precio", "1800", "1900"],
        ["precio", null, "1800"],
      ].sort());
    });

    it("solo una MEDIDA en ABSOLUTO admitida: una variante, una medida en DIFERENCIA o una opción que el producto no admite se rechazan; un precio con 3 decimales o en 0, el guard", async () => {
      expect(await fijar({ opcionId: e.almendrasId })).toMatchObject({ ok: false, mensaje: expect.stringMatching(/no cobra «Almendras» con precio propio/) });
      await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: e.cafeId, grupoId: e.grupoMedidaId }, data: { modoPrecio: "DIFERENCIA" } });
      await prisma.productoAdmiteOpcion.updateMany({ where: { productoId: e.cafeId }, data: { precioAbsoluto: null } });
      expect(await fijar()).toMatchObject({ ok: false });
      expect(await fijar({ precio: 1800.005 })).toEqual({ ok: false, mensaje: "El precio admite como máximo 2 decimales." });
      expect(await fijar({ precio: 0 })).toEqual({ ok: false, mensaje: "El precio tiene que ser mayor que cero." });
      expect(await prisma.precioLocalDeOpcion.count()).toBe(0);
    });

    it("eco de la sucursal y, sin la capacidad `precio_local` en la sucursal, el gate rechaza", async () => {
      expect(await fijar({ sucursalId: e.sucursalB })).toEqual({ ok: false, mensaje: MENSAJE_SUCURSAL_CAMBIADA });
      await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId: e.sucursalA, habilitado: false } });
      const r = await fijar();
      expect(r.ok).toBe(false);
      expect(r.mensaje).not.toBe(MENSAJE_SUCURSAL_CAMBIADA);
      expect(await prisma.precioLocalDeOpcion.count()).toBe(0);
    });

    it("por debajo, la RLS: como motor2_app con el alcance de A, escribir la grilla de B da 42501", async () => {
      const comoA = await conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
      const r = await intentar(comoA, `INSERT INTO "PrecioLocalDeOpcion" ("id", "sucursalId", "productoId", "opcionId", "precio") VALUES ($1, $2, $3, $4, 100.00)`, [randomUUID(), e.sucursalB, e.cafeId, e.grandeId]);
      expect(r).toMatchObject({ codigo: "42501" });
    });
  });
});
