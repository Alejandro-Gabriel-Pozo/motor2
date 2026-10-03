import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Migración de DATOS de la carta propia por sucursal (20261002150000_carta_propia_por_sucursal, ADR-009 C3/C4): arma una base temporal con las
 * migraciones anteriores, le carga la carta que ya existía (una sola por empresa), aplica la migración y mira adónde fue a parar cada fila.
 * Regla: cada empresa deja su carta en UNA sola sucursal (publicada > activa > primera; la más antigua, desempate por id); una empresa sin
 * sucursales pierde sus filas de estructura; las secciones no se tocan.
 */
const MIGRACION = "20261002150000_carta_propia_por_sucursal";

const TABLAS = ["ContenidoCartaProducto", "GeneroCarta", "ItemAgrupadoCarta", "OpcionItemAgrupadoCarta"] as const;

let base: BaseTemporalMigrada;

async function sql(consulta: string, parametros: unknown[] = []) {
  return base.cliente.query(consulta, parametros);
}

async function empresa(id: string) {
  await sql(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [id]);
}

async function sucursal(empresaId: string, id: string, creadoEn: string, opciones: { activo?: boolean; publicada?: boolean } = {}) {
  await sql(`INSERT INTO "Sucursal" ("id","empresaId","nombre","activo","creadoEn") VALUES ($1,$2,$1,$3,$4)`, [id, empresaId, opciones.activo ?? true, creadoEn]);
  if (opciones.publicada !== undefined) {
    await sql(`INSERT INTO "SucursalPublica" ("id","empresaId","sucursalId","slug","publicada","actualizadoEn") VALUES ($1,$2,$3,$3,$4,now())`, [`pub-${id}`, empresaId, id, opciones.publicada]);
  }
}

/** Una carta mínima pero completa (sección, producto, género, contenido, ítem agrupado y su opción) para la empresa. */
async function cartaDe(empresaId: string) {
  const p = (s: string) => `${s}-${empresaId}`;
  await sql(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ($1,$2,'unidad','CANTIDAD')`, [p("u"), empresaId]);
  await sql(`INSERT INTO "SeccionCarta" ("id","empresaId","nombre","orden") VALUES ($1,$2,'Sección',1)`, [p("sec"), empresaId]);
  await sql(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ($1,$2,'P1','Plato','PV',$3)`, [p("prod"), empresaId, p("u")]);
  await sql(`INSERT INTO "GeneroCarta" ("id","empresaId","nombre") VALUES ($1,$2,'Género')`, [p("gen"), empresaId]);
  await sql(
    `INSERT INTO "ContenidoCartaProducto" ("id","empresaId","productoId","visibleEnCarta","seccionCartaId","generoCartaId","actualizadoEn") VALUES ($1,$2,$3,true,$4,$5,now())`,
    [p("cont"), empresaId, p("prod"), p("sec"), p("gen")]
  );
  await sql(`INSERT INTO "ItemAgrupadoCarta" ("id","empresaId","nombre","seccionCartaId","generoCartaId","actualizadoEn") VALUES ($1,$2,'Ítem',$3,$4,now())`, [p("item"), empresaId, p("sec"), p("gen")]);
  await sql(`INSERT INTO "OpcionItemAgrupadoCarta" ("id","empresaId","itemAgrupadoCartaId","productoId") VALUES ($1,$2,$3,$4)`, [p("opc"), empresaId, p("item"), p("prod")]);
}

async function sucursalesConCarta(empresaId: string): Promise<Record<string, string[]>> {
  const salida: Record<string, string[]> = {};
  for (const tabla of TABLAS) {
    const r = await sql(`SELECT DISTINCT "sucursalId" FROM "${tabla}" WHERE "empresaId" = $1 ORDER BY 1`, [empresaId]);
    salida[tabla] = r.rows.map((f) => f.sucursalId);
  }
  return salida;
}

const TODAS = (sucursalId: string) => ({
  ContenidoCartaProducto: [sucursalId],
  GeneroCarta: [sucursalId],
  ItemAgrupadoCarta: [sucursalId],
  OpcionItemAgrupadoCarta: [sucursalId],
});

