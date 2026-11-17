import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Clases de producto como Pedernal, etapa E1 (2026-11-17) — migración 20261117180000_clase_de_uso_del_producto: "Producto"."claseDeUso" (TEXT, NULL = sin clase) con tres CHECK (lista cerrada de las
 * cinco clases, coherencia con "tipo" y «se produce» = ELABORADO en una materia prima) y un disparador que impide cambiar la clase una vez puesta. Sobre una base temporal armada migración por migración,
 * con productos CARGADOS ANTES de la migración (como los de una base real) y contra Postgres REAL.
 *
 * Qué fija: (a) todo lo ya cargado queda sin clase (NULL) y el resto de cada fila intacto, sin perder filas; (b) la lista de clases del CHECK es EXACTAMENTE las cinco; (c) la coherencia con "tipo"
 * (una MP no puede ser VENDIBLE, un PV no puede ser ELABORADO, REVENTA todavía no se admite) y con «se produce» (ELABORADO ⇔ seProduce en una MP; un PV puede traer seProduce); (d) la clase se escribe
 * UNA vez: de NULL a un valor sí, cambiarla o borrarla no (disparador), repetir el mismo valor no falla; (e) un INSERT que no nombra la columna (el binario viejo) recibe NULL; (f) sin índices, políticas
 * ni privilegios nuevos; (g) el down.sql ABORTA, sin tocar nada, si algún producto tiene clase; sin ninguna baja, volver a subir deja la tabla idéntica y bajar dos veces no falla; (h) concurrencia:
 * dos escrituras simultáneas de la clase a un mismo producto sin clase dejan UNA; (i) aislamiento: clasificar el producto de una empresa no toca el de otra.
 *
 * Mutaciones: borrar el `RAISE` del down.sql rompe (g); sacar el disparador rompe (d); cambiar la lista de un CHECK rompe (b) y (c).
 */
const NOMBRE = "20261117180000_clase_de_uso_del_producto";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const A = "emp-clase-a";
const B = "emp-clase-b";

let base: BaseTemporalMigrada;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Producto' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"Producto"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Producto' ORDER BY 1`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Producto' ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'Producto' ORDER BY 1, 2`),
    disparadores: await q(`SELECT tgname::text AS nombre FROM pg_trigger WHERE tgrelid = '"Producto"'::regclass AND NOT tgisinternal ORDER BY 1`),
  };
}

