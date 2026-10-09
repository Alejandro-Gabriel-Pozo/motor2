import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ejecutarScript } from "../../scripts/operaciones/ejecutar-sql-de-psql.mjs";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * M.1 «Grants de la consola» (S-35 / M-10 / M-33), contra Postgres REAL: los scripts de `scripts/operaciones/` se corren de verdad sobre una base TEMPORAL con todas las migraciones
 * (`crearBaseTemporalMigrada`, que se niega a correr fuera de un Postgres local y borra la base al terminar). Jamás sobre `motor2_dev` ni `motor2_e2e`.
 *
 * Los GRANT/REVOKE son por base, así que probarlos acá no toca a nadie más. Los ROLES, en cambio, son del cluster entero (`motor2_app`, `motor2_plataforma`): este archivo NUNCA pasa `clave`
 * (un `ALTER ROLE … PASSWORD` cambiaría la contraseña de todo el entorno) y solo ejercita el camino «el rol ya existe». Si el cluster no tiene los dos roles (un Postgres de CI sin el paso
 * de roles) o falta `PLATAFORMA_DATABASE_URL`, los casos se omiten con motivo.
 *
 * Los scripts se corren con el mismo ejecutor que usa el dueño (`ejecutarScript`, una sola transacción: lo que falla no deja nada a medias), contra el cliente del DUEÑO de la base temporal.
 */
const RAIZ = join(__dirname, "../..");
const script = (nombre: string) => readFileSync(join(RAIZ, "scripts/operaciones", nombre), "utf8");

let base: BaseTemporalMigrada;
let hayRoles = false;

const escapar = (c: Client) => ({ literal: (v: string) => c.escapeLiteral(v), identificador: (v: string) => c.escapeIdentifier(v) });

