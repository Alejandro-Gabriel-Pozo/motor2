import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { analizarFuente, delegadosDeModelos, llamadasALaBase } from "../../scripts/arquitectura/analizar-fuente";
import { PUREZA_HEREDADA_DEL_NUCLEO } from "./pureza-heredada-del-nucleo";

/**
 * `src/core/` no consulta la base (Pureza Fase 3; regla `core-sin-consultas` de la auditoría). El cálculo vive en `core`; la consulta vive en
 * `src/server/consultas/`, `src/server/lecturas/` o `src/server/persistencia/`, y le entrega al cálculo filas ya leídas.
 *
 * La regla mira TODO `src/core/` (Hito 5, pieza 5.4, B6: hasta entonces se activaba por carpeta, una lista que crecía al final de cada PR de la Fase 3 y que
 * dejaba afuera `auth`, `permisos`, `features`, `fiscal` y los archivos sueltos de `core/`; el último paso de la Fase 3 prometía reemplazarla por «todo core»).
 * Se prohíbe, por AST (no por texto):
 *
 *  1. Llamadas a la base: lecturas o escrituras sobre un modelo (`x.producto.findMany`), SQL crudo y `$transaction`.
 *  2. Importar el cliente (`lib/db`, `core/auth/base`).
 *  3. Recibir la base: todo parámetro, variable o campo tipado `Db`, `PrismaClient`, `TransactionClient` o `Transaccion`, AUNQUE el archivo no
 *     haga ninguna llamada. Esto cierra el hueco del analizador de pureza, que no ve la lectura indirecta: una función `async (db: Db)` que le
 *     pasa `db` a otra, o un alias local del tipo (`import type { Db } from "./comun"`), figura como P0 pero consulta.
 *
 * El hallazgo se informa con archivo, línea y qué se detectó. Excepciones: SOLO `ARCHIVOS_PENDIENTES` (abajo), cada uno con su motivo, verificado en las DOS direcciones:
 * un archivo de `core` que consulta y no figura, falla; uno que figura y ya no consulta, falla pidiendo sacarlo; y cada pendiente tiene que figurar en
 * `PUREZA_HEREDADA_DEL_NUCLEO` con un `pendiente` de la Fase 6 (así un resto de la Fase 4 no se esconde acá). Agregar uno es una decisión de arquitectura.
 */
