import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { cambiarAplicacionTema, guardarTemaCarta } from "../../src/server/actions/carta/tema";

/**
 * Los textos EXACTOS de las dos acciones del tema de la carta, el ORDEN de sus chequeos (la sucursal activa antes que el formato; el tema inexistente antes que el
 * tema vacío) y CUÁNDO invalidan la carta pública (Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1), ANTES de mudarlas a casos de uso. `acciones-tema.test.ts` cubre
 * los textos de los caminos principales, pero no el singular, ni qué gana cuando dos chequeos fallan a la vez, ni cuántas veces se revalida. Verde contra el código de
 * antes de la mudanza y después.
 */
describe("tema de la carta: mensajes, orden de los chequeos y revalidación", () => {
  let centralId: string;

  beforeEach(async () => {
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const revalidaciones = () => {
    const n = vi.mocked(revalidarCartasPublicas).mock.calls.length;
    vi.mocked(revalidarCartasPublicas).mockClear();
    return n;
  };

  it("guardar: la sucursal activa se chequea ANTES que el formato; el formato inválido no escribe ni revalida", async () => {
    const otraId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    expect(await guardarTemaCarta(otraId, { color_marca: "red;x" })).toEqual({ ok: false, mensaje: "No se encontró la sucursal." });
    expect(await guardarTemaCarta(centralId, { color_marca: "red;x" })).toEqual({ ok: false, mensaje: expect.stringMatching(/^Revisá este campo: Color de marca \(acento\): /) });
    expect(revalidaciones()).toBe(0);
    expect(await prisma.temaCartaSucursal.count()).toBe(0);
  });

  it("guardar: el texto cuenta los valores (uno en singular, ninguno en plural), dice si es borrador o está aplicado y revalida UNA vez por éxito", async () => {
    expect(await guardarTemaCarta(centralId, { color_marca: "red" })).toEqual({
      ok: true,
      mensaje: 'Tema de "Central" guardado (1 valor cargado; el resto usa el default de la carta). Es un borrador: la carta usa el estilo por defecto hasta que lo apliques.',
    });
    expect(revalidaciones()).toBe(1);
    await cambiarAplicacionTema(centralId, true);
    revalidaciones();
    expect(await guardarTemaCarta(centralId, { restaurante_nombre: "", foo: "bar" })).toEqual({
      ok: true,
      mensaje: 'Tema de "Central" guardado (0 valores cargados; el resto usa el default de la carta). Está aplicado: la carta toma los cambios en hasta 5 minutos.',
    });
    expect(revalidaciones()).toBe(1);
  });

  it("aplicar o desaplicar: la sucursal activa gana sobre «todavía no tiene tema», y ninguno de los dos rechazos revalida", async () => {
    const otraId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    expect(await cambiarAplicacionTema(otraId, true)).toEqual({ ok: false, mensaje: "No se encontró la sucursal." });
    expect(await cambiarAplicacionTema(otraId, false)).toEqual({ ok: false, mensaje: "No se encontró la sucursal." });
    expect(await cambiarAplicacionTema(centralId, true)).toEqual({ ok: false, mensaje: "Esta sucursal todavía no tiene tema: guardalo primero." });
    expect(await cambiarAplicacionTema(centralId, false)).toEqual({ ok: false, mensaje: "Esta sucursal todavía no tiene tema: guardalo primero." });
    expect(revalidaciones()).toBe(0);
  });

  it("aplicar: «tema vacío» no revalida ni aplica; desaplicar un tema vacío SÍ se puede (no mira los valores) y revalida", async () => {
    await prisma.temaCartaSucursal.create({ data: { sucursalId: centralId, valores: {} } });
    expect(await cambiarAplicacionTema(centralId, true)).toEqual({ ok: false, mensaje: "No se puede aplicar un tema vacío: cargá al menos un valor y guardalo." });
    expect(revalidaciones()).toBe(0);
    expect((await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: centralId } })).aplicarEnCarta).toBe(false);
    expect(await cambiarAplicacionTema(centralId, false)).toEqual({
      ok: true,
      mensaje: 'Tema de "Central" desaplicado: la carta vuelve al estilo por defecto (los valores guardados se conservan).',
    });
    expect(revalidaciones()).toBe(1);
  });

  it("aplicar: revalida UNA vez en cada éxito, también cuando avisa «sin efecto» (no está en el portal o no está publicada)", async () => {
    await prisma.temaCartaSucursal.create({ data: { sucursalId: centralId, valores: { color_marca: "red" } } });
    expect((await cambiarAplicacionTema(centralId, true)).mensaje).toBe('Tema de "Central" aplicado, pero sin efecto hasta agregarla al portal (Portal de sucursales).');
    expect(revalidaciones()).toBe(1);
    await prisma.sucursalPublica.create({ data: { sucursalId: centralId, slug: "central" } });
    expect((await cambiarAplicacionTema(centralId, true)).mensaje).toBe('Tema de "Central" aplicado, pero sin efecto hasta publicarla en el portal.');
    expect(revalidaciones()).toBe(1);
    await prisma.sucursalPublica.updateMany({ where: { sucursalId: centralId }, data: { publicada: true } });
    expect((await cambiarAplicacionTema(centralId, true)).mensaje).toBe('Tema de "Central" aplicado: la carta lo toma en hasta 5 minutos.');
    expect(revalidaciones()).toBe(1);
  });
});