describe("migración de datos: la carta que ya había queda en UNA sucursal por empresa", () => {
  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(MIGRACION);

    // A: la publicada MÁS ANTIGUA gana, aunque haya una sucursal anterior sin publicar, una publicada más nueva y una con SucursalPublica sin publicar.
    await empresa("emp-publicada");
    await sucursal("emp-publicada", "pub-sin-publicar", "2026-01-01T00:00:00Z", { publicada: false });
    await sucursal("emp-publicada", "pub-b-nueva", "2026-03-01T00:00:00Z", { publicada: true });
    await sucursal("emp-publicada", "pub-a-vieja", "2026-02-01T00:00:00Z", { publicada: true });
    await sucursal("emp-publicada", "pub-sin-fila", "2026-01-15T00:00:00Z");
    await cartaDe("emp-publicada");

    // B: ninguna publicada: la primera ACTIVA (no la inactiva más antigua).
    await empresa("emp-activa");
    await sucursal("emp-activa", "act-inactiva-vieja", "2026-01-01T00:00:00Z", { activo: false });
    await sucursal("emp-activa", "act-activa-nueva", "2026-05-01T00:00:00Z");
    await sucursal("emp-activa", "act-activa-mas-nueva", "2026-06-01T00:00:00Z");
    await cartaDe("emp-activa");

    // C: todas inactivas y ninguna publicada: la más antigua sin más.
    await empresa("emp-inactivas");
    await sucursal("emp-inactivas", "ina-nueva", "2026-04-01T00:00:00Z", { activo: false });
    await sucursal("emp-inactivas", "ina-vieja", "2026-02-01T00:00:00Z", { activo: false });
    await cartaDe("emp-inactivas");

    // D: empate de fecha: desempata por id.
    await empresa("emp-empate");
    await sucursal("emp-empate", "emp-z", "2026-02-01T00:00:00Z");
    await sucursal("emp-empate", "emp-a", "2026-02-01T00:00:00Z");
    await cartaDe("emp-empate");

    // E: sin sucursales: no hay dónde mostrar la carta.
    await empresa("emp-sin-sucursales");
    await cartaDe("emp-sin-sucursales");

    // F: con sucursal pero SIN carta: no inventa filas.
    await empresa("emp-sin-carta");
    await sucursal("emp-sin-carta", "sc-1", "2026-01-01T00:00:00Z");

    await base.aplicarRestantes();
  }, 120_000);

  afterAll(async () => {
    await base?.eliminar();
  });

  it("empresa con sucursales publicadas: toda su carta va a la publicada más antigua", async () => {
    expect(await sucursalesConCarta("emp-publicada")).toEqual(TODAS("pub-a-vieja"));
  });

  it("sin ninguna publicada: la primera sucursal activa", async () => {
    expect(await sucursalesConCarta("emp-activa")).toEqual(TODAS("act-activa-nueva"));
  });

  it("todas inactivas y sin publicar: la más antigua", async () => {
    expect(await sucursalesConCarta("emp-inactivas")).toEqual(TODAS("ina-vieja"));
  });

  it("mismo creadoEn: desempata por id", async () => {
    expect(await sucursalesConCarta("emp-empate")).toEqual(TODAS("emp-a"));
  });

  it("empresa sin sucursales: se borran sus filas de estructura (y solo las suyas)", async () => {
    expect(await sucursalesConCarta("emp-sin-sucursales")).toEqual({ ContenidoCartaProducto: [], GeneroCarta: [], ItemAgrupadoCarta: [], OpcionItemAgrupadoCarta: [] });
    // La sección de la empresa sin sucursales y las de las demás no se tocan (las secciones siguen siendo de la empresa).
    const secciones = await sql(`SELECT count(*)::int AS n FROM "SeccionCarta"`);
    expect(secciones.rows[0].n).toBe(5);
  });

  it("empresa con sucursal pero sin carta: sigue sin carta", async () => {
    expect(await sucursalesConCarta("emp-sin-carta")).toEqual({ ContenidoCartaProducto: [], GeneroCarta: [], ItemAgrupadoCarta: [], OpcionItemAgrupadoCarta: [] });
  });

  it("no pierde ni duplica filas de las empresas con sucursales (1 por tabla y empresa) y conserva los vínculos entre ellas", async () => {
    for (const tabla of TABLAS) {
      const r = await sql(`SELECT "empresaId", count(*)::int AS n FROM "${tabla}" GROUP BY 1 ORDER BY 1`);
      expect(r.rows, tabla).toEqual(["emp-activa", "emp-empate", "emp-inactivas", "emp-publicada"].map((empresaId) => ({ empresaId, n: 1 })));
    }
    const vinculos = await sql(
      `SELECT count(*)::int AS n FROM "ContenidoCartaProducto" c JOIN "GeneroCarta" g ON g."id" = c."generoCartaId" AND g."sucursalId" = c."sucursalId"
       JOIN "ItemAgrupadoCarta" i ON i."generoCartaId" = g."id" AND i."sucursalId" = g."sucursalId"
       JOIN "OpcionItemAgrupadoCarta" o ON o."itemAgrupadoCartaId" = i."id" AND o."sucursalId" = i."sucursalId"`
    );
    expect(vinculos.rows[0].n).toBe(4);
  });

  it("deja la tabla temporal limpia y `sucursalId` NOT NULL con los únicos por sucursal", async () => {
    expect((await sql(`SELECT to_regclass('_carta_destino') AS t`)).rows[0].t).toBeNull();
    const columnas = await sql(
      `SELECT table_name, is_nullable FROM information_schema.columns WHERE column_name = 'sucursalId' AND table_name = ANY($1) ORDER BY table_name`,
      [[...TABLAS]]
    );
    expect(columnas.rows.map((f) => [f.table_name, f.is_nullable])).toEqual([...TABLAS].sort().map((t) => [t, "NO"]));

    const indices = await sql(`SELECT indexname FROM pg_indexes WHERE tablename = ANY($1)`, [[...TABLAS]]);
    const nombres = indices.rows.map((f) => f.indexname);
    expect(nombres).toEqual(expect.arrayContaining(["ContenidoCartaProducto_sucursalId_productoId_key", "GeneroCarta_sucursalId_nombre_key", "ItemAgrupadoCarta_sucursalId_nombre_key", "OpcionItemAgrupadoCarta_sucursalId_productoId_key"]));
    expect(nombres).not.toEqual(expect.arrayContaining(["ContenidoCartaProducto_empresaId_productoId_key"]));
  });
});
