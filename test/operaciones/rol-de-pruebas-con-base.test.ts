import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ejecutarScript } from "../../scripts/operaciones/ejecutar-sql-de-psql.mjs";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * M.3-A8: el rol de PRUEBAS `motor2_app_pruebas` de `crear-rol-motor2-app.sql`, contra Postgres REAL y en una base TEMPORAL migrada (`crearBaseTemporalMigrada`, que borra la base al terminar).
 * Los fixtures de test siembran con este rol porque las políticas por sucursal de la Fase B son `TO motor2_app`: un rol que NO es miembro de `motor2_app` no las alcanza, pero tiene los MISMOS
 * privilegios (si no, sembrar fallaría por permisos y no por lo que se quiere probar).
 *
 * Los ROLES son del cluster entero (como `motor2_app` y `motor2_plataforma`, ver `grants-m1-con-base.test.ts`): el script ENTERO nunca se corre acá. Se extraen SUS bloques (entre los marcadores
 * `-- [A8:rol:…]` y `-- [A8:grants:…]`) y se corren DENTRO de una transacción que se deshace, con una clave descartable: si el rol ya existe en el cluster (CI), el `ALTER ROLE … PASSWORD` también se
 * deshace; si no existe, se crea y desaparece con el ROLLBACK. Los GRANT son por base, así que probarlos en la temporal no toca a nadie más.
 */
const RAIZ = join(__dirname, "../..");
const SCRIPT = readFileSync(join(RAIZ, "scripts/operaciones/crear-rol-motor2-app.sql"), "utf8");
const ROL = "motor2_app_pruebas";
const CLAVE_DESCARTABLE = "clave-descartable-del-test";

let base: BaseTemporalMigrada;
let nombreDeLaBase: string;
let puedeCrearRoles = false;
let hayRolDeLaApp = false;
let existeElRolDePruebas = false;

const escapar = (c: Client) => ({ literal: (v: string) => c.escapeLiteral(v), identificador: (v: string) => c.escapeIdentifier(v) });

/** Los bloques del script entre `-- [A8:<nombre>:inicio]` y `-- [A8:<nombre>:fin]`, en orden de aparición. */
function bloques(nombre: string): string[] {
  const hallados = [...SCRIPT.matchAll(new RegExp(`^[ \\t]*-- \\[A8:${nombre}:inicio\\][^\\n]*\\n([\\s\\S]*?)^[ \\t]*-- \\[A8:${nombre}:fin\\]`, "gm"))].map((m) => m[1] as string);
  return hallados;
}

/** La sección de `motor2_app` + `motor2_app_pruebas` de UNA base del script (entre dos `\connect`), con el nombre de la base cambiado por el de la temporal y sin el `\connect`. */
function seccionDeBase(indice: 0 | 1): string {
  const cortes = SCRIPT.split(/^\\connect\b.*$/m).slice(1);
  const seccion = cortes[indice] as string;
  return seccion.replace(/\bmotor2_(dev|e2e)\b/g, nombreDeLaBase);
}

async function enTransaccion(fn: () => Promise<void>): Promise<void> {
  await base.cliente.query("BEGIN");
  try {
    await fn();
  } finally {
    await base.cliente.query("ROLLBACK");
  }
}

const correr = (texto: string, vars: Record<string, string> = {}) => ejecutarScript(texto, base.cliente, { ...vars }, escapar(base.cliente));

/** El bloque del rol con la clave descartable (como `-v clave_pruebas=…`). */
const crearRolDePruebas = () => correr(bloques("rol").join("\n"), { clave_pruebas: CLAVE_DESCARTABLE });

/** Las secciones de grants del script, con `motor2_app` ya otorgado por el propio script (se prueba la sección entera, no una copia). */
const otorgarGrants = (indice: 0 | 1, vars: Record<string, string> = {}) => correr(seccionDeBase(indice), { con_pruebas: "t", app_completo: "t", ...vars });

