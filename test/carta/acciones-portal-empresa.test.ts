import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin, EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { activarTodosLosModulos } from "../setup/modulos";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarPortalEmpresa } from "../../src/server/actions/carta/portal-empresa";
import { type SucursalPortalAdmin } from "../../src/core/carta/public";
import { cargarPortalEmpresaAdmin } from "../../src/server/consultas/carta/admin";
import { entradasVistaPreviaPortal } from "../../src/core/carta/public";
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
    case "enum":
      // `portal_marca_derivada` es el único enum sin default («nace cerrado»): su único valor es «si».
      return d.opciones[0];
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

  it("nombre público de la empresa: se guarda recortado y en NFC", async () => {
    expect((await guardarPortalEmpresa({ portal_nombre_publico: "  Cafe\u0301 Sur  " })).ok).toBe(true);
    expect(await guardado()).toEqual({ portal_nombre_publico: "Caf\u00e9 Sur" });
  });

  it.each([
    ["con < y >", "Empresa <B>"],
    ["con un invisible", "Empresa\u200bB"],
    ["con un salto de línea", "Empresa\nB"],
    ["de más de 60 caracteres", "a".repeat(61)],
  ])("nombre público de la empresa %s: rechazado, con el nombre del campo, sin escribir nada", async (_motivo, nombre) => {
    await guardarPortalEmpresa({ portal_nombre_publico: "Empresa B" });
    const r = await guardarPortalEmpresa({ portal_titulo: "Nuevo", portal_nombre_publico: nombre });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("Nombre público de la empresa");
    expect(await guardado()).toEqual({ portal_nombre_publico: "Empresa B" });
  });

  it("nombre público de la empresa: quitarlo (vacío) lo deja sin cargar, y repetir el mismo guardado deja UNA fila", async () => {
    await guardarPortalEmpresa({ portal_nombre_publico: "Empresa B" });
    await guardarPortalEmpresa({ portal_nombre_publico: "Empresa B" });
    expect(await prisma.portalCartaEmpresa.count()).toBe(1);
    await guardarPortalEmpresa({ portal_nombre_publico: "" });
    expect(await guardado()).toEqual({});
  });

  it("nombre público de la empresa: dos administradores guardan a la vez nombres distintos: gana uno entero, una sola fila, sin error", async () => {
    const resultados = await Promise.all([guardarPortalEmpresa({ portal_nombre_publico: "Empresa B" }), guardarPortalEmpresa({ portal_nombre_publico: "Empresa C" })]);
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(await prisma.portalCartaEmpresa.count()).toBe(1);
    expect(["Empresa B", "Empresa C"]).toContain(((await guardado()) as { portal_nombre_publico: string }).portal_nombre_publico);
  });

  it("nombre público de la empresa: cada empresa guarda el suyo y no toca el de la otra", async () => {
    await prismaAdmin.empresa.create({ data: { id: "norte", nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    await activarTodosLosModulos("norte");
    await prismaAdmin.portalCartaEmpresa.create({ data: { empresaId: "norte", valores: { portal_nombre_publico: "Empresa C" } } });
    await guardarPortalEmpresa({ portal_nombre_publico: "Empresa B" });
    expect(await prismaAdmin.portalCartaEmpresa.findMany({ orderBy: { empresaId: "asc" }, select: { empresaId: true, valores: true } })).toEqual([
      { empresaId: EMPRESA_POR_DEFECTO_ID, valores: { portal_nombre_publico: "Empresa B" } },
      { empresaId: "norte", valores: { portal_nombre_publico: "Empresa C" } },
    ]);
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
    await activarTodosLosModulos("norte");
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
    subtituloPortal: null,
    posX: null,
    posY: null,
    posW: null,
    posH: null,
    orden: 0,
    publicada: true,
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

describe("Server Action guardarPortalEmpresa: modo marca (`portal_marca_derivada = «si»` exige una marca que se lea: M1, M2 y M3)", () => {
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
  const SUELTOS = { portal_header_bg: "#e5dfdf", portal_card_bg: "transparent", portal_titulo: "Nuestras sucursales" };

  it("una marca válida se guarda con el marcador, junto a los colores sueltos (que no se pierden)", async () => {
    const r = await guardarPortalEmpresa({ ...SUELTOS, portal_color_marca: "#5c57a2", portal_marca_derivada: "si" });
    expect(r.ok).toBe(true);
    expect(await guardado()).toEqual({ ...SUELTOS, portal_color_marca: "#5c57a2", portal_marca_derivada: "si" });
  });

  it.each([
    ["#ffcb69", "casi no se distingue del fondo"],
    ["#96bbbb", "casi no se distingue del fondo"],
    ["#797d62", "no se lee bien"],
    ["#d32f2f", "no se lee bien"],
  ])("la marca %s se rechaza con un mensaje que dice qué hacer, sin escribir nada", async (marca, motivo) => {
    await guardarPortalEmpresa({ portal_titulo: "Original" });
    const r = await guardarPortalEmpresa({ ...SUELTOS, portal_color_marca: marca, portal_marca_derivada: "si" });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("Color de marca del portal: ");
    expect(r.mensaje).toContain(motivo);
    expect(r.mensaje).toMatch(/Elegí uno más/);
    expect(await guardado()).toEqual({ portal_titulo: "Original" });
  });

  it.each(["", "#5C57A2", "#fff", "red", "rgb(92, 87, 162)", "oklch(0.5 0.1 30)"])("con el marcador, una marca %j (no #rrggbb en minúsculas) se rechaza sin escribir", async (marca) => {
    const r = await guardarPortalEmpresa({ portal_color_marca: marca, portal_marca_derivada: "si" });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("Color de marca del portal: ");
    expect(await prisma.portalCartaEmpresa.count()).toBe(0);
  });

  it("con el marcador y sin ninguna marca cargada se rechaza (no se asume ningún color)", async () => {
    const r = await guardarPortalEmpresa({ ...SUELTOS, portal_marca_derivada: "si" });
    expect(r.ok).toBe(false);
    expect(await prisma.portalCartaEmpresa.count()).toBe(0);
  });

  it("sin el marcador, el guardado de siempre no cambia: una marca de bajo contraste o en cualquier formato se acepta", async () => {
    expect((await guardarPortalEmpresa({ portal_color_marca: "#ffcb69" })).ok).toBe(true);
    expect((await guardarPortalEmpresa({ portal_color_marca: "rgb(255, 203, 105)" })).ok).toBe(true);
    expect((await guardarPortalEmpresa({ portal_color_marca: "red", portal_marca_derivada: "" })).ok).toBe(true);
  });

  it("ida y vuelta: pasar a la marca y volver deja `valores` igual que antes (byte a byte), sin el marcador y con los colores sueltos intactos", async () => {
    const antes = { ...SUELTOS, portal_color_marca: "#5c57a2" };
    await guardarPortalEmpresa(antes);
    const valoresAntes = JSON.stringify(await guardado());
    await guardarPortalEmpresa({ ...antes, portal_marca_derivada: "si" });
    expect(await guardado()).toEqual({ ...antes, portal_marca_derivada: "si" });
    await guardarPortalEmpresa({ ...antes, portal_marca_derivada: "" });
    expect(JSON.stringify(await guardado())).toBe(valoresAntes);
  });

  it("idempotente: pasar dos veces a la misma marca deja una fila con los mismos valores; a la vez (carrera) también", async () => {
    const valores = { ...SUELTOS, portal_color_marca: "#5c57a2", portal_marca_derivada: "si" };
    expect((await guardarPortalEmpresa(valores)).ok).toBe(true);
    expect((await guardarPortalEmpresa(valores)).ok).toBe(true);
    const dos = await Promise.all([guardarPortalEmpresa(valores), guardarPortalEmpresa(valores)]);
    expect(dos.map((r) => r.ok)).toEqual([true, true]);
    expect(await prisma.portalCartaEmpresa.count()).toBe(1);
    expect(await guardado()).toEqual(valores);
  });

  it("carrera del PRIMER guardado (tabla vacía) con valores distintos (pasar y volver a la vez): una fila, estado válido, sin error de la base", async () => {
    const marcada = { ...SUELTOS, portal_color_marca: "#5c57a2", portal_marca_derivada: "si" };
    const clasica = { ...SUELTOS, portal_color_marca: "#5c57a2", portal_marca_derivada: "" };
    const resultados = await Promise.all([guardarPortalEmpresa(marcada), guardarPortalEmpresa(clasica)]);
    expect(resultados.map((r) => r.ok)).toEqual([true, true]);
    expect(await prisma.portalCartaEmpresa.count()).toBe(1);
    // Gana uno de los dos, entero (nunca una mezcla): con el marcador o sin él (los vacíos no se guardan).
    expect([marcada, { ...SUELTOS, portal_color_marca: "#5c57a2" }]).toContainEqual(await guardado());
  });

  it("sin el permiso `carta_portal` no se puede pasar a marca (el operador arranca sin él)", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador2@test.com", sucursalId: centralId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const r = await guardarPortalEmpresa({ portal_color_marca: "#5c57a2", portal_marca_derivada: "si" });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(await prisma.portalCartaEmpresa.count()).toBe(0);
  });

  it("aislamiento entre empresas: pasar a marca no toca el portal de otra empresa", async () => {
    await prismaAdmin.empresa.create({ data: { id: "norte", nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    await activarTodosLosModulos("norte");
    await prismaAdmin.portalCartaEmpresa.create({ data: { empresaId: "norte", valores: { portal_titulo: "Norte" } } });
    await guardarPortalEmpresa({ portal_color_marca: "#5c57a2", portal_marca_derivada: "si" });
    expect(await prismaAdmin.portalCartaEmpresa.findMany({ orderBy: { empresaId: "asc" }, select: { empresaId: true, valores: true } })).toEqual([
      { empresaId: EMPRESA_POR_DEFECTO_ID, valores: { portal_color_marca: "#5c57a2", portal_marca_derivada: "si" } },
      { empresaId: "norte", valores: { portal_titulo: "Norte" } },
    ]);
  });
});
