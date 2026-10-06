import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analizarFuente, capaDeArchivo, delegadosDeModelos, nivelDePureza } from "../../scripts/arquitectura/analizar-fuente";

/**
 * Analizador de pureza (scripts/arquitectura/analizar-fuente.ts, Fase 0 del plan de pureza). Cada caso fija UNA señal con un fragmento
 * mínimo: si el analizador deja de verla, el inventario (y las reglas de pureza que se apoyen en él) mentiría sin que nada falle.
 */
const DELEGADOS = delegadosDeModelos("model Producto {\n}\nmodel MovimientoStock {\n}\n");

const nivel = (codigo: string, ruta = "src/core/x.ts") => nivelDePureza(analizarFuente(codigo, ruta, DELEGADOS));

describe("analizador de pureza: niveles", () => {
  it("P0: una función pura sin imports externos", () => {
    expect(nivel("export const sumar = (a: number, b: number) => a + b;")).toBe("P0");
  });

  it("P0: importar otro archivo del dominio no ensucia", () => {
    expect(nivel('import { sumar } from "./sumar";\nexport const doble = (a: number) => sumar(a, a);')).toBe("P0");
  });

  it("P1: solo tipos de Prisma (import type, o import normal usado solo como tipo)", () => {
    expect(nivel('import type { Prisma } from "@prisma/client";\nexport type F = Prisma.Decimal;')).toBe("P1");
    expect(nivel('import { Prisma } from "@prisma/client";\nexport type F = Prisma.Decimal;')).toBe("P1");
    expect(nivel('import { type Prisma } from "@prisma/client";\nexport type F = Prisma.Decimal;')).toBe("P1");
  });

  it("P1: el tipo `Db` de lib/db-tipos cuenta como tipo de Prisma", () => {
    expect(nivel('import type { Db } from "@/lib/db-tipos";\nexport const f = (db: Db) => db;')).toBe("P1");
  });

  it("P2: un valor de Prisma usado en ejecución (new Prisma.Decimal)", () => {
    expect(nivel('import { Prisma } from "@prisma/client";\nexport const cero = () => new Prisma.Decimal(0);')).toBe("P2");
  });

  it("P2: el reloj (Date.now y new Date() sin argumentos), no new Date(x)", () => {
    expect(nivel("export const a = () => Date.now();")).toBe("P2");
    expect(nivel("export const a = () => new Date();")).toBe("P2");
    expect(nivel("export const a = (x: string) => new Date(x);")).toBe("P0");
  });

  it("P2: azar y entorno", () => {
    expect(nivel("export const a = () => Math.random();")).toBe("P2");
    expect(nivel('import { randomUUID } from "node:crypto";\nexport const a = () => randomUUID();')).toBe("P2");
    expect(nivel("export const a = () => process.env.X;")).toBe("P2");
  });

  it("P3: consultar un modelo de Prisma (el delegado sale del schema)", () => {
    expect(nivel("export const a = (db: any) => db.producto.findMany({});")).toBe("P3");
    expect(nivel("export const a = (db: any) => db.movimientoStock.groupBy({});")).toBe("P3");
  });

  it("P3: escribir, SQL crudo y transacciones", () => {
    expect(nivel("export const a = (db: any) => db.producto.update({});")).toBe("P3");
    expect(nivel("export const a = (db: any) => db.$queryRaw`select 1`;")).toBe("P3");
    expect(nivel("export const a = (db: any) => db.$transaction(async () => 1);")).toBe("P3");
  });

  it("P3: red, disco y el cliente de base", () => {
    expect(nivel('export const a = () => fetch("https://x");')).toBe("P3");
    expect(nivel('import { readFileSync } from "node:fs";\nexport const a = () => readFileSync("x");')).toBe("P3");
    expect(nivel('import { prisma } from "@/lib/db";\nexport const a = () => prisma;')).toBe("P3");
    expect(nivel('import { dbDeEmpresa } from "@/core/auth/base";\nexport const a = () => dbDeEmpresa;')).toBe("P3");
  });

  it("P3 gana sobre P2 y P4 gana sobre todo", () => {
    expect(nivel("export const a = (db: any) => { Date.now(); return db.producto.findMany({}); };")).toBe("P3");
    expect(nivel('import "server-only";\nexport const a = (db: any) => db.producto.findMany({});')).toBe("P4");
    expect(nivel('import { cache } from "react";\nexport const a = cache(() => 1);')).toBe("P4");
    expect(nivel('import { redirect } from "next/navigation";\nexport const a = () => redirect("/");')).toBe("P4");
  });

  it("no confunde un campo con un delegado: `x.producto` sin operación de Prisma no es una consulta", () => {
    expect(nivel("export const a = (x: { producto: { nombre: string } }) => x.producto.nombre;")).toBe("P0");
    expect(nivel("export const a = (xs: string[]) => xs.map((x) => x.trim());")).toBe("P0");
  });

  it("un comentario o un texto que menciona Date.now() o fetch( no cuenta (se mira el AST, no el texto)", () => {
    expect(nivel('// Date.now() y fetch(x)\nexport const a = "process.env y Math.random()";')).toBe("P0");
  });
});

describe("analizador de pureza: capas y modelos", () => {
  it("capaDeArchivo clasifica por ruta (la más específica primero)", () => {
    expect(capaDeArchivo("src/server/actions/movimientos/casos-de-uso/anular-compra.ts")).toBe("server/casos-de-uso");
    expect(capaDeArchivo("src/server/actions/movimientos/compras.ts")).toBe("server/actions");
    expect(capaDeArchivo("src/core/features/compras/compra.schema.ts")).toBe("core/features");
    expect(capaDeArchivo("src/core/moneda.ts")).toBe("core");
    expect(capaDeArchivo("plataforma/src/servidor/modulos.ts")).toBe("plataforma/servidor");
    expect(capaDeArchivo("src/env.ts")).toBe("otros");
  });

  it("delegadosDeModelos sale del schema real y trae los modelos conocidos", () => {
    const real = delegadosDeModelos(readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8"));
    expect(real.size).toBeGreaterThan(60);
    for (const modelo of ["movimientoStock", "operacion", "registroAuditoria", "producto"]) expect(real.has(modelo), modelo).toBe(true);
  });
});
