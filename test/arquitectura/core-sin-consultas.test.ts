import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { analizarFuente, delegadosDeModelos, llamadasALaBase } from "../../scripts/arquitectura/analizar-fuente";

/**
 * `src/core/` no consulta la base (Pureza Fase 3; regla `core-sin-consultas` de la auditoría). El cálculo vive en `core`; la consulta vive en
 * `src/server/consultas/`, `src/server/lecturas/` o `src/server/persistencia/`, y le entrega al cálculo filas ya leídas.
 *
 * La regla se activa POR CARPETA (`CARPETAS_SIN_CONSULTAS`): una carpeta entra a la lista en el mismo commit que termina de sacar sus consultas, y
 * no sale nunca. Así la lista solo crece hasta cubrir todo `src/core/` (el último paso de la Fase 3 la reemplaza por «todo core»). En las carpetas
 * de la lista se prohíbe, por AST (no por texto):
 *
 *  1. Llamadas a la base: lecturas o escrituras sobre un modelo (`x.producto.findMany`), SQL crudo y `$transaction`.
 *  2. Importar el cliente (`lib/db`, `core/auth/base`).
 *  3. Recibir la base: todo parámetro, variable o campo tipado `Db`, `PrismaClient`, `TransactionClient` o `Transaccion`, AUNQUE el archivo no
 *     haga ninguna llamada. Esto cierra el hueco del analizador de pureza, que no ve la lectura indirecta: una función `async (db: Db)` que le
 *     pasa `db` a otra, o un alias local del tipo (`import type { Db } from "./comun"`), figura como P0 pero consulta.
 *
 * El hallazgo se informa con archivo, línea y qué se detectó. Sin excepciones: agregar una es una decisión de arquitectura.
 */
const RAIZ = join(__dirname, "../..");
const DELEGADOS = delegadosDeModelos(readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8"));

/** Carpetas de `src/core/` que ya no consultan. Crece al final de cada PR de la Fase 3; no se achica. */
const CARPETAS_SIN_CONSULTAS: readonly string[] = [
  "src/core/carta",
  "src/core/catalogo",
  "src/core/compras",
  "src/core/correo",
  "src/core/datos",
  "src/core/estadistica",
  "src/core/modulos",
  "src/core/navegacion",
  "src/core/precios",
  "src/core/plataforma",
  "src/core/reportes",
  "src/core/pos",
  "src/core/seguridad",
  "src/core/stock",
  "src/core/tiempo",
];

/**
 * Carpetas que YA no consultan salvo ciertos archivos que se mudan en una fase posterior (cada uno con su motivo). Se verifica en las DOS direcciones: fuera de la
 * lista, ni un hallazgo; y cada archivo de la lista tiene que seguir teniéndolos (si ya no, se saca). La lista solo se achica.
 */
const CARPETAS_CON_PENDIENTES: Record<string, Record<string, string>> = {};

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

function hallazgosDeCarpeta(carpeta: string): Hallazgo[] {
  return archivosDe(join(RAIZ, carpeta)).flatMap((absoluta) => hallazgosDeCodigo(readFileSync(absoluta, "utf8"), relative(RAIZ, absoluta).split(sep).join("/")));
}

describe("core-sin-consultas: las carpetas de la lista no consultan la base", () => {
  it("la lista tiene carpetas que existen (si no, el test no mira nada)", () => {
    expect(CARPETAS_SIN_CONSULTAS.length).toBeGreaterThan(0);
    for (const carpeta of CARPETAS_SIN_CONSULTAS) expect(archivosDe(join(RAIZ, carpeta)).length, carpeta).toBeGreaterThan(0);
  });

  it.each(CARPETAS_SIN_CONSULTAS)("%s: ningún archivo consulta, importa el cliente ni recibe la base", (carpeta) => {
    const hallazgos = hallazgosDeCarpeta(carpeta).map((h) => `${h.archivo}:${h.linea} ${h.que}`);
    expect(hallazgos, "Sacá la consulta a src/server/consultas (o server/lecturas) y pasale al cálculo las filas ya leídas:").toEqual([]);
  });
});

describe("core-sin-consultas: carpetas con archivos pendientes (la lista solo se achica)", () => {
  it("las carpetas con pendientes y las limpias no se pisan (una carpeta no está en las dos listas)", () => {
    expect(Object.keys(CARPETAS_CON_PENDIENTES).filter((c) => CARPETAS_SIN_CONSULTAS.includes(c))).toEqual([]);
  });

  it.each(Object.keys(CARPETAS_CON_PENDIENTES))("%s: solo los archivos de la lista consultan, y todos los de la lista todavía lo hacen", (carpeta) => {
    const pendientes = CARPETAS_CON_PENDIENTES[carpeta]!;
    const hallazgos = hallazgosDeCarpeta(carpeta);
    const conHallazgos = new Set(hallazgos.map((h) => h.archivo));
    const nuevos = [...conHallazgos].filter((a) => !(a in pendientes));
    expect(nuevos, "Estos archivos consultan y no están en la lista de pendientes (sacá la consulta a src/server):").toEqual([]);
    const yaLimpios = Object.keys(pendientes).filter((a) => !conHallazgos.has(a));
    expect(yaLimpios, "Estos ya no consultan: sacalos de la lista de pendientes (CARPETAS_CON_PENDIENTES):").toEqual([]);
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
