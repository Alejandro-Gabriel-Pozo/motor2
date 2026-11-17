import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Clases de producto como Pedernal, etapa E4-1 (2026-11-17) — migración 20261117195000_reventa_clase_de_uso: relaja "Producto_claseDeUso_tipo_chk" para que un producto de venta (PV) pueda ser REVENTA y agrega
 * "Producto_claseDeUso_reventa_chk" (una REVENTA no se produce). Sobre una base temporal armada migración por migración, con productos YA CLASIFICADOS por E1 antes de aplicarla, contra Postgres REAL.
 *
 * Qué fija: (a) lo ya cargado (con y sin clase) queda idéntico y no se pierde ninguna fila; (b) REVENTA se admite SOLO en un PV que no se produce (con MP, con «se produce» o con un valor fuera de lista se rechaza con 23514) y
 * todas las combinaciones de E1 siguen igual; (c) la clase sigue escribiéndose UNA vez (el disparador de E1 no se tocó); (d) sin índices, políticas, privilegios ni columnas nuevas; (e) el down.sql ABORTA, sin tocar nada,
 * si algún producto es REVENTA; sin REVENTA vuelve a la regla de E1 (idéntica), repetirlo no falla, y volver a subir deja lo mismo; (f) concurrencia: dos escrituras simultáneas de REVENTA al mismo producto dejan UNA;
 * (g) aislamiento: clasificar el producto de una empresa no toca el de otra; (h) el down de E1 posterior no queda trabado.
 *
 * Mutaciones: sacar `'REVENTA'` del CHECK nuevo rompe (b); borrar el CHECK de «se produce» rompe (b); borrar el `RAISE` del down.sql rompe (e).
 */
const NOMBRE = "20261117195000_reventa_clase_de_uso";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql" | "verificacion-previa.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const A = "emp-reventa-a";
const B = "emp-reventa-b";

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

const sinClase = async (id: string) => {
  await base.cliente.query(`ALTER TABLE "Producto" DISABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`);
  await base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = NULL WHERE id = $1`, [id]);
  await base.cliente.query(`ALTER TABLE "Producto" ENABLE TRIGGER "Producto_claseDeUso_inmutable_trg"`);
};
const poner = (id: string, clase: string) => base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = $1 WHERE id = $2`, [clase, id]);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe("20261117180000_clase_de_uso_del_producto");
  for (const e of [A, B]) await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
  await base.cliente.query(`SET session_replication_role = replica`);
  await base.cliente.query(
    `INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","seProduce") VALUES ('p-mp',$1,'MP1','Harina','MP','u-x',false), ('p-ins',$1,'MP3','Servilletas','MP','u-x',false), ('p-elab',$1,'MP2','Salsa','MP','u-x',true), ('p-pv',$1,'PV1','Milanesa','PV','u-x',false), ('p-pv2',$1,'PV3','Gaseosa','PV','u-x',false), ('p-pvb',$2,'PV2','Pizza','PV','u-x',true), ('p-pvc',$2,'PV4','Alfajor','PV','u-x',false)`,
    [A, B]
  );
  await base.cliente.query(`SET session_replication_role = DEFAULT`);
  await base.aplicarHasta("20261117180000_clase_de_uso_del_producto");
  // Lo que E1 dejó clasificado antes de esta migración (y lo que quedó sin clase).
  await poner("p-mp", "MATERIA_PRIMA");
  await poner("p-ins", "INSUMO");
  await poner("p-elab", "ELABORADO");
  await poner("p-pv", "VENDIBLE");
  fotoAntes = await foto();
  await base.aplicarHasta(NOMBRE);
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("lo que ya existía", () => {
  it("queda idéntico (con y sin clase) y no se pierde ninguna fila", async () => {
    const filas = await q<{ id: string; tipo: string; seProduce: boolean; claseDeUso: string | null }>(`SELECT "id","tipo"::text AS tipo,"seProduce","claseDeUso" FROM "Producto" WHERE "empresaId" IN ($1,$2) ORDER BY id`, [A, B]);
    expect(filas).toEqual([
      { id: "p-elab", tipo: "MP", seProduce: true, claseDeUso: "ELABORADO" },
      { id: "p-ins", tipo: "MP", seProduce: false, claseDeUso: "INSUMO" },
      { id: "p-mp", tipo: "MP", seProduce: false, claseDeUso: "MATERIA_PRIMA" },
      { id: "p-pv", tipo: "PV", seProduce: false, claseDeUso: "VENDIBLE" },
      { id: "p-pv2", tipo: "PV", seProduce: false, claseDeUso: null },
      { id: "p-pvb", tipo: "PV", seProduce: true, claseDeUso: null },
      { id: "p-pvc", tipo: "PV", seProduce: false, claseDeUso: null },
    ]);
  });

  it("solo cambia el CHECK de «tipo» y suma el de REVENTA: ni columnas, ni índices, ni políticas, ni privilegios, ni disparadores", async () => {
    type Foto = Awaited<ReturnType<typeof foto>>;
    const antes = fotoAntes as Foto;
    const despues = await foto();
    expect(despues.columnas).toEqual(antes.columnas);
    expect(despues.indices).toEqual(antes.indices);
    expect(despues.politicas).toEqual(antes.politicas);
    expect(despues.privilegios).toEqual(antes.privilegios);
    expect(despues.disparadores).toEqual(antes.disparadores);
    const cambiadas = despues.restricciones.filter((r) => !antes.restricciones.some((a) => JSON.stringify(a) === JSON.stringify(r))).map((r) => (r as { nombre: string }).nombre);
    expect(cambiadas.sort()).toEqual(["Producto_claseDeUso_reventa_chk", "Producto_claseDeUso_tipo_chk"]);
  });

  it("la lista cerrada de clases y el CHECK de «se produce» de E1 no se tocaron", async () => {
    type Foto = Awaited<ReturnType<typeof foto>>;
    const antes = (fotoAntes as Foto).restricciones;
    const despues = await foto();
    for (const nombre of ["Producto_claseDeUso_chk", "Producto_claseDeUso_seProduce_chk"]) {
      expect(despues.restricciones.find((r) => (r as { nombre: string }).nombre === nombre)).toEqual(antes.find((r) => (r as { nombre: string }).nombre === nombre));
    }
  });
});