/** Un producto mínimo (con las claves foráneas sueltas: rol de réplica, sin FK ni disparadores de integridad de otras tablas; los de "Producto" mismos NO se apagan: ver `insertar`). */
async function insertar(id: string, empresaId: string, tipo: "MP" | "PV", seProduce = false) {
  await base.cliente.query(`SET session_replication_role = replica`);
  await base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","seProduce") VALUES ($1,$2,$1,$1,$3,'u-x',$4)`, [id, empresaId, tipo, seProduce]);
  await base.cliente.query(`SET session_replication_role = DEFAULT`);
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(NOMBRE);
  for (const e of [A, B]) await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
  await base.cliente.query(`SET session_replication_role = replica`);
  await base.cliente.query(
    `INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","seProduce") VALUES ('p-mp',$1,'MP1','Harina','MP','u-x',false), ('p-elab',$1,'MP2','Salsa','MP','u-x',true), ('p-pv',$1,'PV1','Milanesa','PV','u-x',false), ('p-pvb',$2,'PV2','Pizza','PV','u-x',true)`,
    [A, B]
  );
  await base.cliente.query(`SET session_replication_role = DEFAULT`);
  fotoAntes = await foto();
  await base.aplicarHasta(NOMBRE); // solo hasta E1: la de E4-1 (que relaja su CHECK de «tipo») tiene su propio test
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("lo que ya existía", () => {
  it("queda sin clase (NULL) y el resto de la fila intacto, sin perder ninguna", async () => {
    const filas = await q<{ id: string; empresaId: string; tipo: string; seProduce: boolean; claseDeUso: string | null }>(`SELECT "id","empresaId","tipo"::text AS tipo,"seProduce","claseDeUso" FROM "Producto" WHERE "empresaId" IN ($1,$2) ORDER BY id`, [A, B]);
    expect(filas).toEqual([
      { id: "p-elab", empresaId: A, tipo: "MP", seProduce: true, claseDeUso: null },
      { id: "p-mp", empresaId: A, tipo: "MP", seProduce: false, claseDeUso: null },
      { id: "p-pv", empresaId: A, tipo: "PV", seProduce: false, claseDeUso: null },
      { id: "p-pvb", empresaId: B, tipo: "PV", seProduce: true, claseDeUso: null },
    ]);
  });

  it("la columna es TEXT NULL sin valor por defecto; sin índices, políticas ni privilegios nuevos; trae el disparador", async () => {
    type Foto = Awaited<ReturnType<typeof foto>>;
    const despues = await foto();
    const antes = fotoAntes as Foto;
    expect(despues.columnas.find((c) => c.columna === "claseDeUso")).toEqual({ columna: "claseDeUso", data_type: "text", is_nullable: "YES", column_default: null });
    expect(despues.columnas.filter((c) => c.columna !== "claseDeUso")).toEqual(antes.columnas);
    expect(despues.indices).toEqual(antes.indices);
    expect(despues.politicas).toEqual(antes.politicas);
    expect(despues.privilegios).toEqual(antes.privilegios);
    expect(despues.disparadores.map((d) => d.nombre)).toContain("Producto_claseDeUso_inmutable_trg");
  });

  it("un INSERT que no nombra la columna (el binario viejo) recibe NULL", async () => {
    await insertar("p-viejo", A, "MP");
    expect((await q<{ c: string | null }>(`SELECT "claseDeUso" AS c FROM "Producto" WHERE id = 'p-viejo'`))[0]!.c).toBeNull();
    await base.cliente.query(`DELETE FROM "Producto" WHERE id = 'p-viejo'`);
  });
});

describe("la lista de clases (CHECK)", () => {
  it("es EXACTAMENTE las cinco clases (una sexta, o una que falte, rompe esto)", async () => {
    const def = (await q<{ d: string }>(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'Producto_claseDeUso_chk'`))[0]!.d;
    expect([...def.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]!).sort()).toEqual(["ELABORADO", "INSUMO", "MATERIA_PRIMA", "REVENTA", "VENDIBLE"]);
  });

  it.each(["materia_prima", "Materia prima", "MATERIA_PRIMA ", " VENDIBLE", "", "SERVICIO", "COMBO", "MP"])("rechaza «%s» con 23514", async (malo) => {
    await expect(base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = $1 WHERE id = 'p-mp'`, [malo])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("coherencia con «tipo» y con «se produce»", () => {
  const poner = (id: string, clase: string) => base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = $1 WHERE id = $2`, [clase, id]);
  const volver = (id: string) => base.cliente.query(`ALTER TABLE "Producto" DISABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`).then(() => base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = NULL WHERE id = $1`, [id])).then(() => base.cliente.query(`ALTER TABLE "Producto" ENABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`));

  it.each([
    ["p-mp", "MATERIA_PRIMA", true],
    ["p-mp", "INSUMO", true],
    ["p-elab", "ELABORADO", true],
    ["p-pv", "VENDIBLE", true],
    ["p-pvb", "VENDIBLE", true], // un producto de venta puede traer «se produce»: no significa nada
    ["p-mp", "ELABORADO", false], // una MP que no se produce no es elaborada
    ["p-elab", "MATERIA_PRIMA", false], // una MP que se produce no es materia prima (respuesta 3: «se produce» no se apaga)
    ["p-elab", "INSUMO", false],
    ["p-mp", "VENDIBLE", false], // una MP no se vende
    ["p-pv", "MATERIA_PRIMA", false],
    ["p-pv", "ELABORADO", false],
    ["p-pv", "INSUMO", false],
    ["p-mp", "REVENTA", false], // REVENTA todavía no se admite (E4)
    ["p-pv", "REVENTA", false],
  ] as const)("%s ← %s: %s", async (id, clase, permitido) => {
    if (permitido) {
      await poner(id, clase);
      expect((await q<{ c: string }>(`SELECT "claseDeUso" AS c FROM "Producto" WHERE id = $1`, [id]))[0]!.c).toBe(clase);
      await volver(id);
    } else {
      await expect(poner(id, clase)).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("una MP con clase no puede prender ni apagar «se produce» (ELABORADO ⇔ seProduce)", async () => {
    await poner("p-mp", "MATERIA_PRIMA");
    await expect(base.cliente.query(`UPDATE "Producto" SET "seProduce" = true WHERE id = 'p-mp'`)).rejects.toMatchObject({ code: "23514" });
    await volver("p-mp");
    await poner("p-elab", "ELABORADO");
    await expect(base.cliente.query(`UPDATE "Producto" SET "seProduce" = false WHERE id = 'p-elab'`)).rejects.toMatchObject({ code: "23514" });
    await volver("p-elab");
    // Sin clase, «se produce» sigue siendo libre (todo lo ya cargado se comporta como hoy).
    await base.cliente.query(`UPDATE "Producto" SET "seProduce" = true WHERE id = 'p-mp'`);
    await base.cliente.query(`UPDATE "Producto" SET "seProduce" = false WHERE id = 'p-mp'`);
  });
});

describe("la clase se escribe UNA vez (disparador)", () => {
  it("de NULL a un valor sí; repetir el mismo valor no falla; cambiarla o borrarla no", async () => {
    await base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = 'MATERIA_PRIMA' WHERE id = 'p-mp'`);
    await base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = 'MATERIA_PRIMA' WHERE id = 'p-mp'`); // mismo valor: no es un cambio
    await expect(base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = 'INSUMO' WHERE id = 'p-mp'`)).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("no cambia una vez puesta") });
    await expect(base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = NULL WHERE id = 'p-mp'`)).rejects.toMatchObject({ code: "23514" });
    expect((await q<{ c: string }>(`SELECT "claseDeUso" AS c FROM "Producto" WHERE id = 'p-mp'`))[0]!.c).toBe("MATERIA_PRIMA");
    // Otras columnas del producto siguen editándose con la clase puesta.
    await base.cliente.query(`UPDATE "Producto" SET "nombre" = 'Harina 000' WHERE id = 'p-mp'`);
    await base.cliente.query(`ALTER TABLE "Producto" DISABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`);
    await base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = NULL, "nombre" = 'Harina' WHERE id = 'p-mp'`);
    await base.cliente.query(`ALTER TABLE "Producto" ENABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`);
  });
});

describe("concurrencia y aislamiento", () => {
  it("dos escrituras simultáneas de la clase al mismo producto sin clase: queda UNA y la otra no pisa", async () => {
    const { Client } = await import("pg");
    const otro = new Client({ connectionString: base.url });
    await otro.connect();
    try {
      const clasificar = (c: { query: (t: string, p: unknown[]) => Promise<{ rowCount: number | null }> }) =>
        c.query(`UPDATE "Producto" SET "claseDeUso" = 'MATERIA_PRIMA' WHERE id = 'p-mp' AND "claseDeUso" IS NULL`, []);
      const [r1, r2] = await Promise.all([clasificar(base.cliente), clasificar(otro)]);
      expect((r1.rowCount ?? 0) + (r2.rowCount ?? 0)).toBe(1); // exactamente una escribió
      expect((await clasificar(base.cliente)).rowCount).toBe(0); // repetirla no cambia nada (idempotente)
    } finally {
      await otro.end();
      await base.cliente.query(`ALTER TABLE "Producto" DISABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`);
      await base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = NULL WHERE id = 'p-mp'`);
      await base.cliente.query(`ALTER TABLE "Producto" ENABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`);
    }
  });

  it("clasificar el producto de una empresa no toca el de otra", async () => {
    await base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = 'VENDIBLE' WHERE id = 'p-pv'`);
    expect((await q<{ c: string | null }>(`SELECT "claseDeUso" AS c FROM "Producto" WHERE id = 'p-pvb'`))[0]!.c).toBeNull();
    await base.cliente.query(`ALTER TABLE "Producto" DISABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`);
    await base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = NULL WHERE id = 'p-pv'`);
    await base.cliente.query(`ALTER TABLE "Producto" ENABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`);
  });
});

describe("down.sql", () => {
  it("ABORTA, sin tocar nada, si algún producto ya tiene clase", async () => {
    await base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = 'ELABORADO' WHERE id = 'p-elab'`);
    await expect(base.cliente.query(leer("down.sql"))).rejects.toMatchObject({ code: "55000", message: expect.stringContaining("1 producto(s) con clase de uso") });
    expect((await q<{ n: string }>(`SELECT count(*)::text AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Producto' AND column_name = 'claseDeUso'`))[0]!.n).toBe("1"); // sigue todo ahí
    await base.cliente.query(`ALTER TABLE "Producto" DISABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`);
    await base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = NULL WHERE id = 'p-elab'`);
    await base.cliente.query(`ALTER TABLE "Producto" ENABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`);
  });

  it("sin clases baja; volver a subir deja la tabla idéntica; bajar dos veces no falla; ninguna fila se pierde", async () => {
    const conColumna = await foto();
    await base.cliente.query(leer("down.sql"));
    expect(await foto()).toEqual(fotoAntes); // idéntica a antes de la migración (sin columna, CHECK ni disparador)
    expect((await q<{ n: string }>(`SELECT count(*)::text AS n FROM pg_proc WHERE proname = 'producto_clase_de_uso_inmutable'`))[0]!.n).toBe("0");
    await base.cliente.query(leer("down.sql")); // idempotente
    await base.cliente.query(leer("migration.sql"));
    expect(await foto()).toEqual(conColumna); // volver a subir = lo mismo que la primera vez
    expect((await q<{ n: string }>(`SELECT count(*)::text AS n FROM "Producto" WHERE "empresaId" IN ($1,$2)`, [A, B]))[0]!.n).toBe("4");
  });
});
