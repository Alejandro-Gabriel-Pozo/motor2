import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { agregarSucursalAlPortal, guardarSucursalPublica, quitarSucursalDelPortal, type DatosSucursalPublica } from "../../src/server/actions/carta/registro-publico";

/**
 * Server Actions del registro de tenants del portal (docs/plan-registro-tenants-2026-09-24.md, M6): permiso `carta`, slug
 * derivado del nombre y desambiguado, edición manual del slug, validaciones (dominio, sheetId, posición) y "Quitar del portal"
 * borra la fila. `sheetId` es transición (restaurant-menu-design ya no lee ninguna sheet): no lo exige para publicar.
 */
const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc";

const datos = (p: Partial<DatosSucursalPublica> = {}): DatosSucursalPublica => ({ slug: "central", publicada: false, menuDesdeMotor2: false, ...p });

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
      menuDesdeMotor2: false,
      sheetId: null,
      sheetMenuNombre: "Menu",
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

  it("guardar: edita el slug a mano, dominio normalizado, posición y publica con sheetId; queda en la fila", async () => {
    await agregarSucursalAlPortal(centralId);
    const r = await guardarSucursalPublica(
      centralId,
      datos({
        slug: " Varvarco ",
        etiqueta: "Hostería Varvarco",
        dominio: "https://Carta.Varvarco.com/",
        subtituloPortal: "Frente al río",
        posX: "12,5",
        posY: "40",
        posW: "8",
        posH: "",
        orden: "2",
        publicada: true,
        menuDesdeMotor2: true,
        sheetId: `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=0`,
        sheetMenuNombre: "",
      })
    );
    expect(r).toEqual({ ok: true, mensaje: 'Portal: "Central" guardada y publicada.' });
    const fila = await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } });
    expect(fila).toMatchObject({
      slug: "varvarco",
      etiqueta: "Hostería Varvarco",
      dominio: "carta.varvarco.com",
      subtituloPortal: "Frente al río",
      orden: 2,
      publicada: true,
      menuDesdeMotor2: true,
      sheetId: SHEET,
      sheetMenuNombre: "Menu",
    });
    expect([fila.posX, fila.posY, fila.posW].map(Number)).toEqual([12.5, 40, 8]);
    expect(fila.posH).toBeNull();
  });

  it("guardar rechaza slug o dominio que ya usa otra sucursal, con su nombre", async () => {
    const norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    await agregarSucursalAlPortal(centralId);
    await agregarSucursalAlPortal(norte);
    expect(await guardarSucursalPublica(centralId, datos({ dominio: "carta.x.com" }))).toMatchObject({ ok: true });
    expect(await guardarSucursalPublica(norte, datos({ slug: "central" }))).toEqual({ ok: false, mensaje: 'El slug central ya lo usa "Central".' });
    expect(await guardarSucursalPublica(norte, datos({ slug: "norte", dominio: "CARTA.X.COM" }))).toEqual({ ok: false, mensaje: 'El dominio carta.x.com ya lo usa "Central".' });
    // Guardar la propia fila con su mismo slug y dominio no es un choque.
    expect(await guardarSucursalPublica(centralId, datos({ dominio: "carta.x.com", etiqueta: "Otra etiqueta" }))).toMatchObject({ ok: true });
  });

  it("guardar valida slug, dominio, sheetId, posición, textos y orden sin escribir nada", async () => {
    await agregarSucursalAlPortal(centralId);
    const antes = await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } });
    const malos: Partial<DatosSucursalPublica>[] = [
      { slug: "" },
      { slug: "con espacios" },
      { slug: "piñón" },
      { dominio: "carta.x.com/menu" },
      { dominio: "localhost" },
      { sheetId: "corto" },
      { posX: 10, posY: 10 },
      { posX: 150, posY: 10, posW: 5 },
      { posH: 5 },
      { etiqueta: "x".repeat(81) },
      { subtituloPortal: "x".repeat(201) },
      { orden: "1.5" },
      { sheetMenuNombre: "x".repeat(101) },
    ];
    for (const m of malos) expect((await guardarSucursalPublica(centralId, datos(m))).ok, JSON.stringify(m)).toBe(false);
    expect(await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } })).toEqual(antes);
  });

  it("publicar sin sheetId → ok (restaurant-menu-design ya no lee ninguna sheet)", async () => {
    await agregarSucursalAlPortal(centralId);
    const r = await guardarSucursalPublica(centralId, datos({ publicada: true, menuDesdeMotor2: true }));
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
});
