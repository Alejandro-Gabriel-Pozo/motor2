import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { actualizarActivoGeneroCarta, guardarGeneroCarta } from "../../src/server/actions/carta/generos";

/**
 * Los textos EXACTOS de las dos acciones de géneros de carta, el ORDEN de sus chequeos y CUÁNDO invalidan la carta pública (Hito 5, bloque D, `docs/plan-hito-5-pureza.md`
 * §6.1), ANTES de mudarlas a casos de uso. Los géneros son PROPIOS de cada sucursal (ADR-009, C3): el nombre repetido y el «no se encontró» miran solo la sucursal activa.
 * Verde contra el código de antes de la mudanza y después.
 */
describe("géneros de carta: mensajes, orden de los chequeos y revalidación", () => {
  let centralId: string;
  let norteId: string;

  beforeEach(async () => {
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const revalidaciones = () => {
    const n = vi.mocked(revalidarCartasPublicas).mock.calls.length;
    vi.mocked(revalidarCartasPublicas).mockClear();
    return n;
  };

  it("validaciones: el nombre gana sobre el orden, y los dos antes de leer; no revalida ni escribe", async () => {
    expect(await guardarGeneroCarta({ nombre: "  ", orden: "1,5" })).toEqual({ ok: false, mensaje: "El nombre del género no puede estar vacío." });
    expect(await guardarGeneroCarta({ nombre: "Cervezas", orden: "1,5" })).toEqual({ ok: false, mensaje: "El orden tiene que ser un número entero." });
    expect(revalidaciones()).toBe(0);
    expect(await prisma.generoCarta.count()).toBe(0);
  });

  it("alta: éxito con id y nombre y UNA revalidación; edición: éxito, y «no se encontró» (también si es de OTRA sucursal) sin revalidar", async () => {
    const creado = await guardarGeneroCarta({ nombre: " Cervezas ", orden: 3 });
    expect(creado).toMatchObject({ ok: true, mensaje: 'Género "Cervezas" creado.', nombre: "Cervezas" });
    const id = (creado as { id: string }).id;
    expect(await prisma.generoCarta.findUniqueOrThrow({ where: { id } })).toMatchObject({ sucursalId: centralId, nombre: "Cervezas", orden: 3, activo: true });
    expect(revalidaciones()).toBe(1);

    expect(await guardarGeneroCarta({ id, nombre: "Cervezas artesanales" })).toEqual({ ok: true, mensaje: 'Género "Cervezas artesanales" guardado.', id, nombre: "Cervezas artesanales" });
    expect(revalidaciones()).toBe(1);

    const ajeno = await prisma.generoCarta.create({ data: { sucursalId: norteId, nombre: "Vinos" } });
    expect(await guardarGeneroCarta({ id: ajeno.id, nombre: "Tintos" })).toEqual({ ok: false, mensaje: "No se encontró el género." });
    expect(await guardarGeneroCarta({ id: "cnoexiste000000000000000", nombre: "Otro" })).toEqual({ ok: false, mensaje: "No se encontró el género." });
    expect(revalidaciones()).toBe(0);
    expect((await prisma.generoCarta.findUniqueOrThrow({ where: { id: ajeno.id } })).nombre).toBe("Vinos");
  });

  it("nombre repetido en la sucursal (sin distinguir mayúsculas), con el nombre YA guardado y ganando sobre «no se encontró»; el de otra sucursal no choca; la edición no choca con sí misma", async () => {
    const gaseosas = await prisma.generoCarta.create({ data: { sucursalId: centralId, nombre: "Gaseosas" } });
    await prisma.generoCarta.create({ data: { sucursalId: norteId, nombre: "Vinos" } });
    expect(await guardarGeneroCarta({ nombre: "GASEOSAS" })).toEqual({ ok: false, mensaje: 'Ya existe el género "Gaseosas".' });
    expect(await guardarGeneroCarta({ id: "cnoexiste000000000000000", nombre: "gaseosas" })).toEqual({ ok: false, mensaje: 'Ya existe el género "Gaseosas".' });
    expect(revalidaciones()).toBe(0);
    expect(await guardarGeneroCarta({ nombre: "vinos" })).toMatchObject({ ok: true, mensaje: 'Género "vinos" creado.' });
    expect(revalidaciones()).toBe(1);
    expect(await guardarGeneroCarta({ id: gaseosas.id, nombre: "GASEOSAS" })).toMatchObject({ ok: true, mensaje: 'Género "GASEOSAS" guardado.' });
    expect(revalidaciones()).toBe(1);
  });

  it("activar y desactivar: «no se encontró» (también de otra sucursal) sin revalidar; éxito con el nombre y UNA revalidación; la fila no se borra", async () => {
    const gaseosas = await prisma.generoCarta.create({ data: { sucursalId: centralId, nombre: "Gaseosas" } });
    const ajeno = await prisma.generoCarta.create({ data: { sucursalId: norteId, nombre: "Vinos" } });
    expect(await actualizarActivoGeneroCarta("cnoexiste000000000000000", false)).toEqual({ ok: false, mensaje: "No se encontró el género." });
    expect(await actualizarActivoGeneroCarta(ajeno.id, false)).toEqual({ ok: false, mensaje: "No se encontró el género." });
    expect(revalidaciones()).toBe(0);
    expect(await actualizarActivoGeneroCarta(gaseosas.id, false)).toEqual({ ok: true, mensaje: 'Género "Gaseosas" desactivado.' });
    expect(revalidaciones()).toBe(1);
    expect((await prisma.generoCarta.findUniqueOrThrow({ where: { id: gaseosas.id } })).activo).toBe(false);
    expect(await actualizarActivoGeneroCarta(gaseosas.id, true)).toEqual({ ok: true, mensaje: 'Género "Gaseosas" activado.' });
    expect(revalidaciones()).toBe(1);
    expect((await prisma.generoCarta.findUniqueOrThrow({ where: { id: ajeno.id } })).activo).toBe(true);
  });
});
