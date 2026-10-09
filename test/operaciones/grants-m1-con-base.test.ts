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
