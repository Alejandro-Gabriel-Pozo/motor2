/**
 * Inventario reproducible de pureza y capas del repositorio (Fase 0 del plan de pureza, PR 0.1). Solo lectura: recorre `src/` y
 * `plataforma/src/` con el compilador de TypeScript y escribe un JSON en la salida estándar. No toca la base ni el repo.
 *
 * Es la fuente de TODA cifra de pureza que se cite en docs/linea-de-base-pureza-2026-10-06.md: si una cifra cambia, se vuelve a correr
 * esto, no se estima.
 *
 * Uso:
 *   npm run inventario:arquitectura                 → resumen (cantidades por capa y por nivel de pureza, y señales de `src/core`)
 *   npm run inventario:arquitectura -- --detalle    → además, una fila por archivo (ruta, capa, nivel y señales)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { analizarFuente, capaDeArchivo, delegadosDeModelos, nivelDePureza, type NivelDePureza, type SenalesDeFuente } from "./analizar-fuente";

const RAIZ = join(__dirname, "../..");
const CARPETAS = ["src", "plataforma/src"];

function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "node_modules" || nombre === ".next" ? [] : archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

interface FilaDeArchivo {
  ruta: string;
  capa: string;
  lineas: number;
  nivel: NivelDePureza;
  senales: SenalesDeFuente;
}

const NIVELES: NivelDePureza[] = ["P0", "P1", "P2", "P3", "P4"];

function contarPorNivel(filas: FilaDeArchivo[]): Record<NivelDePureza, number> {
  const cuenta = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const f of filas) cuenta[f.nivel]++;
  return cuenta;
}

function main() {
  const delegados = delegadosDeModelos(readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8"));
  const filas: FilaDeArchivo[] = CARPETAS.flatMap((c) => archivosDe(join(RAIZ, c))).map((absoluta) => {
    const ruta = relative(RAIZ, absoluta).split(sep).join("/");
    const codigo = readFileSync(absoluta, "utf8");
    const senales = analizarFuente(codigo, ruta, delegados);
    return { ruta, capa: capaDeArchivo(ruta), lineas: codigo.split("\n").length, nivel: nivelDePureza(senales), senales };
  });

  const capas = [...new Set(filas.map((f) => f.capa))].sort();
  const porCapa = Object.fromEntries(
    capas.map((capa) => {
      const deLaCapa = filas.filter((f) => f.capa === capa);
      return [capa, { archivos: deLaCapa.length, lineas: deLaCapa.reduce((s, f) => s + f.lineas, 0), niveles: contarPorNivel(deLaCapa) }];
    })
  );

  const nucleo = filas.filter((f) => f.capa === "core" || f.capa === "core/features");
  const senalesDelNucleo = {
    prismaDeValor: nucleo.filter((f) => f.senales.prismaDeValor).length,
    prismaDeTipo: nucleo.filter((f) => f.senales.prismaDeTipo).length,
    importaCliente: nucleo.filter((f) => f.senales.importaCliente).length,
    leeLaBase: nucleo.filter((f) => f.senales.leeLaBase).length,
    escribeEnLaBase: nucleo.filter((f) => f.senales.escribeEnLaBase).length,
    reloj: nucleo.filter((f) => f.senales.reloj).length,
    azar: nucleo.filter((f) => f.senales.azar).length,
    entorno: nucleo.filter((f) => f.senales.entorno).length,
    red: nucleo.filter((f) => f.senales.red).length,
    disco: nucleo.filter((f) => f.senales.disco).length,
    serverOnly: nucleo.filter((f) => f.senales.serverOnly).length,
    reactONext: nucleo.filter((f) => f.senales.reactONext).length,
  };

  const resultado: Record<string, unknown> = {
    archivos: filas.length,
    porCapa,
    nucleo: { archivos: nucleo.length, niveles: contarPorNivel(nucleo), senales: senalesDelNucleo },
    niveles: NIVELES,
  };
  if (process.argv.includes("--detalle")) resultado.detalle = filas.map(({ ruta, capa, lineas, nivel, senales }) => ({ ruta, capa, lineas, nivel, ...senales }));
  console.log(JSON.stringify(resultado, null, 2));
}

main();
