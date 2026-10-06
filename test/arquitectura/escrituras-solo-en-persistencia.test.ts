import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { delegadosDeModelos, llamadasALaBase } from "../../scripts/arquitectura/analizar-fuente";
import { ESCRITURAS_FUERA_DE_PERSISTENCIA, TOPE_DE_ENTRADAS, type EscrituraHeredada } from "./escrituras-fuera-de-persistencia";

/**
 * Regla de cierre de la Fase 4 del plan de pureza: la base se ESCRIBE solo desde `src/server/persistencia/`.
 *
 * El caso de uso orquesta (permiso, transacción, idempotencia, auditoría) y la persistencia escribe: `core` decide, `server/persistencia` toca
 * la base. Hoy quedan archivos que escriben por su cuenta (acciones sin migrar, `core` con escrituras heredadas, la consola); la lista está en
 * `escrituras-fuera-de-persistencia.ts` y SOLO PUEDE ACHICARSE.
 *
 * Qué cuenta como escritura (por AST, no por texto; fuera de los comentarios): `x.<modelo>.<create|createMany|createManyAndReturn|update|
 * updateMany|upsert|delete|deleteMany>`, el mismo delegado suelto (`const { producto } = tx; producto.create(...)`) y el SQL crudo de
 * escritura (`$executeRaw*`). `$transaction` no cuenta por sí mismo: lo que escriben sus callbacks ya se cuenta.
 *
 * Alcance: todo `.ts`/`.tsx` de `src/` y `plataforma/src/`. Quedan fuera, a propósito: `scripts/` (los benchmarks borran filas `bench_*`, los
 * seeds siembran), `prisma/` (seed y migraciones) y `test/`.
 *
 * Cómo se controla (en las dos direcciones, como la lista de pureza): una escritura fuera de la zona y de la lista falla; una entrada cuyo
 * archivo escribe MÁS de lo declarado falla («no puede empeorar»); una que escribe MENOS falla pidiendo fijar la mejora; una que ya no escribe
 * nada falla pidiendo sacarla. `TOPE_DE_ENTRADAS` hace visible en la revisión cualquier entrada nueva.
 */
