import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * GT-20 (S-35): GRANTS = USO. El rol `motor2_plataforma` (consola y scripts de plataforma) tiene privilegio mínimo, tabla por tabla (ADR-012 §3): cada (tabla, privilegio) que
 * `crear-rol-motor2-plataforma.sql` le da lo usa alguna línea de código de plataforma, y todo lo que ese código hace está dado. Un grant sin uso es superficie que un bug o una inyección
 * en la consola podría aprovechar (antes tenía `INSERT`/`UPDATE` sobre `User` y `INSERT` sobre `UsuarioEmpresa` y `UsuarioSucursal` sin escribirlos nunca: el comentario de «el primer
 * gerente se crea con upsert» era de antes de las invitaciones). Se compara en las DOS direcciones:
 *  - grants → uso: no sobra ningún privilegio de escritura (INSERT, UPDATE, DELETE) ni ninguna tabla sin lectura;
 *  - uso → grants: lo que el código escribe o lee está dado (si no, falla en producción y nadie lo vio en los tests, que corren como dueño).
 * El uso se saca del AST de `plataforma/src`, `src/server/operaciones-de-plataforma` y `scripts/plataforma`: `x.modelo.operacion(…)` de Prisma, SQL crudo (`$queryRaw`/`$executeRaw`, con `FOR UPDATE`
 * como UPDATE) y `registrarCambioAuditado` (INSERT en `RegistroAuditoria`). Un `SELECT` implícito (el `RETURNING` de un `create`, el `where` de un `update`) se da por usado con cualquier uso de la tabla.
 */
const RAIZ = join(__dirname, "../..");
const SCRIPT = "scripts/operaciones/crear-rol-motor2-plataforma.sql";
const CARPETAS_DE_USO = ["plataforma/src", "src/server/operaciones-de-plataforma", "scripts/plataforma"];

type Privilegio = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
type Mapa = Map<string, Set<Privilegio>>;

function sumar(mapa: Mapa, tabla: string, ...privilegios: Privilegio[]): void {
  const actual = mapa.get(tabla) ?? new Set<Privilegio>();
  for (const p of privilegios) actual.add(p);
  mapa.set(tabla, actual);
}

// ---- Los grants que da el script ----

