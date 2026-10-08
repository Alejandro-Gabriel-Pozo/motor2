import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import {
  agregarSucursalAlPortal,
  guardarSucursalPublica,
  moverSucursalEnMapa,
  quitarSucursalDelPortal,
  type DatosSucursalPublica,
} from "../../src/server/actions/carta/registro-publico";

/**
 * Los textos EXACTOS de las cuatro acciones del registro público del portal, el ORDEN de sus chequeos (el id antes de leer; la posición de `moverSucursalEnMapa` DESPUÉS
 * de leer la fila) y CUÁNDO invalidan la carta pública (Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1), ANTES de mudarlas a casos de uso.
 * `acciones-registro-publico.test.ts` cubre los caminos principales, pero no qué gana cuando dos chequeos fallan a la vez, ni el texto de cada rechazo, ni cuántas veces se
 * revalida. Verde contra el código de antes de la mudanza y después.
 */
const datos = (p: Partial<DatosSucursalPublica> = {}): DatosSucursalPublica => ({ slug: "central", publicada: false, ...p });

describe("registro público del portal: mensajes, orden de los chequeos y revalidación", () => {
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

  it("un id que no es texto (vacío o de otro tipo) se rechaza en las cuatro ANTES de leer, sin revalidar", async () => {
    const roto = undefined as unknown as string;
    for (const id of ["", roto, 7 as unknown as string]) {
      expect(await agregarSucursalAlPortal(id)).toEqual({ ok: false, mensaje: "Sucursal inválida." });
      expect(await guardarSucursalPublica(id, datos())).toEqual({ ok: false, mensaje: "Sucursal inválida." });
      expect(await quitarSucursalDelPortal(id)).toEqual({ ok: false, mensaje: "Sucursal inválida." });
      expect(await moverSucursalEnMapa(id, 1, 1)).toEqual({ ok: false, mensaje: "Sucursal inválida." });
    }
    expect(revalidaciones()).toBe(0);
  });

  describe("agregar", () => {
    it("el orden: sucursal inexistente, ya está en el portal; el éxito da el slug y revalida UNA vez, los rechazos ninguna", async () => {
      expect(await agregarSucursalAlPortal("cnoexiste000000000000000")).toEqual({ ok: false, mensaje: "No se encontró la sucursal." });
      expect(revalidaciones()).toBe(0);
      expect(await agregarSucursalAlPortal(centralId)).toEqual({ ok: true, mensaje: '"Central" agregada al portal con el slug central (sin publicar todavía).' });
      expect(revalidaciones()).toBe(1);
      expect(await agregarSucursalAlPortal(centralId)).toEqual({ ok: false, mensaje: '"Central" ya está en el portal (slug central).' });
      expect(revalidaciones()).toBe(0);
      expect(await prisma.sucursalPublica.count()).toBe(1);
    });

    it("el slug se desambigua contra TODOS los ocupados de la empresa (-2, -3…) y queda sin publicar", async () => {
      const otras = [];
      for (const nombre of ["Villa Sur", "Villa sur", "VILLA SUR"]) otras.push((await prisma.sucursal.create({ data: { nombre } })).id);
      expect((await agregarSucursalAlPortal(centralId)).mensaje).toBe('"Central" agregada al portal con el slug central (sin publicar todavía).');
      expect((await agregarSucursalAlPortal(otras[0])).mensaje).toBe('"Villa Sur" agregada al portal con el slug villa-sur (sin publicar todavía).');
      expect((await agregarSucursalAlPortal(otras[1])).mensaje).toBe('"Villa sur" agregada al portal con el slug villa-sur-2 (sin publicar todavía).');
      expect((await agregarSucursalAlPortal(otras[2])).mensaje).toBe('"VILLA SUR" agregada al portal con el slug villa-sur-3 (sin publicar todavía).');
      expect((await prisma.sucursalPublica.findMany({ select: { publicada: true } })).every((f) => f.publicada === false)).toBe(true);
    });
  });

  describe("guardar", () => {
    it("datos que no son un objeto o sin `publicada` booleana → «Datos inválidos.», ANTES de validar nada y sin leer", async () => {
      expect(await guardarSucursalPublica(centralId, null as unknown as DatosSucursalPublica)).toEqual({ ok: false, mensaje: "Datos inválidos." });
      expect(await guardarSucursalPublica(centralId, "x" as unknown as DatosSucursalPublica)).toEqual({ ok: false, mensaje: "Datos inválidos." });
      expect(await guardarSucursalPublica(centralId, { slug: "" } as unknown as DatosSucursalPublica)).toEqual({ ok: false, mensaje: "Datos inválidos." });
      expect(await guardarSucursalPublica(centralId, { slug: "", publicada: "si" } as unknown as DatosSucursalPublica)).toEqual({ ok: false, mensaje: "Datos inválidos." });
      expect(revalidaciones()).toBe(0);
    });

    it("cada validación en su orden (slug, etiqueta, subtítulo, posición, orden), todas ANTES de leer; ninguna escribe ni revalida", async () => {
      const malos = {
        slug: "",
        etiqueta: "x".repeat(81),
        subtituloPortal: "x".repeat(201),
        posX: 10,
        posY: 10,
        orden: "1.5",
      };
      expect(await guardarSucursalPublica(centralId, datos(malos))).toEqual({ ok: false, mensaje: "El slug no puede estar vacío." });
      expect(await guardarSucursalPublica(centralId, datos({ ...malos, slug: "Con Espacios" }))).toEqual({
        ok: false,
        mensaje: "El slug solo puede tener letras minúsculas sin tilde, números y guiones sueltos entre medio (ej: villa-la-angostura).",
      });
      expect(await guardarSucursalPublica(centralId, datos({ ...malos, slug: "ok" }))).toEqual({ ok: false, mensaje: "La etiqueta no puede superar los 80 caracteres." });
      expect(await guardarSucursalPublica(centralId, datos({ ...malos, slug: "ok", etiqueta: null }))).toEqual({ ok: false, mensaje: "El subtítulo no puede superar los 200 caracteres." });
      expect(await guardarSucursalPublica(centralId, datos({ ...malos, slug: "ok", etiqueta: null, subtituloPortal: null }))).toEqual({
        ok: false,
        mensaje: "La posición en el mapa necesita x, y y ancho juntos (o ninguno de los tres).",
      });
      expect(await guardarSucursalPublica(centralId, datos({ slug: "ok", posX: 150, posY: 10, posW: 5 }))).toEqual({
        ok: false,
        mensaje: "La posición x tiene que estar entre 0 y 100 (es un porcentaje del mapa).",
      });
      expect(await guardarSucursalPublica(centralId, datos({ slug: "ok", orden: "1.5" }))).toEqual({ ok: false, mensaje: "El orden tiene que ser un número entero." });
      expect(revalidaciones()).toBe(0);
      expect(await prisma.sucursalPublica.count()).toBe(0);
    });

    it("después de leer: «no está en el portal» gana sobre el slug repetido; el slug repetido nombra a la otra sucursal", async () => {
      const norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
      await agregarSucursalAlPortal(centralId);
      revalidaciones();
      expect(await guardarSucursalPublica(norte, datos({ slug: "central" }))).toEqual({ ok: false, mensaje: "Esta sucursal no está en el portal: agregala primero." });
      await agregarSucursalAlPortal(norte);
      revalidaciones();
      expect(await guardarSucursalPublica(norte, datos({ slug: "CENTRAL" }))).toEqual({ ok: false, mensaje: 'El slug central ya lo usa "Central".' });
      expect(revalidaciones()).toBe(0);
    });

    it("el éxito dice guardada y publicada o sin publicar (con el slug en minúscula) y revalida UNA vez", async () => {
      await agregarSucursalAlPortal(centralId);
      revalidaciones();
      expect(await guardarSucursalPublica(centralId, datos({ slug: "Centro", etiqueta: "  Casa  ", publicada: true }))).toEqual({ ok: true, mensaje: 'Portal: "Central" guardada y publicada.' });
      expect(revalidaciones()).toBe(1);
      expect(await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } })).toMatchObject({ slug: "centro", etiqueta: "Casa", publicada: true });
      expect(await guardarSucursalPublica(centralId, datos({ slug: "centro", posX: "10,5", posY: 20, posW: 30, orden: "3" }))).toEqual({ ok: true, mensaje: 'Portal: "Central" guardada (sin publicar).' });
      expect(revalidaciones()).toBe(1);
      expect(await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } })).toMatchObject({ publicada: false, orden: 3 });
    });
  });

  describe("quitar", () => {
    it("«no está en el portal» sin revalidar; el éxito nombra la sucursal y su slug, borra solo esa fila y revalida UNA vez", async () => {
      const norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
      await agregarSucursalAlPortal(centralId);
      await agregarSucursalAlPortal(norte);
      revalidaciones();
      expect(await quitarSucursalDelPortal("cnoexiste000000000000000")).toEqual({ ok: false, mensaje: "Esta sucursal no está en el portal." });
      expect(revalidaciones()).toBe(0);
      expect(await quitarSucursalDelPortal(norte)).toEqual({ ok: true, mensaje: '"Norte" quitada del portal (slug norte).' });
      expect(revalidaciones()).toBe(1);
      expect((await prisma.sucursalPublica.findMany({ select: { sucursalId: true } })).map((f) => f.sucursalId)).toEqual([centralId]);
    });
  });

  describe("mover en el mapa", () => {
    const ubicar = async () => {
      await agregarSucursalAlPortal(centralId);
      revalidaciones();
    };

    it("la posición se valida DESPUÉS de leer: «no está en el portal» y «sin posición» ganan sobre un x roto", async () => {
      expect(await moverSucursalEnMapa(centralId, 500, 1)).toEqual({ ok: false, mensaje: "Esta sucursal no está en el portal." });
      expect(revalidaciones()).toBe(0);
      await ubicar();
      expect(await moverSucursalEnMapa(centralId, 500, 1)).toEqual({
        ok: false,
        mensaje: "Esta sucursal todavía no tiene posición en el mapa: cargala con los números de su formulario.",
      });
      expect(revalidaciones()).toBe(0);
    });

    it("con posición completa: un x fuera de rango o un valor que no es número se rechaza; el éxito da los porcentajes redondeados y revalida UNA vez", async () => {
      await ubicar();
      await prisma.sucursalPublica.updateMany({ where: { sucursalId: centralId }, data: { posX: 10, posY: 10, posW: 20, posH: 8 } });
      expect(await moverSucursalEnMapa(centralId, 101, 1)).toEqual({ ok: false, mensaje: "La posición x tiene que estar entre 0 y 100 (es un porcentaje del mapa)." });
      expect(await moverSucursalEnMapa(centralId, 1, Number.NaN)).toEqual({ ok: false, mensaje: "La posición y no es un número válido." });
      expect(revalidaciones()).toBe(0);
      expect(await moverSucursalEnMapa(centralId, 12.345, 40)).toEqual({ ok: true, mensaje: '"Central" movida a 12.35% / 40%.' });
      expect(revalidaciones()).toBe(1);
      const fila = await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } });
      expect([Number(fila.posX), Number(fila.posY), Number(fila.posW), Number(fila.posH)]).toEqual([12.35, 40, 20, 8]);
    });
  });
});