const RAIZ = join(__dirname, "../..");
const CARPETAS = ["src", "plataforma/src"];
const ZONA_PERMITIDA = "src/server/persistencia/";
const DELEGADOS = delegadosDeModelos(readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8"));
const OPERACIONES_DE_ESCRITURA = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const FASES = new Set(["Fase 4", "Fase 6", "Consola", "Permanente"]);

interface Escritura {
  /** `modelo.operación` o `$executeRaw`… */
  nombre: string;
  linea: number;
}

/** Las escrituras de un archivo: por modelo calificado, por delegado suelto y SQL crudo de escritura. */
function escriturasDe(codigo: string, ruta: string): Escritura[] {
  const calificadas = llamadasALaBase(codigo, ruta, DELEGADOS)
    .filter((l) => l.clase === "escritura" && l.nombre !== "$transaction")
    .map((l) => ({ nombre: l.nombre, linea: l.linea }));

  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sueltas: Escritura[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression) && ts.isIdentifier(nodo.expression.expression)) {
      const delegado = nodo.expression.expression.text;
      const operacion = nodo.expression.name.text;
      if (DELEGADOS.has(delegado) && OPERACIONES_DE_ESCRITURA.has(operacion)) {
        sueltas.push({ nombre: `${delegado}.${operacion}`, linea: fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1 });
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);

  return [...calificadas, ...sueltas].sort((a, b) => a.linea - b.linea);
}

const multiconjunto = (es: readonly Escritura[] | readonly string[]) => es.map((e) => (typeof e === "string" ? e : e.nombre)).sort();

function archivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "node_modules" || nombre === ".next" ? [] : archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

/**
 * Juzga las escrituras de los archivos contra la zona permitida y la lista de heredados. Devuelve los problemas, cada uno con archivo y qué pasó.
 * Recibe todo por parámetro para poder probarse con fixtures.
 */
function juzgar(porArchivo: ReadonlyMap<string, readonly Escritura[]>, heredadas: Readonly<Record<string, EscrituraHeredada>>, zona: string): string[] {
  const problemas: string[] = [];
  for (const [archivo, escrituras] of porArchivo) {
    if (escrituras.length === 0 || archivo.startsWith(zona)) continue;
    const heredada = heredadas[archivo];
    if (!heredada) {
      for (const e of escrituras) problemas.push(`${archivo}:${e.linea}  ${e.nombre}: se escribe la base fuera de ${zona} (y el archivo no está en la lista de heredados)`);
      continue;
    }
    const real = multiconjunto(escrituras);
    const declarado = multiconjunto(heredada.escrituras);
    if (real.length > declarado.length || real.some((n) => real.filter((x) => x === n).length > declarado.filter((x) => x === n).length)) {
      const nuevas = real.filter((n, i) => real.indexOf(n) === i && real.filter((x) => x === n).length > declarado.filter((x) => x === n).length);
      problemas.push(`${archivo}  escribe MÁS de lo declarado (${nuevas.join(", ")}): la lista no puede empeorar; la escritura nueva va a ${zona}`);
    } else if (real.join("|") !== declarado.join("|")) {
      problemas.push(`${archivo}  escribe MENOS de lo declarado: fijá la mejora en escrituras-fuera-de-persistencia.ts (declarado: ${declarado.join(", ")}; real: ${real.join(", ") || "nada"})`);
    }
  }
  for (const archivo of Object.keys(heredadas)) {
    if ((porArchivo.get(archivo)?.length ?? 0) === 0) problemas.push(`${archivo}  ya no escribe nada (o ya no existe): sacalo de la lista de heredados y bajá TOPE_DE_ENTRADAS`);
  }
  return problemas;
}

const fixture = (codigo: string, ruta = "src/server/actions/x.ts") => new Map([[ruta, escriturasDe(codigo, ruta)]]);

describe("escrituras solo en persistencia: el detector ve las escrituras (la regla no puede quedar ciega)", () => {
  it("detecta cada operación de escritura, por modelo calificado y por delegado suelto", () => {
    for (const op of OPERACIONES_DE_ESCRITURA) {
      expect(escriturasDe(`export const f = (tx: any) => tx.producto.${op}({});`, "x.ts").map((e) => e.nombre), `calificado ${op}`).toEqual([`producto.${op}`]);
      expect(escriturasDe(`export const f = (producto: any) => producto.${op}({});`, "x.ts").map((e) => e.nombre), `suelto ${op}`).toEqual([`producto.${op}`]);
    }
  });

  it("detecta el SQL crudo de escritura (llamada y plantilla etiquetada)", () => {
    expect(escriturasDe('export const f = (db: any) => db.$executeRaw`update "Producto" set nombre = 1`;', "x.ts").map((e) => e.nombre)).toEqual(["$executeRaw"]);
    expect(escriturasDe('export const f = (db: any) => db.$executeRawUnsafe("DELETE FROM x");', "x.ts").map((e) => e.nombre)).toEqual(["$executeRawUnsafe"]);
  });

  it("NO marca lecturas, SQL crudo de lectura ni `$transaction` por sí mismo; sí lo que escribe adentro", () => {
    const lecturas = "export const f = (tx: any) => [tx.producto.findMany({}), tx.producto.count({}), tx.$queryRaw`select 1`];";
    expect(escriturasDe(lecturas, "x.ts")).toEqual([]);
    expect(escriturasDe("export const f = (db: any) => db.$transaction(async (tx: any) => { await tx.mesa.create({}); });", "x.ts").map((e) => e.nombre)).toEqual(["mesa.create"]);
    expect(escriturasDe("export const f = (db: any) => db.$transaction([db.mesa.findMany({})]);", "x.ts")).toEqual([]);
  });

  it("no cuenta un identificador que no es un modelo ni un texto o comentario", () => {
    expect(escriturasDe("export const f = (mapa: Map<string, number>) => mapa.delete('a');", "x.ts")).toEqual([]);
    expect(escriturasDe('// tx.producto.create({})\nexport const a = "tx.producto.update({})";', "x.ts")).toEqual([]);
  });
});

describe("escrituras solo en persistencia: el juicio (en las dos direcciones)", () => {
  const heredada = (escrituras: string[]): Record<string, EscrituraHeredada> => ({
    "src/server/actions/x.ts": { escrituras, fase: "Fase 4", motivo: "motivo de prueba suficientemente largo" },
  });

  it("una escritura en la zona permitida no es un problema", () => {
    expect(juzgar(fixture("export const f = (tx: any) => tx.mesa.create({});", "src/server/persistencia/pos/escribir-mesa.ts"), {}, ZONA_PERMITIDA)).toEqual([]);
  });

  it("una escritura fuera de la zona y de la lista falla, con archivo, línea y qué se escribió", () => {
    const problemas = juzgar(fixture("export const f = (tx: any) => tx.mesa.create({});"), {}, ZONA_PERMITIDA);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("src/server/actions/x.ts:1  mesa.create");
  });

  it("un archivo heredado que escribe lo mismo que declara pasa", () => {
    expect(juzgar(fixture("export const f = (tx: any) => [tx.mesa.create({}), tx.mesa.update({})];"), heredada(["mesa.update", "mesa.create"]), ZONA_PERMITIDA)).toEqual([]);
  });

  it("un archivo heredado que escribe MÁS (otra operación, otro modelo o una repetición) falla", () => {
    const base = heredada(["mesa.create"]);
    expect(juzgar(fixture("export const f = (tx: any) => [tx.mesa.create({}), tx.mesa.update({})];"), base, ZONA_PERMITIDA)[0]).toContain("escribe MÁS");
    expect(juzgar(fixture("export const f = (tx: any) => [tx.mesa.create({}), tx.cuenta.create({})];"), base, ZONA_PERMITIDA)[0]).toContain("escribe MÁS");
    expect(juzgar(fixture("export const f = (tx: any) => [tx.mesa.create({}), tx.mesa.create({})];"), base, ZONA_PERMITIDA)[0]).toContain("escribe MÁS");
  });

  it("un archivo heredado que escribe MENOS pide fijar la mejora; uno que ya no escribe pide sacarlo", () => {
    expect(juzgar(fixture("export const f = (tx: any) => tx.mesa.create({});"), heredada(["mesa.create", "mesa.update"]), ZONA_PERMITIDA)[0]).toContain("escribe MENOS");
    expect(juzgar(fixture("export const f = (tx: any) => tx.mesa.findMany({});"), heredada(["mesa.create"]), ZONA_PERMITIDA)[0]).toContain("ya no escribe nada");
  });

  it("una entrada de un archivo que no existe más pide sacarla", () => {
    expect(juzgar(new Map(), heredada(["mesa.create"]), ZONA_PERMITIDA)[0]).toContain("ya no escribe nada (o ya no existe)");
  });
});

describe("escrituras solo en persistencia: el código del repositorio", () => {
  const porArchivo = new Map<string, Escritura[]>(
    CARPETAS.flatMap((c) => archivosDe(join(RAIZ, c))).map((absoluta) => {
      const archivo = relative(RAIZ, absoluta).split(sep).join("/");
      return [archivo, escriturasDe(readFileSync(absoluta, "utf8"), archivo)] as const;
    }),
  );

  it("encuentra el código de src/ y plataforma/src/ y ve escrituras (no está ciega)", () => {
    expect(porArchivo.size).toBeGreaterThan(300);
    expect([...porArchivo.values()].reduce((n, e) => n + e.length, 0)).toBeGreaterThan(40);
  });

  it("la base se escribe solo en src/server/persistencia/ (más la lista de heredados, que solo se achica)", () => {
    const problemas = juzgar(porArchivo, ESCRITURAS_FUERA_DE_PERSISTENCIA, ZONA_PERMITIDA);
    expect(problemas, `Escrituras a la base fuera de ${ZONA_PERMITIDA}:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("la lista de heredados tiene exactamente TOPE_DE_ENTRADAS entradas (agregar una exige tocar el tope, y se ve en la revisión)", () => {
    expect(Object.keys(ESCRITURAS_FUERA_DE_PERSISTENCIA).length).toBe(TOPE_DE_ENTRADAS);
  });

  it("cada entrada lleva una fase del vocabulario cerrado y un motivo", () => {
    for (const [archivo, e] of Object.entries(ESCRITURAS_FUERA_DE_PERSISTENCIA)) {
      expect(FASES.has(e.fase), `${archivo}: fase «${e.fase}»`).toBe(true);
      expect(e.motivo.trim().length, `${archivo}: motivo`).toBeGreaterThan(20);
      expect(e.escrituras.length, `${archivo}: escrituras`).toBeGreaterThan(0);
    }
  });
});
