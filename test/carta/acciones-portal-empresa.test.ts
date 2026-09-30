import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin, EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarPortalEmpresa } from "../../src/server/actions/carta/portal-empresa";
import { cargarPortalEmpresaAdmin, entradasVistaPreviaPortal, type SucursalPortalAdmin } from "../../src/core/carta/admin-consulta";
import { CLAVES_PORTAL_V1, type DefinicionClavePortal } from "../../src/core/carta/portal";

/**
 * Server Action de la apariencia del portal (ADR-006): permiso `carta`, la inyección rechazada sin escribir, un guardado completo
 * con las 22 claves, las claves ajenas ignoradas, normalizaciones, varios errores juntos, upsert idempotente y aislamiento por empresa.
 */

function valorDeMuestra(d: DefinicionClavePortal): string {
  if (d.defaultPortal) return d.defaultPortal;
  switch (d.tipo) {
    case "color":
      return "#123456";
    case "texto":
      return "Texto";
    case "imagen":
      return "https://cdn.example.com/x.png";
    default:
      throw new Error(`sin muestra para ${d.clave}`);
  }
}
const TODAS_VALIDAS = Object.fromEntries(CLAVES_PORTAL_V1.map((d) => [d.clave, valorDeMuestra(d as DefinicionClavePortal)]));

describe("Server Action guardarPortalEmpresa", () => {
  let operadorRolId: string;
  let centralId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    operadorRolId = base.operador.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const guardado = async () => (await prisma.portalCartaEmpresa.findFirst())?.valores;

  it("guarda todas las claves válidas del catálogo", async () => {
    expect(Object.keys(TODAS_VALIDAS)).toHaveLength(CLAVES_PORTAL_V1.length);
    const r = await guardarPortalEmpresa(TODAS_VALIDAS);
    expect(r.ok).toBe(true);
    expect(await guardado()).toEqual(TODAS_VALIDAS);
    const fila = await prisma.portalCartaEmpresa.findFirstOrThrow();
    expect(fila.empresaId).toBe(EMPRESA_POR_DEFECTO_ID);
  });

  it("una clave ajena (del tema de la sucursal, precio_*, cualquier otra) se ignora y no se guarda", async () => {
    expect((await guardarPortalEmpresa({ portal_titulo: "Sucursales", color_marca: "red", precio_simbolo: "US$", foo: "bar" })).ok).toBe(true);
    expect(await guardado()).toEqual({ portal_titulo: "Sucursales" });
  });

  it("normaliza: link de markdown → URL, 14 → se guarda 14, vacíos se omiten, espacios se recortan", async () => {
    await guardarPortalEmpresa({
      portal_bg_image_url: "[mapa](https://cdn.example.com/m.png)",
      portal_card_fuente_label: "14",
      portal_bg_proporcion: "16 : 9",
      portal_titulo: "  Nuestras sucursales  ",
      portal_etiqueta: "",
    });
    expect(await guardado()).toEqual({
      portal_bg_image_url: "https://cdn.example.com/m.png",
      portal_card_fuente_label: "14",
      portal_bg_proporcion: "16/9",
      portal_titulo: "Nuestras sucursales",
    });
  });

  it.each([
    ["color", "portal_card_bg", "red;position:fixed"],
    ["color (cierre de regla)", "portal_header_bg", "red}body{display:none"],
    ["imagen (http)", "portal_bg_image_url", "http://x.com/m.png"],
    ["imagen (comillas)", "portal_bg_image_url", 'https://x.com/"m".png'],
    ["imagen (javascript:)", "empresa_logo_url", "javascript:alert(1)"],
    ["fuente", "portal_card_fuente_label", "1rem}*{display:none"],
    ["overlay fuera de rango", "portal_bg_overlay", "2"],
    ["proporción", "portal_bg_proporcion", "calc(1+1)"],
  ])("inyección o valor inválido rechazado (%s) sin escribir nada", async (_tipo, clave, valor) => {
    await guardarPortalEmpresa({ portal_titulo: "Original" });
    const r = await guardarPortalEmpresa({ portal_titulo: "Nuevo", [clave]: valor });
    expect(r.ok).toBe(false);
    expect(await guardado()).toEqual({ portal_titulo: "Original" });
  });

  it("varios errores juntos en un solo mensaje, con la etiqueta de cada campo, sin escribir", async () => {
    const r = await guardarPortalEmpresa({ portal_card_bg: "a;b", portal_bg_overlay: "9", portal_bg_proporcion: "x", empresa_logo_url: "http://x.com/l.png" });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/^Revisá estos campos: /);
    for (const etiqueta of ["Fondo de la tarjeta", "Oscurecer la imagen (0 a 1)", "URL del logo de la empresa"]) expect(r.mensaje).toContain(`${etiqueta}: `);
    expect(await prisma.portalCartaEmpresa.count()).toBe(0);
  });

  it("upsert idempotente: guardar dos veces lo mismo deja UNA fila; guardar reemplaza todo", async () => {
    await guardarPortalEmpresa({ portal_titulo: "A", portal_card_bg: "#fff" });
    await guardarPortalEmpresa({ portal_titulo: "A", portal_card_bg: "#fff" });
    expect(await prisma.portalCartaEmpresa.count()).toBe(1);
    expect(await guardado()).toEqual({ portal_titulo: "A", portal_card_bg: "#fff" });
    await guardarPortalEmpresa({ portal_titulo: "B" });
    expect(await guardado()).toEqual({ portal_titulo: "B" });
  });

  it("guardar todo vacío deja la fila con {} (vuelve a los defaults)", async () => {
    await guardarPortalEmpresa({ portal_titulo: "A" });
    const r = await guardarPortalEmpresa({ portal_titulo: "" });
    expect(r.ok).toBe(true);
    expect(await guardado()).toEqual({});
  });

  it("no toca la apariencia de otra empresa", async () => {
    await prismaAdmin.empresa.create({ data: { id: "norte", nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    await prismaAdmin.portalCartaEmpresa.create({ data: { empresaId: "norte", valores: { portal_titulo: "Norte" } } });
    await guardarPortalEmpresa({ portal_titulo: "Central" });
    expect(await prismaAdmin.portalCartaEmpresa.findMany({ orderBy: { empresaId: "asc" }, select: { empresaId: true, valores: true } })).toEqual([
      { empresaId: EMPRESA_POR_DEFECTO_ID, valores: { portal_titulo: "Central" } },
      { empresaId: "norte", valores: { portal_titulo: "Norte" } },
    ]);
  });

  it("sin el permiso `carta` (el operador arranca sin él) no escribe", async () => {
    await guardarPortalEmpresa({ portal_titulo: "A" });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: centralId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const r = await guardarPortalEmpresa({ portal_titulo: "B" });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(await guardado()).toEqual({ portal_titulo: "A" });
  });
});

describe("cargarPortalEmpresaAdmin", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    await sembrarBase();
  });

  it("sin fila: valores vacíos y sin versión", async () => {
    expect(await cargarPortalEmpresaAdmin(prisma)).toEqual({ valores: {}, actualizadoEn: null });
  });

  it("devuelve lo guardado tal cual, solo claves del catálogo con valor de texto (lo cargado a mano inválido se ve para corregirlo)", async () => {
    await prismaAdmin.portalCartaEmpresa.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, valores: { portal_titulo: "Hola", portal_card_bg: "rojo;mal", color_marca: "#fff", portal_bg_overlay: 5 } } });
    const r = await cargarPortalEmpresaAdmin(prisma);
    expect(r.valores).toEqual({ portal_titulo: "Hola", portal_card_bg: "rojo;mal" });
    expect(r.actualizadoEn).toBeInstanceOf(Date);
  });
});

