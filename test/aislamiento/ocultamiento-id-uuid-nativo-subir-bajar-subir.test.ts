import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * «Ocultar» como Pedernal: el id de `OcultamientoProducto` pasa de TEXT + CHECK a `UUID` nativo (migración 20261117150000; molde de tabla nueva del frente 3). SUBIR, BAJAR y SUBIR sobre una base TEMPORAL migrada
 * como una real y con marcas ya cargadas. Prueba:
 *  - ANTES: el id es text y existe el CHECK; SUBIR: el id es uuid, el CHECK se fue, las marcas ya cargadas siguen con el MISMO id, la clave primaria y el único `(empresaId, id)` se reconstruyeron con el tipo nuevo;
 *  - la base decide: un id que no es uuid ya no entra (22P02, antes 23514); idempotencia del alta por id (`ON CONFLICT`) y dos altas simultáneas con el mismo id dejan UNA fila;
 *  - BAJAR CON DATOS no pierde ninguna marca (vuelve a text, mismo valor, con el CHECK repuesto); bajar dos veces no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida.
 * Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261117150000_ocultamiento_id_uuid_nativo";
const E = "empresa_uuid";
const ID1 = "00000000-0000-4000-8000-0000000000a1";
const ID2 = "00000000-0000-4000-8000-0000000000a2";
const ID3 = "00000000-0000-4000-8000-0000000000a3";

let base: BaseTemporalMigrada;
const abiertas: Client[] = [];
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");
const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);
const marca = (id: string, productoId: string, sucursalId: string | null) =>
  q(`INSERT INTO "OcultamientoProducto" ("id","empresaId","productoId","sucursalId","oculto","actualizadoPorId","actualizadoEn") VALUES ($1,$2,$3,$4,true,'u_uuid',now()) ON CONFLICT DO NOTHING`, [id, E, productoId, sucursalId]);
const falla = async (texto: string, params: unknown[] = []): Promise<string> => {
  await base.cliente.query("BEGIN");
  try {
    await base.cliente.query(texto, params);
    return "sin error";
  } catch (e) {
    return (e as { code?: string }).code ?? "sin código";
  } finally {
    await base.cliente.query("ROLLBACK");
  }
};

/** Una foto de lo que esta migración puede tocar de la tabla: columnas, restricciones e índices. */
async function foto() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'OcultamientoProducto' ORDER BY 1`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = 'public."OcultamientoProducto"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'OcultamientoProducto' ORDER BY 1`),
  };
}
const tipoDeId = async () => (await q<{ data_type: string }>(`SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'OcultamientoProducto' AND column_name = 'id'`))[0]?.data_type;
const hayCheck = async () => (await q(`SELECT 1 FROM pg_constraint WHERE conrelid = 'public."OcultamientoProducto"'::regclass AND conname = 'OcultamientoProducto_id_uuid_chk'`)).length === 1;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await q(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('uni_u',$1,'u','CANTIDAD')`, [E]);
  await q(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('prod_u1',$1,'PV_1','Milanesa','PV','uni_u',8000), ('prod_u2',$1,'PV_2','Flan','PV','uni_u',3000)`, [E]);
  await q(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_u',$1,'Centro')`, [E]);
  await q(`INSERT INTO "User" ("id","email") VALUES ('u_uuid','uuid@ejemplo.test')`);
}, 300_000);

afterAll(async () => {
  await Promise.all(abiertas.map((c) => c.end().catch(() => undefined)));
  await base?.eliminar();
});

