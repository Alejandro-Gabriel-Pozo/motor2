import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M.3-A8: el rol de PRUEBAS `motor2_app_pruebas` (el que siembra los fixtures; mismos privilegios que `motor2_app`, NO miembro de él, así las políticas por sucursal de la Fase B —`TO motor2_app`—
 * no lo alcanzan) existe SOLO en bases locales y de CI. En una base real (Neon) sería una puerta lateral: un login con los privilegios de la app que las políticas no restringen. Lo que cuida este guardián:
 *  1. NINGÚN archivo fuera de una lista CERRADA nombra el rol, sus variables (`MOTOR2_PRUEBAS_DATABASE_URL`, `MOTOR2_E2E_PRUEBAS_DATABASE_URL`) ni las variables de su script (`clave_pruebas`,
 *     `solo_pruebas`): ni `src/`, ni `prisma/` (las migraciones corren en Neon), ni `plataforma/`, ni `vercel.json`, ni los demás scripts de `scripts/operaciones/` (los que sí corren contra Neon), ni los
 *     documentos de despliegue. Un archivo nuevo que lo nombre pone esto en rojo: sumarlo a la lista es una decisión consciente, con su motivo.
 *  2. `crear-rol-motor2-app.sql` (el ÚNICO script que lo crea) conserva su guarda contra Neon (`\set ON_ERROR_STOP on` primero y un `DO` que aborta sin las bases locales o con `neon_superuser`) y TODO lo
 *     del rol de pruebas viene DESPUÉS de esa guarda.
 *  3. Los workflows lo arman en el orden que hace que funcione: el rol se crea ANTES de `prisma migrate deploy` (privilegios por defecto), se pone al día DESPUÉS de migrar y DESPUÉS del rol de plataforma
 *     (las migraciones recortan privilegios solo de `motor2_app`), y las URLs del rol de pruebas apuntan a la MISMA base que las de la app, con claves de relleno «ci-…-descartable» y sin `secrets.*`.
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

/** Lo que delata al rol de pruebas (o a sus variables) en un archivo. */
const MENCION = /motor2_app_pruebas|MOTOR2_PRUEBAS_DATABASE_URL|MOTOR2_E2E_PRUEBAS_DATABASE_URL|\bclave_pruebas\b|\bsolo_pruebas\b/;

/**
 * Los archivos que PUEDEN nombrarlo (rutas relativas a la raíz; un prefijo termina en «/»). Es una lista cerrada: todo lo demás no.
 *  - el script que lo crea, la config de Playwright y `.env.example` (que documenta la variable), y los dos workflows que arman las bases del runner;
 *  - `test/` (fixtures y pruebas del rol) y los ADR / el registro de pureza (la historia de la decisión). NO los documentos de despliegue ni de operaciones de producción.
 */
const PERMITIDOS = [
  "scripts/operaciones/crear-rol-motor2-app.sql",
  "playwright.config.ts",
  ".env.example",
  ".github/workflows/ci.yml",
  ".github/workflows/seguridad.yml",
  "test/",
  "docs/adr/",
  "docs/pureza-integracion.md",
];
const esPermitido = (ruta: string) => PERMITIDOS.some((p) => (p.endsWith("/") ? ruta.startsWith(p) : ruta === p));

const IGNORADAS = new Set(["node_modules", ".git", ".next", "test-results", "playwright-report", "coverage", "dist", ".vercel", ".turbo"]);
const EXTENSIONES_DE_TEXTO = /\.(ts|tsx|js|mjs|cjs|json|jsonc|sql|sh|md|mdx|ya?ml|toml|env|example|css|html|txt|prisma|conf)$|(^|\/)\.[A-Za-z.]+$|(^|\/)Dockerfile$/;

/** Los archivos de entorno LOCALES (gitignored: `.env`, `.env.local`, `.env.production.local`…) no son del repositorio; `.env.example` sí, y está en la lista cerrada. */
const ENTORNO_LOCAL = /^\.env(\.[a-z]+)*$/;

