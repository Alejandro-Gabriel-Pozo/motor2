import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { activarTodosLosModulos } from "../setup/modulos";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { agregarSucursalAlPortal, guardarSucursalPublica, moverSucursalEnMapa, quitarSucursalDelPortal, type DatosSucursalPublica } from "../../src/server/actions/carta/registro-publico";

/**
 * Server Actions del registro de tenants del portal (docs/plan-registro-tenants-2026-09-24.md, M6): permiso `carta`, slug
 * derivado del nombre y desambiguado, edición manual del slug, validaciones (slug, posición, textos, orden) y "Quitar del portal"
 * borra la fila.
 */
const datos = (p: Partial<DatosSucursalPublica> = {}): DatosSucursalPublica => ({ slug: "central", publicada: false, ...p });

describe("Server Actions del registro público", () => {
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

  it("agregar: crea la fila sin publicar con el slug derivado del nombre", async () => {
    const r = await agregarSucursalAlPortal(centralId);
    expect(r).toEqual({ ok: true, mensaje: '"Central" agregada al portal con el slug central (sin publicar todavía).' });
    expect(await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } })).toMatchObject({
      slug: "central",
      publicada: false,
      etiqueta: null,
    });
    // Dos veces no: ya está.
    expect(await agregarSucursalAlPortal(centralId)).toMatchObject({ ok: false, mensaje: '"Central" ya está en el portal (slug central).' });
    expect(await agregarSucursalAlPortal("no-existe")).toMatchObject({ ok: false, mensaje: "No se encontró la sucursal." });
  });

  it("colisión: 'Villa La Angostura' y 'Villa la Angostura' → villa-la-angostura y villa-la-angostura-2; tildes y ñ fuera", async () => {
    const a = (await prisma.sucursal.create({ data: { nombre: "Villa La Angostura" } })).id;
    const b = (await prisma.sucursal.create({ data: { nombre: "Villa la Angostura" } })).id;
    const c = (await prisma.sucursal.create({ data: { nombre: "Piñón" } })).id;
    for (const id of [a, b, c]) expect((await agregarSucursalAlPortal(id)).ok).toBe(true);
    const slugs = await prisma.sucursalPublica.findMany({ where: { sucursalId: { in: [a, b, c] } }, select: { sucursalId: true, slug: true } });
    expect(Object.fromEntries(slugs.map((s) => [s.sucursalId, s.slug]))).toEqual({ [a]: "villa-la-angostura", [b]: "villa-la-angostura-2", [c]: "pinon" });
  });

  it("renombrar la sucursal después NO cambia el slug guardado", async () => {
    await agregarSucursalAlPortal(centralId);
    await prisma.sucursal.update({ where: { id: centralId }, data: { nombre: "Casa Central" } });
    expect(await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } })).toMatchObject({ slug: "central", etiqueta: null });
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: centralId } })).nombre).toBe("Casa Central");
  });

  it("guardar: edita el slug a mano, posición y publica; queda en la fila", async () => {
    await agregarSucursalAlPortal(centralId);
    const r = await guardarSucursalPublica(
      centralId,
      datos({
        slug: " Varvarco ",
        etiqueta: "Hostería Varvarco",
        subtituloPortal: "Frente al río",
        posX: "12,5",
        posY: "40",
        posW: "8",
        posH: "",
        orden: "2",
        publicada: true,
      })
    );
    expect(r).toEqual({ ok: true, mensaje: 'Portal: "Central" guardada y publicada.' });
    const fila = await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } });
    expect(fila).toMatchObject({
      slug: "varvarco",
      etiqueta: "Hostería Varvarco",
      subtituloPortal: "Frente al río",
      orden: 2,
      publicada: true,
    });
    expect([fila.posX, fila.posY, fila.posW].map(Number)).toEqual([12.5, 40, 8]);
    expect(fila.posH).toBeNull();
  });

  it("guardar rechaza un slug que ya usa otra sucursal, con su nombre", async () => {
    const norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    await agregarSucursalAlPortal(centralId);
    await agregarSucursalAlPortal(norte);
    expect(await guardarSucursalPublica(centralId, datos())).toMatchObject({ ok: true });
    expect(await guardarSucursalPublica(norte, datos({ slug: "central" }))).toEqual({ ok: false, mensaje: 'El slug central ya lo usa "Central".' });
    // Guardar la propia fila con su mismo slug no es un choque.
    expect(await guardarSucursalPublica(centralId, datos({ etiqueta: "Otra etiqueta" }))).toMatchObject({ ok: true });
  });

  it("guardar valida slug, posición, textos y orden sin escribir nada", async () => {
    await agregarSucursalAlPortal(centralId);
    const antes = await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } });
    const malos: Partial<DatosSucursalPublica>[] = [
      { slug: "" },
      { slug: "con espacios" },
      { slug: "piñón" },
      { posX: 10, posY: 10 },
      { posX: 150, posY: 10, posW: 5 },
      { posH: 5 },
      { etiqueta: "x".repeat(81) },
      { subtituloPortal: "x".repeat(201) },
      { orden: "1.5" },
    ];
    for (const m of malos) expect((await guardarSucursalPublica(centralId, datos(m))).ok, JSON.stringify(m)).toBe(false);
    expect(await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } })).toEqual(antes);
  });

  it("publicar → ok", async () => {
    await agregarSucursalAlPortal(centralId);
    const r = await guardarSucursalPublica(centralId, datos({ publicada: true }));
    expect(r).toMatchObject({ ok: true, mensaje: 'Portal: "Central" guardada y publicada.' });
    expect((await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } })).publicada).toBe(true);
  });

  it("guardar una sucursal que no está en el portal → error", async () => {
    expect(await guardarSucursalPublica(centralId, datos())).toEqual({ ok: false, mensaje: "Esta sucursal no está en el portal: agregala primero." });
  });

  it("quitar borra la fila (vuelta atrás) y no toca la sucursal", async () => {
    await agregarSucursalAlPortal(centralId);
    expect(await quitarSucursalDelPortal(centralId)).toEqual({ ok: true, mensaje: '"Central" quitada del portal (slug central).' });
    expect(await prisma.sucursalPublica.count()).toBe(0);
    expect(await prisma.sucursal.findUniqueOrThrow({ where: { id: centralId } })).toMatchObject({ nombre: "Central", activo: true });
    expect(await quitarSucursalDelPortal(centralId)).toEqual({ ok: false, mensaje: "Esta sucursal no está en el portal." });
  });

  it("sin el permiso `carta` (el operador arranca sin él) ninguna acción escribe", async () => {
    await agregarSucursalAlPortal(centralId);
    const antes = await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } });
    const norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: centralId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

    for (const r of [await agregarSucursalAlPortal(norte), await guardarSucursalPublica(centralId, datos({ slug: "otro" })), await quitarSucursalDelPortal(centralId)]) {
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
    }
    expect(await prisma.sucursalPublica.findMany()).toEqual([antes]);
  });

  describe("moverSucursalEnMapa (arrastrar en la vista previa)", () => {
    const ubicar = async () => {
      await agregarSucursalAlPortal(centralId);
      await guardarSucursalPublica(centralId, datos({ posX: "10", posY: "20", posW: "30", posH: "8", etiqueta: "Central", orden: "3" }));
    };
    const fila = () => prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } });

    it("cambia SOLO posX y posY (posW, posH y el resto quedan) y redondea a 2 decimales", async () => {
      await ubicar();
      const antes = await fila();
      const r = await moverSucursalEnMapa(centralId, 55.555, 44.4);
      expect(r.ok).toBe(true);
      const despues = await fila();
      expect(Number(despues.posX)).toBe(55.56);
      expect(Number(despues.posY)).toBe(44.4);
      expect({ ...despues, posX: null, posY: null, actualizadoEn: null }).toEqual({ ...antes, posX: null, posY: null, actualizadoEn: null });
    });

    it("sin posición completa (falta el ancho) → error y no escribe", async () => {
      await agregarSucursalAlPortal(centralId);
      const r = await moverSucursalEnMapa(centralId, 10, 10);
      expect(r).toMatchObject({ ok: false });
      const f = await fila();
      expect([f.posX, f.posY, f.posW]).toEqual([null, null, null]);
    });

    it.each([
      ["x fuera de rango", 101, 10],
      ["x negativa", -1, 10],
      ["y fuera de rango", 10, 100.5],
      ["NaN", Number.NaN, 10],
      ["Infinity", 10, Number.POSITIVE_INFINITY],
    ])("valor inválido (%s) → error y no escribe", async (_n, x, y) => {
      await ubicar();
      const r = await moverSucursalEnMapa(centralId, x, y);
      expect(r.ok).toBe(false);
      const f = await fila();
      expect([Number(f.posX), Number(f.posY)]).toEqual([10, 20]);
    });

    it("sucursal que no existe o que no está en el portal → error", async () => {
      expect(await moverSucursalEnMapa("no-existe", 10, 10)).toEqual({ ok: false, mensaje: "Esta sucursal no está en el portal." });
      expect(await moverSucursalEnMapa(centralId, 10, 10)).toEqual({ ok: false, mensaje: "Esta sucursal no está en el portal." });
    });

    it("no mueve la sucursal de otra empresa (aunque se pase su id)", async () => {
      await prismaAdmin.empresa.create({ data: { id: "norte", nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
      await activarTodosLosModulos("norte");
      const ajena = await prismaAdmin.sucursal.create({ data: { nombre: "Ajena", empresaId: "norte" } });
      await prismaAdmin.sucursalPublica.create({ data: { empresaId: "norte", sucursalId: ajena.id, slug: "ajena", posX: 1, posY: 2, posW: 3 } });
      const r = await moverSucursalEnMapa(ajena.id, 50, 50);
      expect(r.ok).toBe(false);
      const intacta = await prismaAdmin.sucursalPublica.findFirstOrThrow({ where: { sucursalId: ajena.id } });
      expect([Number(intacta.posX), Number(intacta.posY)]).toEqual([1, 2]);
    });

    it("sin el permiso `carta` no escribe", async () => {
      await ubicar();
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: centralId, rolId: operadorRolId });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
      const r = await moverSucursalEnMapa(centralId, 50, 50);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      const f = await fila();
      expect([Number(f.posX), Number(f.posY)]).toEqual([10, 20]);
    });
  });
});
