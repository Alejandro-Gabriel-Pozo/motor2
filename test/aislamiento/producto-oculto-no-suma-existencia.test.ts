import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * «Ocultar» como Pedernal, E3c3 (docs/diseno-ocultar-como-pedernal-2026-11-15.md, I-4, I-5, R-6; Pedernal 0049): el DISPARADOR de `MovimientoStock` rechaza agregar existencia a un producto OCULTO (renglón de cantidad
 * positiva que deja el saldo de la sección por encima de cero). Sobre una base TEMPORAL migrada como una real, con la RLS real (`motor2_app`):
 *  - SUBIR / BAJAR / SUBIR: el catálogo queda idéntico al de antes al bajar y a la primera subida al volver a subir; bajar dos veces no falla; no toca ninguna fila;
 *  - la regla: oculto en el local o en toda la empresa + entrada que deja saldo > 0 → rechazo (23514, `MovimientoStock_producto_oculto_chk`); restar, un renglón en cero, corregir un negativo hasta cero, un producto visible,
 *    oculto en OTRO local o una marca en `oculto = false` → se permiten; la marca que la RLS no deja ver al rol de la app igual rige (SECURITY DEFINER: falla cerrado);
 *  - CONCURRENCIA dos a dos (ocultar vs. sumar existencia, en las dos órdenes): nunca queda «oculto y con existencia nueva».
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261115160000_producto_oculto_no_suma_existencia";
const E = "empresa_ocs";
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");
let base: BaseTemporalMigrada;
let hayRol = false;
const abiertas: Client[] = [];
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  return {
    funciones: await q(`SELECT p.proname::text AS nombre, pg_get_functiondef(p.oid) AS definicion FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`),
    disparadores: await q(`SELECT tgrelid::regclass::text AS tabla, tgname::text AS nombre, pg_get_triggerdef(oid) AS definicion FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`),
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    filas: await q(`SELECT (SELECT count(*) FROM "MovimientoStock") AS movimientos, (SELECT count(*) FROM "OcultamientoProducto") AS marcas, (SELECT count(*) FROM "Producto") AS productos`),
  };
}

async function conectarComoApp(): Promise<Client> {
  const credenciales = new URL(process.env.DATABASE_URL as string);
  const destino = new URL(base.url);
  const c = new Client({
    host: destino.hostname, port: destino.port ? Number(destino.port) : 5432,
    user: decodeURIComponent(credenciales.username), password: decodeURIComponent(credenciales.password), database: decodeURIComponent(destino.pathname.replace(/^\//, "")),
  });
  await c.connect();
  abiertas.push(c);
  return c;
}
async function abrir(c: Client, sucursales: string) {
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.empresa_id', $1, true)", [E]);
  await c.query("SELECT set_config('app.sucursales_lectura', $1, true)", [sucursales]);
  await c.query("SELECT set_config('app.sucursales_escritura', $1, true)", [sucursales]);
}
async function falla(c: Client, texto: string, params: unknown[] = []): Promise<{ codigo: string; restriccion: string | undefined } | null> {
  await c.query("SAVEPOINT intento");
  try {
    await c.query(texto, params);
    await c.query("RELEASE SAVEPOINT intento");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT intento");
    const err = e as { code?: string; constraint?: string };
    return { codigo: err.code ?? "sin código", restriccion: err.constraint };
  }
}

let contador = 100;
/** Un renglón de Kardex de AJUSTE (admite los dos signos) de la sección `seccion`; la Operación se crea con el dueño. */
async function renglon(c: Client, producto: string, seccion: string, sucursal: string, cantidad: number, operacion?: string) {
  const op = operacion ?? u(++contador);
  if (!operacion) await base.cliente.query(`INSERT INTO "Operacion" ("id","empresaId","sucursalId","proceso","fecha","usuarioId") VALUES ($1,$2,$3,'AJUSTE',now(),'u_ocs')`, [op, E, sucursal]);
  return falla(c, `INSERT INTO "MovimientoStock" ("id","empresaId","operacionId","productoId","seccionId","proceso","cantidad","detalle") VALUES ($1,$2,$3,$4,$5,'AJUSTE',$6,'t')`, [u(++contador), E, op, producto, seccion, cantidad]);
}
const marcar = (producto: string, sucursal: string | null, oculto = true) =>
  base.cliente.query(`INSERT INTO "OcultamientoProducto" ("id","empresaId","productoId","sucursalId","oculto","actualizadoPorId","actualizadoEn") VALUES ($1,$2,$3,$4,$5,'u_ocs',now())`, [u(++contador), E, producto, sucursal, oculto]);
const saldo = async (producto: string, seccion: string) => Number((await q<{ s: string }>(`SELECT COALESCE(sum("cantidad"),0) AS s FROM "MovimientoStock" WHERE "productoId" = $1 AND "seccionId" = $2`, [producto, seccion]))[0]!.s);
const limpiar = async () => { await base.cliente.query(`DELETE FROM "OcultamientoProducto"`); await base.cliente.query(`DELETE FROM "MovimientoStock"`); await base.cliente.query(`DELETE FROM "Operacion"`); };

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.aplicarAntesDe(MIGRACION);
  const c = base.cliente;
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_a',$1,'Centro'), ('suc_b',$1,'Norte')`, [E]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_ocs','ocs@ejemplo.test')`);
  await c.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('uni_ocs',$1,'kg','PESO')`, [E]);
  await c.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ('prod_1',$1,'MP_1','Harina','MP','uni_ocs'), ('prod_2',$1,'MP_2','Azúcar','MP','uni_ocs')`, [E]);
  await c.query(`INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre") VALUES ('sec_a',$1,'suc_a','Depósito A'), ('sec_b',$1,'suc_b','Depósito B')`, [E]);
}, 300_000);

