import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { actualizarActivaSeccionCarta, guardarSeccionCarta } from "../../src/server/actions/carta/secciones";

/**
 * Los textos EXACTOS de las dos acciones de secciones de carta, el ORDEN de sus chequeos y CUÁNDO invalidan la carta pública (Hito 5, bloque D, `docs/plan-hito-5-pureza.md`
 * §6.1), ANTES de mudarlas a casos de uso. `acciones-carta.test.ts` cubre los caminos felices, pero no los textos de cada rechazo, ni qué gana cuando dos chequeos
 * fallan a la vez, ni cuántas veces se revalida. Verde contra el código de antes de la mudanza y después.
 */
describe("secciones de carta: mensajes, orden de los chequeos y revalidación", () => {
  beforeEach(async () => {
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const revalidaciones = () => {
    const n = vi.mocked(revalidarCartasPublicas).mock.calls.length;
    vi.mocked(revalidarCartasPublicas).mockClear();
    return n;
  };

  it("alta: cada validación en su orden (nombre, título, descripción, imagen, orden), sin leer ni revalidar", async () => {
    const largo = "x".repeat(121);
    expect(await guardarSeccionCarta({ nombre: " ", titulo: largo, orden: "1,5" })).toEqual({ ok: false, mensaje: "El nombre de la sección de carta no puede estar vacío." });
    expect(await guardarSeccionCarta({ nombre: "Platos", titulo: largo, descripcion: "d".repeat(501), imagenUrl: "http://x", orden: "1,5" })).toEqual({ ok: false, mensaje: "El título no puede superar los 120 caracteres." });
    expect(await guardarSeccionCarta({ nombre: "Platos", descripcion: "d".repeat(501), imagenUrl: "http://x", orden: "1,5" })).toEqual({ ok: false, mensaje: "La descripción no puede superar los 500 caracteres." });
    expect(await guardarSeccionCarta({ nombre: "Platos", imagenUrl: "http://x", orden: "1,5" })).toEqual({
      ok: false,
      mensaje: "La URL de la imagen tiene que empezar con https:// y no puede tener espacios, comillas ni paréntesis.",
    });
    expect(await guardarSeccionCarta({ nombre: "Platos", orden: "1,5" })).toEqual({ ok: false, mensaje: "El orden tiene que ser un número entero." });
    expect(revalidaciones()).toBe(0);
    expect(await prisma.seccionCarta.count()).toBe(0);
  });

  it("alta: éxito con id y nombre; edición: éxito y «no se encontró»; cada éxito revalida UNA vez y los rechazos ninguna", async () => {
    const creada = await guardarSeccionCarta({ nombre: "  Platos ", titulo: "Los platos", orden: 2 });
    expect(creada).toMatchObject({ ok: true, mensaje: 'Sección de carta "Platos" creada.', nombre: "Platos" });
    const id = (creada as { id: string }).id;
    expect(await prisma.seccionCarta.findUniqueOrThrow({ where: { id } })).toMatchObject({ nombre: "Platos", titulo: "Los platos", orden: 2, activa: true });
    expect(revalidaciones()).toBe(1);

    expect(await guardarSeccionCarta({ id, nombre: "Platos principales" })).toEqual({ ok: true, mensaje: 'Sección de carta "Platos principales" guardada.', id, nombre: "Platos principales" });
    expect(revalidaciones()).toBe(1);

    expect(await guardarSeccionCarta({ id: "cnoexiste000000000000000", nombre: "Otra" })).toEqual({ ok: false, mensaje: "No se encontró la sección de carta." });
    expect(revalidaciones()).toBe(0);
  });

  it("nombre repetido (sin distinguir mayúsculas), con el nombre YA guardado; editar la misma sección con su propio nombre no choca; y el repetido gana sobre «no se encontró»", async () => {
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
    expect(await guardarSeccionCarta({ nombre: "PLATOS" })).toEqual({ ok: false, mensaje: 'Ya existe la sección de carta "Platos".' });
    expect(await guardarSeccionCarta({ id: "cnoexiste000000000000000", nombre: "platos" })).toEqual({ ok: false, mensaje: 'Ya existe la sección de carta "Platos".' });
    const otra = await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } });
    expect(await guardarSeccionCarta({ id: otra.id, nombre: "platos" })).toEqual({ ok: false, mensaje: 'Ya existe la sección de carta "Platos".' });
    expect(revalidaciones()).toBe(0);
    expect(await guardarSeccionCarta({ id: platos.id, nombre: "PLATOS" })).toMatchObject({ ok: true, mensaje: 'Sección de carta "PLATOS" guardada.' });
    expect(revalidaciones()).toBe(1);
  });

  it("activar y desactivar: «no se encontró» sin revalidar; éxito con el nombre y UNA revalidación; la fila no se borra", async () => {
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
    expect(await actualizarActivaSeccionCarta("cnoexiste000000000000000", false)).toEqual({ ok: false, mensaje: "No se encontró la sección de carta." });
    expect(revalidaciones()).toBe(0);
    expect(await actualizarActivaSeccionCarta(platos.id, false)).toEqual({ ok: true, mensaje: 'Sección de carta "Platos" desactivada.' });
    expect(revalidaciones()).toBe(1);
    expect((await prisma.seccionCarta.findUniqueOrThrow({ where: { id: platos.id } })).activa).toBe(false);
    expect(await actualizarActivaSeccionCarta(platos.id, true)).toEqual({ ok: true, mensaje: 'Sección de carta "Platos" activada.' });
    expect(revalidaciones()).toBe(1);
  });
});
