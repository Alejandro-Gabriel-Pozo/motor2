import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (informe de seguridad 2026-10-01, S-13): escribir `Empresa` (alta, activación, política de plataforma) es cosa del rol
 * `motor2_plataforma`, no de `motor2_app`, el rol con el que corre la aplicación. El paso de base que los separa es manual (psql, con autorización
 * expresa), así que lo que este guardián cuida es que el repo no lo desarme por descuido:
 *  1. Los scripts de plataforma usan el cliente `prismaPlataforma` (el que lee PLATAFORMA_DATABASE_URL), nunca uno propio.
 *  2. Ninguna migración posterior al esquema inicial le da a `motor2_app` escritura sobre `Empresa` (ni con un GRANT ... ON ALL TABLES).
 *  3. El único script de operaciones que se la devuelve es `quitar-rol-motor2-plataforma.sql`; el de creación la quita con `restringir=1`.
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
    for (const script of ["politica-empresa.ts", "modulos-empresa.ts"]) {
      const fuente = leer("scripts", script);
      expect(fuente, `${script} no importa el cliente de cliente-plataforma.ts`).toMatch(/import \{\s*clienteDePlataforma\s*\} from "\.\/cliente-plataforma"/);
      expect(fuente, `${script} crea su propio PrismaClient`).not.toMatch(/new PrismaClient\(/);
      expect(fuente, `${script} lee process.env de plataforma directo en vez de pasar por el resolutor`).not.toMatch(/process\.env\.(PLATAFORMA_DATABASE_URL|DATABASE_URL)\b/);
    }
  });

  it("el único script de plataforma que crea un cliente de Prisma o un adaptador es cliente-plataforma.ts", () => {
    // Mutación: un `new PrismaClient(` o `new PrismaPg(`/`new PrismaNeon(` en modulos-empresa.ts, politica-empresa.ts o scripts/plataforma/** pone este test en rojo.
    // (Otros scripts del repo, como benchmark-reportes.ts, crean su propio cliente contra la app: no son de plataforma y quedan afuera.)
    const archivosDePlataforma = [
      join(RAIZ, "scripts/cliente-plataforma.ts"),
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
    const conGrant = readdirSync(operaciones)
      .filter((n) => n.endsWith(".sql") && grantsDeEscrituraSobreEmpresa(readFileSync(join(operaciones, n), "utf8")).some((g) => /"Empresa"(?!\w)/.test(g)))
      .sort();
    expect(conGrant).toEqual(["quitar-rol-motor2-plataforma.sql"]);

    const crear = leer("scripts/operaciones/crear-rol-motor2-plataforma.sql");
    expect(crear).toMatch(/REVOKE INSERT, UPDATE, DELETE ON "Empresa" FROM motor2_app/);
    expect(crear).toMatch(/CREATE ROLE motor2_plataforma LOGIN NOSUPERUSER NOBYPASSRLS/);
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
