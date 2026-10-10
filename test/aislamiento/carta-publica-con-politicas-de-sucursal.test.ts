import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { sqlDeAlcanceDeSucursal } from "../setup/politicas-de-alcance-de-sucursal";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

// La carta pública cachea con `unstable_cache` (necesita el caché de Next, que fuera de un pedido no existe): acá corre directo. La clave y la etiqueta las prueban `cartas-publicas-cache-por-empresa.test.ts` y el e2e.
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), unstable_cache: (fn: () => unknown) => fn }));
// La base real, con un espía en `dbDeEmpresa` para ver con qué alcance abre la carta pública cada lectura (y quedarnos con la base que abrió).
vi.mock("@/core/auth/base", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/auth/base")>();
  return { ...original, dbDeEmpresa: vi.fn(original.dbDeEmpresa) };
});

/**
 * M.3-A7 (RLS por sucursal, Fase A): la CARTA PÚBLICA contra las políticas de la Fase B, sobre Postgres real. Se arma una base TEMPORAL con todas las migraciones (`crearBaseTemporalMigrada`:
 * solo Postgres local, jamás `motor2_dev` ni `motor2_e2e`), se le aplica el SQL de las políticas por sucursal que genera `test/setup/politicas-de-alcance-de-sucursal.ts` (el borrador de la
 * Fase B; NO es una migración) y se corre `server/carta-publica/sin-sesion.ts` —la entrada que importan las páginas— contra ella con el rol de la app (`motor2_app`, sujeto a RLS).
 *
 * Qué prueba (con las políticas puestas, que es como va a estar la base en producción):
 *  - con el slug de una sucursal se ve la carta de ESA sucursal y de ninguna otra, aunque la base tenga las de otras sucursales de la misma empresa y las de otras empresas (incluida una que
 *    usa el MISMO slug «central»); precios locales, tema y promos incluidos;
 *  - la base con la que se lee la carta es de SOLO LECTURA en esa única sucursal: ni ve filas de las otras ni puede escribir;
 *  - un slug que no resuelve (inexistente, de otra empresa, sin publicar, de una sucursal inactiva, con caracteres raros) da el mismo `null` de siempre y NO abre ninguna lectura por sucursal;
 *  - una empresa suspendida no resuelve (404), igual que antes.
 * El rojo previo: con el código anterior (`dbDeEmpresa(empresa.id)` SIN alcance) estas políticas ocultan toda la carta (falla cerrado) y el primer caso da una carta vacía.
 * Mutaciones (revertidas editando `sin-sesion.ts`): alcance de lectura con la sucursal equivocada, con escritura = la sucursal, o sin alcance ⇒ rojo.
 */