function listar(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (IGNORADAS.has(e.name) || (ENTORNO_LOCAL.test(e.name) && e.name !== ".env.example")) return [];
    const ruta = join(dir, e.name);
    return e.isDirectory() ? listar(ruta) : [ruta];
  });
}

/** Las rutas (relativas) de los archivos de texto del repo que nombran el rol de pruebas o sus variables, y que NO están en la lista cerrada. */
export function menciones(contenidos: Record<string, string>): string[] {
  return Object.entries(contenidos)
    .filter(([ruta, texto]) => MENCION.test(texto) && !esPermitido(ruta))
    .map(([ruta]) => ruta)
    .sort();
}

function contenidosDelRepo(): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const abs of listar(RAIZ)) {
    const ruta = relative(RAIZ, abs).split("\\").join("/");
    if (!EXTENSIONES_DE_TEXTO.test(ruta)) continue;
    salida[ruta] = readFileSync(abs, "utf8");
  }
  return salida;
}

/** Lo que ejecuta `psql` del script: sin comentarios y con LF. */
const comandos = (sql: string) =>
  sql
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("--"))
    .join("\n");

/** Problemas de la guarda de `crear-rol-motor2-app.sql`: ON_ERROR_STOP primero, un DO de guarda con las bases locales y `neon_superuser`, y el rol de pruebas solo DESPUÉS de ella. */
export function problemasDeLaGuarda(sql: string): string[] {
  const problemas: string[] = [];
  const c = comandos(sql);
  if (c.split("\n")[0] !== "\\set ON_ERROR_STOP on") problemas.push("el primer comando no es \\set ON_ERROR_STOP on");
  const guarda = /^DO \$\$[\s\S]*?^\$\$;/m.exec(c);
  // Las CONDICIONES (no el texto del mensaje, que también nombra las bases y a Neon): las dos bases locales por nombre y la presencia del rol `neon_superuser`, que solo existe en Neon.
  if (
    !guarda ||
    !/NOT EXISTS \(SELECT 1 FROM pg_database WHERE datname = 'motor2_dev'\)/.test(guarda[0]) ||
    !/NOT EXISTS \(SELECT 1 FROM pg_database WHERE datname = 'motor2_e2e'\)/.test(guarda[0]) ||
    !/(^|\s)OR EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser'\)/.test(guarda[0]) ||
    !/RAISE EXCEPTION/.test(guarda[0]) ||
    !/NUNCA en Neon/.test(guarda[0])
  ) {
    problemas.push("falta el DO de guarda que aborta sin las bases locales o con neon_superuser");
    return problemas;
  }
  const finDeLaGuarda = guarda.index + guarda[0].length;
  const primera = c.search(MENCION);
  if (primera < 0) problemas.push("el script ya no crea el rol de pruebas (sanidad)");
  else if (primera < finDeLaGuarda) problemas.push("el rol de pruebas (o sus variables) se nombra ANTES de la guarda contra Neon");
  return problemas;
}

/** Texto de un job de un workflow: desde `  <job>:` hasta el siguiente job (misma sangría) o el final. */
function trozoDeJob(workflow: string, job: string): string {
  const inicio = new RegExp(`^  ${job}:\\s*$`, "m").exec(workflow);
  if (!inicio) return "";
  const resto = workflow.slice(inicio.index + inicio[0].length);
  const siguiente = /^  [a-z0-9-]+:\s*$/m.exec(resto);
  return siguiente ? resto.slice(0, siguiente.index) : resto;
}

/**
 * Problemas del armado del rol de pruebas en un job: el script se corre con `clave_pruebas` ANTES de `prisma migrate deploy`; se vuelve a correr con `solo_pruebas=1` DESPUÉS de migrar y de crear
 * el rol de plataforma (si el job lo crea) y ANTES de lo que usa el rol; la URL del rol de pruebas apunta a la misma base que la de la app y usa una clave de relleno.
 */
