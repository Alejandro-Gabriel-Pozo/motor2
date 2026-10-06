import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { cambiarAplicacionTema, guardarTemaCarta } from "../../src/server/actions/carta/tema";
import { CLAVES_TEMA_V1, type DefinicionClaveTema } from "../../src/core/carta/tema";

/**
 * Server Actions del tema de la carta (docs/plan-tema-carta-2026-09-24.md, M8): permiso `carta`, la inyección rechazada en cada
 * tipo peligroso sin escribir nada, un guardado completo, las precio_* ignoradas, las normalizaciones, varios errores juntos, el
 * upsert idempotente, y aplicar/desaplicar (nunca un tema vacío ni sin fila; desaplicar conserva los valores).
 */

/** Un valor válido por clave: el default de la carta si lo hay, si no uno de muestra según el tipo. */
function valorDeMuestra(d: DefinicionClaveTema): string {
  if (d.defaultCarta) return d.defaultCarta;
  switch (d.tipo) {
    case "color":
      return "#123456";
    case "colorHeroInk":
      return "claro";
    case "colorHex":
      return "#aabbcc";
    case "texto":
      return "Texto";
    case "imagen":
      return "https://cdn.example.com/x.png";
    case "redSocial":
      return "laparrilla";
    case "telefono":
      return "5492941234567";
    case "urlHttps":
      return "https://maps.app.goo.gl/x";
    default:
      throw new Error(`sin muestra para ${d.clave}`);
  }
}
const TODAS_VALIDAS = Object.fromEntries(CLAVES_TEMA_V1.map((d) => [d.clave, valorDeMuestra(d as DefinicionClaveTema)]));