/** (tabla → privilegios) de los `GRANT … TO motor2_plataforma` del SQL: nombrados, `public.<tabla>` y los de `FOREACH t IN ARRAY ARRAY['A','B']` con `public.%I`. */
export function grantsDelScript(sql: string): Mapa {
  const sinComentarios = sql.replace(/--[^\n]*/g, "");
  const grants: Mapa = new Map();
  const re = /GRANT\s+([A-Z, ]+?)\s+ON\s+([^;']*?)\s+TO\s+motor2_plataforma\b/gi;
  for (const m of sinComentarios.matchAll(re)) {
    const privilegios = m[1].split(",").map((p) => p.trim().toUpperCase()) as Privilegio[];
    const objetos = m[2].trim();
    if (/^(SCHEMA|SEQUENCE|DATABASE)\b/i.test(objetos)) continue; // USAGE sobre el esquema: no es una tabla
    if (/%I/.test(objetos)) {
      // `GRANT … ON public.%I …` dentro de un FOREACH: las tablas son el ARRAY['…'] que lo precede
      const previo = sinComentarios.slice(0, m.index);
      const arreglo = [...previo.matchAll(/ARRAY\s*\[([^\]]*)\]/gi)].pop();
      for (const t of arreglo?.[1].matchAll(/'([^']+)'/g) ?? []) sumar(grants, t[1], ...privilegios);
      continue;
    }
    for (const bruto of objetos.split(",")) {
      const tabla = bruto.trim().replace(/^public\./i, "").replace(/"/g, "");
      if (tabla) sumar(grants, tabla, ...privilegios);
    }
  }
  return grants;
}

// ---- El uso que hace el código ----

const LECTURAS = new Set(["findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);
const mayuscula = (s: string) => s[0].toUpperCase() + s.slice(1);

/** (tabla → privilegios) que usa un fuente TypeScript: operaciones de modelo de Prisma, SQL crudo y `registrarCambioAuditado`. */
export function usoDelCodigo(codigo: string): Mapa {
  const uso: Mapa = new Map();
  const sf = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const f = n.expression;
      if (ts.isPropertyAccessExpression(f) && ts.isPropertyAccessExpression(f.expression) && /^[a-z]/.test(f.expression.name.text)) {
        const modelo = mayuscula(f.expression.name.text);
        const op = f.name.text;
        if (LECTURAS.has(op)) sumar(uso, modelo, "SELECT");
        else if (op === "create" || op === "createMany" || op === "createManyAndReturn") sumar(uso, modelo, "INSERT");
        else if (op === "update" || op === "updateMany") sumar(uso, modelo, "UPDATE");
        else if (op === "upsert") sumar(uso, modelo, "INSERT", "UPDATE");
        else if (op === "delete" || op === "deleteMany") sumar(uso, modelo, "DELETE");
      }
      if (ts.isIdentifier(f) && f.text === "registrarCambioAuditado") sumar(uso, "RegistroAuditoria", "INSERT");
    }
    if (ts.isTaggedTemplateExpression(n) && /^\$(queryRaw|executeRaw)$/.test(n.tag.getText(sf).split(".").pop() ?? "")) {
      const sql = n.template.getText(sf);
      for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+"?(\w+)"?/gi)) sumar(uso, m[1], "SELECT");
      for (const m of sql.matchAll(/\bINSERT\s+INTO\s+"?(\w+)"?/gi)) sumar(uso, m[1], "INSERT");
      for (const m of sql.matchAll(/\bUPDATE\s+"?(\w+)"?\s+SET\b/gi)) sumar(uso, m[1], "UPDATE");
      // `SELECT … FROM "X" … FOR UPDATE` toma el bloqueo de fila: Postgres exige el privilegio UPDATE sobre la tabla.
      if (/\bFOR\s+UPDATE\b/i.test(sql)) for (const m of sql.matchAll(/\bFROM\s+"?(\w+)"?/gi)) sumar(uso, m[1], "UPDATE");
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return uso;
}

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

function usoDePlataforma(): { uso: Mapa; porTabla: Map<string, string[]> } {
  const uso: Mapa = new Map();
  const porTabla = new Map<string, string[]>();
  for (const carpeta of CARPETAS_DE_USO) {
    for (const a of archivos(join(RAIZ, carpeta))) {
      for (const [tabla, privilegios] of usoDelCodigo(readFileSync(a, "utf8"))) {
        sumar(uso, tabla, ...privilegios);
        porTabla.set(tabla, [...(porTabla.get(tabla) ?? []), relative(RAIZ, a).replace(/\\/g, "/")]);
      }
    }
  }
  return { uso, porTabla };
}

const texto = (m: Mapa) => [...m.entries()].map(([t, ps]) => `${t}: ${[...ps].sort().join(", ")}`).sort();

describe("GT-20: el detector (SQL y código sintéticos; sanidad: no pasa en vacío)", () => {
  it("lee los GRANT nombrados, con public. y los de un FOREACH con %I", () => {
    const sql = `
      GRANT SELECT, INSERT, UPDATE ON "Empresa", "ModuloEmpresa" TO motor2_plataforma;
      -- GRANT DELETE ON "Empresa" TO motor2_plataforma;
      GRANT SELECT ON public._prisma_migrations TO motor2_plataforma;
      DO $$ BEGIN FOREACH t IN ARRAY ARRAY['A1', 'B2'] LOOP EXECUTE format('GRANT SELECT, UPDATE ON public.%I TO motor2_plataforma', t); END LOOP; END $$;
      GRANT SELECT ON "Otra" TO motor2_app;`;
    expect(texto(grantsDelScript(sql))).toEqual(["A1: SELECT, UPDATE", "B2: SELECT, UPDATE", "Empresa: INSERT, SELECT, UPDATE", "ModuloEmpresa: INSERT, SELECT, UPDATE", "_prisma_migrations: SELECT"]);
  });

  it("lee el uso: operaciones de modelo, upsert, SQL crudo con FOR UPDATE y registrarCambioAuditado", () => {
    const uso = usoDelCodigo(`
      async function f(tx, db) {
        await tx.user.findUnique({});
        await tx.moduloEmpresa.upsert({});
        await db.sesionPlataforma.updateMany({});
        await tx.$queryRaw\`SELECT id FROM "Empresa" WHERE id = \${x} FOR UPDATE\`;
        await tx.$queryRaw\`SELECT migration_name FROM "_prisma_migrations"\`;
        await registrarCambioAuditado(tx, {});
        await tx.$executeRaw\`SELECT set_config('app.empresa_id', \${x}, true)\`;
      }`);
    expect(texto(uso)).toEqual(["Empresa: SELECT, UPDATE", "ModuloEmpresa: INSERT, UPDATE", "RegistroAuditoria: INSERT", "SesionPlataforma: UPDATE", "User: SELECT", "_prisma_migrations: SELECT"]);
  });

  it("el código real de plataforma tiene uso (no se compara contra el vacío)", () => {
    const { uso } = usoDePlataforma();
    expect(uso.size).toBeGreaterThan(15);
    expect(uso.get("Empresa")).toEqual(new Set(["SELECT", "INSERT", "UPDATE"]));
    expect(grantsDelScript(readFileSync(join(RAIZ, SCRIPT), "utf8")).size).toBeGreaterThan(15);
  });
});

describe("GT-20: los grants de motor2_plataforma son exactamente su uso", () => {
  const grants = grantsDelScript(readFileSync(join(RAIZ, SCRIPT), "utf8"));
  const { uso, porTabla } = usoDePlataforma();
  const ESCRITURAS: Privilegio[] = ["INSERT", "UPDATE", "DELETE"];

  it("ningún privilegio de escritura sobra: todo INSERT/UPDATE/DELETE dado lo ejerce algún código de plataforma", () => {
    const sobran: string[] = [];
    for (const [tabla, privilegios] of grants) {
      for (const p of privilegios) if (ESCRITURAS.includes(p) && !uso.get(tabla)?.has(p)) sobran.push(`${tabla}: ${p}`);
    }
    expect(sobran.sort(), "grants de escritura que ningún código de plataforma usa: recortarlos de crear-rol-motor2-plataforma.sql").toEqual([]);
  });

  it("ninguna tabla se da sin que se use (ni siquiera para leer)", () => {
    const sinUso = [...grants.keys()].filter((t) => !uso.has(t)).sort();
    expect(sinUso, "tablas con grant que ningún código de plataforma toca").toEqual([]);
  });

  it("nada que el código hace falta en los grants (fallaría en producción, y los tests corren como dueño)", () => {
    const faltan: string[] = [];
    for (const [tabla, privilegios] of uso) {
      const dados = grants.get(tabla);
      for (const p of privilegios) {
        const cubierto = dados?.has(p) || (p === "SELECT" && dados !== undefined);
        if (!cubierto) faltan.push(`${tabla}: ${p} (en ${[...new Set(porTabla.get(tabla))].join(", ")})`);
      }
    }
    expect(faltan.sort()).toEqual([]);
  });

  it("DELETE y TRUNCATE no se dan nunca", () => {
    for (const [tabla, privilegios] of grants) expect([...privilegios].filter((p) => p === "DELETE" || (p as string) === "TRUNCATE"), tabla).toEqual([]);
  });
});
