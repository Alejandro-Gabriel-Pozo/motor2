import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import type { EmpresaCarta } from "@/server/lecturas/carta/empresa";
import type { Db } from "@/lib/db-tipos";

/**
 * Categoría PUBLICA_ANONIMA_POR_CLAVE de la matriz de denegación (`denegacion/generadores.ts`): la PRUEBA PROPIA de sus cinco puertas, contra Postgres real y con el rol de la app (`motor2_app`, sujeto a RLS). Criterio de Pedernal: toda excepción al
 * aislamiento tiene nombre, motivo y una prueba propia que cae si aparece otra. Las puertas (las nombra `denegacion-por-defecto.test.ts`, que exige que estén todas acá): `resolverPortalCarta`, `resolverConfigPortal`, `resolverCartaPublica`, y las dos
 * duales del portal PR-A, `resolverPortalCartaDual` y `resolverConfigPortalDual`.
 *
 * «Por clave»: el anónimo entra con el código público de la empresa (su slug, `resolverEmpresaCarta`) y, para la carta, el de la sucursal. Qué se prueba:
 *  1. con el código de una empresa SOLO sale lo PUBLICADO de ESA empresa: ninguna fila de otra, ninguna sucursal sin publicar ni inactiva, ninguna tarjeta o zona del portal nuevo que apunte a una sucursal no publicada, inactiva o con la tarjeta oculta;
 *  2. un código inexistente, con forma rara, de una empresa suspendida, o de una empresa/sucursal/portal sin nada publicado, no devuelve nada (null, lista vacía o los valores de fábrica);
 *  3. FALLO CERRADO por la base: aunque a una puerta se le pase la empresa equivocada (un error de código), la RLS de la base de la empresa que la abrió no le deja ver nada de la otra;
 *  4. sin fila de `PortalDeEmpresa`, cada puerta DUAL devuelve EXACTAMENTE lo mismo que su original (la lectura de siempre).
 */
const AHORA = AHORA_DE_LA_CORRIDA;
const ZONA = { zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS" };
const [EA, EB, EC, ED, EE, EG] = ["empresa_a", "empresa_b", "empresa_c", "empresa_d", "empresa_e", "empresa_g"];
const UUID_D = "00000000-0000-4000-8000-0000000000d1";
const UUID_E = "00000000-0000-4000-8000-0000000000e1";
const CODIGO_D = "D".repeat(22);
const CODIGO_E = "E".repeat(22);

let base: BaseTemporalMigrada;
let duenio: PrismaClient;
let hayRol = false;
let publica: typeof import("@/server/lecturas/carta/publica");
let carta: typeof import("@/server/lecturas/carta/empresa");
let dbDeEmpresa: typeof import("@/server/sesion/base").dbDeEmpresa;
let prismaDelProceso: PrismaClient | undefined;
const entorno = { url: process.env.DATABASE_URL, prisma: (globalThis as { prisma?: PrismaClient }).prisma };

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarRestantes();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  duenio = new PrismaClient({ adapter: new PrismaPg({ connectionString: base.url }) });
  await sembrar(duenio); // el dueño de las tablas no está sujeto a las políticas: siembra aunque la base ya las traiga.
  // El runtime de `src/` (el rol de la app) apuntando a la base temporal: `src/lib/db.ts` lee `DATABASE_URL` al importarse.
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = new URL(base.url).pathname;
  process.env.DATABASE_URL = url.toString();
  delete (globalThis as { prisma?: PrismaClient }).prisma;
  vi.resetModules();
  publica = await import("@/server/lecturas/carta/publica");
  carta = await import("@/server/lecturas/carta/empresa");
  dbDeEmpresa = (await import("@/server/sesion/base")).dbDeEmpresa;
  prismaDelProceso = (await import("@/lib/db")).prisma;
});

