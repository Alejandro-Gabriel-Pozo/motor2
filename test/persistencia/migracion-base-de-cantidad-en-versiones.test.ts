import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Merma sobre el bruto como Pedernal, etapa M2 (2026-11-17) — migración 20261117140000_base_de_cantidad_en_versiones: `baseDeCantidad` (TEXT NOT NULL DEFAULT 'NETA', CHECK NETA|BRUTA) en
 * "RecetaVersion" y en "VersionDeOpcion". Sobre una base temporal armada migración por migración, con versiones CARGADAS ANTES de la migración (como las de una base real) y contra Postgres REAL.
 *
 * Qué fija: (a) todo lo ya cargado queda NETA y el resto de cada fila (id, empresa, producto/opción, número, tipo, factor…) intacto, sin perder filas; (b) el CHECK acepta NETA y BRUTA y rechaza
 * cualquier otro valor (minúsculas, espacios, vacío, NULL) con 23514/23502; (c) un INSERT que no nombra la columna (el binario viejo) recibe NETA; (d) sin índices, políticas ni privilegios nuevos;
 * (e) el down.sql ABORTA, sin tocar nada, si ya hay una versión BRUTA (de receta o de opción); con todo NETA baja y volver a subir deja las tablas idénticas, y bajar dos veces no falla;
 * (f) concurrencia: dos marcas simultáneas a la misma versión con `WHERE baseDeCantidad = 'NETA'` dejan UNA sola; (g) aislamiento: marcar la versión de una empresa no toca la de otra.
 *
 * Mutaciones: borrar el `RAISE` del down.sql rompe (e); cambiar el DEFAULT o el CHECK rompe (a), (b) y (c).
 */
const NOMBRE = "20261117140000_base_de_cantidad_en_versiones";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const A = "emp-base-a";
const B = "emp-base-b";
const TABLAS = ["RecetaVersion", "VersionDeOpcion"] as const;