/** Lo mismo con `-v solo_pruebas=1`: la sección NO toca a motor2_app, solo copia lo que motor2_app tiene en ese momento. */
const sincronizarSoloPruebas = (indice: 0 | 1) => correr(seccionDeBase(indice), { con_pruebas: "t", app_completo: "f", solo_pruebas: "1" });

/** La huella de privilegios de un rol en la base temporal: toda ACL que lo nombra (tablas, secuencias, columnas, esquema, base y privilegios por defecto), sin el nombre del rol. */
async function huellaDe(rol: string): Promise<string[]> {
  const r = await base.cliente.query<{ x: string }>(
    `WITH acls AS (
       SELECT 'objeto ' || c.relkind::text || ' ' || c.relname AS donde, unnest(c.relacl)::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
       UNION ALL SELECT 'columna ' || c.relname || '.' || t.attname, unnest(t.attacl)::text FROM pg_attribute t JOIN pg_class c ON c.oid = t.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND t.attacl IS NOT NULL
       UNION ALL SELECT 'esquema public', unnest(nspacl)::text FROM pg_namespace WHERE nspname = 'public'
       UNION ALL SELECT 'base', unnest(datacl)::text FROM pg_database WHERE datname = current_database()
       UNION ALL SELECT 'por defecto ' || pg_get_userbyid(defaclrole) || ' ' || defaclobjtype::text, unnest(defaclacl)::text FROM pg_default_acl
     )
     SELECT donde || ' ' || substring(acl from '=(.*)$') AS x FROM acls WHERE acl LIKE $1 ORDER BY 1`,
    [`${rol}=%`],
  );
  return r.rows.map((f) => f.x);
}

/** Los privilegios EFECTIVOS sobre cada tabla y secuencia de public (lo que de verdad puede hacer, vengan de donde vengan). */
async function efectivosDe(rol: string): Promise<string[]> {
  const r = await base.cliente.query<{ x: string }>(
    `SELECT c.relname || ' ' || p AS x FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_table_privilege($1, c.oid, p)
     UNION ALL
     SELECT c.relname || ' ' || p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(ARRAY['USAGE','SELECT','UPDATE']) p
      WHERE n.nspname = 'public' AND c.relkind = 'S' AND has_sequence_privilege($1, c.oid, p)
     ORDER BY 1`,
    [rol],
  );
  return r.rows.map((f) => f.x);
}

/** La base temporal nace SIN migrar: los casos que miran privilegios sobre tablas la migran (`migrada`); el del orden del CI las migra DESPUÉS de otorgar. */
const migrada = () => base.aplicarRestantes();

/** Intenta algo que tiene que fallar SIN abortar la transacción del caso (savepoint): para probar varias aserciones del script seguidas. */
async function rechazado(fn: () => Promise<unknown>, patron: RegExp, motivo: string): Promise<void> {
  await base.cliente.query("SAVEPOINT intento");
  try {
    await expect(fn(), motivo).rejects.toThrow(patron);
  } finally {
    await base.cliente.query("ROLLBACK TO SAVEPOINT intento");
  }
}

