import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián de arquitectura (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 5 — molde de
 * `disponibilidad-en-un-solo-lugar.test.ts`): todo archivo que lea `RecetaIngrediente`/`RecetaVersion` directo (vía
 * `recetaVersion.find*`, `recetaIngrediente.find*` o el filtro `recetaVersiones: {...}`) tiene que estar en la lista
 * explícita de abajo, clasificado `efectivo` (resuelve `rendimientoEfectivo` — cantidad/merma DE LA SUCURSAL) o `central`
 * (nunca calibra por sucursal: es el editor central, o solo mira la estructura — existe la receta, quién referencia qué —
 * sin leer cantidad/merma). Un archivo nuevo que empiece a leer la receta directo y se olvide de pasar `sucursalId` a
 * `construirIndiceRecetas`/incluir `rendimientosLocales` reintroduciría en silencio el bug que motivó todo este plan (el
 * botón "Usar este valor" escribiendo en la sucursal equivocada): este test lo obliga a declararse acá primero, con motivo.
 *
 * Verificado en las DOS direcciones, mismo criterio que `toda-accion-se-usa.test.ts`: un archivo listado que ya no lee la
 * receta (se refactorizó) también es una desincronización a corregir.
 */
const SRC = join(__dirname, "../../src");

interface ArchivoClasificado {
  ruta: string;
  clase: "efectivo" | "central";
  motivo: string;
}

const ARCHIVOS_CLASIFICADOS: readonly ArchivoClasificado[] = [
  {
    ruta: "core/reportes/comun.ts",
    clase: "efectivo",
    motivo: "construirIndiceRecetas: la fuente única (R1) — efectivo cuando recibe sucursalId, central sin ella (quien solo usa la estructura).",
  },
  {
    ruta: "core/movimientos/registrar-venta.ts",
    clase: "efectivo",
    motivo: "C1: el consumo de receta al vender se resuelve con rendimientoEfectivo de la sucursal del actor.",
  },
  {
    ruta: "server/actions/movimientos/movimientos.ts",
    clase: "efectivo",
    motivo: "C2 (calcularConsumosProduccion): el consumo de receta al producir se resuelve con rendimientoEfectivo de ctx.sucursalId.",
  },
  {
    ruta: "core/reportes/rendimiento-recetas.ts",
    clase: "efectivo",
    motivo: "R2 (construirPools): cantidad/mermaPorcentaje de cada uso salen efectivos; el RÓTULO sigue usando los valores centrales a propósito.",
  },
  {
    ruta: "core/reportes/historial-producto.ts",
    clase: "efectivo",
    motivo: "R3 (obtenerIngredientesRecetaVigente): cantidad efectiva de la sucursal en el cartel de 'producto de reventa'.",
  },
  {
    ruta: "core/reportes/rendimiento-por-sucursal.ts",
    clase: "efectivo",
    motivo: "D8 (compararRendimientosPorSucursal): resuelve el efectivo de CADA sucursal pedida, una al lado de la otra, para compararlas.",
  },
  {
    ruta: "server/actions/catalogo/recetas.ts",
    clase: "central",
    motivo: "El editor de la receta CENTRAL (obtenerRecetaVigente/listarVersionesDeReceta/guardarReceta) — nunca resuelve por sucursal, es lo que se calibra contra. El arrastre de D3 lee la versión vieja completa, pero solo para copiar/descartar RendimientoLocalIngrediente, no para resolver ningún efectivo.",
  },
  {
    ruta: "server/actions/catalogo/rendimiento-local.ts",
    clase: "central",
    motivo: "fijarRendimientoLocal/volverAlRendimientoCentral leen la línea (RecetaIngrediente) y la versión vigente para VALIDAR que la calibración apunte a la versión actual — no resuelven ningún rendimiento efectivo, escriben el override tal cual.",
  },
  {
    ruta: "app/(app)/catalogo/recetas/page.tsx",
    clase: "central",
    motivo: "Solo verifica que el producto TENGA alguna receta (recetaVersiones: { some: {} }) — no lee cantidad ni merma.",
  },
  {
    ruta: "core/catalogo/desactivar-producto.ts",
    clase: "central",
    motivo: "Chequea si algún RecetaIngrediente referencia el producto a desactivar (dependencias) — no resuelve ningún rendimiento.",
  },
] as const;

const RUTAS_PERMITIDAS = new Set(ARCHIVOS_CLASIFICADOS.map((a) => a.ruta));

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

const RE_LECTURA = /recetaVersion\.find\w*|recetaIngrediente\.find\w*|recetaVersiones:/;

/** true si el archivo tiene al menos una línea (no comentario) que lee la receta directo. */
function leeRecetaDirecto(fuente: string): boolean {
  return fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((linea) => !esComentario(linea) && RE_LECTURA.test(linea));
}

describe("lectores de receta: todo archivo que lee RecetaVersion/RecetaIngrediente directo está clasificado efectivo/central", () => {
  const rutas = archivosFuente(SRC);

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("todo archivo que lee la receta directo está en la lista, y ninguno de la lista dejó de leerla", () => {
    const encontrados = new Set<string>();
    for (const ruta of rutas) {
      const nombre = relative(SRC, ruta).split(sep).join("/");
      if (leeRecetaDirecto(readFileSync(ruta, "utf8"))) encontrados.add(nombre);
    }

    const sinClasificar = Array.from(encontrados).filter((n) => !RUTAS_PERMITIDAS.has(n));
    expect(
      sinClasificar,
      `Estos archivos leen RecetaVersion/RecetaIngrediente directo pero no están en ARCHIVOS_CLASIFICADOS (clasificalos efectivo/central con motivo):\n${sinClasificar.join("\n")}`
    ).toEqual([]);

    const yaNoLeen = Array.from(RUTAS_PERMITIDAS).filter((n) => !encontrados.has(n));
    expect(yaNoLeen, `Estos ya no leen la receta directo: sacalos de ARCHIVOS_CLASIFICADOS:\n${yaNoLeen.join("\n")}`).toEqual([]);
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca recetaVersion.findFirst/findMany y recetaIngrediente.findMany fuera de un comentario", () => {
      expect(leeRecetaDirecto('const v = await tx.recetaVersion.findFirst({ where: { productoId } });')).toBe(true);
      expect(leeRecetaDirecto("const usos = await db.recetaIngrediente.findMany({ where: { insumoProductoId } });")).toBe(true);
      expect(leeRecetaDirecto('where: { recetaVersiones: { some: {} } },')).toBe(true);
    });

    it("no marca un comentario que solo menciona el patrón", () => {
      expect(leeRecetaDirecto("// ver recetaVersion.findMany en otro lado")).toBe(false);
      expect(leeRecetaDirecto(" * 3 `recetaVersion.findMany` por reporte")).toBe(false);
    });

    it("no marca un archivo sin ninguna de las tres formas", () => {
      expect(leeRecetaDirecto('const productos = await db.producto.findMany({});')).toBe(false);
    });
  });
});