describe("Server Actions del tema de la carta", () => {
  let centralId: string;
  let operadorRolId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    operadorRolId = base.operador.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const guardado = async () => (await prisma.temaCartaSucursal.findFirst({ where: { sucursalId: centralId } }))?.valores;

  it("guarda las 64 claves válidas en borrador (al crear no aplica)", async () => {
    expect(Object.keys(TODAS_VALIDAS)).toHaveLength(64);
    const r = await guardarTemaCarta(centralId, TODAS_VALIDAS);
    expect(r).toEqual({ ok: true, mensaje: 'Tema de "Central" guardado (64 valores cargados; el resto usa el default de la carta). Es un borrador: la carta usa el estilo por defecto hasta que lo apliques.' });
    const fila = await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: centralId } });
    expect(fila.aplicarEnCarta).toBe(false);
    expect(Object.keys(fila.valores as object)).toHaveLength(64);
    expect(fila.valores).toEqual(TODAS_VALIDAS);
  });

  it("una clave precio_* (o cualquier otra ajena al catálogo) se ignora y no se guarda", async () => {
    expect((await guardarTemaCarta(centralId, { color_marca: "red", precio_simbolo: "US$", precio_locale: "en-US", meta_title: "x", foo: "bar" })).ok).toBe(true);
    expect(await guardado()).toEqual({ color_marca: "red" });
  });

  it("normaliza: 120 → 120px en el alto de desktop, Sí → si, hex de 3 → 6, teléfono → solo dígitos", async () => {
    await guardarTemaCarta(centralId, { carta_banda_alto_desktop: "120", carta_imagen_overlay: "Sí", hero_color_fondo: "#AbC", restaurante_whatsapp: "+54 9 294 123-4567", restaurante_nombre: "  La Parrilla  ", color_item_nombre: "" });
    expect(await guardado()).toEqual({
      carta_banda_alto_desktop: "120px",
      carta_imagen_overlay: "si",
      hero_color_fondo: "#aabbcc",
      restaurante_whatsapp: "5492941234567",
      restaurante_nombre: "La Parrilla",
    });
  });

  it.each([
    ["color", "color_marca", "red;position:fixed"],
    ["color (cierre de regla)", "color_item_precio", "red}body{display:none"],
    ["altoBandaDesktop", "carta_banda_alto_desktop", "1px}*{display:none"],
    ["altoBandaDesktop (<style>)", "carta_banda_alto_desktop", "90px</style><script>alert(1)</script>"],
    ["urlHttps", "restaurante_footer_maps_url", "javascript:alert(1)"],
    ["redSocial", "restaurante_instagram", "javascript:alert(1)"],
    ["redSocial (otro host)", "restaurante_facebook", "https://evil.com/x"],
  ])("inyección rechazada (%s) sin escribir nada", async (_tipo, clave, valor) => {
    await guardarTemaCarta(centralId, { color_marca: "#8b4513" });
    const r = await guardarTemaCarta(centralId, { color_marca: "blue", [clave]: valor });
    expect(r.ok).toBe(false);
    expect(await guardado()).toEqual({ color_marca: "#8b4513" });
  });

  it("varios errores juntos en un solo mensaje (hasta 5), sin escribir", async () => {
    const r = await guardarTemaCarta(centralId, { color_marca: "claro", hero_color_fondo: "oklch(0.5 0.1 30)", carta_imagen_opacidad: "0", restaurante_logo_url: "http://x.com/logo.png" });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/^Revisá estos campos: /);
    for (const etiqueta of ["Color de marca (acento)", "Fondo de la portada (hex #rrggbb)", "Opacidad de la imagen (1 a 100)", "URL del logo"]) expect(r.mensaje).toContain(`${etiqueta}: `);
    expect(await prisma.temaCartaSucursal.count()).toBe(0);
  });

  it("upsert idempotente: guardar dos veces lo mismo deja una fila con los mismos valores; guardar reemplaza todo", async () => {
    await guardarTemaCarta(centralId, { color_marca: "red", restaurante_nombre: "A" });
    await guardarTemaCarta(centralId, { color_marca: "red", restaurante_nombre: "A" });
    expect(await prisma.temaCartaSucursal.count()).toBe(1);
    expect(await guardado()).toEqual({ color_marca: "red", restaurante_nombre: "A" });
    await guardarTemaCarta(centralId, { color_marca: "blue" });
    expect(await guardado()).toEqual({ color_marca: "blue" });
  });

  it("guardar un tema ya aplicado lo mantiene aplicado", async () => {
    await guardarTemaCarta(centralId, { color_marca: "red" });
    await cambiarAplicacionTema(centralId, true);
    const r = await guardarTemaCarta(centralId, { color_marca: "blue" });
    expect(r.mensaje).toMatch(/Está aplicado: la carta toma los cambios en hasta 5 minutos\.$/);
    expect((await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: centralId } })).aplicarEnCarta).toBe(true);
  });

  it("aplicar sin fila o con el tema vacío → error; con valores → aplicado (avisa si no está en el portal)", async () => {
    expect(await cambiarAplicacionTema(centralId, true)).toEqual({ ok: false, mensaje: "Esta sucursal todavía no tiene tema: guardalo primero." });
    await guardarTemaCarta(centralId, {});
    expect(await cambiarAplicacionTema(centralId, true)).toEqual({ ok: false, mensaje: "No se puede aplicar un tema vacío: cargá al menos un valor y guardalo." });
    expect((await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: centralId } })).aplicarEnCarta).toBe(false);

    await guardarTemaCarta(centralId, { color_marca: "red" });
    expect(await cambiarAplicacionTema(centralId, true)).toEqual({ ok: true, mensaje: 'Tema de "Central" aplicado, pero sin efecto hasta agregarla al portal (Portal de sucursales).' });
    expect((await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: centralId } })).aplicarEnCarta).toBe(true);

    await prisma.sucursalPublica.create({ data: { sucursalId: centralId, slug: "central" } });
    expect((await cambiarAplicacionTema(centralId, true)).mensaje).toBe('Tema de "Central" aplicado, pero sin efecto hasta publicarla en el portal.');
    await prisma.sucursalPublica.updateMany({ where: { sucursalId: centralId }, data: { publicada: true } });
    expect((await cambiarAplicacionTema(centralId, true)).mensaje).toBe('Tema de "Central" aplicado: la carta lo toma en hasta 5 minutos.');
  });

  it("un tema con solo valores inválidos cargados a mano cuenta como vacío", async () => {
    await prisma.temaCartaSucursal.create({ data: { sucursalId: centralId, valores: { color_marca: "red;x", precio_simbolo: "US$" } } });
    expect((await cambiarAplicacionTema(centralId, true)).ok).toBe(false);
  });

  it("desaplicar conserva los valores (y la carta deja de tomarlos)", async () => {
    await guardarTemaCarta(centralId, { color_marca: "red", restaurante_nombre: "La Parrilla" });
    await cambiarAplicacionTema(centralId, true);
    expect(await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: centralId } })).toMatchObject({ aplicarEnCarta: true, valores: { color_marca: "red" } });
    expect(await cambiarAplicacionTema(centralId, false)).toEqual({ ok: true, mensaje: 'Tema de "Central" desaplicado: la carta vuelve al estilo por defecto (los valores guardados se conservan).' });
    const fila = await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: centralId } });
    expect(fila.aplicarEnCarta).toBe(false);
    expect(fila.valores).toEqual({ color_marca: "red", restaurante_nombre: "La Parrilla" });
  });

  it("guardar para una sucursal inexistente → error", async () => {
    expect(await guardarTemaCarta("no-existe", { color_marca: "red" })).toEqual({ ok: false, mensaje: "No se encontró la sucursal." });
  });

  it("con `carta_tema` en esta sucursal no se puede guardar ni aplicar el tema de otra (contexto sucursal)", async () => {
    const otraId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    await prisma.temaCartaSucursal.create({ data: { sucursalId: otraId, valores: { color_marca: "red" } } });
    const antes = await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: otraId } });

    const intentos = [await guardarTemaCarta(otraId, { color_marca: "blue" }), await cambiarAplicacionTema(otraId, true), await cambiarAplicacionTema(otraId, false)];
    for (const r of intentos) expect(r).toEqual({ ok: false, mensaje: "No se encontró la sucursal." });
    expect(await prisma.temaCartaSucursal.findMany()).toEqual([antes]);
  });

  it("sin el permiso `carta_tema` (el operador arranca sin él) ninguna acción escribe", async () => {
    await guardarTemaCarta(centralId, { color_marca: "red" });
    const antes = await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: centralId } });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: centralId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

    for (const r of [await guardarTemaCarta(centralId, { color_marca: "blue" }), await cambiarAplicacionTema(centralId, true)]) {
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
    }
    expect(await prisma.temaCartaSucursal.findMany()).toEqual([antes]);
  });
});