beforeEach(async () => {
  base = await crearBaseTemporalMigrada();
  nombreDeLaBase = decodeURIComponent(new URL(base.url).pathname.replace(/^\//, ""));
  hayRolDeLaApp = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  existeElRolDePruebas = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app_pruebas'")).rowCount === 1;
  puedeCrearRoles = (await base.cliente.query<{ v: boolean }>("SELECT rolsuper AS v FROM pg_roles WHERE rolname = current_user")).rows[0]!.v;
}, 180_000);

afterEach(async () => {
  await base?.eliminar();
});

describe("M.3-A8: el script trae los bloques del rol de pruebas, marcados", () => {
  it("un bloque del rol y uno de grants por cada base local (motor2_dev y motor2_e2e)", () => {
    expect(bloques("rol")).toHaveLength(1);
    expect(bloques("grants")).toHaveLength(2);
  });
});

describe("M.3-A8: el rol motor2_app_pruebas (en una transacción que se deshace)", () => {
  it("se crea con LOGIN, sin superusuario, sin BYPASSRLS, sin CREATEROLE/CREATEDB/REPLICATION y NO es miembro de ningún rol (tampoco de motor2_app)", async (ctx) => {
    if (!puedeCrearRoles) ctx.skip();
    await enTransaccion(async () => {
      await crearRolDePruebas();
      const r = await base.cliente.query(`SELECT rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb, rolreplication FROM pg_roles WHERE rolname = $1`, [ROL]);
      expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: true, rolcreaterole: false, rolcreatedb: false, rolreplication: false });
      const membresias = await base.cliente.query(`SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = $1`, [ROL]);
      expect(membresias.rowCount, "el rol de pruebas es miembro de otro rol").toBe(0);
      if (hayRolDeLaApp) {
        const miembro = await base.cliente.query<{ v: boolean }>(`SELECT pg_has_role($1, 'motor2_app', 'MEMBER') AS v`, [ROL]);
        expect(miembro.rows[0]!.v, "las políticas TO motor2_app alcanzarían al rol de pruebas").toBe(false);
      }
    });
  });

  it("es idempotente y corrige la deriva: si alguien le dio SUPERUSER/BYPASSRLS/CREATEROLE, correrlo de nuevo lo deja como debe", async (ctx) => {
    if (!puedeCrearRoles) ctx.skip();
    await enTransaccion(async () => {
      await crearRolDePruebas();
      await base.cliente.query(`ALTER ROLE ${ROL} SUPERUSER BYPASSRLS CREATEROLE`);
      await crearRolDePruebas();
      const r = await base.cliente.query(`SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = $1`, [ROL]);
      expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
    });
  });

  it("ABORTA si el rol llegó a ser miembro de otro rol (motor2_app o el dueño): fallar cerrado, no corregir en silencio", async (ctx) => {
    if (!puedeCrearRoles || !hayRolDeLaApp) ctx.skip();
    for (const otro of ["motor2_app", "current_user"]) {
      await enTransaccion(async () => {
        await crearRolDePruebas();
        await base.cliente.query(otro === "current_user" ? `GRANT ${(await base.cliente.query<{ u: string }>("SELECT current_user AS u")).rows[0]!.u} TO ${ROL}` : `GRANT ${otro} TO ${ROL}`);
        await expect(crearRolDePruebas(), `miembro de ${otro}`).rejects.toThrow(/M\.3-A8/);
      });
    }
  });

  it("ABORTA con una clave vacía (un rol con LOGIN y sin contraseña no serviría y esconde el error)", async (ctx) => {
    if (!puedeCrearRoles) ctx.skip();
    await enTransaccion(async () => {
      await expect(correr(bloques("rol").join("\n"), { clave_pruebas: "" })).rejects.toThrow(/M\.3-A8/);
    });
  });

  it("SIN `clave_pruebas` el script no crea ni modifica ningún rol (los entornos viejos siguen corriéndolo como antes)", async () => {
    const sentencias: string[] = [];
    const espia = { query: (t: string) => (sentencias.push(t), base.cliente.query(t)) };
    await enTransaccion(async () => {
      await ejecutarScript(SCRIPT.slice(SCRIPT.indexOf("-- [A8:decision]"), SCRIPT.indexOf("-- [A8:decision:fin]")), espia, {}, escapar(base.cliente));
    });
    expect(sentencias.filter((s) => /\b(CREATE|ALTER|DROP)\s+ROLE\b/i.test(s))).toEqual([]);
  });
});