let base: BaseTemporalMigrada;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  const resultado: Record<string, unknown> = {};
  for (const t of TABLAS) {
    resultado[t] = {
      columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t]),
      restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = ('"' || $1::text || '"')::regclass ORDER BY 1`, [t]),
      indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`, [t]),
      politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`, [t]),
      privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = $1 ORDER BY 1, 2`, [t]),
    };
  }
  return resultado;
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(NOMBRE);
  for (const e of [A, B]) await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
  // Filas mínimas con las claves foráneas sueltas (rol de réplica = sin FK ni disparadores): lo que se prueba es la columna nueva, no el resto del modelo.
  await base.cliente.query(`SET session_replication_role = replica`);
  await base.cliente.query(`INSERT INTO "RecetaVersion" ("id","empresaId","productoId","version") VALUES ('rv-a1',$1,'prod-a',1), ('rv-a2',$1,'prod-a',2), ('rv-b1',$2,'prod-b',1)`, [A, B]);
  await base.cliente.query(`INSERT INTO "VersionDeOpcion" ("id","empresaId","opcionId","numero","tipoDeDiferencia","diferenciaPrecio","creadoPorId") VALUES ('vo-a1',$1,'op-a',1,'MONTO',150.5,'u-a'), ('vo-a2',$1,'op-a',2,'MONTO',200,'u-a'), ('vo-b1',$2,'op-b',1,'MONTO',0,'u-b')`, [A, B]);
  await base.cliente.query(`SET session_replication_role = DEFAULT`);
  fotoAntes = await foto();
  await base.aplicarRestantes();
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("lo que ya existía", () => {
  it("queda NETA y el resto de la fila intacto, sin perder ninguna", async () => {
    const recetas = await q<{ id: string; empresaId: string; productoId: string; version: number; baseDeCantidad: string }>(`SELECT * FROM "RecetaVersion" WHERE "empresaId" IN ($1,$2) ORDER BY id`, [A, B]);
    expect(recetas.map(({ id, empresaId, productoId, version, baseDeCantidad }) => ({ id, empresaId, productoId, version, baseDeCantidad }))).toEqual([
      { id: "rv-a1", empresaId: A, productoId: "prod-a", version: 1, baseDeCantidad: "NETA" },
      { id: "rv-a2", empresaId: A, productoId: "prod-a", version: 2, baseDeCantidad: "NETA" },
      { id: "rv-b1", empresaId: B, productoId: "prod-b", version: 1, baseDeCantidad: "NETA" },
    ]);
    const opciones = await q<{ id: string; numero: number; tipoDeDiferencia: string; diferenciaPrecio: string; baseDeCantidad: string }>(`SELECT * FROM "VersionDeOpcion" WHERE "empresaId" IN ($1,$2) ORDER BY id`, [A, B]);
    expect(opciones.map(({ id, numero, tipoDeDiferencia, diferenciaPrecio, baseDeCantidad }) => ({ id, numero, tipoDeDiferencia, diferenciaPrecio, baseDeCantidad }))).toEqual([
      { id: "vo-a1", numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "150.50", baseDeCantidad: "NETA" },
      { id: "vo-a2", numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "200.00", baseDeCantidad: "NETA" },
      { id: "vo-b1", numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", baseDeCantidad: "NETA" },
    ]);
  });

  it("las columnas son TEXT NOT NULL con valor por defecto 'NETA' y no aparecen índices, políticas ni privilegios nuevos", async () => {
    type Tabla = { columnas: Array<{ columna: string; data_type: string; is_nullable: string; column_default: string | null }>; indices: unknown; politicas: unknown; privilegios: unknown };
    const despues = (await foto()) as Record<string, Tabla>;
    const antes = fotoAntes as Record<string, Tabla>;
    for (const t of TABLAS) {
      expect(despues[t]!.columnas.find((c) => c.columna === "baseDeCantidad")).toEqual({ columna: "baseDeCantidad", data_type: "text", is_nullable: "NO", column_default: "'NETA'::text" });
      expect(despues[t]!.columnas.filter((c) => c.columna !== "baseDeCantidad")).toEqual(antes[t]!.columnas);
      expect(despues[t]!.indices).toEqual(antes[t]!.indices);
      expect(despues[t]!.politicas).toEqual(antes[t]!.politicas);
      expect(despues[t]!.privilegios).toEqual(antes[t]!.privilegios);
    }
  });

  it("un INSERT que no nombra la columna (el binario viejo) recibe NETA", async () => {
    await base.cliente.query(`SET session_replication_role = replica`);
    await base.cliente.query(`INSERT INTO "RecetaVersion" ("id","empresaId","productoId","version") VALUES ('rv-viejo',$1,'prod-a',3)`, [A]);
    await base.cliente.query(`INSERT INTO "VersionDeOpcion" ("id","empresaId","opcionId","numero","tipoDeDiferencia","diferenciaPrecio","creadoPorId") VALUES ('vo-viejo',$1,'op-a',3,'MONTO',1,'u-a')`, [A]);
    await base.cliente.query(`SET session_replication_role = DEFAULT`);
    expect((await q<{ b: string }>(`SELECT "baseDeCantidad" AS b FROM "RecetaVersion" WHERE id = 'rv-viejo'`))[0]!.b).toBe("NETA");
    expect((await q<{ b: string }>(`SELECT "baseDeCantidad" AS b FROM "VersionDeOpcion" WHERE id = 'vo-viejo'`))[0]!.b).toBe("NETA");
    await base.cliente.query(`DELETE FROM "RecetaVersion" WHERE id = 'rv-viejo'`);
    await base.cliente.query(`DELETE FROM "VersionDeOpcion" WHERE id = 'vo-viejo'`);
  });
});

describe("el CHECK de dos valores", () => {
  it.each(TABLAS)("%s: acepta NETA y BRUTA", async (tabla) => {
    const id = tabla === "RecetaVersion" ? "rv-a1" : "vo-a1";
    for (const valor of ["BRUTA", "NETA"]) {
      await base.cliente.query(`UPDATE "${tabla}" SET "baseDeCantidad" = $1 WHERE id = $2`, [valor, id]);
      expect((await q<{ b: string }>(`SELECT "baseDeCantidad" AS b FROM "${tabla}" WHERE id = $1`, [id]))[0]!.b).toBe(valor);
    }
  });

  it.each(TABLAS)("%s: rechaza cualquier otro valor con 23514 y NULL con 23502", async (tabla) => {
    const id = tabla === "RecetaVersion" ? "rv-a1" : "vo-a1";
    for (const malo of ["neta", "bruta", "NETA ", " BRUTA", "", "BRUTO", "NETA;"]) {
      await expect(base.cliente.query(`UPDATE "${tabla}" SET "baseDeCantidad" = $1 WHERE id = $2`, [malo, id])).rejects.toMatchObject({ code: "23514" });
    }
    await expect(base.cliente.query(`UPDATE "${tabla}" SET "baseDeCantidad" = NULL WHERE id = $1`, [id])).rejects.toMatchObject({ code: "23502" });
  });
});

describe("la lista del CHECK", () => {
  it.each(TABLAS)("%s: es EXACTAMENTE NETA y BRUTA (un tercer valor, o uno que falte, rompe esto)", async (tabla) => {
    const def = (await q<{ d: string }>(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = $1`, [`${tabla}_baseDeCantidad_chk`]))[0]!.d;
    const valores = [...def.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]!).sort();
    expect(valores).toEqual(["BRUTA", "NETA"]);
  });
});

describe("concurrencia y aislamiento", () => {
  it("dos marcas simultáneas a la misma versión con `WHERE baseDeCantidad = 'NETA'`: gana una y la otra no pisa", async () => {
    const { Client } = await import("pg");
    const otro = new Client({ connectionString: base.url });
    await otro.connect();
    try {
      const marcar = (c: { query: (t: string, p: unknown[]) => Promise<{ rowCount: number | null }> }) =>
        c.query(`UPDATE "RecetaVersion" SET "baseDeCantidad" = 'BRUTA' WHERE id = 'rv-a2' AND "baseDeCantidad" = 'NETA'`, []);
      const [r1, r2] = await Promise.all([marcar(base.cliente), marcar(otro)]);
      expect((r1.rowCount ?? 0) + (r2.rowCount ?? 0)).toBe(1); // exactamente una escribió
      expect((await marcar(base.cliente)).rowCount).toBe(0); // repetirla no cambia nada (idempotente)
    } finally {
      await otro.end();
      await base.cliente.query(`UPDATE "RecetaVersion" SET "baseDeCantidad" = 'NETA' WHERE id = 'rv-a2'`);
    }
  });

  it("marcar la versión de una empresa no toca la de otra", async () => {
    await base.cliente.query(`UPDATE "VersionDeOpcion" SET "baseDeCantidad" = 'BRUTA' WHERE id = 'vo-a1'`);
    expect((await q<{ b: string }>(`SELECT "baseDeCantidad" AS b FROM "VersionDeOpcion" WHERE id = 'vo-b1'`))[0]!.b).toBe("NETA");
    await base.cliente.query(`UPDATE "VersionDeOpcion" SET "baseDeCantidad" = 'NETA' WHERE id = 'vo-a1'`);
  });
});

describe("down.sql", () => {
  it.each([
    ["una versión de receta", `UPDATE "RecetaVersion" SET "baseDeCantidad" = 'BRUTA' WHERE id = 'rv-a1'`, `UPDATE "RecetaVersion" SET "baseDeCantidad" = 'NETA' WHERE id = 'rv-a1'`, "1 versión(es) de receta y 0"],
    ["una versión de opción", `UPDATE "VersionDeOpcion" SET "baseDeCantidad" = 'BRUTA' WHERE id = 'vo-a1'`, `UPDATE "VersionDeOpcion" SET "baseDeCantidad" = 'NETA' WHERE id = 'vo-a1'`, "0 versión(es) de receta y 1"],
  ])("ABORTA, sin tocar nada, si ya hay %s en BRUTA", async (_nombre, marcar, desmarcar, fragmento) => {
    await base.cliente.query(marcar);
    await expect(base.cliente.query(leer("down.sql"))).rejects.toMatchObject({ code: "55000", message: expect.stringContaining(fragmento) });
    const columnas = await q<{ n: string }>(`SELECT count(*)::text AS n FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'baseDeCantidad' AND table_name IN ('RecetaVersion','VersionDeOpcion')`);
    expect(columnas[0]!.n).toBe("2"); // sigue todo ahí
    await base.cliente.query(desmarcar);
  });

  it("con todo NETA baja; volver a subir deja las tablas idénticas; bajar dos veces no falla; ninguna fila se pierde", async () => {
    const conColumnas = await foto();
    await base.cliente.query(leer("down.sql"));
    expect(await foto()).toEqual(fotoAntes); // idéntica a antes de la migración
    await base.cliente.query(leer("down.sql")); // idempotente
    await base.cliente.query(leer("migration.sql"));
    expect(await foto()).toEqual(conColumnas); // volver a subir = lo mismo que la primera vez
    expect((await q<{ n: string }>(`SELECT count(*)::text AS n FROM "RecetaVersion" WHERE "empresaId" IN ($1,$2)`, [A, B]))[0]!.n).toBe("3");
    expect((await q<{ n: string }>(`SELECT count(*)::text AS n FROM "VersionDeOpcion" WHERE "empresaId" IN ($1,$2)`, [A, B]))[0]!.n).toBe("3");
  });
});