afterAll(async () => {
  await prismaDelProceso?.$disconnect().catch(() => undefined);
  if (entorno.url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = entorno.url;
  (globalThis as { prisma?: PrismaClient }).prisma = entorno.prisma;
  await duenio?.$disconnect().catch(() => undefined);
  await base?.eliminar();
});

/**
 * Seis empresas. A y B: portal de siempre (sin `PortalDeEmpresa`); las dos tienen una sucursal con slug «central» y un tema del portal con su propio nombre público. A, además: «norte» publicada, «oculta» sin publicar y «cerrada» publicada pero inactiva.
 * C: suspendida. D: portal nuevo variante A (tarjetas): una tarjeta visible de sucursal publicada, una oculta, una visible de sucursal sin publicar y una visible de sucursal inactiva. E: portal nuevo variante B (zonas): una visible y publicada, una visible sin publicar.
 * G: nada publicado (una sola sucursal sin publicar y sin portal nuevo).
 */
async function sembrar(d: PrismaClient) {
  for (const [id, slug, estado] of [[EA, "emp-a", "ACTIVE"], [EB, "emp-b", "ACTIVE"], [EC, "emp-c", "SUSPENDED"], [ED, "emp-d", "ACTIVE"], [EE, "emp-e", "ACTIVE"], [EG, "emp-g", "ACTIVE"]] as const) {
    await d.empresa.create({ data: { id, nombre: id, slug, estado, ...ZONA } });
    await d.moduloEmpresa.createMany({ data: ["carta", "promociones"].map((modulo) => ({ empresaId: id, modulo })) });
    await d.unidad.create({ data: { id: `u_${id}`, empresaId: id, nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    await d.seccionCarta.create({ data: { id: `sec_${id}`, empresaId: id, nombre: "Platos", orden: 1 } });
  }
  // id, empresa, nombre, slug, publicada, activa
  const sucursales: Array<[string, string, string, string, boolean, boolean]> = [
    ["a1", EA, "Central A", "central", true, true],
    ["a2", EA, "Norte A", "norte", true, true],
    ["a3", EA, "Oculta A", "oculta", false, true],
    ["a4", EA, "Cerrada A", "cerrada", true, false],
    ["b1", EB, "Central B", "central", true, true],
    ["c1", EC, "Central C", "central", true, true],
    ["d1", ED, "Visible D", "d-visible", true, true],
    ["d2", ED, "Tarjeta oculta D", "d-tarjeta-oculta", true, true],
    ["d3", ED, "Sin publicar D", "d-sin-publicar", false, true],
    ["d4", ED, "Inactiva D", "d-inactiva", true, false],
    ["e1", EE, "Zona visible E", "e-visible", true, true],
    ["e2", EE, "Zona sin publicar E", "e-sin-publicar", false, true],
    ["g1", EG, "Sin publicar G", "g-sin-publicar", false, true],
  ];
  for (const [id, empresaId, nombre, slug, publicada, activo] of sucursales) {
    await d.sucursal.create({ data: { id, empresaId, nombre, activo } });
    await d.sucursalPublica.create({ data: { empresaId, sucursalId: id, slug, publicada } });
  }
  await d.portalCartaEmpresa.create({ data: { empresaId: EA, valores: { portal_nombre_publico: "Nombre público A" } } });
  await d.portalCartaEmpresa.create({ data: { empresaId: EB, valores: { portal_nombre_publico: "Nombre público B" } } });
  // Portal nuevo (solo las filas del portal; la tabla guarda la variante y los textos que el dual usa en lugar del Json).
  await base.cliente.query(`INSERT INTO "PortalDeEmpresa" ("id","empresaId","codigo","variante","titulo","creadoPorId","actualizadoEn") VALUES ($1,$2,$3,'A','Portal D','u',now()), ($4,$5,$6,'B','Portal E','u',now())`, [UUID_D, ED, CODIGO_D, UUID_E, EE, CODIGO_E]);
  for (const [sucursal, orden, visible] of [["d1", 1, true], ["d2", 2, false], ["d3", 3, true], ["d4", 4, true]] as const) {
    await base.cliente.query(`INSERT INTO "PortalTarjeta" ("empresaId","portalId","sucursalId","orden","visible","actualizadoEn") VALUES ($1,$2,$3,$4,$5,now())`, [ED, UUID_D, sucursal, orden, visible]);
  }
  for (const [zona, sucursal] of [["00000000-0000-4000-8000-0000000000e2", "e1"], ["00000000-0000-4000-8000-0000000000e3", "e2"]] as const) {
    await base.cliente.query(`INSERT INTO "PortalZona" ("id","empresaId","portalId","sucursalId","x","y","ancho","alto","visible","actualizadoEn") VALUES ($1,$2,$3,$4,10,10,20,20,true,now())`, [zona, EE, UUID_E, sucursal]);
  }
  // Una carta mínima por sucursal publicada de A y B: cada una con un plato que solo es suyo.
  const plato = async (id: string, empresaId: string, sucursalId: string, nombre: string, precio: number) => {
    await d.producto.create({ data: { id, empresaId, codigo: id.toUpperCase(), nombre, tipo: "PV", precioVenta: precio, unidadStockId: `u_${empresaId}` } });
    await d.disponibilidadProducto.create({ data: { empresaId, sucursalId, productoId: id, disponible: true } });
    await d.contenidoCartaProducto.create({ data: { empresaId, sucursalId, productoId: id, visibleEnCarta: true, seccionCartaId: `sec_${empresaId}` } });
  };
  await plato("p_a1", EA, "a1", "Plato A1", 1000);
  await plato("p_a2", EA, "a2", "Plato A2", 2000);
  await plato("p_a3", EA, "a3", "Plato A3 sin publicar", 3000);
  await plato("p_b1", EB, "b1", "Plato B1", 900);
}

const slugs = (entradas: Array<{ slug: string }>) => entradas.map((e) => e.slug).sort();
/** La empresa que resuelve el código público (la entrada del anónimo). */
async function empresa(codigo: string): Promise<EmpresaCarta> {
  const e = await carta.resolverEmpresaCarta(codigo, prismaDelProceso as unknown as Db);
  expect(e, `el código ${codigo} tiene que resolver`).not.toBeNull();
  return e!;
}
/** Las dos bases que arma `server/carta-publica/sin-sesion.ts`: la de la empresa y, ya resuelta la sucursal, la de SOLO LECTURA en esa sucursal. */
const basesDe = (empresaId: string) => ({ deLaEmpresa: dbDeEmpresa(empresaId), deLaSucursal: (sucursalId: string) => dbDeEmpresa(empresaId, { lectura: [sucursalId], escritura: [] }) });
const resumen = (r: Awaited<ReturnType<typeof publica.resolverCartaPublica>>) => (r ? { sucursal: r.carta.sucursal.nombre, items: r.carta.secciones.flatMap((s) => s.items.map((i) => i.nombre)).sort() } : null);

describe("PUBLICA_ANONIMA_POR_CLAVE: las cinco puertas de la carta pública anónima, contra Postgres real y el rol de la app", () => {
  it("resolverPortalCarta y resolverPortalCartaDual: con el código de la empresa solo salen sus sucursales PUBLICADAS y activas (ninguna de otra empresa, ni sin publicar, ni inactiva)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const puerta of [publica.resolverPortalCarta, publica.resolverPortalCartaDual]) {
      expect(slugs(await puerta(await empresa("emp-a"), dbDeEmpresa(EA))), `${puerta.name}: A`).toEqual(["central", "norte"]);
      expect(slugs(await puerta(await empresa("emp-b"), dbDeEmpresa(EB))), `${puerta.name}: B`).toEqual(["central"]);
    }
  });

  it("resolverConfigPortal y resolverConfigPortalDual: cada empresa ve SU apariencia, nunca la de otra", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const puerta of [publica.resolverConfigPortal, publica.resolverConfigPortalDual]) {
      const deA = JSON.stringify(await puerta(await empresa("emp-a"), dbDeEmpresa(EA)));
      const deB = JSON.stringify(await puerta(await empresa("emp-b"), dbDeEmpresa(EB)));
      expect(deA, `${puerta.name}: A`).toContain("Nombre público A");
      expect(deA, `${puerta.name}: A no trae lo de B`).not.toContain("Nombre público B");
      expect(deB, `${puerta.name}: B`).toContain("Nombre público B");
      expect(deB, `${puerta.name}: B no trae lo de A`).not.toContain("Nombre público A");
    }
  });

  it("resolverCartaPublica: con el código de la empresa y el de la sucursal sale la carta de ESA sucursal (ni otra sucursal, ni otra empresa con el mismo slug «central»)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const a = await empresa("emp-a");
    const b = await empresa("emp-b");
    expect(resumen(await publica.resolverCartaPublica(a, "central", basesDe(EA), AHORA))).toEqual({ sucursal: "Central A", items: ["Plato A1"] });
    expect(resumen(await publica.resolverCartaPublica(a, "norte", basesDe(EA), AHORA))).toEqual({ sucursal: "Norte A", items: ["Plato A2"] });
    expect(resumen(await publica.resolverCartaPublica(b, "central", basesDe(EB), AHORA))).toEqual({ sucursal: "Central B", items: ["Plato B1"] });
  });

  it("portal nuevo (dual): variante A muestra solo las tarjetas visibles de sucursales publicadas y activas; variante B, solo las zonas visibles de sucursales publicadas y activas", async (ctx) => {
    if (!hayRol) return ctx.skip();
    expect(slugs(await publica.resolverPortalCartaDual(await empresa("emp-d"), dbDeEmpresa(ED)))).toEqual(["d-visible"]);
    expect(slugs(await publica.resolverPortalCartaDual(await empresa("emp-e"), dbDeEmpresa(EE)))).toEqual(["e-visible"]);
    // La apariencia del dual sale del portal nuevo de ESA empresa: ni el Json de otra ni el de fábrica de otra.
    expect(JSON.stringify(await publica.resolverConfigPortalDual(await empresa("emp-d"), dbDeEmpresa(ED)))).toContain("Portal D");
    expect(JSON.stringify(await publica.resolverConfigPortalDual(await empresa("emp-e"), dbDeEmpresa(EE)))).toContain("Portal E");
    expect(JSON.stringify(await publica.resolverConfigPortalDual(await empresa("emp-d"), dbDeEmpresa(ED)))).not.toContain("Portal E");
  });

  it("un código inexistente, con forma rara, de una empresa suspendida: no resuelve (null); una empresa sin nada publicado devuelve lista vacía, valores de fábrica y carta null", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const db = prismaDelProceso as unknown as Db;
    for (const codigo of ["no-existe", "emp-c", "", "%", "emp-a' OR '1'='1", "../emp-a", "EMP-A", "emp a"]) expect(await carta.resolverEmpresaCarta(codigo, db), `«${codigo}»`).toBeNull();
    const g = await empresa("emp-g");
    for (const puerta of [publica.resolverPortalCarta, publica.resolverPortalCartaDual]) expect(await puerta(g, dbDeEmpresa(EG)), puerta.name).toEqual([]);
    const defecto = publica.resolverConfigPortal;
    expect(await publica.resolverConfigPortalDual(g, dbDeEmpresa(EG))).toEqual(await defecto(g, dbDeEmpresa(EG)));
    expect(JSON.stringify(await defecto(g, dbDeEmpresa(EG)))).not.toContain("Nombre público");
    expect(await publica.resolverCartaPublica(g, "g-sin-publicar", basesDe(EG), AHORA), "sucursal sin publicar").toBeNull();
  });

  it("resolverCartaPublica con un código de sucursal que no resuelve da null: inexistente, de OTRA empresa, sin publicar, inactiva, con forma rara", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const a = await empresa("emp-a");
    const b = await empresa("emp-b");
    const sinResolver: Array<[string, EmpresaCarta, string]> = [
      ["no existe", a, "no-existe"],
      ["«norte» es de A, no de B", b, "norte"],
      ["sin publicar", a, "oculta"],
      ["sucursal inactiva", a, "cerrada"],
      ["vacío", a, ""],
      ["comodín", a, "%"],
      ["inyección", a, "central' OR '1'='1"],
      ["salir de la ruta", a, "../emp-b/central"],
      ["el id de la sucursal en lugar del slug", a, "a1"],
      ["mayúsculas", a, "CENTRAL"],
    ];
    for (const [caso, e, slug] of sinResolver) expect(await publica.resolverCartaPublica(e, slug, basesDe(e.id), AHORA), caso).toBeNull();
  });

  it("FALLO CERRADO por la RLS: con la empresa equivocada (error de código) las cinco puertas no ven ni una fila de la otra empresa", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const a = await empresa("emp-a");
    const b = await empresa("emp-b");
    const d = await empresa("emp-d");
    const fabrica = JSON.stringify(await publica.resolverConfigPortal(await empresa("emp-g"), dbDeEmpresa(EG)));
    // Se le pasa la empresa B, pero la base la abrió la empresa A (y al revés): el filtro por `empresaId` coincide con la otra y la política de la base lo deja en cero.
    for (const puerta of [publica.resolverPortalCarta, publica.resolverPortalCartaDual]) {
      expect(await puerta(b, dbDeEmpresa(EA)), `${puerta.name}: B con la base de A`).toEqual([]);
      expect(await puerta(a, dbDeEmpresa(EB)), `${puerta.name}: A con la base de B`).toEqual([]);
      expect(await puerta(d, dbDeEmpresa(EA)), `${puerta.name}: D (portal nuevo) con la base de A`).toEqual([]);
    }
    for (const puerta of [publica.resolverConfigPortal, publica.resolverConfigPortalDual]) {
      expect(JSON.stringify(await puerta(b, dbDeEmpresa(EA))), `${puerta.name}: B con la base de A`).toBe(fabrica);
      expect(JSON.stringify(await puerta(d, dbDeEmpresa(EA))), `${puerta.name}: D con la base de A`).toBe(fabrica);
    }
    expect(await publica.resolverCartaPublica(b, "central", basesDe(EA), AHORA), "carta de B con las bases de A").toBeNull();
    expect(await publica.resolverCartaPublica(a, "central", basesDe(EB), AHORA), "carta de A con las bases de B").toBeNull();
    // Con la base de la sucursal equivocada la carta no se arma con datos de la otra: sale vacía o null, nunca el plato de la otra sucursal.
    const mezclada = await publica.resolverCartaPublica(a, "central", { deLaEmpresa: dbDeEmpresa(EA), deLaSucursal: () => dbDeEmpresa(EA, { lectura: ["a2"], escritura: [] }) }, AHORA);
    expect(resumen(mezclada)?.items ?? [], "la base de a2 no deja ver el plato de a1").not.toContain("Plato A1");
  });

  it("sin fila de PortalDeEmpresa, las duales devuelven EXACTAMENTE lo mismo que las originales (A, B y G)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const [codigo, id] of [["emp-a", EA], ["emp-b", EB], ["emp-g", EG]] as const) {
      const e = await empresa(codigo);
      expect(await publica.resolverPortalCartaDual(e, dbDeEmpresa(id)), `portal de ${codigo}`).toEqual(await publica.resolverPortalCarta(e, dbDeEmpresa(id)));
      expect(await publica.resolverConfigPortalDual(e, dbDeEmpresa(id)), `apariencia de ${codigo}`).toEqual(await publica.resolverConfigPortal(e, dbDeEmpresa(id)));
    }
  });
});