describe("REVENTA solo en un producto de venta que no se produce; todo lo de E1 sigue igual", () => {
  it.each([
    // lo nuevo
    ["p-pv2", "REVENTA", true], // un PV que no se produce, sin clase: REVENTA
    ["p-pvc", "REVENTA", true], // ídem, de otra empresa
    ["p-mp", "REVENTA", false], // una MP no es REVENTA (ya tiene clase: aun así, lo rechaza el CHECK antes que el disparador)
    ["p-pvb", "REVENTA", false], // un PV que se produce no es REVENTA (CHECK nuevo)
    ["p-pv2", "reventa", false],
    ["p-pv2", "", false],
    ["p-pv2", "SERVICIO", false],
    // lo de E1 (sin cambios)
    ["p-pv2", "VENDIBLE", true],
    ["p-pvb", "VENDIBLE", true], // un PV que se produce puede ser VENDIBLE (la medialuna que se vende y se produce)
    ["p-pv2", "MATERIA_PRIMA", false],
    ["p-pv2", "ELABORADO", false],
    ["p-pv2", "INSUMO", false],
  ] as const)("%s ← %s: %s", async (id, clase, permitido) => {
    // Siempre se parte de «sin clase» (los de arriba con clase se vuelven a NULL con el disparador apagado, como en la prueba de E1).
    const original = (await q<{ c: string | null }>(`SELECT "claseDeUso" AS c FROM "Producto" WHERE id = $1`, [id]))[0]!.c;
    if (original) await sinClase(id);
    if (permitido) {
      await poner(id, clase);
      expect((await q<{ c: string }>(`SELECT "claseDeUso" AS c FROM "Producto" WHERE id = $1`, [id]))[0]!.c).toBe(clase);
    } else {
      await expect(poner(id, clase)).rejects.toMatchObject({ code: "23514" });
    }
    await sinClase(id);
    if (original) await poner(id, original);
  });

  it("una MP con clase de E1 sigue sin poder ser vendible; y una REVENTA no puede pasar a «se produce»", async () => {
    await expect(base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = 'VENDIBLE' WHERE id = 'p-mp'`)).rejects.toMatchObject({ code: "23514" });
    await poner("p-pv2", "REVENTA");
    await expect(base.cliente.query(`UPDATE "Producto" SET "seProduce" = true WHERE id = 'p-pv2'`)).rejects.toMatchObject({ code: "23514" });
    await base.cliente.query(`UPDATE "Producto" SET "nombre" = 'Gaseosa 1,5 L' WHERE id = 'p-pv2'`); // lo demás de la fila se sigue editando
    await base.cliente.query(`UPDATE "Producto" SET "nombre" = 'Gaseosa' WHERE id = 'p-pv2'`);
    await sinClase("p-pv2");
  });

  it("un INSERT directo de un PV que no se produce con REVENTA entra; con «se produce» o con tipo MP, no", async () => {
    await base.cliente.query(`SET session_replication_role = replica`);
    try {
      await base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","seProduce","claseDeUso") VALUES ('i-ok',$1,'I1','I1','PV','u-x',false,'REVENTA')`, [A]);
      await expect(base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","seProduce","claseDeUso") VALUES ('i-prod',$1,'I2','I2','PV','u-x',true,'REVENTA')`, [A])).rejects.toMatchObject({ code: "23514" });
      await expect(base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","seProduce","claseDeUso") VALUES ('i-mp',$1,'I3','I3','MP','u-x',false,'REVENTA')`, [A])).rejects.toMatchObject({ code: "23514" });
    } finally {
      await base.cliente.query(`SET session_replication_role = DEFAULT`);
      await base.cliente.query(`DELETE FROM "Producto" WHERE id IN ('i-ok','i-prod','i-mp')`);
    }
  });
});

describe("la clase se escribe UNA vez (el disparador de E1 sigue)", () => {
  it("de NULL a REVENTA sí; repetir no falla; cambiarla o borrarla no", async () => {
    await poner("p-pv2", "REVENTA");
    await poner("p-pv2", "REVENTA");
    await expect(poner("p-pv2", "VENDIBLE")).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("no cambia una vez puesta") });
    await expect(base.cliente.query(`UPDATE "Producto" SET "claseDeUso" = NULL WHERE id = 'p-pv2'`)).rejects.toMatchObject({ code: "23514" });
    await sinClase("p-pv2");
  });
});

