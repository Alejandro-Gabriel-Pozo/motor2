import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarTemaCarta } from "../../src/server/actions/carta/tema";
import { CLAVES_TEMA_V1, type DefinicionClaveTema } from "../../src/core/carta/tema";

/**
 * Server Actions del tema de la carta (docs/plan-tema-carta-2026-09-24.md, M8): permiso `carta`, la inyección rechazada en cada
 * tipo peligroso sin escribir nada, un guardado completo, las precio_* ignoradas, las normalizaciones, varios errores juntos, el
 * upsert idempotente, y que guardar aplica el tema.
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
    case "enum":
      // `marca_derivada` es el único enum sin default («nace cerrado»): su único valor es «si».
      return d.opciones[0];
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

  it("guarda las 65 claves válidas y queda aplicado (guardar = aplicar)", async () => {
    expect(Object.keys(TODAS_VALIDAS)).toHaveLength(65);
    const r = await guardarTemaCarta(centralId, TODAS_VALIDAS);
    expect(r).toEqual({ ok: true, mensaje: 'Tema de "Central" guardado (65 valores cargados; el resto usa el default de la carta). Está aplicado: la carta toma los cambios en hasta 5 minutos.' });
    const fila = await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: centralId } });
    expect(fila.aplicarEnCarta).toBe(true);
    expect(Object.keys(fila.valores as object)).toHaveLength(65);
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

  it("guardar para una sucursal inexistente → error", async () => {
    expect(await guardarTemaCarta("no-existe", { color_marca: "red" })).toEqual({ ok: false, mensaje: "No se encontró la sucursal." });
  });

  it("con `carta_tema` en esta sucursal no se puede guardar el tema de otra (contexto sucursal)", async () => {
    const otraId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    await prisma.temaCartaSucursal.create({ data: { sucursalId: otraId, valores: { color_marca: "red" } } });
    const antes = await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: otraId } });

    expect(await guardarTemaCarta(otraId, { color_marca: "blue" })).toEqual({ ok: false, mensaje: "No se encontró la sucursal." });
    expect(await prisma.temaCartaSucursal.findMany()).toEqual([antes]);
  });

  it("sin el permiso `carta_tema` (el operador arranca sin él) la acción no escribe", async () => {
    await guardarTemaCarta(centralId, { color_marca: "red" });
    const antes = await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: centralId } });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: centralId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

    const r = await guardarTemaCarta(centralId, { color_marca: "blue" });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(await prisma.temaCartaSucursal.findMany()).toEqual([antes]);
  });

  describe("modo marca: `marca_derivada = «si»` exige una marca que se lea (M1, M2 y M3) o se rechaza sin escribir", () => {
    const COLORES_SUELTOS = { color_fondo_dia: "#181818", color_item_nombre: "#ffffff", hero_ink: "#ffffff" };

    it("una marca válida se guarda con el marcador, junto a los colores sueltos (que no se pierden)", async () => {
      const r = await guardarTemaCarta(centralId, { ...COLORES_SUELTOS, color_marca: "#5c57a2", marca_derivada: "si" });
      expect(r.ok).toBe(true);
      expect(await guardado()).toEqual({ ...COLORES_SUELTOS, color_marca: "#5c57a2", marca_derivada: "si" });
    });

    it.each([
      ["#ffcb69", "casi no se distingue del fondo"],
      ["#96bbbb", "casi no se distingue del fondo"],
      ["#797d62", "no se lee bien"],
      ["#d32f2f", "no se lee bien"],
    ])("la marca %s se rechaza con un mensaje que dice qué hacer, sin escribir nada", async (marca, motivo) => {
      await guardarTemaCarta(centralId, { color_marca: "#8b4513" });
      const r = await guardarTemaCarta(centralId, { ...COLORES_SUELTOS, color_marca: marca, marca_derivada: "si" });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("Color de marca: ");
      expect(r.mensaje).toContain(motivo);
      expect(r.mensaje).toMatch(/Elegí uno más/);
      expect(await guardado()).toEqual({ color_marca: "#8b4513" });
    });

    it.each(["", "#5C57A2", "#fff", "red", "rgb(92, 87, 162)", "oklch(0.5 0.1 30)"])("con el marcador, una marca %j (no #rrggbb en minúsculas) se rechaza sin escribir", async (marca) => {
      const r = await guardarTemaCarta(centralId, { color_marca: marca, marca_derivada: "si" });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("Color de marca: ");
      expect(await prisma.temaCartaSucursal.count()).toBe(0);
    });

    it("sin el marcador, el guardado de siempre no cambia: una marca de bajo contraste o en cualquier formato se acepta", async () => {
      expect((await guardarTemaCarta(centralId, { color_marca: "#ffcb69" })).ok).toBe(true);
      expect((await guardarTemaCarta(centralId, { color_marca: "rgb(255, 203, 105)" })).ok).toBe(true);
      expect((await guardarTemaCarta(centralId, { color_marca: "red", marca_derivada: "" })).ok).toBe(true);
    });

    it("volver a mis colores anteriores: guardar sin el marcador deja los colores sueltos tal cual", async () => {
      await guardarTemaCarta(centralId, { ...COLORES_SUELTOS, color_marca: "#5c57a2", marca_derivada: "si" });
      const r = await guardarTemaCarta(centralId, { ...COLORES_SUELTOS, color_marca: "#5c57a2", marca_derivada: "" });
      expect(r.ok).toBe(true);
      expect(await guardado()).toEqual({ ...COLORES_SUELTOS, color_marca: "#5c57a2" });
    });

    it("idempotente: pasar dos veces a la misma marca deja una fila con los mismos valores; a la vez (carrera) también", async () => {
      const valores = { ...COLORES_SUELTOS, color_marca: "#5c57a2", marca_derivada: "si" };
      expect((await guardarTemaCarta(centralId, valores)).ok).toBe(true);
      expect((await guardarTemaCarta(centralId, valores)).ok).toBe(true);
      const dos = await Promise.all([guardarTemaCarta(centralId, valores), guardarTemaCarta(centralId, valores)]);
      expect(dos.map((r) => r.ok)).toEqual([true, true]);
      expect(await prisma.temaCartaSucursal.count()).toBe(1);
      expect(await guardado()).toEqual(valores);
    });

    it("ida y vuelta: pasar a la marca y volver deja `valores` igual que antes (salvo el marcador, que se va), con las claves viejas intactas", async () => {
      const antes = { ...COLORES_SUELTOS, color_marca: "#5c57a2" };
      await guardarTemaCarta(centralId, antes);
      const valoresAntes = JSON.stringify(await guardado());
      await guardarTemaCarta(centralId, { ...antes, marca_derivada: "si" });
      expect(await guardado()).toEqual({ ...antes, marca_derivada: "si" });
      await guardarTemaCarta(centralId, { ...antes, marca_derivada: "" });
      expect(JSON.stringify(await guardado())).toBe(valoresAntes);
    });

    it("carrera con valores distintos (pasar y volver a la vez): gana uno de los dos, nunca un estado inválido ni una fila de más", async () => {
      const marcada = { ...COLORES_SUELTOS, color_marca: "#5c57a2", marca_derivada: "si" };
      const clasica = { ...COLORES_SUELTOS, color_marca: "#5c57a2", marca_derivada: "" };
      await Promise.all([guardarTemaCarta(centralId, marcada), guardarTemaCarta(centralId, clasica)]);
      expect(await prisma.temaCartaSucursal.count()).toBe(1);
      const valores = (await guardado()) as Record<string, string>;
      expect([JSON.stringify(marcada), JSON.stringify(clasica)].map((j) => JSON.parse(j)).some((c) => JSON.stringify(Object.entries(c).filter(([, v]) => v !== "").sort()) === JSON.stringify(Object.entries(valores).sort()))).toBe(true);
    });

    it("aislamiento: con permiso en Central no se puede pasar a marca la carta de una sucursal en la que no se tiene membresía", async () => {
      const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
      const r = await guardarTemaCarta(otra.id, { color_marca: "#5c57a2", marca_derivada: "si" });
      expect(r.ok).toBe(false);
      expect(await prisma.temaCartaSucursal.count({ where: { sucursalId: otra.id } })).toBe(0);
    });

    it("sin el permiso `carta_tema` no se puede pasar a marca (el operador arranca sin él)", async () => {
      const operador = await crearUsuarioConMembresia({ email: "operador2@test.com", sucursalId: centralId, rolId: operadorRolId });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
      const r = await guardarTemaCarta(centralId, { color_marca: "#5c57a2", marca_derivada: "si" });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      expect(await prisma.temaCartaSucursal.count()).toBe(0);
    });
  });
});