export function problemasDelJob(trozo: string, opciones: { variableDePruebas: string; variableDeLaApp: string; usaRolDePlataforma: boolean; despuesDelSync: RegExp }): string[] {
  const p: string[] = [];
  if (!trozo) return ["no se encontró el job"];
  const crear = [...trozo.matchAll(/crear-rol-motor2-app\.sql/g)].map((m) => m.index as number);
  const lineaDe = (i: number) => trozo.slice(trozo.lastIndexOf("\n", i) + 1, trozo.indexOf("\n", i));
  const lineas = crear.map((i) => lineaDe(i));
  const iCrear = crear.findIndex((_, k) => !/solo_pruebas/.test(lineas[k] as string));
  const iSync = crear.findIndex((_, k) => /solo_pruebas=1/.test(lineas[k] as string));
  if (iCrear < 0 || iSync < 0 || crear.length !== 2) return ["tienen que ser exactamente DOS corridas de crear-rol-motor2-app.sql: la que crea los roles y la de `solo_pruebas=1`"];
  if (!/-v clave_pruebas="\$CLAVE_PRUEBAS"/.test(lineas[iCrear] as string)) p.push("la corrida que crea los roles no pasa -v clave_pruebas=\"$CLAVE_PRUEBAS\"");
  if (!/-v clave="\$CLAVE_APP"/.test(lineas[iCrear] as string)) p.push("la corrida que crea los roles no pasa -v clave=\"$CLAVE_APP\"");
  if (!/-v clave_pruebas="\$CLAVE_PRUEBAS"/.test(lineas[iSync] as string)) p.push("la corrida de solo_pruebas no pasa -v clave_pruebas=\"$CLAVE_PRUEBAS\"");
  if (/-v clave="/.test(lineas[iSync] as string)) p.push("la corrida de solo_pruebas pasa la clave de motor2_app (no la necesita ni la toca)");
  const migrar = trozo.search(/prisma migrate deploy/);
  if (migrar < 0) p.push("no hay `prisma migrate deploy`");
  if (!(crear[iCrear]! < migrar)) p.push("el rol de pruebas se crea DESPUÉS de migrar (tiene que ser antes: los privilegios por defecto)");
  if (!(crear[iSync]! > migrar)) p.push("la corrida de solo_pruebas va ANTES de migrar (tiene que ir después: las migraciones recortan a motor2_app)");
  if (opciones.usaRolDePlataforma) {
    const plataformas = [...trozo.matchAll(/crear-rol-motor2-plataforma\.sql/g)].map((m) => m.index as number);
    if (plataformas.length === 0 || !(crear[iSync]! > Math.max(...plataformas))) p.push("la corrida de solo_pruebas va ANTES de crear el rol de plataforma (tiene que ir después de todos)");
  }
  const despues = opciones.despuesDelSync.exec(trozo);
  if (!despues) p.push(`no se encontró lo que usa el rol de pruebas (${opciones.despuesDelSync})`);
  else if (!(crear[iSync]! < despues.index)) p.push("la corrida de solo_pruebas va DESPUÉS de lo que usa el rol de pruebas");
  const urlPruebas = new RegExp(`^\\s+${opciones.variableDePruebas}: (postgresql://\\S+)\\s*$`, "m").exec(trozo)?.[1];
  const urlApp = new RegExp(`^\\s+${opciones.variableDeLaApp}: (postgresql://\\S+)\\s*$`, "m").exec(trozo)?.[1];
  if (!urlPruebas) p.push(`falta ${opciones.variableDePruebas} en el job`);
  if (!urlApp) p.push(`falta ${opciones.variableDeLaApp} en el job`);
  if (urlPruebas && urlApp) {
    const a = new URL(urlPruebas);
    const b = new URL(urlApp);
    if (a.username !== "motor2_app_pruebas") p.push(`${opciones.variableDePruebas} no usa el rol motor2_app_pruebas`);
    if (a.host !== b.host || a.pathname !== b.pathname) p.push(`${opciones.variableDePruebas} no apunta a la misma base que ${opciones.variableDeLaApp}`);
    if (!/^ci-[a-z0-9]+(-[a-z0-9]+)*-descartable$/.test(a.password)) p.push(`la clave de ${opciones.variableDePruebas} no es de relleno («ci-…-descartable»)`);
  }
  return p;
}

describe("M.3-A8: el rol de pruebas no existe fuera de bases locales y de CI", () => {
  it("ningún archivo FUERA de la lista cerrada nombra el rol de pruebas ni sus variables (src, prisma, plataforma, vercel.json, scripts para Neon, documentos de despliegue…)", () => {
    // Mutación: nombrar el rol en cualquier script de scripts/operaciones/ (p. ej. crear-rol-motor2-plataforma.sql) o en una migración pone esto en rojo.
    expect(menciones(contenidosDelRepo())).toEqual([]);
  });

  it("el detector de menciones: encuentra el rol en un script de Neon, en src y en una migración; deja pasar el script local, los tests y los ADR (SQL y rutas sintéticos)", () => {
    const base = { "scripts/operaciones/crear-rol-motor2-app.sql": "CREATE ROLE motor2_app_pruebas", "test/setup/rol-de-pruebas.ts": "MOTOR2_PRUEBAS_DATABASE_URL", "docs/adr/ADR-099-x.md": "solo_pruebas" };
    expect(menciones(base)).toEqual([]);
    for (const ruta of [
      "scripts/operaciones/crear-rol-motor2-plataforma.sql",
      "scripts/operaciones/devolver-escritura-de-empresa-a-motor2-app.sql",
      "scripts/operaciones/cargar-env-vercel.sh",
      "src/env.ts",
      "src/lib/db.ts",
      "prisma/migrations/20261101000000_x/migration.sql",
      "plataforma/src/entorno.ts",
      "vercel.json",
      "docs/guion-produccion-2026-10-05.md",
      "docs/deploy-con-migraciones.md",
    ]) {
      expect(menciones({ ...base, [ruta]: "GRANT SELECT ON x TO motor2_app_pruebas" }), ruta).toEqual([ruta]);
    }
    for (const texto of ["MOTOR2_E2E_PRUEBAS_DATABASE_URL", "-v clave_pruebas=x", "-v solo_pruebas=1"]) expect(menciones({ "scripts/operaciones/rotar-clave-neon.sh": texto }), texto).toEqual(["scripts/operaciones/rotar-clave-neon.sh"]);
  });

  it("los scripts de operaciones que SÍ corren contra Neon y el cargador de variables de Vercel no lo nombran (comprobación nominal, además de la lista cerrada)", () => {
    const operaciones = join(RAIZ, "scripts/operaciones");
    const contrarios = readdirSync(operaciones).filter((n) => n !== "crear-rol-motor2-app.sql");
    expect(contrarios.length).toBeGreaterThan(5);
    for (const n of contrarios) expect(MENCION.test(readFileSync(join(operaciones, n), "utf8")), `scripts/operaciones/${n} nombra el rol de pruebas`).toBe(false);
    expect(MENCION.test(leer("vercel.json"))).toBe(false);
    expect(MENCION.test(leer("package.json"))).toBe(false);
    expect(MENCION.test(leer("src/env.ts"))).toBe(false);
  });
});

describe("M.3-A8: crear-rol-motor2-app.sql (el único que lo crea) conserva su guarda contra Neon", () => {
  const SQL = () => leer("scripts/operaciones/crear-rol-motor2-app.sql");

  it("el script real: ON_ERROR_STOP primero, DO de guarda (bases locales + neon_superuser) y el rol de pruebas solo después de la guarda", () => {
    expect(problemasDeLaGuarda(SQL())).toEqual([]);
    expect(problemasDeLaGuarda(SQL().replace(/\r?\n/g, "\r\n")), "con CRLF").toEqual([]);
  });

  it("el chequeo detecta: sin guarda, sin la condición de neon_superuser, el rol antes de la guarda y ON_ERROR_STOP tarde (SQL sintético)", () => {
    const guarda = "DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'motor2_dev') OR NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'motor2_e2e') OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser') THEN\n    RAISE EXCEPTION 'M.1 ... NUNCA en Neon';\n  END IF;\nEND\n$$;";
    const bien = `\\set ON_ERROR_STOP on\n${guarda}\nCREATE ROLE motor2_app_pruebas LOGIN;\n`;
    expect(problemasDeLaGuarda(bien)).toEqual([]);
    expect(problemasDeLaGuarda(`\\set ON_ERROR_STOP on\nCREATE ROLE motor2_app_pruebas LOGIN;\n`)).toContain("falta el DO de guarda que aborta sin las bases locales o con neon_superuser");
    expect(problemasDeLaGuarda(bien.replace("OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser')", ""))).toContain("falta el DO de guarda que aborta sin las bases locales o con neon_superuser");
    expect(problemasDeLaGuarda(`\\set ON_ERROR_STOP on\nSELECT 1 FROM x WHERE c = :{?clave_pruebas};\n${guarda}\n`)).toContain("el rol de pruebas (o sus variables) se nombra ANTES de la guarda contra Neon");
    expect(problemasDeLaGuarda(`${guarda}\n\\set ON_ERROR_STOP on\nCREATE ROLE motor2_app_pruebas LOGIN;\n`)).toContain("el primer comando no es \\set ON_ERROR_STOP on");
    expect(problemasDeLaGuarda(`\\set ON_ERROR_STOP on\n${guarda}\nSELECT 1;\n`)).toContain("el script ya no crea el rol de pruebas (sanidad)");
  });
});

describe("M.3-A8: los workflows arman el rol de pruebas en el orden que funciona", () => {
  const CASOS = [
    { archivo: ".github/workflows/ci.yml", job: "integracion", variableDePruebas: "MOTOR2_PRUEBAS_DATABASE_URL", variableDeLaApp: "DATABASE_URL", usaRolDePlataforma: true, despuesDelSync: /npm run build\b/ },
    { archivo: ".github/workflows/ci.yml", job: "e2e", variableDePruebas: "MOTOR2_E2E_PRUEBAS_DATABASE_URL", variableDeLaApp: "MOTOR2_E2E_APP_DATABASE_URL", usaRolDePlataforma: true, despuesDelSync: /npm run test:e2e/ },
    { archivo: ".github/workflows/seguridad.yml", job: "pruebas-de-seguridad", variableDePruebas: "MOTOR2_PRUEBAS_DATABASE_URL", variableDeLaApp: "DATABASE_URL", usaRolDePlataforma: true, despuesDelSync: /npx vitest run test\/seguridad/ },
    { archivo: ".github/workflows/seguridad.yml", job: "zap", variableDePruebas: "MOTOR2_E2E_PRUEBAS_DATABASE_URL", variableDeLaApp: "MOTOR2_E2E_APP_DATABASE_URL", usaRolDePlataforma: false, despuesDelSync: /seguridad-sembrar-para-zap/ },
  ];

  for (const { archivo, job, ...opciones } of CASOS) {
    it(`${archivo} · ${job}: rol antes de migrar, solo_pruebas después de migrar y antes de usarlo, URL del rol de pruebas en la misma base`, () => {
      expect(problemasDelJob(trozoDeJob(leer(archivo), job), opciones)).toEqual([]);
    });
  }

  it("los dos workflows declaran CLAVE_PRUEBAS de relleno («ci-…-descartable»), sin `secrets.*` ni actions nuevas por esto", () => {
    for (const archivo of [".github/workflows/ci.yml", ".github/workflows/seguridad.yml"]) {
      const texto = leer(archivo);
      expect(/^  CLAVE_PRUEBAS: ci-[a-z0-9]+(-[a-z0-9]+)*-descartable\s*$/m.test(texto), `${archivo}: CLAVE_PRUEBAS`).toBe(true);
      expect(/\$\{\{\s*secrets\./.test(texto), `${archivo}: usa secrets.*`).toBe(false);
    }
  });

  it("el chequeo del job detecta (YAML sintético): rol de pruebas sin clave, creado después de migrar, solo_pruebas antes de migrar o antes del rol de plataforma, y URL en otra base o con otro usuario", () => {
    const job = (pasos: string[], env = ["      DATABASE_URL: postgresql://motor2_app:ci-app-descartable@localhost:5432/d_dev", "      MOTOR2_PRUEBAS_DATABASE_URL: postgresql://motor2_app_pruebas:ci-pruebas-descartable@localhost:5432/d_dev"]) =>
      ["  j:", "    env:", ...env, "    steps:", ...pasos.map((p) => `      - run: ${p}`)].join("\n") + "\n";
    const CREAR = 'psql -v ON_ERROR_STOP=1 -v clave="$CLAVE_APP" -v clave_pruebas="$CLAVE_PRUEBAS" -f scripts/operaciones/crear-rol-motor2-app.sql';
    const SYNC = 'psql -v ON_ERROR_STOP=1 -v solo_pruebas=1 -v clave_pruebas="$CLAVE_PRUEBAS" -f scripts/operaciones/crear-rol-motor2-app.sql';
    const PLAT = 'psql -v clave="$CLAVE_PLATAFORMA" -f scripts/operaciones/crear-rol-motor2-plataforma.sql';
    const MIG = "npx prisma migrate deploy";
    const USA = "npx vitest run test/seguridad";
    const o = { variableDePruebas: "MOTOR2_PRUEBAS_DATABASE_URL", variableDeLaApp: "DATABASE_URL", usaRolDePlataforma: true, despuesDelSync: /npx vitest run test\/seguridad/ };
    expect(problemasDelJob(job([CREAR, MIG, PLAT, SYNC, USA]), o)).toEqual([]);
    expect(problemasDelJob(job([CREAR.replace(' -v clave_pruebas="$CLAVE_PRUEBAS"', ""), MIG, PLAT, SYNC, USA]), o)).toContain('la corrida que crea los roles no pasa -v clave_pruebas="$CLAVE_PRUEBAS"');
    expect(problemasDelJob(job([MIG, CREAR, PLAT, SYNC, USA]), o)).toContain("el rol de pruebas se crea DESPUÉS de migrar (tiene que ser antes: los privilegios por defecto)");
    expect(problemasDelJob(job([CREAR, SYNC, MIG, PLAT, USA]), o)).toContain("la corrida de solo_pruebas va ANTES de migrar (tiene que ir después: las migraciones recortan a motor2_app)");
    expect(problemasDelJob(job([CREAR, MIG, SYNC, PLAT, USA]), o)).toContain("la corrida de solo_pruebas va ANTES de crear el rol de plataforma (tiene que ir después de todos)");
    expect(problemasDelJob(job([CREAR, MIG, PLAT, USA, SYNC]), o)).toContain("la corrida de solo_pruebas va DESPUÉS de lo que usa el rol de pruebas");
    expect(problemasDelJob(job([CREAR, MIG, PLAT, USA]), o)).toContain("tienen que ser exactamente DOS corridas de crear-rol-motor2-app.sql: la que crea los roles y la de `solo_pruebas=1`");
    const envMal = (url: string) => ["      DATABASE_URL: postgresql://motor2_app:ci-app-descartable@localhost:5432/d_dev", `      MOTOR2_PRUEBAS_DATABASE_URL: ${url}`];
    expect(problemasDelJob(job([CREAR, MIG, PLAT, SYNC, USA], envMal("postgresql://motor2_app_pruebas:ci-pruebas-descartable@localhost:5432/otra")), o)).toContain("MOTOR2_PRUEBAS_DATABASE_URL no apunta a la misma base que DATABASE_URL");
    expect(problemasDelJob(job([CREAR, MIG, PLAT, SYNC, USA], envMal("postgresql://motor2_app:ci-pruebas-descartable@localhost:5432/d_dev")), o)).toContain("MOTOR2_PRUEBAS_DATABASE_URL no usa el rol motor2_app_pruebas");
    expect(problemasDelJob(job([CREAR, MIG, PLAT, SYNC, USA], envMal("postgresql://motor2_app_pruebas:clave-real-1234@localhost:5432/d_dev")), o)).toContain("la clave de MOTOR2_PRUEBAS_DATABASE_URL no es de relleno («ci-…-descartable»)");
  });
});
