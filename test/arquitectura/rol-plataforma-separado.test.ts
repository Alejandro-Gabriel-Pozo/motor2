import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (informe de seguridad 2026-10-01, S-13): escribir `Empresa` (alta, activación, política de plataforma) es cosa del rol
 * `motor2_plataforma`, no de `motor2_app`, el rol con el que corre la aplicación. El paso de base que los separa es manual (psql, con autorización
 * expresa), así que lo que este guardián cuida es que el repo no lo desarme por descuido:
 *  1. Los scripts de plataforma usan el cliente `prismaPlataforma` (el que lee PLATAFORMA_DATABASE_URL), nunca uno propio.
 *  2. Ninguna migración posterior al esquema inicial le da a `motor2_app` escritura sobre `Empresa` (ni con un GRANT ... ON ALL TABLES).
 *  3. Los únicos scripts de operaciones que se la devuelven son `quitar-rol-motor2-plataforma.sql` y, desde M.1-C3, la reversa granular `devolver-escritura-de-empresa-a-motor2-app.sql`
 *     (y `crear-rol-motor2-app.sql`, que arma las bases locales); el de creación la quita con `restringir=1`.
 *  4. La aplicación (`src/`) no conoce el cliente ni la variable de plataforma, y el cargador de variables de Vercel no la acepta con valor.
 */
const RAIZ = join(__dirname, "../..");
const MIGRACION_INICIAL = "20260929100000_multiempresa_estructura";
const leer = (...ruta: string[]) => readFileSync(join(RAIZ, ...ruta), "utf8");

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}