afterAll(async () => {
  await Promise.all(abiertas.map((c) => c.end().catch(() => undefined)));
  await base?.eliminar();
});

describe("Ocultar E3c3: el disparador de MovimientoStock (subir, bajar, subir, la regla y la concurrencia)", () => {
  let antes: Awaited<ReturnType<typeof foto>>;
  let arriba: Awaited<ReturnType<typeof foto>>;

  it("0. la migración existe, avisa que requiere autorización, es posterior a la de la tabla y a la de la Parte, y su reversa no es destructiva", () => {
    expect(MIGRACION > "20261115150000").toBe(true);
    expect(sql("migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql("migration.sql")).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|ALTER TABLE|UPDATE "/);
    expect(sql("down.sql")).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/);
  });

  it("1. SUBIR: queda el disparador BEFORE INSERT y la función SECURITY DEFINER; no toca ninguna fila", async () => {
    if (!hayRol) return;
    antes = await foto();
    expect(antes.disparadores.find((d) => d.nombre === "MovimientoStock_producto_oculto_trg")).toBeUndefined();
    await base.cliente.query(sql("migration.sql"));
    arriba = await foto();
    expect(arriba.disparadores.filter((d) => d.nombre === "MovimientoStock_producto_oculto_trg").map((d) => d.definicion).join(" ")).toMatch(/BEFORE INSERT ON (public\.)?"?MovimientoStock"? FOR EACH ROW/);
    expect(await q(`SELECT prosecdef FROM pg_proc WHERE proname = 'rechazar_suma_a_producto_oculto'`)).toEqual([{ prosecdef: true }]);
    expect(arriba.filas, "no toca filas").toEqual(antes.filas);
  });

  it("2. LA REGLA (como motor2_app, con la RLS real): rechaza sumar a un oculto con saldo final > 0; todo lo demás se permite", async () => {
    if (!hayRol) return;
    const c = await conectarComoApp();
    await limpiar();
    await abrir(c, "suc_a,suc_b");
    try {
      // Visible: se permite sumar.
      expect(await renglon(c, "prod_1", "sec_a", "suc_a", 5), "visible").toBeNull();
      await c.query("ROLLBACK");
      await limpiar();
      // Oculto en el local, sin existencia: sumar se rechaza con el código y la restricción cerrados.
      await marcar("prod_1", "suc_a");
      await abrir(c, "suc_a,suc_b");
      expect(await renglon(c, "prod_1", "sec_a", "suc_a", 5), "oculto en el local").toEqual({ codigo: "23514", restriccion: "MovimientoStock_producto_oculto_chk" });
      expect(await renglon(c, "prod_1", "sec_b", "suc_b", 5), "oculto en OTRO local: no afecta a éste").toBeNull();
      expect(await renglon(c, "prod_2", "sec_a", "suc_a", 5), "otro producto").toBeNull();
      expect(await renglon(c, "prod_1", "sec_a", "suc_a", 0), "renglón en cero: no suma").toBeNull();
      expect(await renglon(c, "prod_1", "sec_a", "suc_a", -3), "restar siempre se permite").toBeNull();
      expect(await renglon(c, "prod_1", "sec_a", "suc_a", 3), "corregir el negativo HASTA cero").toBeNull();
      expect(await renglon(c, "prod_1", "sec_a", "suc_a", 1), "pasarse de cero: rechazo").toMatchObject({ codigo: "23514" });
      await c.query("ROLLBACK");
      await limpiar();
      // Oculto en toda la empresa, aunque la RLS no le deje ver la marca de la empresa a un alcance sin la sucursal... (acá sí la ve): rige igual.
      await marcar("prod_2", null);
      await abrir(c, "suc_a");
      expect(await renglon(c, "prod_2", "sec_a", "suc_a", 2), "oculto en toda la empresa").toMatchObject({ codigo: "23514" });
      await c.query("ROLLBACK");
      // Marca con oculto = false (se volvió a mostrar): se permite.
      await limpiar();
      await marcar("prod_2", null, false);
      await abrir(c, "suc_a");
      expect(await renglon(c, "prod_2", "sec_a", "suc_a", 2), "marca en false").toBeNull();
    } finally {
      await c.query("ROLLBACK");
    }
  });

  it("3. CONCURRENCIA dos a dos: ocultar vs. sumar existencia, en las dos órdenes, nunca deja «oculto y con existencia nueva»", async () => {
    if (!hayRol) return;
    /** El protocolo de `ocultarProductoCasoDeUso`: producto FOR UPDATE → escribir la marca → recién entonces mirar la existencia; con existencia, se deshace. */
    async function ocultar(c: Client): Promise<"oculto" | "rechazado"> {
      await abrir(c, "suc_a");
      await c.query(`SELECT "id" FROM "Producto" WHERE "id" = 'prod_1' FOR UPDATE`);
      await c.query(`INSERT INTO "OcultamientoProducto" ("id","empresaId","productoId","sucursalId","oculto","actualizadoPorId","actualizadoEn") VALUES ($1,$2,'prod_1','suc_a',true,'u_ocs',now())`, [u(++contador), E]);
      const { rows } = await c.query(`SELECT COALESCE(sum("cantidad"),0) AS s FROM "MovimientoStock" WHERE "productoId" = 'prod_1' AND "seccionId" = 'sec_a'`);
      if (Number(rows[0].s) !== 0) { await c.query("ROLLBACK"); return "rechazado"; }
      await new Promise((res) => setTimeout(res, 300)); // la transacción sigue abierta (marca sin confirmar) mientras el otro lado intenta sumar: así las dos se entrelazan de verdad
      await c.query("COMMIT");
      return "oculto";
    }
    for (const orden of ["ocultar primero", "sumar primero"] as const) {
      for (let ronda = 0; ronda < 4; ronda++) {
        await limpiar();
        const [a, b] = [await conectarComoApp(), await conectarComoApp()];
        const op = u(++contador);
        await base.cliente.query(`INSERT INTO "Operacion" ("id","empresaId","sucursalId","proceso","fecha","usuarioId") VALUES ($1,$2,'suc_a','AJUSTE',now(),'u_ocs')`, [op, E]);
        const sumar = async (): Promise<"sumo" | "rechazado"> => {
          await abrir(b, "suc_a");
          const r = await renglon(b, "prod_1", "sec_a", "suc_a", 2, op);
          if (r) { await b.query("ROLLBACK"); return "rechazado"; }
          await new Promise((res) => setTimeout(res, 150)); // el renglón sigue sin confirmar mientras el otro intenta
          await b.query("COMMIT");
          return "sumo";
        };
        const [x, y] = orden === "ocultar primero"
          ? await (async () => { const o = ocultar(a); await new Promise((r) => setTimeout(r, 40)); return Promise.all([o, sumar()]); })()
          : await (async () => { const s = sumar(); await new Promise((r) => setTimeout(r, 40)); return Promise.all([ocultar(a), s]); })();
        const oculto = Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "OcultamientoProducto" WHERE "productoId" = 'prod_1' AND "oculto"`))[0]!.n) > 0;
        const existencia = await saldo("prod_1", "sec_a");
        expect(oculto && existencia > 0, `${orden}, ronda ${ronda}: ocultar=${String(x)} sumar=${String(y)} oculto=${oculto} saldo=${existencia}`).toBe(false);
        expect([x, y].filter((r) => r === "oculto" || r === "sumo"), `${orden}: exactamente UNA de las dos gana`).toHaveLength(1);
      }
    }
  });

  it("4. BAJAR: el catálogo queda IDÉNTICO al de antes; bajar dos veces no falla; el stock se escribe sin el control", async () => {
    if (!hayRol) return;
    await limpiar();
    await base.cliente.query(sql("down.sql"));
    await base.cliente.query(sql("down.sql"));
    expect(await foto()).toEqual({ ...antes, filas: expect.anything() });
    await marcar("prod_1", "suc_a");
    const c = await conectarComoApp();
    await abrir(c, "suc_a");
    try { expect(await renglon(c, "prod_1", "sec_a", "suc_a", 5), "sin el disparador").toBeNull(); } finally { await c.query("ROLLBACK"); }
  });

  it("5. SUBIR OTRA VEZ: idéntico a la primera subida y el control vuelve a regir", async () => {
    if (!hayRol) return;
    await limpiar();
    await base.cliente.query(sql("migration.sql"));
    expect(await foto()).toEqual({ ...arriba, filas: expect.anything() });
    await marcar("prod_1", "suc_a");
    const c = await conectarComoApp();
    await abrir(c, "suc_a");
    try { expect(await renglon(c, "prod_1", "sec_a", "suc_a", 5)).toMatchObject({ codigo: "23514" }); } finally { await c.query("ROLLBACK"); }
  });
});