/** Corre un script del repo como lo haría el ejecutor del dueño: en UNA transacción (si falla, ROLLBACK y el error sale). */
async function correr(nombre: string, vars: Record<string, string> = {}): Promise<void> {
  await base.cliente.query("BEGIN");
  try {
    await ejecutarScript(script(nombre), base.cliente, { ...vars }, escapar(base.cliente));
    await base.cliente.query("COMMIT");
  } catch (e) {
    await base.cliente.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

const tiene = async (rol: string, tabla: string, privilegios: string): Promise<boolean> =>
  (await base.cliente.query<{ v: boolean }>("SELECT has_table_privilege($1, $2, $3) AS v", [rol, `public."${tabla}"`, privilegios])).rows[0]!.v;

/** ¿Puede iniciar sesión motor2_plataforma, con la contraseña de PLATAFORMA_DATABASE_URL, en la base temporal? (la prueba de que el script no rotó la credencial) */
async function plataformaPuedeIngresar(): Promise<boolean> {
  const credenciales = new URL(process.env.PLATAFORMA_DATABASE_URL as string);
  const destino = new URL(base.url);
  const c = new Client({
    host: destino.hostname,
    port: destino.port ? Number(destino.port) : 5432,
    user: decodeURIComponent(credenciales.username),
    password: decodeURIComponent(credenciales.password),
    database: decodeURIComponent(destino.pathname.replace(/^\//, "")),
  });
  try {
    await c.connect();
    await c.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

/** El hash guardado de la contraseña (solo lo lee un superusuario; con un dueño que no lo es devuelve null y ese control se omite: queda el de poder ingresar). */
async function hashDeLaClave(): Promise<string | null> {
  try {
    const r = await base.cliente.query<{ h: string }>("SELECT rolpassword AS h FROM pg_authid WHERE rolname = 'motor2_plataforma'");
    return r.rows[0]?.h ?? null;
  } catch {
    return null;
  }
}

/** Una conexión a la base temporal con las credenciales de un rol del .env (la contraseña viene de la URL; nunca se imprime). */
function clienteComo(urlConCredenciales: string | undefined, usuarioEsperado: string): Client | null {
  if (!urlConCredenciales) return null;
  const credenciales = new URL(urlConCredenciales);
  if (decodeURIComponent(credenciales.username) !== usuarioEsperado) return null;
  const destino = new URL(base.url);
  return new Client({
    host: destino.hostname,
    port: destino.port ? Number(destino.port) : 5432,
    user: usuarioEsperado,
    password: decodeURIComponent(credenciales.password),
    database: decodeURIComponent(destino.pathname.replace(/^\//, "")),
  });
}

/** Los privilegios EXACTOS de "Empresa" (tabla y columnas), ordenados: la ACL tal como queda guardada, sin depender del orden en que se fueron otorgando. */
async function aclDeEmpresa(): Promise<string[]> {
  const r = await base.cliente.query<{ x: string }>(
    `SELECT 'tabla ' || a::text AS x FROM pg_class c, unnest(c.relacl) a WHERE c.oid = 'public."Empresa"'::regclass
     UNION ALL
     SELECT 'columna ' || t.attname || ' ' || a::text FROM pg_attribute t, unnest(t.attacl) a WHERE t.attrelid = 'public."Empresa"'::regclass AND t.attacl IS NOT NULL
     ORDER BY 1`,
  );
  return r.rows.map((f) => f.x);
}

const ESCRITURA_Y_MAS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

beforeEach(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarRestantes();
  const roles = await base.cliente.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_plataforma')");
  hayRoles = roles.rows.length === 2 && Boolean(process.env.PLATAFORMA_DATABASE_URL);
}, 180_000);

afterEach(async () => {
  await base?.eliminar();
});

describe("M.1-C1: `clave` es opcional si el rol de plataforma YA existe", () => {
  it("restringir sin clave aplica el recorte y la contraseña de motor2_plataforma sigue sirviendo", async (ctx) => {
    if (!hayRoles) ctx.skip();
    expect(await plataformaPuedeIngresar(), "premisa: la contraseña de PLATAFORMA_DATABASE_URL sirve antes de correr el script").toBe(true);
    const antes = await hashDeLaClave();

    await correr("crear-rol-motor2-plataforma.sql", { restringir: "1" });

    // el recorte: motor2_app ya no escribe Empresa y sigue leyéndola
    for (const privilegio of ["INSERT", "UPDATE", "DELETE"]) expect(await tiene("motor2_app", "Empresa", privilegio), `motor2_app conserva ${privilegio} sobre Empresa`).toBe(false);
    expect(await tiene("motor2_app", "Empresa", "SELECT")).toBe(true);
    // la credencial de la consola quedó como estaba
    expect(await plataformaPuedeIngresar(), "la contraseña de motor2_plataforma dejó de servir: el script rotó la credencial").toBe(true);
    expect(await hashDeLaClave(), "el hash de la clave cambió: hubo un ALTER ROLE … PASSWORD").toBe(antes);
    // y el rol sigue siendo el de la consola
    const atributos = await base.cliente.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>("SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'motor2_plataforma'");
    expect(atributos.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: true });
  });

  it("la verificación de atributos aborta con un rol superusuario, con BYPASSRLS o sin LOGIN, y deja pasar al que es de la consola (roles descartables, dentro de una transacción que se deshace)", async () => {
    // Se saca del script real el DO que mira los atributos y se le cambia el nombre del rol por uno descartable: así se prueba LA MISMA lógica sin tocar a motor2_plataforma, que es del cluster entero.
    const bloque = (script("crear-rol-motor2-plataforma.sql").match(/^\s*DO \$\$[\s\S]*?^\s*\$\$;/gm) ?? []).find((b) => b.includes("rolcanlogin"));
    expect(bloque, "el script no tiene el DO que verifica los atributos del rol existente").toBeDefined();
    const rol = `m1_prueba_${process.pid}`;
    const casos: Array<[string, boolean]> = [
      ["LOGIN NOSUPERUSER NOBYPASSRLS", false],
      ["LOGIN BYPASSRLS", true],
      ["LOGIN SUPERUSER", true],
      ["NOLOGIN", true],
    ];
    for (const [atributos, debeFallar] of casos) {
      await base.cliente.query("BEGIN");
      try {
        await base.cliente.query(`CREATE ROLE ${rol} ${atributos}`);
        const corrida = ejecutarScript((bloque as string).replaceAll("motor2_plataforma", rol), base.cliente, {}, escapar(base.cliente));
        if (debeFallar) await expect(corrida, `con «${atributos}» tendría que abortar`).rejects.toThrow(/M\.1/);
        else await expect(corrida, `con «${atributos}» tendría que pasar`).resolves.toBe(1);
      } finally {
        await base.cliente.query("ROLLBACK");
      }
    }
    expect((await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [rol])).rowCount, "el rol descartable quedó en el cluster").toBe(0);
  });
});

describe("M.1-C2: `restringir` deniega por defecto sobre Empresa (no enumera lo que quita)", () => {
  it("quita también TRUNCATE, TRIGGER y REFERENCES y los privilegios por columna que motor2_app tuviera; la deja solo con SELECT", async (ctx) => {
    if (!hayRoles) ctx.skip();
    await base.cliente.query(`GRANT TRUNCATE, TRIGGER, REFERENCES ON "Empresa" TO motor2_app`);
    await base.cliente.query(`GRANT UPDATE ("nombre"), INSERT ("slug"), REFERENCES ("cuit") ON "Empresa" TO motor2_app`);
    for (const p of ["TRUNCATE", "TRIGGER", "REFERENCES"]) expect(await tiene("motor2_app", "Empresa", p), `premisa: ${p} otorgado`).toBe(true);

    await correr("crear-rol-motor2-plataforma.sql", { restringir: "1" });

    for (const p of ESCRITURA_Y_MAS) expect(await tiene("motor2_app", "Empresa", p), `motor2_app conserva ${p} sobre Empresa`).toBe(false);
    const columnas = await base.cliente.query<{ v: boolean }>(`SELECT has_any_column_privilege('motor2_app', 'public."Empresa"', 'INSERT, UPDATE, REFERENCES') AS v`);
    expect(columnas.rows[0]!.v, "motor2_app conserva privilegios por columna sobre Empresa").toBe(false);
    expect((await aclDeEmpresa()).filter((x) => x.includes("motor2_app="))).toEqual(["tabla motor2_app=r/motor2"]);
  });

  it("con UPDATE sobre Empresa otorgado a PUBLIC el script FALLA con el mensaje de M.1 y no cambia NADA (la ACL queda idéntica)", async (ctx) => {
    if (!hayRoles) ctx.skip();
    await base.cliente.query(`GRANT UPDATE ON "Empresa" TO PUBLIC`);
    const antes = await aclDeEmpresa();
    expect(antes.some((x) => x.startsWith("tabla =w/")), "premisa: PUBLIC tiene UPDATE").toBe(true);

    await expect(correr("crear-rol-motor2-plataforma.sql", { restringir: "1" })).rejects.toThrow(/M\.1/);

    expect(await aclDeEmpresa(), "el script falló a medias y dejó la ACL cambiada").toEqual(antes);
    expect(await tiene("motor2_app", "Empresa", "INSERT"), "el REVOKE quedó aplicado aunque el script falló").toBe(true);
  });

  it("con la escritura heredada por MEMBRESÍA de otro rol el script también falla (rol descartable; la transacción se deshace entera)", async (ctx) => {
    if (!hayRoles) ctx.skip();
    const intermedio = `m1_heredado_${process.pid}`;
    await base.cliente.query("BEGIN");
    try {
      await base.cliente.query(`CREATE ROLE ${intermedio} NOLOGIN`);
      await base.cliente.query(`GRANT UPDATE ON "Empresa" TO ${intermedio}`);
      await base.cliente.query(`GRANT ${intermedio} TO motor2_app`);
      expect(await tiene("motor2_app", "Empresa", "UPDATE"), "premisa: motor2_app hereda UPDATE").toBe(true);
      await expect(ejecutarScript(script("crear-rol-motor2-plataforma.sql"), base.cliente, { restringir: "1" }, escapar(base.cliente))).rejects.toThrow(/M\.1/);
    } finally {
      await base.cliente.query("ROLLBACK");
    }
    expect((await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [intermedio])).rowCount, "el rol descartable quedó en el cluster").toBe(0);
  });

  it("los dos bloques `\\if :{?restringir}` de crear-rol-motor2-app.sql hacen lo mismo (se corren SOLOS: el script entero cambia el rol de todo el cluster y no se prueba contra Postgres real)", async (ctx) => {
    if (!hayRoles) ctx.skip();
    const bloques = [...script("crear-rol-motor2-app.sql").matchAll(/^\\if :\{\?restringir\}\r?\n[\s\S]*?^\\endif/gm)].map((m) => m[0]);
    expect(bloques, "uno por base: motor2_dev y motor2_e2e").toHaveLength(2);
    for (const bloque of bloques) {
      await base.cliente.query(`GRANT TRUNCATE, TRIGGER, REFERENCES ON "Empresa" TO motor2_app`);
      await base.cliente.query("BEGIN");
      try {
        await ejecutarScript(bloque, base.cliente, { restringir: "1" }, escapar(base.cliente));
        await base.cliente.query("COMMIT");
      } catch (e) {
        await base.cliente.query("ROLLBACK").catch(() => undefined);
        throw e;
      }
      for (const p of ESCRITURA_Y_MAS) expect(await tiene("motor2_app", "Empresa", p), `el bloque deja ${p}`).toBe(false);
      expect(await tiene("motor2_app", "Empresa", "SELECT")).toBe(true);

      // con PUBLIC escribiendo, el bloque aborta
      await base.cliente.query(`GRANT UPDATE ON "Empresa" TO PUBLIC`);
      await base.cliente.query("BEGIN");
      await expect(ejecutarScript(bloque, base.cliente, { restringir: "1" }, escapar(base.cliente))).rejects.toThrow(/M\.1/);
      await base.cliente.query("ROLLBACK");
      await base.cliente.query(`REVOKE UPDATE ON "Empresa" FROM PUBLIC`);
    }
  });

  it("motor2_app sigue pudiendo LEER Empresa (la app la necesita) y ya no puede escribirla: lo prueba entrando de verdad con su credencial", async (ctx) => {
    if (!hayRoles) ctx.skip();
    const comoApp = clienteComo(process.env.DATABASE_URL, "motor2_app");
    if (!comoApp) ctx.skip();
    await correr("crear-rol-motor2-plataforma.sql", { restringir: "1" });
    expect(await tiene("motor2_app", "Empresa", "SELECT")).toBe(true);
    const app = comoApp as Client;
    await app.connect();
    try {
      await expect(app.query(`SELECT count(*) FROM "Empresa"`)).resolves.toBeDefined();
      for (const sentencia of [`UPDATE "Empresa" SET "nombre" = "nombre"`, `DELETE FROM "Empresa"`, `TRUNCATE "Empresa"`]) {
        await expect(app.query(sentencia), sentencia).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await app.end();
    }
  });
});