describe("entradasVistaPreviaPortal", () => {
  const registro = (o: Partial<NonNullable<SucursalPortalAdmin["publica"]>>): NonNullable<SucursalPortalAdmin["publica"]> => ({
    slug: "s",
    etiqueta: null,
    dominio: null,
    subtituloPortal: null,
    posX: null,
    posY: null,
    posW: null,
    posH: null,
    orden: 0,
    publicada: true,
    menuDesdeMotor2: true,
    sheetId: null,
    sheetMenuNombre: "Menu",
    ...o,
  });
  const suc = (id: string, nombre: string, publica: SucursalPortalAdmin["publica"], activo = true): SucursalPortalAdmin => ({ id, nombre, activo, publica, temaDesdeMotor2: false });

  it("solo publicadas y activas, en el orden del portal, con la etiqueta o el nombre y la posición completa o null", () => {
    const r = entradasVistaPreviaPortal([
      suc("1", "Zeta", registro({ slug: "zeta", orden: 2, posX: 10, posY: 20, posW: 30, posH: 5 })),
      suc("2", "Alfa", registro({ slug: "alfa", orden: 2, etiqueta: "Alfa Centro", subtituloPortal: "Frente al lago", posX: 10, posY: 20 })),
      suc("3", "Sin publicar", registro({ slug: "no", publicada: false })),
      suc("4", "Inactiva", registro({ slug: "inactiva" }), false),
      suc("5", "Fuera", null),
      suc("6", "Primera", registro({ slug: "primera", orden: 1 })),
    ]);
    expect(r).toEqual([
      { id: "6", slug: "primera", etiqueta: "Primera", subtitulo: null, posicion: null },
      { id: "2", slug: "alfa", etiqueta: "Alfa Centro", subtitulo: "Frente al lago", posicion: null },
      { id: "1", slug: "zeta", etiqueta: "Zeta", subtitulo: null, posicion: { x: 10, y: 20, w: 30, h: 5 } },
    ]);
  });
});
