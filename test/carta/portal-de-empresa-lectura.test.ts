import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// La carta pública se cachea con `unstable_cache` (necesita el caché de Next, que fuera de un pedido no existe): en esta prueba corre directo. El portal no se cachea.
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), unstable_cache: (fn: () => unknown) => fn }));

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { fijarModulosActivos } from "../setup/modulos";
import { resolverEstiloPortal } from "../../src/core/carta/public";
import { configPortalPublica, empresaCartaPublica, portalCartaPublico } from "../../src/server/carta-publica/sin-sesion";
import {
  CENTRO_DE_LA_ZONA,
  DIMENSIONES_DE_LAS_TABLAS,
  NOMBRE_DE_LA_CARTA,
  NOMBRE_DE_LA_TARJETA,
  REGLAS,
  ZONA_SEMBRADA,
  esperado,
  todosLosCasos,
  type Caso,
} from "./portal-de-empresa-lectura.oraculo";

/**
 * LECTURA DUAL del portal público (PR-A del portal; `docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md` §8 y §10). Va por la ENTRADA pública (`server/carta-publica/sin-sesion.ts`, lo que importan las páginas) contra Postgres real, con la empresa resuelta por su slug.
 *  1. ORÁCULO EXHAUSTIVO: se recorren TODAS las combinaciones de módulo × portal nuevo × tarjeta × zona × sucursal contra la tabla de `portal-de-empresa-lectura.oraculo.ts` (escrita aparte del código).
 *  2. GUARDIÁN de dimensiones: falla si una columna nueva de las tres tablas no está declarada en el oráculo.
 *  3. SIN REGRESIÓN: sin la fila nueva todo sale idéntico a hoy (el estilo y el listado de siempre).
 *  4. El ESTILO con el portal nuevo, el ORDEN, el aislamiento entre empresas y el módulo Carta apagado («portal»).
 */
const E = EMPRESA_POR_DEFECTO_ID;
const SLUG = "principal";
const GUARDADA = "#e5dfdf";

async function empresaPublica() {
  const empresa = await empresaCartaPublica(SLUG);
  expect(empresa, "la empresa de prueba tiene que resolver por su slug (ACTIVE)").not.toBeNull();
  return empresa!;
}

