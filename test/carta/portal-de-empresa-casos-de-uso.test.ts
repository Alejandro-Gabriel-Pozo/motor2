import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// Para forzar una falla A MITAD de camino (atomicidad): envuelve las altas de tarjeta y de zona con el original por defecto y deja que un test las haga fallar en la N-ésima llamada.
vi.mock("../../src/server/persistencia/carta/portal-de-empresa", async (importar) => {
  const real = await importar<typeof import("../../src/server/persistencia/carta/portal-de-empresa")>();
  return { ...real, crearTarjeta: vi.fn(real.crearTarjeta), crearZona: vi.fn(real.crearZona), cambiarTarjeta: vi.fn(real.cambiarTarjeta) };
});

import { DATOS_EMPRESA_TESTIGO, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { generarCodigoDePortal, type DatosDelPortal } from "../../src/core/carta/public";
import type { ComandoGuardarPortalDeEmpresa } from "../../src/core/features/carta/portal-de-empresa.schema";
import { azarDelProceso } from "../../src/lib/azar";
import { guardarPortalDeEmpresaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-portal-de-empresa";
import { guardarPortalDeEmpresa } from "../../src/server/actions/carta/portal-empresa";
import { consultarPortalDeEmpresa } from "../../src/server/lecturas/carta/portal-de-empresa";
import { cambiarTarjeta, crearTarjeta, crearZona } from "../../src/server/persistencia/carta/portal-de-empresa";

/**
 * Portal de la empresa, PR-A (docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md, nivel 10): «guardar el portal» contra Postgres real como `motor2_app`. Concurrencia (gana uno; dos altas → una fila), idempotencia (escribe y audita una sola vez), atomicidad (una falla a mitad no deja
 * un portal sin tarjetas ni una zona huérfana), aislamiento (una sucursal de otra empresa responde «no encontrada»; las claves foráneas compuestas lo repiten en la base), permisos (el operador no; gerente y administrador sí) y «cambiar de variante no toca lo cargado en la otra».
 */
const ITERACIONES = 8;
const DIRECCION = "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/carta/portal/fondo.jpg";
const IMAGEN = { proveedor: "CLOUDINARY", cuenta: "mi-cuenta", idPublico: "carta/portal/fondo", version: "1700000000", extension: "jpg" } as const;

const DATOS: DatosDelPortal = { variante: "A", lineaSuperior: null, titulo: null, colorEncabezado: null, colorPagina: null, colorDetras: null, logoVisible: true };

describe("guardar el portal de la empresa (PR-A)", () => {
  let sucursalA: string;
  let sucursalB: string;
  let usuarioId: string;
  let operadorId: string;
  let rolAdminId: string;
  const actor = () => actorDePrueba(usuarioId, sucursalA);
  const comando = (extra: Partial<ComandoGuardarPortalDeEmpresa> = {}): ComandoGuardarPortalDeEmpresa => ({
    datos: DATOS,
    imagen: undefined,
    tarjetas: [],
    zonas: [],
    versionEsperada: undefined,
    portalId: crypto.randomUUID(),
    codigoNuevo: generarCodigoDePortal(azarDelProceso),
    ...extra,
  });
  const tarjeta = (sucursalId: string, extra: Partial<ComandoGuardarPortalDeEmpresa["tarjetas"][number]> = {}) => ({ sucursalId, orden: 0, visible: true, nombre: null, telefono: null, foto: null, ...extra });
  const zona = (sucursalId: string, extra: Partial<ComandoGuardarPortalDeEmpresa["zonas"][number]> = {}) => ({ id: crypto.randomUUID(), sucursalId, x: 1000, y: 2000, ancho: 3000, alto: 1500, visible: true, ...extra });
  const guardar = (extra: Partial<ComandoGuardarPortalDeEmpresa> = {}) => guardarPortalDeEmpresaCasoDeUso(actor(), comando(extra));
  const portales = () => prisma.portalDeEmpresa.findMany();
  const auditorias = () => prisma.registroAuditoria.findMany({ where: { entidad: { in: ["PortalDeEmpresa", "PortalTarjeta", "PortalZona"] } }, orderBy: { creadoEn: "asc" } });
  const cuentaAuditorias = (entidad: string) => prisma.registroAuditoria.count({ where: { entidad } });
  const gestion = () => consultarPortalDeEmpresa(actor().db, { empresaId: EMPRESA_POR_DEFECTO_ID });

  beforeEach(async () => {
    vi.mocked(crearTarjeta).mockClear();
    vi.mocked(crearZona).mockClear();
    vi.mocked(cambiarTarjeta).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalA = base.sucursal.id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    rolAdminId = base.admin.id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalA, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: sucursalA, rolId: base.operador.id })).id;
  });

  describe("el alta", () => {
    it("crea el portal (nace con la variante A, el código que mandó el servidor y la versión 1) con sus tarjetas y zonas, y deja UNA auditoría por entidad con el estado antes (null) y después", async () => {
      const c = comando({ tarjetas: [tarjeta(sucursalA, { orden: 1, nombre: "Centro", telefono: "1155551234", foto: IMAGEN })], zonas: [zona(sucursalB)], imagen: IMAGEN });
      const r = await guardarPortalDeEmpresaCasoDeUso(actor(), c);
      expect(r).toMatchObject({ ok: true, datos: { portalId: c.portalId, codigo: c.codigoNuevo, version: 1, yaEstaba: false } });
      const [p] = await portales();
      expect(p).toMatchObject({ id: c.portalId, empresaId: EMPRESA_POR_DEFECTO_ID, codigo: c.codigoNuevo, variante: "A", version: 1, creadoPorId: usuarioId, imagenCuenta: "mi-cuenta", imagenIdPublico: "carta/portal/fondo" });
      expect(c.codigoNuevo).toHaveLength(22);
      expect(await prisma.portalTarjeta.findMany()).toMatchObject([{ portalId: c.portalId, sucursalId: sucursalA, orden: 1, nombre: "Centro", telefono: "1155551234", fotoCuenta: "mi-cuenta", version: 1 }]);
      const zonas = await prisma.portalZona.findMany();
      expect(zonas).toHaveLength(1);
      expect(zonas[0]).toMatchObject({ id: c.zonas[0]!.id, sucursalId: sucursalB, version: 1 });
      expect(zonas[0]!.x.toString()).toBe("10");
      expect(zonas[0]!.ancho.toString()).toBe("30");

      const filas = await auditorias();
      expect(filas.map((f) => [f.entidad, f.campo, f.valorAnterior === null, f.sucursalId, f.actorId])).toEqual([
        ["PortalDeEmpresa", "portal", true, null, usuarioId],
        ["PortalTarjeta", "tarjeta", true, null, usuarioId],
        ["PortalZona", "zona", true, null, usuarioId],
      ]);
      expect(JSON.parse(filas[0]!.valorNuevo!)).toMatchObject({ codigo: c.codigoNuevo, variante: "A", imagen: "mi-cuenta/carta/portal/fondo.jpg" });
      expect(filas[1]!.entidadId).toBe(`${c.portalId}:${sucursalA}`);
      expect(JSON.parse(filas[1]!.valorNuevo!)).toMatchObject({ orden: 1, nombre: "Centro", telefono: "1155551234" });
    });

    it("la consulta de gestión devuelve el portal con todo lo cargado y lo que falta como «pendiente de completar» (nunca inventado)", async () => {
      expect(await gestion()).toBeNull();
      await guardar({ datos: { ...DATOS, variante: "B" } });
      expect(await gestion()).toMatchObject({ variante: "B", imagen: null, tarjetas: [], zonas: [], pendientes: ["SIN_IMAGEN", "SIN_ZONAS_VISIBLES"] });
      const v = (await gestion())!.version;
      await guardar({ datos: { ...DATOS, variante: "B" }, imagen: IMAGEN, zonas: [zona(sucursalA, { x: 0, y: 0, ancho: 10000, alto: 10000 })], versionEsperada: v });
      expect(await gestion()).toMatchObject({ imagen: { direccion: DIRECCION }, zonas: [{ sucursalId: sucursalA, nombreDeLaSucursal: expect.any(String), x: 0, y: 0, ancho: 100, alto: 100, visible: true }], pendientes: [] });
    });

    it("repetir lo mismo (un doble clic, o un reintento con OTRO id y OTRO código de alta) es éxito sin escribir ni auditar: `yaEstaba`, con el código de siempre", async () => {
      const c = comando({ tarjetas: [tarjeta(sucursalA)], zonas: [zona(sucursalB)] });
      await guardarPortalDeEmpresaCasoDeUso(actor(), c);
      const antes = await auditorias();
      const otra = await guardarPortalDeEmpresaCasoDeUso(actor(), { ...c, portalId: crypto.randomUUID(), codigoNuevo: generarCodigoDePortal(azarDelProceso), zonas: [{ ...c.zonas[0]!, id: crypto.randomUUID() }] });
      expect(otra).toMatchObject({ ok: true, datos: { portalId: c.portalId, codigo: c.codigoNuevo, version: 1, yaEstaba: true } });
      expect(await portales()).toHaveLength(1);
      expect(await auditorias()).toHaveLength(antes.length);
    });

    it("sin la versión que vio la pantalla, un portal que ya existe y cambia da PORTAL_NO_VISTO (no se pisa lo que otro cargó)", async () => {
      await guardar();
      expect(await guardar({ datos: { ...DATOS, titulo: "Otro" } })).toMatchObject({ ok: false, codigo: "PORTAL_NO_VISTO" });
      expect((await portales())[0]!.titulo).toBeNull();
    });
  });

  describe("cambiar el portal", () => {
    it("el cambio exige la versión vigente, la sube en uno, audita antes y después, y NO cambia el código ni la fecha de alta", async () => {
      const c = comando({ tarjetas: [tarjeta(sucursalA, { orden: 3 })] });
      await guardarPortalDeEmpresaCasoDeUso(actor(), c);
      const r = await guardar({ datos: { ...DATOS, lineaSuperior: "Nuestros restaurantes", colorEncabezado: "#e5dfdf" }, tarjetas: [tarjeta(sucursalA, { orden: 3, nombre: "Centro" })], versionEsperada: 1 });
      expect(r).toMatchObject({ ok: true, datos: { portalId: c.portalId, codigo: c.codigoNuevo, version: 2, yaEstaba: false } });
      expect(await portales()).toMatchObject([{ codigo: c.codigoNuevo, version: 2, lineaSuperior: "Nuestros restaurantes", colorEncabezado: "#e5dfdf" }]);
      expect(await prisma.portalTarjeta.findMany()).toMatchObject([{ nombre: "Centro", version: 2 }]);
      const cambios = (await auditorias()).filter((f) => f.valorAnterior !== null);
      expect(cambios.map((f) => f.entidad).sort()).toEqual(["PortalDeEmpresa", "PortalTarjeta"]);
      const portal = cambios.find((f) => f.entidad === "PortalDeEmpresa")!;
      expect(JSON.parse(portal.valorAnterior!)).toMatchObject({ lineaSuperior: null, colorEncabezado: null });
      expect(JSON.parse(portal.valorNuevo!)).toMatchObject({ lineaSuperior: "Nuestros restaurantes", colorEncabezado: "#e5dfdf" });
      expect(JSON.parse(portal.valorNuevo!).codigo).toBeUndefined();
    });

    it("una versión vieja (otra persona cambió el portal) da VERSION_DESACTUALIZADA y no cambia NADA (ni el portal, ni sus tarjetas, ni la auditoría)", async () => {
      await guardar({ tarjetas: [tarjeta(sucursalA)] });
      expect(await guardar({ datos: { ...DATOS, titulo: "Primero" }, tarjetas: [tarjeta(sucursalA)], versionEsperada: 1 })).toMatchObject({ ok: true });
      const auditoriasAntes = await auditorias();
      expect(await guardar({ datos: { ...DATOS, titulo: "Segundo" }, tarjetas: [tarjeta(sucursalA, { nombre: "X" })], versionEsperada: 1 })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      expect(await portales()).toMatchObject([{ titulo: "Primero", version: 2 }]);
      expect(await prisma.portalTarjeta.findMany()).toMatchObject([{ nombre: null }]);
      expect(await auditorias()).toHaveLength(auditoriasAntes.length);
    });

    it("cambiar de variante NO toca lo cargado en la otra: las tarjetas de la A, las zonas de la B y la imagen se conservan (la imagen ausente se conserva; `null` la quita)", async () => {
      await guardar({ tarjetas: [tarjeta(sucursalA, { nombre: "Centro" })], zonas: [zona(sucursalB)], imagen: IMAGEN });
      const idZona = (await prisma.portalZona.findMany())[0]!.id;
      // A → B: sin mandar tarjetas ni imagen.
      expect(await guardar({ datos: { ...DATOS, variante: "B" }, versionEsperada: 1 })).toMatchObject({ ok: true, datos: { version: 2 } });
      expect(await portales()).toMatchObject([{ variante: "B", imagenCuenta: "mi-cuenta" }]);
      expect(await prisma.portalTarjeta.findMany()).toMatchObject([{ sucursalId: sucursalA, nombre: "Centro", visible: true, version: 1 }]);
      expect(await prisma.portalZona.findMany()).toMatchObject([{ id: idZona, visible: true, version: 1 }]);
      // B → A: lo mismo.
      expect(await guardar({ datos: { ...DATOS, variante: "A" }, versionEsperada: 2 })).toMatchObject({ ok: true, datos: { version: 3 } });
      expect(await prisma.portalZona.findMany()).toMatchObject([{ id: idZona, version: 1 }]);
      expect(await prisma.portalTarjeta.findMany()).toMatchObject([{ version: 1 }]);
      // `null` quita la imagen; las tarjetas y zonas siguen.
      expect(await guardar({ imagen: null, versionEsperada: 3 })).toMatchObject({ ok: true });
      expect(await portales()).toMatchObject([{ imagenProveedor: null, imagenCuenta: null, imagenIdPublico: null, imagenVersion: null, imagenExtension: null }]);
      expect(await prisma.portalZona.count()).toBe(1);
    });

    it("lo que el pedido no manda queda como está y nada se borra: ocultar es `visible: false` (la tarjeta oculta sigue en la base)", async () => {
      await guardar({ tarjetas: [tarjeta(sucursalA), tarjeta(sucursalB, { orden: 1 })] });
      expect(await guardar({ tarjetas: [tarjeta(sucursalA, { visible: false })], versionEsperada: 1 })).toMatchObject({ ok: true });
      expect(await prisma.portalTarjeta.findMany({ orderBy: { orden: "asc" } })).toMatchObject([
        { sucursalId: sucursalA, visible: false, version: 2 },
        { sucursalId: sucursalB, visible: true, version: 1 },
      ]);
      // La sucursal de una zona ya cargada la identifica: el `id` del pedido no la cambia.
      await guardar({ zonas: [zona(sucursalA)], versionEsperada: 2 });
      const [z] = await prisma.portalZona.findMany();
      await guardar({ zonas: [zona(sucursalA, { x: 0, visible: false })], versionEsperada: 3 });
      expect(await prisma.portalZona.findMany()).toMatchObject([{ id: z!.id, sucursalId: sucursalA, visible: false, version: 2 }]);
    });
  });

  describe("aislamiento entre empresas", () => {
    it("una sucursal de OTRA empresa (o que no existe) responde «no encontrada» igual, no escribe nada y no deja rastro", async () => {
      await prismaAdmin.empresa.upsert({ where: { id: EMPRESA_TESTIGO_ID }, update: { estado: "ACTIVE" }, create: DATOS_EMPRESA_TESTIGO });
      const ajena = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "Ajena" } });
      try {
        expect(await guardar({ tarjetas: [tarjeta(sucursalA), tarjeta(ajena.id, { orden: 1 })] })).toMatchObject({ ok: false, codigo: "SUCURSAL_NO_ENCONTRADA" });
        expect(await guardar({ zonas: [zona(ajena.id)] })).toMatchObject({ ok: false, codigo: "SUCURSAL_NO_ENCONTRADA" });
        expect(await guardar({ tarjetas: [tarjeta("sucursal-que-no-existe")] })).toMatchObject({ ok: false, codigo: "SUCURSAL_NO_ENCONTRADA" });
        expect(await portales()).toEqual([]);
        expect(await auditorias()).toEqual([]);
      } finally {
        await prismaAdmin.sucursal.delete({ where: { id: ajena.id } });
      }
    });

    it("la base lo repite: el portal de una empresa no admite una tarjeta ni una zona de una sucursal de otra (clave foránea compuesta con la empresa, 23503)", async () => {
      await guardar({ tarjetas: [tarjeta(sucursalA)] });
      const portalId = (await portales())[0]!.id;
      await prismaAdmin.empresa.upsert({ where: { id: EMPRESA_TESTIGO_ID }, update: { estado: "ACTIVE" }, create: DATOS_EMPRESA_TESTIGO });
      const ajena = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "Ajena" } });
      try {
        await expect(prismaAdmin.$executeRawUnsafe(`INSERT INTO "PortalTarjeta" ("empresaId","portalId","sucursalId","orden","actualizadoEn") VALUES ($1,$2::uuid,$3,5,now())`, EMPRESA_POR_DEFECTO_ID, portalId, ajena.id)).rejects.toThrow(/foreign key|23503/i);
        await expect(
          prismaAdmin.$executeRawUnsafe(`INSERT INTO "PortalZona" ("id","empresaId","portalId","sucursalId","x","y","ancho","alto","actualizadoEn") VALUES ($1::uuid,$2,$3::uuid,$4,0,0,10,10,now())`, crypto.randomUUID(), EMPRESA_POR_DEFECTO_ID, portalId, ajena.id),
        ).rejects.toThrow(/foreign key|23503/i);
        // Y al revés: la empresa ajena no puede colgar una tarjeta de SU sucursal en el portal de esta (el portal no es suyo).
        await expect(prismaAdmin.$executeRawUnsafe(`INSERT INTO "PortalTarjeta" ("empresaId","portalId","sucursalId","orden","actualizadoEn") VALUES ($1,$2::uuid,$3,5,now())`, EMPRESA_TESTIGO_ID, portalId, ajena.id)).rejects.toThrow(/foreign key|23503/i);
      } finally {
        await prismaAdmin.sucursal.delete({ where: { id: ajena.id } });
      }
    });

    it("cada empresa tiene SU portal con SU código: el de otra no se ve ni se toca desde esta (la empresa sale del contexto, no del pedido)", async () => {
      await prismaAdmin.empresa.upsert({ where: { id: EMPRESA_TESTIGO_ID }, update: { estado: "ACTIVE" }, create: DATOS_EMPRESA_TESTIGO });
      const ajena = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "Ajena" } });
      const codigoAjeno = generarCodigoDePortal(azarDelProceso);
      const ajeno = await prismaAdmin.portalDeEmpresa.create({ data: { id: crypto.randomUUID(), empresaId: EMPRESA_TESTIGO_ID, codigo: codigoAjeno, titulo: "De otra empresa", creadoPorId: "otro", actualizadoEn: new Date() } });
      try {
        expect(await gestion()).toBeNull();
        expect(await guardar({ datos: { ...DATOS, titulo: "Mío" } })).toMatchObject({ ok: true, datos: { yaEstaba: false } });
        expect((await gestion())!.titulo).toBe("Mío");
        expect(await prismaAdmin.portalDeEmpresa.findUnique({ where: { id: ajeno.id } })).toMatchObject({ titulo: "De otra empresa", version: 1, codigo: codigoAjeno });
        // Con el MISMO código de la otra empresa (única en toda la plataforma) la base no deja crear otro.
        await prismaAdmin.portalDeEmpresa.deleteMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID } });
        expect(await guardar({ codigoNuevo: codigoAjeno })).toMatchObject({ ok: false });
        expect(await prisma.portalDeEmpresa.count()).toBe(0);
      } finally {
        await prismaAdmin.portalDeEmpresa.delete({ where: { id: ajeno.id } });
        await prismaAdmin.sucursal.delete({ where: { id: ajena.id } });
      }
    });
  });

  describe("concurrencia real", () => {
    it(`${ITERACIONES} vueltas: dos ALTAS a la vez con contenido distinto → UNA fila de portal y una sola auditoría de alta; la otra ve que ya existe (PORTAL_NO_VISTO)`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        await limpiarBaseDeTest();
        const base = await sembrarBase();
        sucursalA = base.sucursal.id;
        usuarioId = (await crearUsuarioConMembresia({ email: `admin${i}@test.com`, sucursalId: sucursalA, rolId: base.admin.id })).id;
        const [x, y] = await Promise.allSettled([guardar({ datos: { ...DATOS, titulo: "Uno" }, tarjetas: [tarjeta(sucursalA)] }), guardar({ datos: { ...DATOS, titulo: "Dos" }, tarjetas: [tarjeta(sucursalA, { nombre: "Otra" })] })]);
        const resultados = [x, y].map((r) => (r.status === "fulfilled" ? r.value : null));
        expect(resultados.every((r) => r !== null), `vuelta ${i}: ninguno debería lanzar`).toBe(true);
        expect(resultados.filter((r) => r!.ok)).toHaveLength(1);
        expect(resultados.filter((r) => !r!.ok)).toMatchObject([{ codigo: "PORTAL_NO_VISTO" }]);
        expect(await portales(), `vuelta ${i}`).toHaveLength(1);
        expect(await prisma.portalTarjeta.count()).toBe(1);
        expect(await cuentaAuditorias("PortalDeEmpresa")).toBe(1);
      }
    }, 120_000);

    it(`${ITERACIONES} vueltas: dos ALTAS IGUALES a la vez → UNA fila; las dos responden bien (una crea, la otra `+"`yaEstaba`"+`) y el código es el mismo`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        await limpiarBaseDeTest();
        const base = await sembrarBase();
        sucursalA = base.sucursal.id;
        usuarioId = (await crearUsuarioConMembresia({ email: `admin${i}@test.com`, sucursalId: sucursalA, rolId: base.admin.id })).id;
        const dos = await Promise.all([guardar({ tarjetas: [tarjeta(sucursalA)] }), guardar({ tarjetas: [tarjeta(sucursalA)] })]);
        expect(dos.every((r) => r.ok), `vuelta ${i}`).toBe(true);
        expect(dos.filter((r) => r.ok && r.datos.yaEstaba)).toHaveLength(1);
        const [a, b] = dos;
        if (a.ok && b.ok) expect(a.datos.codigo).toBe(b.datos.codigo);
        expect(await portales()).toHaveLength(1);
        expect(await cuentaAuditorias("PortalDeEmpresa")).toBe(1);
      }
    }, 120_000);

    it(`${ITERACIONES} vueltas: dos «guardar» con LA MISMA versión y contenido distinto → gana uno (versión 2) y el otro VERSION_DESACTUALIZADA; nunca queda mezclado`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        await limpiarBaseDeTest();
        const base = await sembrarBase();
        sucursalA = base.sucursal.id;
        usuarioId = (await crearUsuarioConMembresia({ email: `admin${i}@test.com`, sucursalId: sucursalA, rolId: base.admin.id })).id;
        await guardar({ tarjetas: [tarjeta(sucursalA)] });
        const [x, y] = await Promise.all([
          guardar({ datos: { ...DATOS, titulo: "Uno" }, tarjetas: [tarjeta(sucursalA, { nombre: "Uno" })], versionEsperada: 1 }),
          guardar({ datos: { ...DATOS, titulo: "Dos" }, tarjetas: [tarjeta(sucursalA, { nombre: "Dos" })], versionEsperada: 1 }),
        ]);
        expect([x.ok, y.ok].sort()).toEqual([false, true]);
        expect([x, y].find((r) => !r.ok)).toMatchObject({ codigo: "VERSION_DESACTUALIZADA" });
        const [p] = await portales();
        const [t] = await prisma.portalTarjeta.findMany();
        expect(p!.version, `vuelta ${i}`).toBe(2);
        // El portal y su tarjeta son de la MISMA persona (todo o nada).
        expect(t!.nombre).toBe(p!.titulo);
        expect(await cuentaAuditorias("PortalDeEmpresa")).toBe(2);
      }
    }, 120_000);
  });

  describe("atomicidad", () => {
    const persistenciaReal = () => vi.importActual<typeof import("../../src/server/persistencia/carta/portal-de-empresa")>("../../src/server/persistencia/carta/portal-de-empresa");

    it("una falla a mitad del ALTA (la segunda tarjeta) no deja un portal sin tarjetas, ni una zona huérfana, ni auditoría", async () => {
      const real = await persistenciaReal();
      let llamadas = 0;
      vi.mocked(crearTarjeta).mockImplementation(async (tx, args) => {
        llamadas += 1;
        if (llamadas === 2) throw new Error("falla forzada a mitad de camino");
        return real.crearTarjeta(tx, args);
      });
      try {
        await expect(guardar({ tarjetas: [tarjeta(sucursalA), tarjeta(sucursalB, { orden: 1 })], zonas: [zona(sucursalA)] })).rejects.toThrow("falla forzada");
        expect(await portales()).toEqual([]);
        expect(await prisma.portalTarjeta.count()).toBe(0);
        expect(await prisma.portalZona.count()).toBe(0);
        expect(await auditorias()).toEqual([]);
      } finally {
        vi.mocked(crearTarjeta).mockImplementation(real.crearTarjeta);
      }
    });

    it("una falla a mitad de un CAMBIO (al crear una zona nueva) deja el portal, sus tarjetas y la auditoría exactamente como estaban (versión incluida)", async () => {
      await guardar({ tarjetas: [tarjeta(sucursalA)] });
      const auditoriasAntes = await auditorias();
      const real = await persistenciaReal();
      vi.mocked(crearZona).mockImplementation(async () => {
        throw new Error("falla forzada al crear la zona");
      });
      try {
        await expect(guardar({ datos: { ...DATOS, titulo: "Nuevo" }, tarjetas: [tarjeta(sucursalA, { nombre: "Cambiada" })], zonas: [zona(sucursalA)], versionEsperada: 1 })).rejects.toThrow("falla forzada");
        expect(await portales()).toMatchObject([{ titulo: null, version: 1 }]);
        expect(await prisma.portalTarjeta.findMany()).toMatchObject([{ nombre: null, version: 1 }]);
        expect(await prisma.portalZona.count()).toBe(0);
        expect(await auditorias()).toHaveLength(auditoriasAntes.length);
      } finally {
        vi.mocked(crearZona).mockImplementation(real.crearZona);
      }
    });
  });

  describe("la Server Action", () => {
    const pedido = (extra: Record<string, unknown> = {}) => ({ variante: "A", logoVisible: true, tarjetas: [{ sucursalId: sucursalA, orden: 0, visible: true }], ...extra });

    it("el operador no puede (no escribe nada); el administrador sí; un pedido sin forma se rechaza antes de tocar la base", async () => {
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      expect((await guardarPortalDeEmpresa(pedido())).ok).toBe(false);
      expect(await portales()).toEqual([]);
      expect(await auditorias()).toEqual([]);

      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      for (const malo of [null, "texto", { ...pedido(), variante: "Z" }, { ...pedido(), colorPagina: "red" }, pedido({ tarjetas: [{ sucursalId: sucursalA, orden: 0, visible: true, telefono: "11 5555" }] }), pedido({ imagen: "https://evil.com/x.png" })]) {
        expect((await guardarPortalDeEmpresa(malo)).ok, JSON.stringify(malo)).toBe(false);
      }
      expect(await portales()).toEqual([]);

      expect(await guardarPortalDeEmpresa(pedido())).toMatchObject({ ok: true });
      expect(await portales()).toMatchObject([{ variante: "A", creadoPorId: usuarioId }]);
      // Repetir el mismo pedido: no cambia nada (ya estaba).
      expect(await guardarPortalDeEmpresa(pedido())).toMatchObject({ ok: true, mensaje: "El portal ya estaba así: no cambió nada." });
      expect(await portales()).toHaveLength(1);
    });

    it("el GERENTE de la empresa (rolEmpresa «gerente») puede: lo que cambia es la persona, no el permiso", async () => {
      const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: sucursalA, rolId: rolAdminId });
      await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
      await mockearUsuarioActual({ id: gerente.id, email: "gerente@test.com", nombre: null });
      expect(await guardarPortalDeEmpresa(pedido({ titulo: "Del gerente" }))).toMatchObject({ ok: true });
      expect(await portales()).toMatchObject([{ titulo: "Del gerente", creadoPorId: gerente.id }]);
      expect(await cuentaAuditorias("PortalDeEmpresa")).toBe(1);
    });

    it("la empresa, el id y el código salen del servidor, no del pedido: lo que mande el navegador se ignora; el código lo genera el servidor (22 caracteres, uno por alta)", async () => {
      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      await prismaAdmin.empresa.upsert({ where: { id: EMPRESA_TESTIGO_ID }, update: { estado: "ACTIVE" }, create: DATOS_EMPRESA_TESTIGO });
      try {
        const colado = { empresaId: EMPRESA_TESTIGO_ID, id: crypto.randomUUID(), portalId: crypto.randomUUID(), codigo: "c".repeat(30), codigoNuevo: "d".repeat(30) };
        expect(await guardarPortalDeEmpresa(pedido(colado))).toMatchObject({ ok: true });
        const [p] = await portales();
        expect(p).toMatchObject({ empresaId: EMPRESA_POR_DEFECTO_ID });
        expect(p!.id).not.toBe(colado.id);
        expect(p!.id).not.toBe(colado.portalId);
        expect(p!.codigo).toHaveLength(22);
        expect(p!.codigo).not.toBe(colado.codigo);
        expect(await prismaAdmin.portalDeEmpresa.count({ where: { empresaId: EMPRESA_TESTIGO_ID } })).toBe(0);
      } finally {
        await prismaAdmin.portalDeEmpresa.deleteMany({ where: { empresaId: EMPRESA_TESTIGO_ID } });
      }
    });
  });
});
