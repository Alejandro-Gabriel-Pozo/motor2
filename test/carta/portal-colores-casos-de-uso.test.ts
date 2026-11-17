import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/persistencia/carta/portal-de-empresa", async (importar) => {
  const real = await importar<typeof import("../../src/server/persistencia/carta/portal-de-empresa")>();
  return { ...real, crearTarjeta: vi.fn(real.crearTarjeta) };
});

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { generarCodigoDePortal } from "../../src/core/carta/public";
import type { ComandoGuardarColoresDelPortal } from "../../src/core/features/carta/portal-colores.schema";
import { azarDelProceso } from "../../src/lib/azar";
import { guardarColoresDelPortalCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-colores-del-portal";
import { guardarColoresDelPortal } from "../../src/server/actions/carta/portal-empresa";
import { resolverConfigPortalDual, resolverPortalCartaDual } from "../../src/server/lecturas/carta/publica";
import { crearTarjeta } from "../../src/server/persistencia/carta/portal-de-empresa";

/**
 * «Guardar los colores del portal» (pantalla simple) contra Postgres real como `motor2_app` (nivel 10 del diseño): el RIESGO «portal vacío al crear la fila» (el alta siembra las tarjetas y el portal se ve IGUAL antes y después), concurrencia (gana uno; dos altas, una fila),
 * idempotencia (escribe y audita una sola vez), atomicidad (una falla a mitad del alta no deja un portal sin tarjetas), permisos, interruptor apagado (el servidor rechaza) y «mezcla»: no toca variante, tarjetas, zonas ni código.
 */
const ITERACIONES = 8;
const PEDIDO_BASE = { colorEncabezado: null, colorPagina: null, colorDetras: null, lineaSuperior: null, titulo: null, logoVisible: true, imagen: undefined, versionEsperada: undefined } as const;

describe("guardar los colores del portal", () => {
  let sucursalA: string;
  let sucursalB: string;
  let usuarioId: string;
  let operadorId: string;
  const actor = () => actorDePrueba(usuarioId, sucursalA);
  const comando = (extra: Partial<ComandoGuardarColoresDelPortal> = {}): ComandoGuardarColoresDelPortal => ({ ...PEDIDO_BASE, portalId: crypto.randomUUID(), codigoNuevo: generarCodigoDePortal(azarDelProceso), ...extra });
  const guardar = (extra: Partial<ComandoGuardarColoresDelPortal> = {}) => guardarColoresDelPortalCasoDeUso(actor(), comando(extra));
  const portales = () => prisma.portalDeEmpresa.findMany();
  const auditorias = () => prisma.registroAuditoria.findMany({ where: { entidad: { in: ["PortalDeEmpresa", "PortalTarjeta", "PortalZona"] } }, orderBy: { creadoEn: "asc" } });
  const publica = (sucursalId: string, extra: { slug: string; publicada?: boolean; orden?: number; etiqueta?: string | null }) =>
    prisma.sucursalPublica.create({ data: { sucursalId, slug: extra.slug, publicada: extra.publicada ?? true, orden: extra.orden ?? 0, etiqueta: extra.etiqueta ?? null } });

  beforeAll(() => {
    process.env.MOTOR2_PORTAL_SIMPLE_PRUEBA = "1";
  });
  afterAll(() => {
    delete process.env.MOTOR2_PORTAL_SIMPLE_PRUEBA;
  });
  beforeEach(async () => {
    vi.mocked(crearTarjeta).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalA = base.sucursal.id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalA, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: sucursalA, rolId: base.operador.id })).id;
  });

  /** Lo que el portal público muestra (slug y etiqueta de cada tarjeta, en orden) y su estilo, tal como la lectura dual lo resuelve. */
  const loQueSeVe = async () => {
    const empresa = { id: EMPRESA_POR_DEFECTO_ID } as Parameters<typeof resolverPortalCartaDual>[0];
    const sucursales = await resolverPortalCartaDual(empresa, actor().db);
    const estilo = await resolverConfigPortalDual(empresa, actor().db);
    return { sucursales: sucursales.map((s) => [s.slug, s.etiqueta, s.subtitulo]), colores: { cabecera: estilo.valores.portal_header_bg, pagina: estilo.valores.portal_fondo_color, acentoPagina: estilo.variablesCss["--portal-acento-pagina"], titulo: estilo.valores.portal_titulo, linea: estilo.valores.portal_etiqueta } };
  };

  describe("el alta no deja el portal vacío ni cambia lo que se ve (el riesgo)", () => {
    it("con dos sucursales publicadas (una con etiqueta, una sin publicar) y colores en el Json: antes y después de crear la fila, el portal muestra lo mismo", async () => {
      await publica(sucursalA, { slug: "centro", orden: 1, etiqueta: "Centro" });
      await publica(sucursalB, { slug: "norte", orden: 0, publicada: false });
      await prisma.portalCartaEmpresa.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, valores: { portal_header_bg: "#112233", portal_fondo_color: "#fafafa", portal_titulo: "Del Json", portal_etiqueta: "Línea del Json" } } });
      const antes = await loQueSeVe();
      expect(antes.sucursales.map((s) => s[0])).toEqual(["centro"]);
      // La pantalla manda lo que mostró (los textos precargados del Json; los colores, vacíos: «sin color»).
      expect(await guardar({ titulo: "Del Json", lineaSuperior: "Línea del Json" })).toMatchObject({ ok: true, datos: { version: 1, yaEstaba: false } });
      expect(await prisma.portalTarjeta.count()).toBe(2);
      expect(await loQueSeVe()).toEqual(antes);
    });

    it("sin nada cargado (ni Json ni registros): crea el portal sin tarjetas y se ve igual (vacío, como antes)", async () => {
      const antes = await loQueSeVe();
      expect(await guardar()).toMatchObject({ ok: true });
      expect(await portales()).toMatchObject([{ variante: "A", version: 1 }]);
      expect(await prisma.portalTarjeta.count()).toBe(0);
      expect(await loQueSeVe()).toEqual(antes);
    });

    it("el portal de hoy es un MAPA (imagen y sucursal ubicada): NO se crea nada y se dice por qué (PORTAL_NO_SE_PUEDE_CREAR_IGUAL)", async () => {
      await prisma.sucursalPublica.create({ data: { sucursalId: sucursalA, slug: "centro", publicada: true, posX: 10, posY: 10, posW: 20 } });
      await prisma.portalCartaEmpresa.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, valores: { portal_bg_image_url: "https://res.cloudinary.com/x/image/upload/v1/a.jpg" } } });
      const r = await guardar();
      expect(r).toMatchObject({ ok: false, codigo: "PORTAL_NO_SE_PUEDE_CREAR_IGUAL" });
      expect(await portales()).toEqual([]);
      expect(await auditorias()).toEqual([]);
    });

    it("el alta audita el portal y cada tarjeta sembrada, sin sucursal (es de la empresa), con el estado anterior en null", async () => {
      await publica(sucursalA, { slug: "centro" });
      const c = comando({ colorEncabezado: "#1f4e79" });
      await guardarColoresDelPortalCasoDeUso(actor(), c);
      const filas = await auditorias();
      expect(filas.map((f) => [f.entidad, f.valorAnterior === null, f.sucursalId, f.actorId])).toEqual([
        ["PortalDeEmpresa", true, null, usuarioId],
        ["PortalTarjeta", true, null, usuarioId],
      ]);
      expect(JSON.parse(filas[0]!.valorNuevo!)).toMatchObject({ codigo: c.codigoNuevo, colorEncabezado: "#1f4e79" });
    });
  });

  describe("mezcla, idempotencia y versión", () => {
    it("cambia SOLO lo de la pantalla: la variante, las tarjetas y el código no se tocan; sube la versión y audita antes y después", async () => {
      await publica(sucursalA, { slug: "centro" });
      const alta = comando();
      await guardarColoresDelPortalCasoDeUso(actor(), alta);
      await prisma.portalDeEmpresa.updateMany({ data: { variante: "B" } }); // lo cambió otra pantalla (PR-A): la de colores no lo pisa
      const antesTarjetas = await prisma.portalTarjeta.findMany();
      const v = (await portales())[0]!.version;
      expect(await guardar({ colorPagina: "#17562f", titulo: "Hola", versionEsperada: v })).toMatchObject({ ok: true, datos: { version: v + 1, yaEstaba: false } });
      expect(await portales()).toMatchObject([{ variante: "B", codigo: alta.codigoNuevo, colorPagina: "#17562f", titulo: "Hola", version: v + 1 }]);
      expect(await prisma.portalTarjeta.findMany()).toEqual(antesTarjetas);
      const cambio = (await auditorias()).filter((f) => f.entidad === "PortalDeEmpresa" && f.valorAnterior !== null);
      expect(cambio).toHaveLength(1);
      expect(JSON.parse(cambio[0]!.valorAnterior!)).toMatchObject({ colorPagina: null });
      expect(JSON.parse(cambio[0]!.valorNuevo!)).toMatchObject({ colorPagina: "#17562f" });
    });

    it("repetir lo mismo (doble clic o reintento con OTRO id y código) es éxito sin escribir ni auditar: yaEstaba", async () => {
      await publica(sucursalA, { slug: "centro" });
      await guardar({ colorEncabezado: "#1f4e79" });
      const filas = await auditorias();
      const otra = await guardar({ colorEncabezado: "#1f4e79" });
      expect(otra).toMatchObject({ ok: true, datos: { version: 1, yaEstaba: true } });
      expect(await portales()).toHaveLength(1);
      expect(await auditorias()).toHaveLength(filas.length);
    });

    it("sin la versión que vio la pantalla, un portal que ya existe y cambia da PORTAL_NO_VISTO; con una vieja, VERSION_DESACTUALIZADA; en los dos no cambia NADA", async () => {
      await guardar();
      const filas = await auditorias();
      expect(await guardar({ titulo: "X" })).toMatchObject({ ok: false, codigo: "PORTAL_NO_VISTO" });
      expect(await guardar({ titulo: "Y", versionEsperada: 1 })).toMatchObject({ ok: true });
      expect(await guardar({ titulo: "Z", versionEsperada: 1 })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      expect(await portales()).toMatchObject([{ titulo: "Y", version: 2 }]);
      expect(await auditorias()).toHaveLength(filas.length + 1);
    });

    it("sin imagen en el pedido se conserva la que tiene; null la quita", async () => {
      const imagen = { proveedor: "CLOUDINARY", cuenta: "mi-cuenta", idPublico: "carta/portal/fondo", version: "1700000000", extension: "jpg" } as const;
      await guardar({ imagen });
      expect(await guardar({ titulo: "A", versionEsperada: 1 })).toMatchObject({ ok: true });
      expect((await portales())[0]).toMatchObject({ imagenIdPublico: "carta/portal/fondo" });
      expect(await guardar({ titulo: "A", imagen: null, versionEsperada: 2 })).toMatchObject({ ok: true });
      expect((await portales())[0]).toMatchObject({ imagenIdPublico: null });
    });
  });

  describe("concurrencia", () => {
    it("dos ALTAS a la vez dejan UNA fila (el único por empresa arbitra); la segunda ve la primera y da éxito sin escribir si coinciden", async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        await limpiarBaseDeTest();
        const base = await sembrarBase();
        sucursalA = base.sucursal.id;
        usuarioId = (await crearUsuarioConMembresia({ email: `a${i}@test.com`, sucursalId: sucursalA, rolId: base.admin.id })).id;
        await publica(sucursalA, { slug: "centro" });
        const [x, y] = await Promise.all([guardar({ colorPagina: "#17562f" }), guardar({ colorPagina: "#17562f" })]);
        expect(x.ok && y.ok, `vuelta ${i}`).toBe(true);
        expect(await portales(), `vuelta ${i}`).toHaveLength(1);
        expect(await prisma.portalTarjeta.count(), `vuelta ${i}`).toBe(1);
      }
    }, 120_000);

    it("dos CAMBIOS con la misma versión: gana uno y el otro da VERSION_DESACTUALIZADA", async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        await limpiarBaseDeTest();
        const base = await sembrarBase();
        sucursalA = base.sucursal.id;
        usuarioId = (await crearUsuarioConMembresia({ email: `b${i}@test.com`, sucursalId: sucursalA, rolId: base.admin.id })).id;
        await guardar();
        const [x, y] = await Promise.all([guardar({ titulo: "Uno", versionEsperada: 1 }), guardar({ titulo: "Dos", versionEsperada: 1 })]);
        expect([x.ok, y.ok].sort(), `vuelta ${i}`).toEqual([false, true]);
        expect([x, y].find((r) => !r.ok), `vuelta ${i}`).toMatchObject({ codigo: "VERSION_DESACTUALIZADA" });
        expect((await portales())[0]!.version).toBe(2);
      }
    }, 120_000);
  });

  describe("atomicidad", () => {
    it("una falla a mitad del ALTA (la segunda tarjeta sembrada) no deja un portal sin tarjetas ni auditoría", async () => {
      await publica(sucursalA, { slug: "centro" });
      await publica(sucursalB, { slug: "norte", orden: 1 });
      const real = await vi.importActual<typeof import("../../src/server/persistencia/carta/portal-de-empresa")>("../../src/server/persistencia/carta/portal-de-empresa");
      let llamadas = 0;
      vi.mocked(crearTarjeta).mockImplementation(async (tx, args) => {
        llamadas += 1;
        if (llamadas === 2) throw new Error("falla forzada a mitad de camino");
        return real.crearTarjeta(tx, args);
      });
      try {
        await expect(guardar()).rejects.toThrow("falla forzada");
        expect(await portales()).toEqual([]);
        expect(await prisma.portalTarjeta.count()).toBe(0);
        expect(await auditorias()).toEqual([]);
      } finally {
        vi.mocked(crearTarjeta).mockImplementation(real.crearTarjeta);
      }
    });
  });

  describe("la Server Action", () => {
    const pedido = (extra: Record<string, unknown> = {}) => ({ logoVisible: true, colorEncabezado: "#1f4e79", ...extra });

    it("el operador no puede; el administrador sí; un pedido sin forma se rechaza antes de tocar la base; lo colado (empresa, variante, tarjetas) se ignora", async () => {
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      expect((await guardarColoresDelPortal(pedido())).ok).toBe(false);
      expect(await portales()).toEqual([]);
      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      for (const malo of [null, "x", { ...pedido(), colorEncabezado: "azul" }, { ...pedido(), titulo: "<b>" }, { ...pedido(), imagen: "https://evil.com/x.png" }, { logoVisible: "si" }]) expect((await guardarColoresDelPortal(malo)).ok, JSON.stringify(malo)).toBe(false);
      expect(await portales()).toEqual([]);
      expect(await guardarColoresDelPortal(pedido({ empresaId: "otra", variante: "B", portalId: crypto.randomUUID(), codigo: "c".repeat(22) }))).toMatchObject({ ok: true });
      expect(await portales()).toMatchObject([{ empresaId: EMPRESA_POR_DEFECTO_ID, variante: "A", colorEncabezado: "#1f4e79", creadoPorId: usuarioId }]);
    });

    it("con el interruptor APAGADO el servidor rechaza aunque el pedido se arme a mano y no escribe nada", async () => {
      delete process.env.MOTOR2_PORTAL_SIMPLE_PRUEBA;
      try {
        await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
        expect(await guardarColoresDelPortal(pedido())).toMatchObject({ ok: false, mensaje: expect.stringContaining("todavía no está disponible") });
        expect(await portales()).toEqual([]);
      } finally {
        process.env.MOTOR2_PORTAL_SIMPLE_PRUEBA = "1";
      }
    });
  });

  describe("la lectura pública con el interruptor APAGADO no cambia (la de PR-A)", () => {
    it("un color de página elegido NO pinta nada con el interruptor apagado y solo pinta el filo (acento) con él encendido", async () => {
      await guardar({ colorPagina: "#808080" });
      const encendido = await loQueSeVe();
      delete process.env.MOTOR2_PORTAL_SIMPLE_PRUEBA;
      try {
        const apagado = await loQueSeVe();
        expect(apagado.colores.acentoPagina).toBeUndefined();
        expect(apagado.colores.pagina).toBe("#808080"); // la de PR-A: el color elegido de la fila es el FONDO de la página (como hasta hoy)
        expect(encendido.colores.acentoPagina).toBe("#808080"); // encendido: solo el filo, tal cual (sin ajustar)
        expect(encendido.colores.pagina).toBe(""); // el fondo ya no es ese color (sigue el del sistema)
      } finally {
        process.env.MOTOR2_PORTAL_SIMPLE_PRUEBA = "1";
      }
    });
  });
});