describe("M.3-A8: los grants de motor2_app_pruebas son los MISMOS que los de motor2_app", () => {
  beforeEach(migrada, 180_000);

  for (const [nombre, indice] of [["motor2_dev", 0], ["motor2_e2e", 1]] as const) {
    it(`sección de ${nombre}: misma huella de privilegios (ACL de tablas, secuencias, columnas, esquema, base y por defecto), también con \`restringir\` (Empresa solo de lectura)`, async (ctx) => {
      if (!puedeCrearRoles || !hayRolDeLaApp) ctx.skip();
      for (const vars of [{}, { restringir: "1" }] as Array<Record<string, string>>) {
        await enTransaccion(async () => {
          await crearRolDePruebas();
          await otorgarGrants(indice, vars);
          const app = await huellaDe("motor2_app");
          const pruebas = await huellaDe(ROL);
          expect(app.length, "la huella de motor2_app está vacía: la prueba no mide nada").toBeGreaterThan(70);
          expect(app).toContain("objeto r Producto arwd/motor2");
          expect(pruebas, `huellas distintas (${JSON.stringify(vars)})`).toEqual(app);
          expect(await efectivosDe(ROL)).toEqual(await efectivosDe("motor2_app"));
          const empresa = await base.cliente.query<{ x: string }>(`SELECT a::text AS x FROM pg_class c, unnest(c.relacl) a WHERE c.oid = 'public."Empresa"'::regclass AND a::text LIKE $1`, [`${ROL}=%`]);
          expect(empresa.rows.map((f) => f.x.replace(`${ROL}=`, ""))).toEqual([Object.keys(vars).length ? "r/motor2" : "arwd/motor2"]);
        });
      }
    });
  }

  it("correr la sección dos veces da la misma huella (idempotente)", async (ctx) => {
    if (!puedeCrearRoles || !hayRolDeLaApp) ctx.skip();
    await enTransaccion(async () => {
      await crearRolDePruebas();
      await otorgarGrants(0, { restringir: "1" });
      const primera = await huellaDe(ROL);
      await otorgarGrants(0, { restringir: "1" });
      expect(await huellaDe(ROL)).toEqual(primera);
      expect(await huellaDe("motor2_app")).toEqual(primera);
    });
  });

  it("converge: un privilegio de más que alguien le dio al rol de pruebas se quita al volver a correr, y lo que tenga motor2_app se copia (mismos grants por construcción)", async (ctx) => {
    if (!puedeCrearRoles || !hayRolDeLaApp) ctx.skip();
    await enTransaccion(async () => {
      await crearRolDePruebas();
      await otorgarGrants(0);
      await base.cliente.query(`GRANT TRUNCATE ON "Producto" TO ${ROL}`);
      expect((await efectivosDe(ROL)).includes("Producto TRUNCATE"), "premisa").toBe(true);
      await otorgarGrants(0);
      expect(await huellaDe(ROL)).toEqual(await huellaDe("motor2_app"));
      expect((await efectivosDe(ROL)).includes("Producto TRUNCATE")).toBe(false);
      await base.cliente.query(`GRANT TRUNCATE ON "Producto" TO motor2_app`);
      await otorgarGrants(0);
      expect((await efectivosDe(ROL)).includes("Producto TRUNCATE"), "lo que motor2_app tiene se copia").toBe(true);
      expect(await huellaDe(ROL)).toEqual(await huellaDe("motor2_app"));
    });
  });

  it("la aserción final del script ABORTA si los privilegios efectivos difieren (se corre SOLA, después de darle de más al rol de pruebas)", async (ctx) => {
    if (!puedeCrearRoles || !hayRolDeLaApp) ctx.skip();
    const aserciones = (bloques("grants")[0] as string).match(/^[ \t]*DO \$\$[\s\S]*?^[ \t]*\$\$;/gm) ?? [];
    const asercion = aserciones.find((d) => d.includes("diferencias"));
    expect(asercion, "el bloque de grants no trae la aserción de huella").toBeDefined();
    await enTransaccion(async () => {
      await crearRolDePruebas();
      await otorgarGrants(0);
      await expect(correr(asercion as string), "iguales: pasa").resolves.toBe(1);
      await base.cliente.query(`GRANT TRUNCATE ON "Producto" TO ${ROL}`);
      await rechazado(() => correr(asercion as string), /M\.3-A8[\s\S]*Producto TRUNCATE/, "el rol de pruebas tiene de más");
      await base.cliente.query(`REVOKE TRUNCATE ON "Producto" FROM ${ROL}`);
      await base.cliente.query(`REVOKE UPDATE ON "Producto" FROM motor2_app`);
      await rechazado(() => correr(asercion as string), /M\.3-A8[\s\S]*Producto\S* UPDATE/, "motor2_app tiene de menos");
    });
  });

  it("el rol de pruebas puede sembrar (SELECT/INSERT/UPDATE/DELETE en las tablas de la app) y no tiene TRUNCATE; sobre Empresa solo lee si motor2_app solo lee (restringir)", async (ctx) => {
    if (!puedeCrearRoles || !hayRolDeLaApp) ctx.skip();
    await enTransaccion(async () => {
      await crearRolDePruebas();
      await otorgarGrants(0, { restringir: "1" });
      const puede = async (privilegio: string, tabla: string) =>
        (await base.cliente.query<{ v: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS v`, [ROL, `public."${tabla}"`, privilegio])).rows[0]!.v;
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(await puede(p, "Producto"), `Producto ${p}`).toBe(true);
      expect(await puede("SELECT", "Empresa")).toBe(true);
      for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) expect(await puede(p, "Empresa"), `Empresa ${p}`).toBe(false);
      expect(await puede("TRUNCATE", "Producto"), "TRUNCATE queda del dueño").toBe(false);
    });
  });
});

describe("M.3-A8: el ORDEN del CI (rol y privilegios por defecto ANTES de migrar; `solo_pruebas` DESPUÉS)", () => {
  it("al migrar, el rol de pruebas recibe los privilegios por defecto pero las migraciones recortan SOLO a motor2_app; `solo_pruebas` copia esos recortes y no toca a motor2_app", async (ctx) => {
    // No es transaccional (las migraciones no se pueden deshacer en bloque): usa el rol de pruebas que YA existe en el cluster (en CI lo crea el paso previo a migrar) y toca solo la base temporal.
    if (!hayRolDeLaApp || !existeElRolDePruebas) ctx.skip();
    const tieneTabla = async (rol: string, tabla: string, p: string) => (await base.cliente.query<{ v: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS v`, [rol, `public."${tabla}"`, p])).rows[0]!.v;
    const tieneColumna = async (rol: string, tabla: string, columna: string, p: string) =>
      (await base.cliente.query<{ v: boolean }>(`SELECT has_column_privilege($1, $2, $3, $4) AS v`, [rol, `public."${tabla}"`, columna, p])).rows[0]!.v;

    await otorgarGrants(0); // base vacía: deja los privilegios por defecto de los dos roles (lo que hace el script antes de `prisma migrate deploy`)
    await migrada();

    // Antes de sincronizar: el recorte de la migración de auditoría inmutable le llegó a motor2_app, no al rol de pruebas (la divergencia que `solo_pruebas` corrige).
    expect(await tieneTabla("motor2_app", "RegistroAuditoria", "UPDATE"), "premisa: la migración recortó a motor2_app").toBe(false);
    expect(await tieneTabla(ROL, "RegistroAuditoria", "UPDATE"), "premisa: el rol de pruebas conserva el privilegio por defecto").toBe(true);
    const appAntes = await huellaDe("motor2_app");

    await sincronizarSoloPruebas(0);

    expect(await tieneTabla(ROL, "RegistroAuditoria", "UPDATE")).toBe(false);
    expect(await tieneTabla(ROL, "RegistroAuditoria", "DELETE")).toBe(false);
    expect(await tieneTabla(ROL, "RegistroAuditoria", "INSERT")).toBe(true);
    expect(await tieneTabla(ROL, "Invitacion", "UPDATE"), "Invitacion: sin UPDATE de tabla").toBe(false);
    expect(await tieneColumna(ROL, "Invitacion", "estado", "UPDATE"), "Invitacion: UPDATE por columna").toBe(true);
    expect(await tieneColumna(ROL, "Invitacion", "id", "UPDATE"), "una columna que motor2_app no puede actualizar").toBe(false);
    expect(await efectivosDe(ROL)).toEqual(await efectivosDe("motor2_app"));
    expect(await huellaDe(ROL), "misma huella de ACL que motor2_app").toEqual(await huellaDe("motor2_app"));
    expect(await huellaDe("motor2_app"), "solo_pruebas cambió a motor2_app").toEqual(appAntes);
  }, 180_000);
});