describe("OcultamientoProducto: id uuid nativo (subir, bajar y subir, con marcas cargadas)", () => {
  let primeraSubida: Awaited<ReturnType<typeof foto>>;

  it("ANTES: el id es text y existe el CHECK de forma uuid; se cargan dos marcas (una de empresa y una de sucursal)", async () => {
    expect(await tipoDeId()).toBe("text");
    expect(await hayCheck()).toBe(true);
    await marca(ID1, "prod_u1", null);
    await marca(ID2, "prod_u2", "suc_u");
    expect(await q(`SELECT "id" FROM "OcultamientoProducto" ORDER BY 1`)).toEqual([{ id: ID1 }, { id: ID2 }]);
  });

  it("SUBIR: el id es uuid, el CHECK se fue, las marcas siguen con el MISMO id y la PK y el único se reconstruyeron con el tipo nuevo", async () => {
    await correr("migration.sql");
    expect(await tipoDeId()).toBe("uuid");
    expect(await hayCheck()).toBe(false);
    expect(await q(`SELECT "id"::text AS id, "oculto" FROM "OcultamientoProducto" ORDER BY 1`)).toEqual([{ id: ID1, oculto: true }, { id: ID2, oculto: true }]);
    const f = await foto();
    expect(f.indices.map((i) => i.nombre)).toEqual(expect.arrayContaining(["OcultamientoProducto_pkey", "OcultamientoProducto_empresaId_id_key", "OcultamientoProducto_producto_empresa_key", "OcultamientoProducto_producto_sucursal_key"]));
    primeraSubida = f;
  });

  it("la base decide: un id que no es uuid no entra (22P02); repetir el alta con el mismo id no duplica; dos altas simultáneas con el mismo id dejan UNA fila", async () => {
    expect(await falla(`INSERT INTO "OcultamientoProducto" ("id","empresaId","productoId","sucursalId","oculto","actualizadoPorId","actualizadoEn") VALUES ('no-es-uuid',$1,'prod_u1','suc_u',true,'u_uuid',now())`, [E])).toBe("22P02");
    await marca(ID1, "prod_u1", null);
    expect(await q(`SELECT count(*)::int AS n FROM "OcultamientoProducto"`)).toEqual([{ n: 2 }]);
    const dos = await Promise.all([0, 1].map(async () => {
      const c = new Client({ connectionString: base.url });
      await c.connect();
      abiertas.push(c);
      return c;
    }));
    await Promise.all(dos.map((c) => c.query(`INSERT INTO "OcultamientoProducto" ("id","empresaId","productoId","sucursalId","oculto","actualizadoPorId","actualizadoEn") VALUES ($1,$2,'prod_u1','suc_u',true,'u_uuid',now()) ON CONFLICT DO NOTHING`, [ID3, E]).catch((e: { code?: string }) => {
      // Si el ON CONFLICT no alcanza a ver al otro, la clave única lo frena: nunca quedan dos.
      expect(["23505"]).toContain(e.code);
    })));
    expect(await q(`SELECT count(*)::int AS n FROM "OcultamientoProducto" WHERE "id" = $1`, [ID3])).toEqual([{ n: 1 }]);
    await q(`DELETE FROM "OcultamientoProducto" WHERE "id" = $1`, [ID3]);
  });

  it("BAJAR con datos: ninguna marca se pierde (vuelve a text con el mismo valor) y el CHECK se repone; bajar dos veces no falla", async () => {
    await correr("down.sql");
    expect(await tipoDeId()).toBe("text");
    expect(await hayCheck()).toBe(true);
    expect(await q(`SELECT "id" FROM "OcultamientoProducto" ORDER BY 1`)).toEqual([{ id: ID1 }, { id: ID2 }]);
    expect(await falla(`INSERT INTO "OcultamientoProducto" ("id","empresaId","productoId","sucursalId","oculto","actualizadoPorId","actualizadoEn") VALUES ('no-es-uuid',$1,'prod_u1','suc_u',true,'u_uuid',now())`, [E])).toBe("23514");
    await correr("down.sql");
    expect(await tipoDeId()).toBe("text");
    expect(await hayCheck()).toBe(true);
  });

  it("SUBIR OTRA VEZ: el catálogo de la tabla queda idéntico al de la primera subida y las marcas siguen", async () => {
    await correr("migration.sql");
    expect(await foto()).toEqual(primeraSubida);
    expect(await q(`SELECT "id"::text AS id FROM "OcultamientoProducto" ORDER BY 1`)).toEqual([{ id: ID1 }, { id: ID2 }]);
  });
});