const EA = "empresa_a";
const EB = "empresa_b";
const EC = "empresa_c";
const ZONA = { zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS" };
// El reloj entra por parámetro (`cartaPublica(…, ahora)` solo lo usa para `generadoEn`) y no se compara con filas creadas por `now()`: el «ahora» de la corrida alcanza.
const AHORA = AHORA_DE_LA_CORRIDA;

let base: BaseTemporalMigrada;
let duenio: PrismaClient;
let hayRol = false;
let sinSesion: typeof import("@/server/carta-publica/sin-sesion");
let dbDeEmpresa: ReturnType<typeof vi.mocked<typeof import("@/core/auth/base").dbDeEmpresa>>;
let prismaDelProceso: PrismaClient | undefined;
const entorno = { url: process.env.DATABASE_URL, prisma: (globalThis as { prisma?: PrismaClient }).prisma };

/** Lo que un anónimo ve de una carta, resumido para comparar. */
function resumen(r: Awaited<ReturnType<typeof sinSesion.cartaPublica>>) {
  if (!r) return null;
  return {
    sucursal: r.carta.sucursal.nombre,
    estilo: r.estilo.valores.restaurante_nombre,
    items: r.carta.secciones.flatMap((s) => s.items.map((i) => `${i.nombre}:${i.precio}`)).sort(),
    promos: r.carta.secciones.flatMap((s) => s.promos.map((p) => p.titulo)).sort(),
  };
}

async function empresa(slug: string) {
  const e = await sinSesion.empresaCartaPublica(slug);
  expect(e, `la empresa ${slug} tiene que resolver`).not.toBeNull();
  return e!;
}

/** Los alcances con que se abrió una base POR SUCURSAL (los de `dbDeEmpresa(empresa, alcance)`), en orden. La del nivel empresa (sin alcance) no cuenta. */
const alcancesAbiertos = () => dbDeEmpresa.mock.calls.filter((c) => c[1] !== undefined).map((c) => ({ empresa: c[0], alcance: c[1] }));

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarRestantes();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  duenio = new PrismaClient({ adapter: new PrismaPg({ connectionString: base.url }) });
  await sembrar(duenio);
  await base.cliente.query(sqlDeAlcanceDeSucursal());

  // El runtime de `src/` (el rol de la app, `motor2_app`) apuntando a la base temporal: `src/lib/db.ts` lee `DATABASE_URL` al importarse y se queda con un singleton en `globalThis`.
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = new URL(base.url).pathname;
  process.env.DATABASE_URL = url.toString();
  delete (globalThis as { prisma?: PrismaClient }).prisma;
  vi.resetModules();
  sinSesion = await import("@/server/carta-publica/sin-sesion");
  dbDeEmpresa = vi.mocked((await import("@/core/auth/base")).dbDeEmpresa);
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

/** Tres empresas. A: dos sucursales publicadas («central» y «norte»), una sin publicar y una inactiva. B: una sucursal que TAMBIÉN se llama «central». C: suspendida. */
async function sembrar(d: PrismaClient) {
  for (const [id, slug, estado] of [[EA, "emp-a", "ACTIVE"], [EB, "emp-b", "ACTIVE"], [EC, "emp-c", "SUSPENDED"]] as const) {
    await d.empresa.create({ data: { id, nombre: id, slug, estado, ...ZONA } });
    await d.moduloEmpresa.createMany({ data: ["carta", "promociones"].map((modulo) => ({ empresaId: id, modulo })) });
    await d.unidad.create({ data: { id: `u_${id}`, empresaId: id, nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    await d.seccionCarta.create({ data: { id: `sec_${id}`, empresaId: id, nombre: "Platos", orden: 1 } });
  }
  // El Precio Local rige en toda la empresa A (la fila por defecto, `sucursalId` NULL); `Accion` es el catálogo global de acciones que la FK exige.
  await d.accion.create({ data: { clave: "precio_local", descripcion: "Fijar Precio Local por sucursal" } });
  await d.capacidadSucursal.create({ data: { empresaId: EA, accionClave: "precio_local", sucursalId: null, habilitado: true } });

  const sucursales: Array<[string, string, string, string, boolean, boolean]> = [
    // id, empresa, nombre, slug, publicada, activa
    ["suc_a1", EA, "Central A", "central", true, true],
    ["suc_a2", EA, "Norte A", "norte", true, true],
    ["suc_a3", EA, "Oculta A", "oculta", false, true],
    ["suc_a4", EA, "Cerrada A", "cerrada", true, false],
    ["suc_b1", EB, "Central B", "central", true, true],
    ["suc_c1", EC, "Central C", "central", true, true],
  ];
  for (const [id, empresaId, nombre, slug, publicada, activo] of sucursales) {
    await d.sucursal.create({ data: { id, empresaId, nombre, activo } });
    await d.sucursalPublica.create({ data: { empresaId, sucursalId: id, slug, publicada } });
  }
  // Un tema aplicado por sucursal: si la lectura mezclara sucursales, el nombre del restaurante delataría cuál se leyó.
  for (const [id, empresaId, nombre] of [["suc_a1", EA, "Tema A1"], ["suc_a2", EA, "Tema A2"], ["suc_b1", EB, "Tema B1"]] as const) {
    await d.temaCartaSucursal.create({ data: { empresaId, sucursalId: id, valores: { restaurante_nombre: nombre }, aplicarEnCarta: true } });
  }

  // Productos de la empresa A (los productos son de la empresa; lo propio de cada sucursal es su disponibilidad, su contenido de carta y su precio local).
  const producto = (id: string, empresaId: string, nombre: string, precio: number) =>
    d.producto.create({ data: { id, empresaId, codigo: id.toUpperCase(), nombre, tipo: "PV", precioVenta: precio, unidadStockId: `u_${empresaId}` } });
  await producto("p_bife", EA, "Bife A1", 1000);
  await producto("p_pizza", EA, "Pizza A2", 2000);
  await producto("p_agua", EA, "Agua", 100);
  await producto("p_bife_b", EB, "Bife B1", 900);
  const enCarta = async (empresaId: string, sucursalId: string, productoId: string) => {
    await d.disponibilidadProducto.create({ data: { empresaId, sucursalId, productoId, disponible: true } });
    await d.contenidoCartaProducto.create({ data: { empresaId, sucursalId, productoId, visibleEnCarta: true, seccionCartaId: `sec_${empresaId}` } });
  };
  await enCarta(EA, "suc_a1", "p_bife");
  await enCarta(EA, "suc_a1", "p_agua");
  await enCarta(EA, "suc_a2", "p_pizza");
  await enCarta(EA, "suc_a2", "p_agua");
  await enCarta(EA, "suc_a3", "p_agua");
  await enCarta(EA, "suc_a4", "p_agua");
  await enCarta(EB, "suc_b1", "p_bife_b");
  // Precios locales distintos para el mismo producto: un cruce entre sucursales se vería en el precio.
  await d.precioLocalProducto.createMany({
    data: [
      { empresaId: EA, sucursalId: "suc_a1", productoId: "p_agua", precio: 300 },
      { empresaId: EA, sucursalId: "suc_a2", productoId: "p_agua", precio: 400 },
      { empresaId: EA, sucursalId: "suc_a2", productoId: "p_bife", precio: 9999 },
    ],
  });
  // Una promo por sucursal, cada una ofrecida solo en la suya.
  for (const [id, titulo, sucursalId] of [["promo_a1", "Promo A1", "suc_a1"], ["promo_a2", "Promo A2", "suc_a2"]] as const) {
    await d.promoCarta.create({ data: { id, empresaId: EA, seccionCartaId: `sec_${EA}`, titulo, precio: 500 } });
    await d.promoCartaSucursal.create({ data: { empresaId: EA, promoCartaId: id, sucursalId } });
  }
}

const CARTA_A1 = { sucursal: "Central A", estilo: "Tema A1", items: ["Agua:300", "Bife A1:1000"], promos: ["Promo A1"] };
const CARTA_A2 = { sucursal: "Norte A", estilo: "Tema A2", items: ["Agua:400", "Pizza A2:2000"], promos: ["Promo A2"] };
const CARTA_B1 = { sucursal: "Central B", estilo: "Tema B1", items: ["Bife B1:900"], promos: [] };

describe("la carta pública con las políticas de la RLS por sucursal puestas", () => {
  it("con el slug de una sucursal se ve la carta de esa sucursal (precios locales, tema y promos propios), no la de otra de la misma empresa", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const a = await empresa("emp-a");
    expect(resumen(await sinSesion.cartaPublica(a, "central", AHORA))).toEqual(CARTA_A1);
    expect(resumen(await sinSesion.cartaPublica(a, "norte", AHORA))).toEqual(CARTA_A2);
  });

  it("dos empresas con una sucursal llamada «central»: cada una ve la suya", async (ctx) => {
    if (!hayRol) return ctx.skip();
    expect(resumen(await sinSesion.cartaPublica(await empresa("emp-a"), "central", AHORA))).toEqual(CARTA_A1);
    expect(resumen(await sinSesion.cartaPublica(await empresa("emp-b"), "central", AHORA))).toEqual(CARTA_B1);
  });

  it("cada lectura abre UNA base por sucursal, de SOLO LECTURA en la sucursal que resolvió el slug (lectura = [esa], escritura = [])", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const a = await empresa("emp-a");
    dbDeEmpresa.mockClear();
    await sinSesion.cartaPublica(a, "norte", AHORA);
    expect(alcancesAbiertos()).toEqual([{ empresa: EA, alcance: { lectura: ["suc_a2"], escritura: [] } }]);
    dbDeEmpresa.mockClear();
    await sinSesion.cartaPublica(await empresa("emp-b"), "central", AHORA);
    expect(alcancesAbiertos()).toEqual([{ empresa: EB, alcance: { lectura: ["suc_b1"], escritura: [] } }]);
  });

  it("la base con la que se lee la carta ve solo las filas de esa sucursal en TODAS las tablas por sucursal, aunque la consulta no filtre, y no puede escribir", async (ctx) => {
    if (!hayRol) return ctx.skip();
    dbDeEmpresa.mockClear();
    await sinSesion.cartaPublica(await empresa("emp-a"), "central", AHORA);
    const abiertas = dbDeEmpresa.mock.results.filter((_, i) => dbDeEmpresa.mock.calls[i]![1] !== undefined);
    expect(abiertas).toHaveLength(1);
    const db = abiertas[0]!.value as PrismaClient;
    // Sin ningún `where`: lo que decide es la base, no el filtro de la consulta.
    const sucursalesDe = async (filas: Promise<Array<{ sucursalId: string }>>) => [...new Set((await filas).map((f) => f.sucursalId))];
    expect(await sucursalesDe(db.disponibilidadProducto.findMany({ select: { sucursalId: true } }))).toEqual(["suc_a1"]);
    expect(await sucursalesDe(db.contenidoCartaProducto.findMany({ select: { sucursalId: true } }))).toEqual(["suc_a1"]);
    expect(await sucursalesDe(db.precioLocalProducto.findMany({ select: { sucursalId: true } }))).toEqual(["suc_a1"]);
    expect(await sucursalesDe(db.promoCartaSucursal.findMany({ select: { sucursalId: true } }))).toEqual(["suc_a1"]);
    expect(await sucursalesDe(db.temaCartaSucursal.findMany({ select: { sucursalId: true } }))).toEqual(["suc_a1"]);
    // Escribir en la propia sucursal tampoco: la escritura del alcance está vacía.
    await expect(db.disponibilidadProducto.create({ data: { sucursalId: "suc_a1", productoId: "p_pizza", disponible: true } })).rejects.toThrow(/row-level security|42501/i);
    await expect(db.disponibilidadProducto.updateMany({ data: { disponible: false } })).resolves.toEqual({ count: 0 });
    await expect(db.disponibilidadProducto.deleteMany({})).resolves.toEqual({ count: 0 });
  });

  it("un slug que no resuelve da null y NO abre ninguna lectura por sucursal: inexistente, de OTRA empresa, sin publicar, de una sucursal inactiva, vacío o con caracteres raros", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const a = await empresa("emp-a");
    const b = await empresa("emp-b");
    dbDeEmpresa.mockClear();
    const sinResolver: Array<[string, typeof a, string]> = [
      ["no existe", a, "no-existe"],
      ["slug de OTRA empresa: «norte» es de A, no de B", b, "norte"],
      ["sin publicar", a, "oculta"],
      ["sucursal inactiva", a, "cerrada"],
      ["vacío", a, ""],
      ["comodín de LIKE", a, "%"],
      ["porcentaje codificado", a, "%25"],
      ["con espacio", a, "centra l"],
      ["intento de salir de la ruta", a, "../emp-b/central"],
      ["inyección", a, "central' OR '1'='1"],
      ["id de sucursal en lugar del slug", a, "suc_a1"],
      ["mayúsculas", a, "CENTRAL"],
    ];
    for (const [caso, empresaDelPedido, slug] of sinResolver) expect(await sinSesion.cartaPublica(empresaDelPedido, slug, AHORA), caso).toBeNull();
    expect(alcancesAbiertos(), "ningún slug que no resuelve abrió una lectura por sucursal").toEqual([]);
  });

  it("una empresa suspendida no resuelve (404 sin decir que existe) y el portal sigue listando solo lo publicado y activo de la empresa pedida", async (ctx) => {
    if (!hayRol) return ctx.skip();
    expect(await sinSesion.empresaCartaPublica("emp-c")).toBeNull();
    expect(await sinSesion.empresaCartaPublica("no-existe")).toBeNull();
    expect((await sinSesion.portalCartaPublico(await empresa("emp-a"))).map((s) => s.slug).sort()).toEqual(["central", "norte"]);
    expect((await sinSesion.portalCartaPublico(await empresa("emp-b"))).map((s) => s.slug)).toEqual(["central"]);
  });
});