function sentencias(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/^\s*\\[^\n]*/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Sentencias GRANT que le dan a `motor2_app` escritura sobre `Empresa` (nombrada, o con ON ALL TABLES). */
function grantsDeEscrituraSobreEmpresa(sql: string): string[] {
  return sentencias(sql).filter((s) => {
    if (!/^GRANT\b/i.test(s) || !/\bTO\b[^]*\bmotor2_app\b/i.test(s)) return false;
    if (!/\b(INSERT|UPDATE|DELETE|ALL)\b/i.test(s.split(/\bON\b/i)[0])) return false;
    return /"Empresa"(?!\w)/.test(s) || /\bON\s+ALL\s+TABLES\b/i.test(s);
  });
}

describe("el rol de plataforma queda separado de motor2_app", () => {
  it("los scripts de plataforma obtienen su cliente de cliente-plataforma.ts y no crean el propio (ADR-025: --instalacion)", () => {
    // Mutación: un `new PrismaClient(` en modulos-empresa.ts o politica-empresa.ts pone este test en rojo.
    // S-33: los scripts obtienen su cliente (y el actor ya verificado) de `contexto-de-plataforma.ts`, que lo pide a cliente-plataforma.ts: ni ellos ni el contexto crean uno propio.
    for (const script of ["politica-empresa.ts", "modulos-empresa.ts"]) {
      const fuente = leer("scripts", script);
      expect(fuente, `${script} no abre su conexión por contexto-de-plataforma.ts`).toMatch(/import \{[^}]*\babrirContextoDePlataforma\b[^}]*\} from "\.\/contexto-de-plataforma"/);
      expect(fuente, `${script} crea su propio PrismaClient`).not.toMatch(/new PrismaClient\(/);
      expect(fuente, `${script} lee process.env de plataforma directo en vez de pasar por el resolutor`).not.toMatch(/process\.env\.(PLATAFORMA_DATABASE_URL|DATABASE_URL)\b/);
    }
    expect(leer("scripts", "contexto-de-plataforma.ts"), "contexto-de-plataforma.ts no importa el cliente de cliente-plataforma.ts").toMatch(/import \{\s*clienteDePlataforma\s*\} from "\.\/cliente-plataforma"/);
  });

  it("el único script de plataforma que crea un cliente de Prisma o un adaptador es cliente-plataforma.ts", () => {
    // Mutación: un `new PrismaClient(` o `new PrismaPg(`/`new PrismaNeon(` en modulos-empresa.ts, politica-empresa.ts o scripts/plataforma/** pone este test en rojo.
    // (Otros scripts del repo, como benchmark-reportes.ts, crean su propio cliente contra la app: no son de plataforma y quedan afuera.)
    const archivosDePlataforma = [
      join(RAIZ, "scripts/cliente-plataforma.ts"),
      join(RAIZ, "scripts/contexto-de-plataforma.ts"),
      join(RAIZ, "scripts/modulos-empresa.ts"),
      join(RAIZ, "scripts/politica-empresa.ts"),
      ...archivos(join(RAIZ, "scripts/plataforma")),
    ];
    const creadores = archivosDePlataforma
      .filter((r) => /new\s+(PrismaClient|PrismaPg|PrismaNeon)\b|from\s+["']@prisma\/adapter-/.test(readFileSync(r, "utf8")))
      .map((r) => r.replace(RAIZ, "").replace(/\\/g, "/").replace(/^\//, ""));
    expect(creadores).toEqual(["scripts/cliente-plataforma.ts"]);
  });

  it("ninguna migración posterior a la inicial le da a motor2_app escritura sobre Empresa", () => {
    const problemas: string[] = [];
    for (const carpeta of readdirSync(join(RAIZ, "prisma/migrations"), { withFileTypes: true })) {
      if (!carpeta.isDirectory() || carpeta.name === MIGRACION_INICIAL) continue;
      for (const archivo of ["migration.sql", "down.sql"]) {
        let sql: string;
        try {
          sql = leer("prisma/migrations", carpeta.name, archivo);
        } catch {
          continue;
        }
        for (const g of grantsDeEscrituraSobreEmpresa(sql)) problemas.push(`${carpeta.name}/${archivo}: ${g.slice(0, 80)}`);
      }
    }
    expect(problemas, `Estas migraciones devolverían la escritura de Empresa a motor2_app:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("solo quitar-rol-motor2-plataforma.sql devuelve la escritura; crear-rol-motor2-plataforma.sql la quita con restringir=1", () => {
    const operaciones = join(RAIZ, "scripts/operaciones");
    // S-35 (B-C20): también cuenta el GRANT masivo (`ON ALL TABLES`), que antes se descartaba y volvía a darle `UPDATE "Empresa"` a la app cada vez que se corría
    // `crear-rol-motor2-app.sql`. Ese script lo da (es el que arma las bases locales de prueba, donde los tests escriben `Empresa` con `motor2_app`) pero lo QUITA a continuación si se
    // pasa `-v restringir=1` (el mismo interruptor que `crear-rol-motor2-plataforma.sql`): lo verifica el test de abajo.
    const conGrant = readdirSync(operaciones)
      .filter((n) => n.endsWith(".sql") && grantsDeEscrituraSobreEmpresa(readFileSync(join(operaciones, n), "utf8")).length > 0)
      .sort();
    // M.1-C3: la reversa GRANULAR del recorte (devolver SOLO la escritura de Empresa, sin borrar el rol de plataforma) es el tercero; un cuarto script con un GRANT de escritura sobre Empresa pone esto en rojo.
    expect(conGrant).toEqual(["crear-rol-motor2-app.sql", "devolver-escritura-de-empresa-a-motor2-app.sql", "quitar-rol-motor2-plataforma.sql"]);

    const crear = leer("scripts/operaciones/crear-rol-motor2-plataforma.sql");
    // M.1-C2: el recorte DENIEGA POR DEFECTO (REVOKE ALL + GRANT SELECT + aserción), no enumera lo que quita: un privilegio nuevo o heredado no se cuela.
    expect(crear).toMatch(/REVOKE ALL ON "Empresa" FROM motor2_app/);
    expect(crear).toMatch(/GRANT SELECT ON "Empresa" TO motor2_app/);
    expect(crear).toMatch(/has_table_privilege\('motor2_app',\s*'public\."Empresa"',\s*'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'\)/);
    expect(crear).not.toMatch(/REVOKE INSERT, UPDATE, DELETE ON "Empresa"/);
    expect(crear).toMatch(/CREATE ROLE motor2_plataforma LOGIN NOSUPERUSER NOBYPASSRLS/);
  });

  it("M.1-C3: devolver-escritura-de-empresa-a-motor2-app.sql es la reversa GRANULAR del recorte: ON_ERROR_STOP primero, un solo GRANT de escritura sobre Empresa y nada que toque al rol de plataforma", () => {
    const sql = leer("scripts/operaciones/devolver-escritura-de-empresa-a-motor2-app.sql");
    const comandos = sql.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.trim().startsWith("--"));
    expect(comandos[0]?.trim(), "ON_ERROR_STOP tiene que ser lo primero").toBe("\\set ON_ERROR_STOP on");
    const s = sentencias(sql);
    expect(s[0]).toBe('GRANT INSERT, UPDATE, DELETE ON "Empresa" TO motor2_app');
    expect(s.slice(1).every((x) => /^SELECT\b/i.test(x)), "después del GRANT solo hay SELECT de verificación").toBe(true);
    expect(s.slice(1).length, "falta el SELECT de verificación").toBeGreaterThan(0);
    expect(s.join(";"), "la reversa granular no borra roles ni toca a motor2_plataforma").not.toMatch(/\b(DROP|REVOKE|TRUNCATE|CREATE|ALTER)\b|motor2_plataforma/i);
  });

  it("S-35 (B-C20): crear-rol-motor2-app.sql, después de cada GRANT masivo, quita la escritura de Empresa si se pasa restringir=1 (volver a correrlo no desarma la separación)", () => {
    const secciones = leer("scripts/operaciones/crear-rol-motor2-app.sql").split(/^\\connect\b.*$/m).slice(1);
    expect(secciones.length, "una sección por base (motor2_dev y motor2_e2e)").toBeGreaterThanOrEqual(2);
    for (const [i, seccion] of secciones.entries()) {
      const grant = seccion.search(/GRANT[^;]*\bON\s+ALL\s+TABLES\b[^;]*\bTO\s+motor2_app\b/i);
      const revoke = seccion.search(/REVOKE\s+ALL\s+ON\s+"Empresa"\s+FROM\s+motor2_app\s*;/i);
      expect(grant, `sección ${i + 1}: falta el GRANT masivo`).toBeGreaterThanOrEqual(0);
      expect(revoke, `sección ${i + 1}: falta el REVOKE ALL de Empresa (M.1-C2: deniega por defecto)`).toBeGreaterThan(grant);
      // M.1-C2: después del REVOKE ALL, SOLO lectura, y la aserción de que no quedó escritura (por PUBLIC, por membresía ni por columna)
      const cola = seccion.slice(revoke);
      const lectura = cola.search(/GRANT\s+SELECT\s+ON\s+"Empresa"\s+TO\s+motor2_app\s*;/i);
      const asercion = cola.search(/has_table_privilege\('motor2_app',\s*'public\."Empresa"',\s*'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'\)/);
      expect(lectura, `sección ${i + 1}: falta el GRANT SELECT sobre Empresa después del REVOKE ALL`).toBeGreaterThan(0);
      expect(asercion, `sección ${i + 1}: falta la aserción has_table_privilege después del GRANT SELECT`).toBeGreaterThan(lectura);
      expect(cola.slice(asercion), `sección ${i + 1}: la aserción también mira los privilegios por columna`).toMatch(/has_any_column_privilege\('motor2_app',\s*'public\."Empresa"',\s*'INSERT, UPDATE, REFERENCES'\)/);
      // y solo con restringir=1: sin el interruptor, las bases locales de prueba siguen dejando que los tests escriban `Empresa` como motor2_app
      const antes = seccion.slice(0, revoke).split("\n").filter((l) => /^\s*\\(if|endif)\b/.test(l)).pop() ?? "";
      expect(antes.trim(), `sección ${i + 1}: el REVOKE va dentro de \\if :{?restringir}`).toBe("\\if :{?restringir}");
      expect(seccion.slice(revoke).split("\n").find((l) => /^\s*\\(if|endif)\b/.test(l))?.trim()).toBe("\\endif");
    }
  });

  it("crear-rol-motor2-plataforma.sql da privilegios tabla por tabla: nunca DELETE ni TRUNCATE ni ON ALL TABLES a motor2_plataforma (ADR-012 §3)", () => {
    const grants = sentencias(leer("scripts/operaciones/crear-rol-motor2-plataforma.sql")).filter((s) => /^GRANT\b/i.test(s) && /\bTO\s+motor2_plataforma\b/i.test(s));
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) {
      expect(g.split(/\bON\b/i)[0], "privilegio peligroso").not.toMatch(/\b(DELETE|TRUNCATE|ALL)\b/i);
      expect(g, "GRANT masivo").not.toMatch(/\bON\s+ALL\s+TABLES\b/i);
    }
    // El script parte de cero: revoca lo que una versión anterior (DML sobre todo public + default privileges) haya dado.
    expect(leer("scripts/operaciones/crear-rol-motor2-plataforma.sql")).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA public FROM motor2_plataforma/);
  });

  it("src/ no conoce el cliente ni la variable de plataforma", () => {
    const problemas = archivos(join(RAIZ, "src")).filter((r) => /cliente-plataforma|PLATAFORMA_DATABASE_URL|PLATAFORMA_INSTALACION|prismaPlataforma/.test(readFileSync(r, "utf8")));
    expect(problemas).toEqual([]);
  });

  it("el cargador de Vercel no lista PLATAFORMA_DATABASE_URL y la rechaza si trae valor", () => {
    const fuente = leer("scripts/operaciones/cargar-env-vercel.sh");
    for (const lista of ["SENSIBLES", "PUBLICAS"]) {
      const linea = fuente.split("\n").find((l) => l.startsWith(`${lista}="`));
      expect(linea, `no encuentro la lista ${lista}`).toBeDefined();
      expect(linea).not.toContain("PLATAFORMA_DATABASE_URL");
      expect(linea, "ninguna variable de la consola va a la app").not.toMatch(/\sPLATAFORMA_/);
    }
    expect(fuente).toMatch(/PLATAFORMA_DATABASE_URL" \]\]; then\s+\[\[ -z "\$valor" \]\] \|\| fallar/);
  });

  describe("M.1-C4: verificar-grants-m1.sql es de SOLO LECTURA (guarda con SQL real y sintético)", () => {
    const VERIFICADOR = "scripts/operaciones/verificar-grants-m1.sql";

    /**
     * Qué tiene de no-lectura un SQL: sin comentarios y con los literales vaciados (en `has_table_privilege(…, 'UPDATE')` la palabra UPDATE es un TEXTO, no una sentencia), todas las sentencias
     * tienen que empezar con SELECT o SET, no puede haber comandos de psql (`\`) ni ninguna palabra de escritura, DDL o copia, y ni siquiera SELECT … INTO ni funciones con efectos.
     */
    function problemasDeSoloLectura(sql: string): string[] {
      const limpio = sql
        .replace(/\r\n/g, "\n")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/--[^\n]*/g, "")
        .replace(/'(?:[^']|'')*'/g, "''");
      const problemas: string[] = [];
      if (/^\s*\\/m.test(limpio)) problemas.push("comando de psql");
      const sentencias = limpio.split(";").map((s) => s.trim()).filter(Boolean);
      if (sentencias.length === 0) problemas.push("no hay ninguna sentencia");
      for (const s of sentencias) {
        if (!/^(SELECT|SET)\b/i.test(s)) problemas.push(`no empieza con SELECT ni SET: ${s.slice(0, 50).replace(/\s+/g, " ")}`);
        const palabra = /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|CREATE|DROP|DO|COPY|INTO|VACUUM|ANALYZE|REINDEX|LOCK|COMMENT|NOTIFY|LISTEN|CALL|EXECUTE|PREPARE)\b/i.exec(s);
        if (palabra) problemas.push(`palabra de escritura «${palabra[1]}»: ${s.slice(0, 50).replace(/\s+/g, " ")}`);
        const funcion = /\b(nextval|setval|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_advisory_lock|pg_advisory_xact_lock|lo_import|lo_export|pg_read_file|pg_ls_dir|dblink\w*)\s*\(/i.exec(s);
        if (funcion) problemas.push(`función con efectos «${funcion[1]}»`);
        if (/^SET\s+(SESSION\s+AUTHORIZATION|ROLE|LOCAL\s+ROLE|SESSION\s+ROLE)\b/i.test(s)) problemas.push(`cambia de rol: ${s}`);
      }
      return problemas;
    }

    it("el verificador real: solo SELECT y SET, sin comentarios ni literales que cuenten (y lo mismo con saltos de línea CRLF)", () => {
      const sql = leer(VERIFICADOR);
      expect(problemasDeSoloLectura(sql)).toEqual([]);
      expect(problemasDeSoloLectura(sql.replace(/\r?\n/g, "\r\n")), "con CRLF da otro resultado").toEqual([]);
      // sanidad: no pasa en vacío; mira las consultas que se portaron del diagnóstico M-33 y las de M.1
      for (const parte of ["has_table_privilege", "relacl", "attacl", "pg_default_acl", "pg_auth_members", "md5("]) expect(sql, `falta ${parte}`).toContain(parte);
      expect(sql.split(";").length, "pocas consultas").toBeGreaterThan(10);
    });

    it("el detector marca lo que no es lectura y deja pasar lo que lo parece pero no lo es (SQL sintético)", () => {
      expect(problemasDeSoloLectura("SELECT has_table_privilege('x', 'public.\"Empresa\"', 'UPDATE, DELETE'); -- GRANT ALL\nSET TRANSACTION READ ONLY;")).toEqual([]);
      for (const malo of [
        'GRANT SELECT ON "Empresa" TO motor2_app;',
        "SELECT 1; INSERT INTO t VALUES (1);",
        "SELECT 1; DO $$ BEGIN END $$;",
        "SELECT * INTO nueva FROM t;",
        "SELECT nextval('s');",
        "SELECT 1; SET ROLE motor2;",
        "SELECT 1; REVOKE ALL ON t FROM r;",
        "SELECT 1; \\copy t to x",
        "WITH x AS (SELECT 1) SELECT * FROM x;",
      ]) {
        expect(problemasDeSoloLectura(malo), malo).not.toEqual([]);
      }
    });
  });

  describe("el detector (con SQL sintético)", () => {
    it("marca un GRANT de escritura sobre Empresa, nombrado o masivo, a motor2_app", () => {
      const sql = ['GRANT SELECT, INSERT, UPDATE, DELETE ON "Empresa", "UsuarioEmpresa" TO motor2_app;', "GRANT ALL ON ALL TABLES IN SCHEMA public TO motor2_app;"].join("\n");
      expect(grantsDeEscrituraSobreEmpresa(sql)).toHaveLength(2);
    });

    it("no marca lecturas, otras tablas, otro rol ni un comentario", () => {
      const sql = [
        'GRANT SELECT ON "Empresa" TO motor2_app;',
        'GRANT INSERT, UPDATE ON "PortalCartaEmpresa" TO motor2_app;',
        'GRANT INSERT, UPDATE ON "Empresa" TO motor2_plataforma;',
        '-- GRANT UPDATE ON "Empresa" TO motor2_app;',
        'REVOKE INSERT, UPDATE, DELETE ON "Empresa" FROM motor2_app;',
      ].join("\n");
      expect(grantsDeEscrituraSobreEmpresa(sql)).toEqual([]);
    });
  });
});