describe("concurrencia y aislamiento", () => {
  it("dos escrituras simultáneas de REVENTA al mismo producto sin clase: queda UNA y la otra no pisa", async () => {
    const { Client } = await import("pg");
    const otro = new Client({ connectionString: base.url });
    await otro.connect();
    try {
      const clasificar = (c: { query: (t: string, p: unknown[]) => Promise<{ rowCount: number | null }> }) => c.query(`UPDATE "Producto" SET "claseDeUso" = 'REVENTA' WHERE id = 'p-pv2' AND "claseDeUso" IS NULL`, []);
      const [r1, r2] = await Promise.all([clasificar(base.cliente), clasificar(otro)]);
      expect((r1.rowCount ?? 0) + (r2.rowCount ?? 0)).toBe(1);
      expect((await clasificar(base.cliente)).rowCount).toBe(0); // repetirla no cambia nada (idempotente)
    } finally {
      await otro.end();
      await sinClase("p-pv2");
    }
  });

  it("clasificar el producto de una empresa no toca el de otra", async () => {
    await poner("p-pv2", "REVENTA");
    expect((await q<{ c: string | null }>(`SELECT "claseDeUso" AS c FROM "Producto" WHERE id = 'p-pvc'`))[0]!.c).toBeNull();
    await sinClase("p-pv2");
  });
});

describe("down.sql y verificacion-previa.sql", () => {
  it("ABORTA, sin tocar nada, si algún producto ya es REVENTA", async () => {
    await poner("p-pv2", "REVENTA");
    const antes = await foto();
    await expect(base.cliente.query(leer("down.sql"))).rejects.toMatchObject({ code: "55000", message: expect.stringContaining("1 producto(s) con clase REVENTA") });
    expect(await foto()).toEqual(antes); // sigue todo ahí
    await sinClase("p-pv2");
  });

  it("sin REVENTA vuelve a la regla de E1 (idéntica); repetirlo no falla; volver a subir deja lo mismo; ninguna fila se pierde", async () => {
    const conReventa = await foto();
    await base.cliente.query(leer("down.sql"));
    expect(await foto()).toEqual(fotoAntes); // idéntica al estado de E1
    await base.cliente.query(leer("down.sql")); // idempotente
    // Con la regla de E1, una REVENTA ya no entra.
    await expect(poner("p-pv2", "REVENTA")).rejects.toMatchObject({ code: "23514" });
    await base.cliente.query(leer("migration.sql"));
    expect(await foto()).toEqual(conReventa); // volver a subir = lo mismo que la primera vez
    expect((await q<{ n: string }>(`SELECT count(*)::text AS n FROM "Producto" WHERE "empresaId" IN ($1,$2)`, [A, B]))[0]!.n).toBe("7");
  });

  it("la verificación previa corre (solo lectura) y no ve ninguna REVENTA", async () => {
    const resultados = (await base.cliente.query(leer("verificacion-previa.sql"))) as unknown as Array<{ rows: Array<Record<string, unknown>> }>;
    expect(resultados.length).toBe(3);
    expect(resultados[1]!.rows[0]).toEqual({ productos_reventa: "0" });
  });

  it("el down de E1, bajado después, tampoco queda trabado por esta migración (el CHECK nuevo cae con la columna)", async () => {
    await base.cliente.query(leer("down.sql")); // vuelve a la regla de E1
    const e1 = join(__dirname, "../../prisma/migrations/20261117180000_clase_de_uso_del_producto/down.sql");
    await sinClase("p-mp"); await sinClase("p-ins"); await sinClase("p-elab"); await sinClase("p-pv");
    await base.cliente.query(readFileSync(e1, "utf8"));
    expect((await q<{ n: string }>(`SELECT count(*)::text AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Producto' AND column_name = 'claseDeUso'`))[0]!.n).toBe("0");
  });
});
