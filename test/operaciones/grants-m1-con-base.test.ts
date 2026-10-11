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

const SIETE_PRIVILEGIOS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

/** La matriz de un rol: «tabla PRIVILEGIO» para cada privilegio EFECTIVO que tiene sobre las tablas de public. */
async function matrizDe(rol: string): Promise<string[]> {
  const r = await base.cliente.query<{ x: string }>(
    `SELECT c.relname || ' ' || p AS x
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest($2::text[]) p
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_table_privilege($1, c.oid, p)
      ORDER BY 1`,
    [rol, SIETE_PRIVILEGIOS],
  );
  return r.rows.map((f) => f.x);
}

/** La huella del estado de permisos de la base: la ACL de TODAS las tablas y secuencias de public (y por columna), los privilegios por defecto y los atributos (sin contraseña) de los dos roles. */
async function huella(): Promise<Record<"tablas" | "columnas" | "porDefecto" | "roles", string[]>> {
  const pedir = async (consulta: string) => (await base.cliente.query<{ x: string }>(consulta)).rows.map((f) => f.x);
  return {
    tablas: await pedir(`SELECT c.relname || ' ' || a::text AS x FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(c.relacl) a WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S') ORDER BY 1`),
    columnas: await pedir(`SELECT c.relname || '.' || t.attname || ' ' || a::text AS x FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute t ON t.attrelid = c.oid, unnest(t.attacl) a WHERE n.nspname = 'public' AND t.attacl IS NOT NULL ORDER BY 1`),
    porDefecto: await pedir(`SELECT pg_get_userbyid(d.defaclrole) || ' ' || d.defaclobjtype::text || ' ' || a::text AS x FROM pg_default_acl d, unnest(d.defaclacl) a ORDER BY 1`),
    roles: await pedir(
      `SELECT rolname || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls || ' login=' || rolcanlogin || ' createrole=' || rolcreaterole || ' createdb=' || rolcreatedb || ' inherit=' || rolinherit || ' limite=' || rolconnlimit AS x FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_plataforma') ORDER BY 1`,
    ),
  };
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

describe("M.1-C3: reversa granular (ida y vuelta, en una base real temporal)", () => {
  it("recorte → devolver-escritura-de-empresa: la ACL de Empresa y la huella entera vuelven EXACTAS a las de antes del recorte, y repetir la reversa no cambia nada", async (ctx) => {
    if (!hayRoles) ctx.skip();
    await correr("crear-rol-motor2-plataforma.sql"); // el estado de ANTES del recorte: rol de plataforma con sus grants, motor2_app con la escritura de Empresa
    const aclAntes = await aclDeEmpresa();
    const huellaAntes = await huella();
    expect(aclAntes.filter((x) => x.includes("motor2_app=")), "premisa: antes del recorte la app escribe Empresa").toEqual(["tabla motor2_app=arwd/motor2"]);

    await correr("crear-rol-motor2-plataforma.sql", { restringir: "1" });
    expect((await aclDeEmpresa()).filter((x) => x.includes("motor2_app="))).toEqual(["tabla motor2_app=r/motor2"]);

    await correr("devolver-escritura-de-empresa-a-motor2-app.sql");
    expect(await aclDeEmpresa(), "la reversa no devolvió exactamente la ACL de Empresa").toEqual(aclAntes);
    expect(await huella(), "la reversa cambió algo más que Empresa").toEqual(huellaAntes);

    await correr("devolver-escritura-de-empresa-a-motor2-app.sql");
    expect(await huella(), "la reversa no es idempotente").toEqual(huellaAntes);
    // y se puede volver a recortar: ida y vuelta, otra vez
    await correr("crear-rol-motor2-plataforma.sql", { restringir: "1" });
    await correr("devolver-escritura-de-empresa-a-motor2-app.sql");
    expect(await huella()).toEqual(huellaAntes);
  });

  it("la reversa no toca a motor2_plataforma ni a las demás tablas, y funciona aunque el recorte no se haya aplicado nunca", async (ctx) => {
    if (!hayRoles) ctx.skip();
    const sinRecorte = await huella();
    await correr("devolver-escritura-de-empresa-a-motor2-app.sql");
    expect(await huella(), "con la escritura ya dada, la reversa es un no-op").toEqual(sinRecorte);

    await correr("crear-rol-motor2-plataforma.sql", { restringir: "1" });
    const recortado = await matrizDe("motor2_plataforma");
    await correr("devolver-escritura-de-empresa-a-motor2-app.sql");
    expect(await matrizDe("motor2_plataforma"), "la reversa granular cambió los grants de motor2_plataforma").toEqual(recortado);
    for (const p of ["INSERT", "UPDATE", "DELETE"]) expect(await tiene("motor2_app", "Empresa", p), `la reversa no devolvió ${p}`).toBe(true);
    for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER"]) expect(await tiene("motor2_app", "Empresa", p), `la reversa dio de más: ${p}`).toBe(false);
  });

  it("revertir-recorte-de-grants-motor2-plataforma.sql devuelve exactamente lo documentado a motor2_plataforma, y volver a recortar da la misma huella que el primer recorte", async (ctx) => {
    if (!hayRoles) ctx.skip();
    await correr("crear-rol-motor2-plataforma.sql");
    const matrizAntesDelRecorte = await matrizDe("motor2_plataforma");

    await correr("crear-rol-motor2-plataforma.sql", { restringir: "1" });
    expect(await matrizDe("motor2_plataforma"), "restringir tocó los grants de motor2_plataforma").toEqual(matrizAntesDelRecorte);
    const huellaRecortada = await huella();

    await correr("revertir-recorte-de-grants-motor2-plataforma.sql");
    const revertida = await matrizDe("motor2_plataforma");
    expect(revertida.filter((x) => !matrizAntesDelRecorte.includes(x))).toEqual([
      "RegistroAuditoria INSERT",
      "RegistroAuditoria SELECT",
      "User INSERT",
      "User UPDATE",
      "UsuarioEmpresa INSERT",
      "UsuarioSucursal INSERT",
      "UsuarioSucursal SELECT",
    ]);
    expect(matrizAntesDelRecorte.filter((x) => !revertida.includes(x)), "la reversa quitó algo").toEqual([]);

    await correr("crear-rol-motor2-plataforma.sql", { restringir: "1" });
    expect(await matrizDe("motor2_plataforma"), "volver a recortar no dejó la matriz de antes").toEqual(matrizAntesDelRecorte);
    expect(await huella(), "volver a recortar no da la misma huella").toEqual(huellaRecortada);
  });
});

describe("M.1-C5: la guarda de crear-rol-motor2-app.sql (SOLO el DO de guarda; el script entero cambia el rol de todo el cluster y NO se corre contra Postgres real)", () => {
  const guarda = () => (script("crear-rol-motor2-app.sql").match(/^DO \$\$[\s\S]*?^\$\$;/m) ?? [])[0] as string;
  const correrGuarda = (texto: string) => ejecutarScript(texto, base.cliente, {}, escapar(base.cliente));

  it("aborta si falta motor2_dev o motor2_e2e, y deja pasar cuando están las dos", async () => {
    expect(guarda(), "no hay DO de guarda").toBeTruthy();
    for (const base_ of ["motor2_dev", "motor2_e2e"]) {
      await expect(correrGuarda(guarda().replaceAll(`'${base_}'`, `'no_existe_${process.pid}'`)), `sin ${base_} tendría que abortar`).rejects.toThrow(/M\.1[\s\S]*NUNCA en Neon/);
    }
    const locales = await base.cliente.query("SELECT 1 FROM pg_database WHERE datname IN ('motor2_dev', 'motor2_e2e')");
    if (locales.rowCount === 2) await expect(correrGuarda(guarda())).resolves.toBe(1);
  });

  it("aborta si el servidor es de Neon (existe el rol neon_superuser); roles descartables dentro de una transacción que se deshace", async () => {
    await base.cliente.query("BEGIN");
    try {
      await base.cliente.query("CREATE ROLE neon_superuser NOLOGIN");
      await expect(correrGuarda(guarda())).rejects.toThrow(/NUNCA en Neon/);
    } finally {
      await base.cliente.query("ROLLBACK");
    }
    expect((await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser'")).rowCount).toBe(0);
  });
});

describe("M.1-C4: verificar-grants-m1.sql es de solo lectura y mide lo que dice", () => {
  type Fila = Record<string, unknown>;
  /** Corre el verificador DENTRO de una transacción READ ONLY (si escribiera algo, Postgres lo rechaza) y devuelve las filas de cada consulta. */
  async function verificar(): Promise<Fila[][]> {
    const consultas: Fila[][] = [];
    await base.cliente.query("BEGIN READ ONLY");
    try {
      await ejecutarScript(script("verificar-grants-m1.sql"), base.cliente, {}, escapar(base.cliente), (_sentencia, resultado) => consultas.push(resultado.rows as Fila[]));
    } finally {
      await base.cliente.query("ROLLBACK");
    }
    return consultas;
  }
  const consultaCon = (consultas: Fila[][], columna: string) => consultas.find((filas) => filas.length > 0 && columna in filas[0]!) ?? [];

  it("corre completo dentro de BEGIN READ ONLY sin fallar, también sin los roles en el cluster", async () => {
    const consultas = await verificar();
    expect(consultas.length, "no devolvió las 11 consultas").toBe(11);
    expect(consultaCon(consultas, "relacl_de_empresa"), "falta la ACL exacta de Empresa").toHaveLength(1);
    expect(consultaCon(consultas, "huella_de_la_matriz")[0]!.huella_de_la_matriz).toMatch(/^[0-9a-f]{32}$/);
  });

  it("la ACL de Empresa, la matriz y la huella reflejan el recorte y la reversa (la huella cambia al recortar y vuelve al devolver la escritura)", async (ctx) => {
    if (!hayRoles) ctx.skip();
    await correr("crear-rol-motor2-plataforma.sql"); // el estado de antes del recorte
    const antes = await verificar();
    const huellaAntes = consultaCon(antes, "huella_de_la_matriz")[0]!.huella_de_la_matriz;
    expect(consultaCon(antes, "relacl_de_empresa")[0]!.relacl_de_empresa).toContain("motor2_app=arwd/");
    expect(consultaCon(antes, "puede_select").length, "la matriz tiene una fila por rol y tabla").toBeGreaterThan(70);

    await correr("crear-rol-motor2-plataforma.sql", { restringir: "1" });
    const recortada = await verificar();
    expect(consultaCon(recortada, "huella_de_la_matriz")[0]!.huella_de_la_matriz, "la huella no cambió con el recorte").not.toBe(huellaAntes);
    expect(consultaCon(recortada, "relacl_de_empresa")[0]!.relacl_de_empresa).toContain("motor2_app=r/");
    const filaDeEmpresa = consultaCon(recortada, "puede_select").find((f) => f.rol === "motor2_app" && f.tabla === "Empresa");
    expect(filaDeEmpresa).toMatchObject({ puede_select: true, puede_insert: false, puede_update: false, puede_delete: false, puede_truncate: false, puede_references: false, puede_trigger: false });
    expect(consultaCon(recortada, "privilegios_sobre_empresa").find((f) => f.quien === "motor2_app")?.privilegios_sobre_empresa).toBe("SELECT");

    await correr("devolver-escritura-de-empresa-a-motor2-app.sql");
    const devuelta = await verificar();
    expect(consultaCon(devuelta, "huella_de_la_matriz")[0]!.huella_de_la_matriz, "la huella no volvió a la de antes").toBe(huellaAntes);
  });

  it("ve un privilegio por columna y uno de PUBLIC que un REVOKE de rol no quita", async () => {
    await base.cliente.query(`GRANT UPDATE ON "Empresa" TO PUBLIC`);
    await base.cliente.query(`GRANT SELECT ("nombre") ON "Sucursal" TO PUBLIC`);
    const consultas = await verificar();
    expect(consultaCon(consultas, "privilegios_sobre_empresa").find((f) => f.quien === "PUBLIC")?.privilegios_sobre_empresa).toBe("UPDATE");
    expect(consultaCon(consultas, "attacl").some((f) => f.tabla === "Sucursal" && f.columna === "nombre")).toBe(true);
  });
});
