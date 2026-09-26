import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearSeccion, actualizarActivaSeccion, actualizarRespaldoSeccion, renombrarSeccion, listarSeccionesActivas } from "../../src/server/actions/movimientos/secciones";

describe("Secciones", () => {
  let sucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("crea una sección y la lista entre las activas", async () => {
    const resultado = await crearSeccion("Depósito Central");
    expect(resultado.ok).toBe(true);

    const activas = await listarSeccionesActivas(sucursalId);
    expect(activas.map((s) => s.nombre)).toContain("Depósito Central");
  });

  it("una sección nueva nace sirviendo de respaldo automático en ventas (Seccion.sirveDeRespaldoEnVentas, default de la base)", async () => {
    const resultado = await crearSeccion("Cocina");
    expect(resultado.ok).toBe(true);
    const creada = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: "Cocina" } });
    expect(creada.sirveDeRespaldoEnVentas).toBe(true);
  });

  it("rechaza un nombre duplicado, ignorando mayúsculas/espacios", async () => {
    await crearSeccion("Barra");
    const resultado = await crearSeccion("  barra  ");
    expect(resultado.ok).toBe(false);
  });

  it("desactivar una sección la saca de listarSeccionesActivas sin borrarla", async () => {
    const creada = await crearSeccion("Cocina");
    expect(creada.ok).toBe(true);
    if (!creada.ok) return;

    await actualizarActivaSeccion(creada.id, false);
    const activas = await listarSeccionesActivas(sucursalId);
    expect(activas.map((s) => s.nombre)).not.toContain("Cocina");
  });

  describe("renombrarSeccion (hallazgo de la auditoría: antes solo se podía elegir el nombre al crearla)", () => {
    it("renombra una sección existente", async () => {
      const creada = await crearSeccion("Depósito Viejo");
      expect(creada.ok).toBe(true);
      if (!creada.ok) return;

      const resultado = await renombrarSeccion(creada.id, "Depósito Nuevo");
      expect(resultado.ok, resultado.mensaje).toBe(true);
      expect((await prisma.seccion.findUniqueOrThrow({ where: { id: creada.id } })).nombre).toBe("Depósito Nuevo");
    });

    it("rechaza renombrar a un nombre que ya usa otra sección de la misma sucursal, ignorando mayúsculas", async () => {
      await crearSeccion("Barra");
      const creada = await crearSeccion("Cocina");
      if (!creada.ok) return;

      const resultado = await renombrarSeccion(creada.id, "barra");
      expect(resultado.ok).toBe(false);
      expect((await prisma.seccion.findUniqueOrThrow({ where: { id: creada.id } })).nombre).toBe("Cocina");
    });

    it("el Kardex ya escrito con esa sección sigue siendo válido tras renombrarla (referencia por FK, no por texto)", async () => {
      const creada = await crearSeccion("Depósito A");
      if (!creada.ok) return;
      const seccionId = creada.id;

      await renombrarSeccion(seccionId, "Depósito B");
      const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
      expect(seccion.id).toBe(seccionId);
      expect(seccion.nombre).toBe("Depósito B");
    });
  });
  describe("respaldo automático en ventas (actualizarRespaldoSeccion)", () => {
    it("apaga y vuelve a prender el flag de una sección propia", async () => {
      await crearSeccion("Cocina");
      const cocina = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: "Cocina" } });
      expect(await actualizarRespaldoSeccion(cocina.id, false)).toEqual({ ok: true, mensaje: 'Sección "Cocina" ya no sirve de respaldo automático en ventas.' });
      expect((await prisma.seccion.findUniqueOrThrow({ where: { id: cocina.id } })).sirveDeRespaldoEnVentas).toBe(false);
      expect(await actualizarRespaldoSeccion(cocina.id, true)).toEqual({ ok: true, mensaje: 'Sección "Cocina" ahora sirve de respaldo automático en ventas.' });
      expect((await prisma.seccion.findUniqueOrThrow({ where: { id: cocina.id } })).sirveDeRespaldoEnVentas).toBe(true);
    });

    it("rechaza una sección de otra sucursal sin tocarla", async () => {
      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const ajena = await prisma.seccion.create({ data: { sucursalId: norte.id, nombre: "Barra Norte" } });
      expect(await actualizarRespaldoSeccion(ajena.id, false)).toEqual({ ok: false, mensaje: "No se encontró la sección." });
      expect((await prisma.seccion.findUniqueOrThrow({ where: { id: ajena.id } })).sirveDeRespaldoEnVentas).toBe(true);
    });

    it("sin permiso de secciones no escribe", async () => {
      await crearSeccion("Cocina");
      const cocina = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: "Cocina" } });
      const rol = await prisma.rol.create({ data: { nombre: "sin-secciones" } });
      const usuario = await crearUsuarioConMembresia({ email: "sin@test.com", sucursalId, rolId: rol.id });
      await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });
      const r = await actualizarRespaldoSeccion(cocina.id, false);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain('"secciones"');
      expect((await prisma.seccion.findUniqueOrThrow({ where: { id: cocina.id } })).sirveDeRespaldoEnVentas).toBe(true);
    });
  });
});