describe("lectura dual del portal público", () => {
  let sucursalId: string;
  const usuario = "u_portal";

  async function limpiarPortal() {
    await prismaAdmin.portalZona.deleteMany();
    await prismaAdmin.portalTarjeta.deleteMany();
    await prismaAdmin.portalDeEmpresa.deleteMany();
    await prismaAdmin.sucursalPublica.deleteMany();
    await prismaAdmin.sucursal.updateMany({ data: { activo: true } });
  }
  const crearPortal = (variante: "A" | "B", extra: Record<string, unknown> = {}) =>
    prismaAdmin.portalDeEmpresa.create({ data: { id: crypto.randomUUID(), empresaId: E, codigo: "C".repeat(22), variante, creadoPorId: usuario, actualizadoEn: new Date(), ...extra } });

  /** Siembra un caso del oráculo y devuelve lo que el comensal ve de la sucursal sembrada. */
  async function verDe(c: Caso) {
    await limpiarPortal();
    if (c.sucursal !== "sin_registro") {
      await prisma.sucursalPublica.create({ data: { sucursalId, slug: "central", publicada: c.sucursal !== "no_publicada", subtituloPortal: "Subtítulo" } });
    }
    if (c.sucursal === "inactiva") await prismaAdmin.sucursal.update({ where: { id: sucursalId }, data: { activo: false } });
    if (c.portal !== "sin_portal") {
      const portal = await crearPortal(c.portal === "variante_A" ? "A" : "B");
      if (c.tarjeta !== "sin_fila") {
        await prismaAdmin.portalTarjeta.create({
          data: { portalId: portal.id, empresaId: E, sucursalId, orden: 0, visible: c.tarjeta !== "oculta", nombre: c.tarjeta === "visible_con_nombre" ? NOMBRE_DE_LA_TARJETA : null, actualizadoEn: new Date() },
        });
      }
      if (c.zona !== "sin_fila") {
        await prismaAdmin.portalZona.create({ data: { id: crypto.randomUUID(), portalId: portal.id, empresaId: E, sucursalId, ...ZONA_SEMBRADA, visible: c.zona === "visible", actualizadoEn: new Date() } });
      }
    }
    const empresa = await empresaPublica();
    return portalCartaPublico(empresa);
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalId = (await prisma.sucursal.create({ data: { nombre: NOMBRE_DE_LA_CARTA } })).id;
    await fijarModulosActivos(E, ["carta"]);
  });

  describe("el oráculo, exhaustivo", () => {
    it("la tabla del oráculo está completa: toda combinación tiene una regla y cada regla se usa", () => {
      const casos = todosLosCasos();
      // 2 módulos × (8 sin portal + 2 variantes × 4 tarjetas × 3 zonas × 4 sucursales) = 2 × (4 + 96 + 96)... se cuenta contra el código del oráculo, no a mano.
      expect(casos.length).toBe(2 * (4 + 2 * 4 * 3 * 4));
      const usadas = new Set(casos.map((c) => esperado(c).regla));
      expect([...usadas].sort()).toEqual(REGLAS.map((r) => r.id).sort());
    });

    for (const modulo of ["con_carta", "sin_carta"] as const) {
      it(`TODAS las combinaciones con el módulo Carta ${modulo === "con_carta" ? "contratado" : "NO contratado"}: el listado del portal es el del oráculo`, async () => {
        await fijarModulosActivos(E, modulo === "con_carta" ? ["carta"] : ["stock"]);
        const fallas: string[] = [];
        let revisados = 0;
        for (const c of todosLosCasos().filter((x) => x.modulo === modulo)) {
          const visto = await verDe(c);
          const { regla, aparicion } = esperado(c);
          const real = visto.map((e) => ({ slug: e.slug, etiqueta: e.etiqueta, subtitulo: e.subtitulo, posicion: e.posicion }));
          const quiere = aparicion === null ? [] : [{ slug: "central", etiqueta: aparicion.etiqueta, subtitulo: "Subtítulo", posicion: aparicion.posicion }];
          // Sin registro público la sucursal no tiene subtítulo ni slug: no aparece (regla R2), así que `quiere` ya es vacío.
          if (JSON.stringify(real) !== JSON.stringify(quiere)) fallas.push(`${regla} ${JSON.stringify(c)} → vio ${JSON.stringify(real)}, esperaba ${JSON.stringify(quiere)}`);
          revisados += 1;
        }
        expect(revisados).toBeGreaterThan(90);
        expect(fallas).toEqual([]);
      }, 240_000);
    }
  });

  describe("el guardián de dimensiones", () => {
    const esquema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
    const columnasDe = (modelo: string) => {
      const cuerpo = new RegExp(`^model ${modelo} \\{([\\s\\S]*?)^\\}`, "m").exec(esquema)?.[1] ?? "";
      return cuerpo
        .split(/\r?\n/)
        .map((l) => /^\s{2}(\w+)\s+\S+/.exec(l)?.[1])
        .filter((c): c is string => c !== undefined && !c.startsWith("@"))
        .sort();
    };

    for (const modelo of Object.keys(DIMENSIONES_DE_LAS_TABLAS)) {
      it(`${modelo}: toda columna del esquema está declarada en el oráculo (afecta o no afecta lo que ve el comensal), y no hay declaradas de más`, () => {
        const declaradas = Object.keys(DIMENSIONES_DE_LAS_TABLAS[modelo]!).sort();
        expect(columnasDe(modelo), "una columna nueva se declara en `DIMENSIONES_DE_LAS_TABLAS` (y, si afecta, con una regla del oráculo)").toEqual(declaradas);
        for (const [columna, motivo] of Object.entries(DIMENSIONES_DE_LAS_TABLAS[modelo]!)) expect(motivo, `${modelo}.${columna}`).toMatch(/^(afecta|no afecta)/);
      });
    }

    it("el detector funciona: una columna que no está declarada se ve (la mutación se demuestra acá)", () => {
      const declaradas = Object.keys(DIMENSIONES_DE_LAS_TABLAS.PortalTarjeta!).filter((c) => c !== "telefono").sort();
      expect(columnasDe("PortalTarjeta")).not.toEqual(declaradas);
    });
  });

  describe("sin regresión: sin la fila nueva todo sale idéntico a hoy", () => {
    it("el listado sale de `SucursalPublica` (publicada y activa, por `orden` y después etiqueta, con su posición del centro) y el estilo del Json, como antes de las tablas nuevas", async () => {
      const norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
      const sur = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
      await prisma.sucursalPublica.create({ data: { sucursalId: sur, slug: "sur", publicada: true, orden: 1, etiqueta: "Sur grande", posX: 30, posY: 40, posW: 20 } });
      await prisma.sucursalPublica.create({ data: { sucursalId: norte, slug: "norte", publicada: true, orden: 0, subtituloPortal: "Al norte" } });
      await prisma.sucursalPublica.create({ data: { sucursalId, slug: "central", publicada: false } });
      const valores = { portal_titulo: "Mi portal", portal_header_bg: GUARDADA, portal_bg_image_url: "https://cdn.example.com/mapa.png" };
      await prisma.portalCartaEmpresa.create({ data: { valores } });
      const empresa = await empresaPublica();
      expect(await portalCartaPublico(empresa)).toEqual([
        { slug: "norte", etiqueta: "Norte", subtitulo: "Al norte", posicion: null },
        { slug: "sur", etiqueta: "Sur grande", subtitulo: null, posicion: { x: 30, y: 40, w: 20, h: null } },
      ]);
      expect(await configPortalPublica(empresa)).toEqual(resolverEstiloPortal(valores));
    });

    it("sin portal y sin Json, el estilo es el de fábrica (portal sin configurar)", async () => {
      expect(await configPortalPublica(await empresaPublica())).toEqual(resolverEstiloPortal(undefined));
    });
  });

  describe("el estilo con el portal nuevo", () => {
    const IMAGEN = { imagenProveedor: "CLOUDINARY", imagenCuenta: "mi-cuenta", imagenIdPublico: "carta/mapa", imagenVersion: "1700000000", imagenExtension: "png" };
    const URL_DE_LA_IMAGEN = "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/carta/mapa.png";
    const JSON_VIEJO = { portal_titulo: "Título viejo", portal_etiqueta: "Etiqueta vieja", portal_header_bg: "#111111", portal_fondo_color: "#222222", portal_bg_image_url: "https://cdn.example.com/viejo.png", portal_nombre_publico: "Mi Empresa", portal_card_color: "#333333", empresa_logo_url: "https://cdn.example.com/logo.png" };

    it("las claves que el portal nuevo modela salen SOLO de él (vacío = el valor por defecto, nunca el Json); el resto del Json se conserva (el nombre público, los colores de las tarjetas) y el logo se muestra o no", async () => {
      await prisma.portalCartaEmpresa.create({ data: { valores: JSON_VIEJO } });
      await crearPortal("B", { lineaSuperior: "Nuestros restaurantes", titulo: "Elegí dónde comer", colorEncabezado: GUARDADA, ...IMAGEN, logoVisible: true });
      const estilo = await configPortalPublica(await empresaPublica());
      expect(estilo.valores).toMatchObject({
        portal_etiqueta: "Nuestros restaurantes",
        portal_titulo: "Elegí dónde comer",
        portal_header_bg: GUARDADA,
        portal_fondo_color: "",
        portal_bg_image_url: URL_DE_LA_IMAGEN,
        portal_nombre_publico: "Mi Empresa",
        portal_card_color: "#333333",
        empresa_logo_url: "https://cdn.example.com/logo.png",
      });
      expect(estilo.imagenFondo).toBe(URL_DE_LA_IMAGEN);
      // Sin colores ni textos en el portal nuevo: los valores por defecto, NO los del Json viejo.
      await prismaAdmin.portalDeEmpresa.updateMany({ data: { lineaSuperior: null, titulo: null, colorEncabezado: null, logoVisible: false } });
      const vacio = (await configPortalPublica(await empresaPublica())).valores;
      expect(vacio).toMatchObject({ portal_etiqueta: "", portal_titulo: "", portal_header_bg: "", portal_fondo_color: "", empresa_logo_url: "", portal_nombre_publico: "Mi Empresa" });
    });

    it("la imagen de fondo solo se usa en la variante B (en la A el portal es una grilla), y lo cargado en la otra variante se conserva", async () => {
      await crearPortal("A", { ...IMAGEN });
      expect((await configPortalPublica(await empresaPublica())).imagenFondo).toBeNull();
      await prismaAdmin.portalDeEmpresa.updateMany({ data: { variante: "B" } });
      expect((await configPortalPublica(await empresaPublica())).imagenFondo).toBe(URL_DE_LA_IMAGEN);
    });

    it("con el módulo Carta apagado el portal NUEVO tampoco se publica (ni el listado ni la apariencia de la empresa)", async () => {
      await crearPortal("A", { titulo: "Título del portal nuevo" });
      await prismaAdmin.portalTarjeta.create({ data: { portalId: (await prismaAdmin.portalDeEmpresa.findFirstOrThrow()).id, empresaId: E, sucursalId, orden: 0, visible: true, actualizadoEn: new Date() } });
      await prisma.sucursalPublica.create({ data: { sucursalId, slug: "central", publicada: true } });
      const empresa = await empresaPublica();
      expect((await portalCartaPublico(empresa)).map((s) => s.slug)).toEqual(["central"]);
      expect(JSON.stringify(await configPortalPublica(empresa))).toContain("Título del portal nuevo");
      await fijarModulosActivos(E, ["stock"]);
      expect(await portalCartaPublico(empresa)).toEqual([]);
      expect(JSON.stringify(await configPortalPublica(empresa))).not.toContain("Título del portal nuevo");
    });
  });

  describe("el orden y el aislamiento", () => {
    async function dosSucursales() {
      const norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
      await prisma.sucursalPublica.create({ data: { sucursalId, slug: "central", publicada: true, orden: 5 } });
      await prisma.sucursalPublica.create({ data: { sucursalId: norte, slug: "norte", publicada: true, orden: 1 } });
      return norte;
    }

    it("variante A: por el `orden` de la tarjeta y después por nombre; variante B: por el `orden` del registro público y después por nombre; las ocultas y las que no tienen registro no salen", async () => {
      const norte = await dosSucursales();
      const portal = await crearPortal("A");
      await prismaAdmin.portalTarjeta.create({ data: { portalId: portal.id, empresaId: E, sucursalId, orden: 0, visible: true, actualizadoEn: new Date() } });
      await prismaAdmin.portalTarjeta.create({ data: { portalId: portal.id, empresaId: E, sucursalId: norte, orden: 1, visible: true, actualizadoEn: new Date() } });
      const empresa = await empresaPublica();
      expect((await portalCartaPublico(empresa)).map((s) => s.slug)).toEqual(["central", "norte"]);
      await prismaAdmin.portalTarjeta.updateMany({ where: { sucursalId }, data: { orden: 9 } });
      expect((await portalCartaPublico(empresa)).map((s) => s.slug)).toEqual(["norte", "central"]);
      await prismaAdmin.portalTarjeta.updateMany({ where: { sucursalId: norte }, data: { visible: false } });
      expect((await portalCartaPublico(empresa)).map((s) => s.slug)).toEqual(["central"]);

      // Variante B: las zonas, ordenadas por el registro público (norte 1, central 5), no por la tarjeta.
      await prismaAdmin.portalDeEmpresa.updateMany({ data: { variante: "B" } });
      await prismaAdmin.portalZona.create({ data: { id: crypto.randomUUID(), portalId: portal.id, empresaId: E, sucursalId, ...ZONA_SEMBRADA, actualizadoEn: new Date() } });
      await prismaAdmin.portalZona.create({ data: { id: crypto.randomUUID(), portalId: portal.id, empresaId: E, sucursalId: norte, x: 0, y: 0, ancho: 100, alto: 100, actualizadoEn: new Date() } });
      const enB = await portalCartaPublico(empresa);
      expect(enB.map((s) => s.slug)).toEqual(["norte", "central"]);
      expect(enB[0]!.posicion).toEqual({ x: 50, y: 50, w: 100, h: 100 });
      expect(enB[1]!.posicion).toEqual(CENTRO_DE_LA_ZONA);
    });

    it("otra empresa: sus tarjetas, zonas y portal no aparecen en esta (la lectura va con la base de ESTA empresa)", async () => {
      await prisma.sucursalPublica.create({ data: { sucursalId, slug: "central", publicada: true } });
      await prismaAdmin.empresa.create({ data: { id: "otra_empresa_portal", nombre: "Otra", slug: "otra-portal", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
      const ajena = await prismaAdmin.sucursal.create({ data: { empresaId: "otra_empresa_portal", nombre: "De otra" } });
      try {
        await prismaAdmin.sucursalPublica.create({ data: { empresaId: "otra_empresa_portal", sucursalId: ajena.id, slug: "ajena", publicada: true } });
        const ajeno = await prismaAdmin.portalDeEmpresa.create({ data: { id: crypto.randomUUID(), empresaId: "otra_empresa_portal", codigo: "Z".repeat(22), variante: "A", titulo: "Portal ajeno", creadoPorId: "x", actualizadoEn: new Date() } });
        await prismaAdmin.portalTarjeta.create({ data: { portalId: ajeno.id, empresaId: "otra_empresa_portal", sucursalId: ajena.id, orden: 0, visible: true, actualizadoEn: new Date() } });
        // Esta empresa NO tiene portal nuevo: se lee el de siempre y no se mezcla nada de la otra.
        const empresa = await empresaPublica();
        expect((await portalCartaPublico(empresa)).map((s) => s.slug)).toEqual(["central"]);
        expect(JSON.stringify(await configPortalPublica(empresa))).not.toContain("Portal ajeno");
      } finally {
        await prismaAdmin.portalTarjeta.deleteMany({ where: { empresaId: "otra_empresa_portal" } });
        await prismaAdmin.portalDeEmpresa.deleteMany({ where: { empresaId: "otra_empresa_portal" } });
        await prismaAdmin.sucursalPublica.deleteMany({ where: { empresaId: "otra_empresa_portal" } });
        await prismaAdmin.sucursal.delete({ where: { id: ajena.id } });
        await prismaAdmin.empresa.delete({ where: { id: "otra_empresa_portal" } });
      }
    });
  });
});