const RAIZ = join(__dirname, "../..");
const DELEGADOS = delegadosDeModelos(readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8"));

/**
 * Los archivos de `src/core/` que todavía consultan o reciben la base: la sesión y la base por empresa (`core/auth`, infraestructura que la Fase 6 muda a `server/sesion`) y la
 * factura autorizada (recibe `Db`; la usa la consola, que no puede importar `src/server`: queda para la Fase 6). La lista solo se achica.
 */
const ARCHIVOS_PENDIENTES: Record<string, string> = {
  "src/core/auth/base.ts": "Fase 6: infraestructura de la base por empresa (importa el cliente y fija `app.empresa_id` con un set_config local a la transacción); sale UNA vez a server/sesion junto con contexto y rol-de-ejecucion, sin tocar su código.",
  "src/core/auth/contexto.ts": "Fase 6: el resolvedor del contexto de sesión (lee la base y depende de server-only, React o Next); pasa a server/sesion.",
  "src/core/auth/rol-de-ejecucion.ts": "Fase 6: verifica el rol de ejecución leyendo la base; lo importa solo auth/base.ts (infraestructura de sesión), así que no puede salir antes que él: se muda con server/sesion.",
  "src/core/fiscal/factura-autorizada.ts": "Fase 6: recibe `Db` (la fuente de facturas autorizadas cuenta filas con la base que le pasan) y la usa la consola de plataforma, que no puede importar src/server; queda para la Fase 6.",
};

const TIPOS_DE_BASE = new Set(["Db", "PrismaClient", "TransactionClient", "Transaccion"]);

interface Hallazgo {
  archivo: string;
  linea: number;
  que: string;
}

function archivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

/** Nombre del tipo de una referencia (`Db`, `Prisma.TransactionClient` → `TransactionClient`). */
function nombreDeTipo(nombre: ts.EntityName): string {
  return ts.isIdentifier(nombre) ? nombre.text : nombre.right.text;
}

/** Hallazgos de un archivo (ruta relativa a la raíz del repo, con `/`). */
function hallazgosDeCodigo(codigo: string, ruta: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const archivo = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lineaDe = (nodo: ts.Node) => archivo.getLineAndCharacterOfPosition(nodo.getStart(archivo)).line + 1;

  for (const llamada of llamadasALaBase(codigo, ruta, DELEGADOS)) hallazgos.push({ archivo: ruta, linea: llamada.linea, que: `consulta la base (${llamada.nombre})` });
  if (analizarFuente(codigo, ruta, DELEGADOS).importaCliente) hallazgos.push({ archivo: ruta, linea: 1, que: "importa el cliente de base" });

  const visitar = (nodo: ts.Node): void => {
    if (ts.isTypeReferenceNode(nodo) && TIPOS_DE_BASE.has(nombreDeTipo(nodo.typeName))) {
      hallazgos.push({ archivo: ruta, linea: lineaDe(nodo), que: `recibe la base (tipo ${nombreDeTipo(nodo.typeName)})` });
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(archivo);
  return hallazgos;
}

/** Todos los hallazgos de `src/core/` (carpetas y archivos sueltos), por archivo. */
function hallazgosDeTodoCore(): Map<string, Hallazgo[]> {
  const porArchivo = new Map<string, Hallazgo[]>();
  for (const absoluta of archivosDe(join(RAIZ, "src/core"))) {
    const ruta = relative(RAIZ, absoluta).split(sep).join("/");
    porArchivo.set(ruta, hallazgosDeCodigo(readFileSync(absoluta, "utf8"), ruta));
  }
  return porArchivo;
}

/** Los problemas de `porArchivo` contra la lista de pendientes y el registro de heredados, en las dos direcciones. Recibe todo por parámetro para poder probarse con fixtures. */
function juzgar(
  porArchivo: ReadonlyMap<string, readonly Hallazgo[]>,
  pendientes: Readonly<Record<string, string>>,
  heredados: Readonly<Record<string, { pendiente: string }>>
): string[] {
  const problemas: string[] = [];
  for (const [archivo, hallazgos] of porArchivo) {
    if (hallazgos.length > 0 && !(archivo in pendientes)) {
      problemas.push(...hallazgos.map((h) => `${h.archivo}:${h.linea} ${h.que} (sacá la consulta a src/server y pasale al cálculo las filas ya leídas)`));
    }
  }
  for (const [archivo, motivo] of Object.entries(pendientes)) {
    if (!porArchivo.has(archivo)) problemas.push(`${archivo}: pendiente de ARCHIVOS_PENDIENTES que no existe (¿se mudó? sacalo de la lista)`);
    else if ((porArchivo.get(archivo) ?? []).length === 0) problemas.push(`${archivo}: ya no consulta ni recibe la base (sacalo de ARCHIVOS_PENDIENTES)`);
    if (motivo.trim().length < 20) problemas.push(`${archivo}: pendiente sin motivo`);
    const heredado = heredados[archivo];
    if (!heredado) problemas.push(`${archivo}: pendiente que no figura en PUREZA_HEREDADA_DEL_NUCLEO (un resto de la Fase 4 no se esconde acá: tiene que ser deuda declarada de la Fase 6)`);
    else if (!/^Fase 6/.test(heredado.pendiente)) problemas.push(`${archivo}: figura en PUREZA_HEREDADA_DEL_NUCLEO con «${heredado.pendiente.slice(0, 40)}…» y no con una Fase 6`);
  }
  return problemas;
}

describe("core-sin-consultas: TODO src/core/ no consulta la base (salvo los pendientes de la Fase 6)", () => {
  const porArchivo = hallazgosDeTodoCore();

  it("recorre todo core: las carpetas de negocio, las que faltaban (auth, permisos, features, fiscal) y los archivos sueltos", () => {
    const rutas = [...porArchivo.keys()];
    expect(rutas.length).toBeGreaterThan(200);
    for (const suelto of ["excel", "moneda", "numero", "resultado-caso", "texto"]) expect(rutas, `src/core/${suelto}.ts`).toContain(`src/core/${suelto}.ts`);
    for (const carpeta of ["auth", "permisos", "features", "fiscal", "movimientos", "catalogo", "carta", "reportes"]) {
      expect(rutas.some((r) => r.startsWith(`src/core/${carpeta}/`)), `src/core/${carpeta}/`).toBe(true);
    }
  });

  it("ningún archivo consulta, importa el cliente ni recibe la base, salvo los de ARCHIVOS_PENDIENTES (y la lista no tiene entradas de más ni de otra fase)", () => {
    const problemas = juzgar(porArchivo, ARCHIVOS_PENDIENTES, PUREZA_HEREDADA_DEL_NUCLEO);
    expect(problemas).toEqual([]);
  });

  it("los pendientes son exactamente los cuatro esperados (la lista solo se achica)", () => {
    expect(Object.keys(ARCHIVOS_PENDIENTES).sort()).toEqual(["src/core/auth/base.ts", "src/core/auth/contexto.ts", "src/core/auth/rol-de-ejecucion.ts", "src/core/fiscal/factura-autorizada.ts"]);
  });
});

describe("core-sin-consultas: el juicio sobre los pendientes (con fixtures)", () => {
  const consulta: Hallazgo = { archivo: "src/core/x/a.ts", linea: 3, que: "consulta la base (producto.findMany)" };
  const heredado = (pendiente: string) => ({ "src/core/x/a.ts": { pendiente } });

  it("un archivo que consulta y no está en la lista es un problema; con la entrada de la Fase 6 y el heredado, no", () => {
    expect(juzgar(new Map([["src/core/x/a.ts", [consulta]]]), {}, {})).toHaveLength(1);
    expect(juzgar(new Map([["src/core/x/a.ts", [consulta]]]), { "src/core/x/a.ts": "Fase 6: se muda con la sesión de la consola" }, heredado("Fase 6: pasa a server/sesion"))).toEqual([]);
  });

  it("un pendiente que ya no consulta, que no existe, sin motivo, fuera de PUREZA_HEREDADA o con una fase distinta de la 6 es un problema", () => {
    const motivo = "Fase 6: se muda con la sesión de la consola";
    expect(juzgar(new Map([["src/core/x/a.ts", []]]), { "src/core/x/a.ts": motivo }, heredado("Fase 6: x"))).toHaveLength(1);
    expect(juzgar(new Map(), { "src/core/x/a.ts": motivo }, heredado("Fase 6: x"))).toHaveLength(1);
    expect(juzgar(new Map([["src/core/x/a.ts", [consulta]]]), { "src/core/x/a.ts": "corto" }, heredado("Fase 6: x"))).toHaveLength(1);
    expect(juzgar(new Map([["src/core/x/a.ts", [consulta]]]), { "src/core/x/a.ts": motivo }, {})).toHaveLength(1);
    expect(juzgar(new Map([["src/core/x/a.ts", [consulta]]]), { "src/core/x/a.ts": motivo }, heredado("Fase 4: la escritura sale a un caso de uso"))).toHaveLength(1);
  });
});

describe("core-sin-consultas: el detector (con fuentes sintéticas)", () => {
  const detecta = (codigo: string) => hallazgosDeCodigo(codigo, "src/core/ejemplo/x.ts").map((h) => h.que);

  it("una llamada a un modelo de la base", () => {
    expect(detecta("export async function f(x: { producto: { findMany(): unknown } }) { return x.producto.findMany(); }")).toEqual(["consulta la base (producto.findMany)"]);
  });

  it("un parámetro tipado Db, aunque no haga ninguna llamada (la lectura indirecta)", () => {
    expect(detecta('import type { Db } from "@/lib/db-tipos";\nexport const f = (db: Db) => db;')).toEqual(["recibe la base (tipo Db)"]);
  });

  it("un alias local del tipo y las variantes PrismaClient / Prisma.TransactionClient / Transaccion", () => {
    expect(detecta('import type { Prisma, PrismaClient } from "@prisma/client";\nexport const a = (c: PrismaClient) => c;\nexport const b = (t: Prisma.TransactionClient) => t;')).toEqual([
      "recibe la base (tipo PrismaClient)",
      "recibe la base (tipo TransactionClient)",
    ]);
    expect(detecta('import type { Transaccion } from "@/lib/db-tipos";\nexport interface E { transaccion: Transaccion }')).toEqual(["recibe la base (tipo Transaccion)"]);
  });

  it("importar el cliente", () => {
    expect(detecta('import { prisma } from "@/lib/db";\nexport const f = () => prisma;')).toEqual(["importa el cliente de base"]);
  });

  it("un cálculo puro sobre filas ya leídas no tiene hallazgos", () => {
    expect(detecta("export const total = (filas: { cantidad: number }[]) => filas.reduce((s, f) => s + f.cantidad, 0);")).toEqual([]);
  });
});
