import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { analizarFuente, delegadosDeModelos, nivelDePureza, type NivelDePureza, type SenalesDeFuente } from "../../scripts/arquitectura/analizar-fuente";
import { PUREZA_HEREDADA_DEL_NUCLEO } from "./pureza-heredada-del-nucleo";

/**
 * Regla de arquitectura (Fase 0 del plan de pureza, PR 0.5): EL NÚCLEO (`src/core/`) NACE PURO Y SOLO PUEDE MEJORAR.
 *
 * Nivel de pureza de cada archivo (`scripts/arquitectura/analizar-fuente.ts`): P0 puro · P1 puro salvo tipos de Prisma · P2 valores de Prisma, reloj, azar o
 * entorno · P3 consulta o escribe la base, red, disco o importa el cliente · P4 depende del servidor o del framework. La meta del plan es que TODO
 * `src/core/` sea P0 (el dominio no conoce el ORM, el framework, el reloj, la red ni el entorno). Al empezar la Fase 0 eran 117 de 256 archivos; hoy quedan los de la lista (38 al 2026-10-07; 34 desde B3 del Hito 3, 2026-10-08; 27 al cerrar la pieza 5.2 del Hito 5, 2026-10-08): esa deuda está escrita, archivo por
 * archivo y con la fase del plan que la limpia, en `pureza-heredada-del-nucleo.ts`. Este test la vigila en las dos direcciones, sin baseline silencioso:
 *  1. Todo archivo de `src/core/` que NO figure en esa lista tiene que ser P0: lo nuevo nace puro, en carpeta nueva o vieja.
 *  2. Un archivo de la lista no puede EMPEORAR: ni pasar a un nivel peor ni sumar una señal de impureza que no tenía.
 *  3. Si MEJORA (o llega a P0, o ya no existe), el test falla hasta que se actualice o se saque su entrada: cada avance queda fijado y la deuda solo se achica.
 *
 * Qué NO cubre: las capas fuera del núcleo (`server/`, `app/`: ahí P3/P4 es lo esperado), ni la pureza transitiva (que un archivo P0 importe uno impuro: de eso se
 * ocupa dependency-cruiser; la medida transitiva está en el informe de la auditoría).
 */
const RAIZ = join(__dirname, "../..");
const ORDEN: NivelDePureza[] = ["P0", "P1", "P2", "P3", "P4"];
const rango = (n: NivelDePureza) => ORDEN.indexOf(n);
const NOMBRES_DE_SENALES: (keyof SenalesDeFuente)[] = ["prismaDeValor", "prismaDeTipo", "serverOnly", "reactONext", "importaCliente", "leeLaBase", "escribeEnLaBase", "reloj", "azar", "entorno", "red", "disco"];

function archivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

const DELEGADOS = delegadosDeModelos(readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8"));
const ACTUAL = new Map(
  archivosDe(join(RAIZ, "src/core")).map((absoluta) => {
    const ruta = relative(RAIZ, absoluta).split(sep).join("/");
    const senales = analizarFuente(readFileSync(absoluta, "utf8"), ruta, DELEGADOS);
    return [ruta, { nivel: nivelDePureza(senales), senales: NOMBRES_DE_SENALES.filter((n) => senales[n] === true) }] as const;
  })
);

describe("pureza del núcleo (src/core): lo nuevo nace puro y lo heredado solo mejora", () => {
  it("encuentra el núcleo (si deja de encontrarse, la regla quedó vacía)", () => {
    expect(ACTUAL.size).toBeGreaterThan(200);
    expect([...ACTUAL.values()].filter((a) => a.nivel === "P0").length).toBeGreaterThan(100);
  });

  it("todo archivo del núcleo que no figura en la lista de heredados es P0", () => {
    const impurosNuevos = [...ACTUAL].filter(([ruta, a]) => a.nivel !== "P0" && !(ruta in PUREZA_HEREDADA_DEL_NUCLEO)).map(([ruta, a]) => `${ruta}: ${a.nivel} (${a.senales.join(", ")})`);
    expect(
      impurosNuevos,
      `El núcleo nace puro: sin Prisma, sin base, sin reloj, sin azar, sin entorno, sin red y sin framework. Pasá la hora actual y la configuración por parámetro, y dejá las lecturas en server/consultas o detrás de un puerto:\n${impurosNuevos.join("\n")}`
    ).toEqual([]);
  });

  it("ningún heredado empeora (ni de nivel ni con una señal de impureza nueva)", () => {
    const empeoraron: string[] = [];
    for (const [ruta, entrada] of Object.entries(PUREZA_HEREDADA_DEL_NUCLEO)) {
      const actual = ACTUAL.get(ruta);
      if (!actual) continue;
      if (rango(actual.nivel) > rango(entrada.nivel)) empeoraron.push(`${ruta}: era ${entrada.nivel} y ahora es ${actual.nivel}`);
      const nuevas = actual.senales.filter((s) => !entrada.senales.includes(s));
      if (nuevas.length > 0) empeoraron.push(`${ruta}: suma impureza que no tenía (${nuevas.join(", ")})`);
    }
    expect(empeoraron, `La deuda de pureza no puede crecer:\n${empeoraron.join("\n")}`).toEqual([]);
  });

  it("si un heredado mejora, la entrada se actualiza o se saca (la lista solo se achica)", () => {
    const mejoraron: string[] = [];
    for (const [ruta, entrada] of Object.entries(PUREZA_HEREDADA_DEL_NUCLEO)) {
      const actual = ACTUAL.get(ruta);
      if (!actual) {
        mejoraron.push(`${ruta}: ya no existe; sacala de la lista`);
        continue;
      }
      if (actual.nivel === "P0") mejoraron.push(`${ruta}: ya es P0; sacala de la lista`);
      else if (rango(actual.nivel) < rango(entrada.nivel)) mejoraron.push(`${ruta}: mejoró de ${entrada.nivel} a ${actual.nivel}; actualizá la entrada`);
      else if (actual.senales.length < entrada.senales.length && actual.senales.every((s) => entrada.senales.includes(s))) {
        const sacadas = entrada.senales.filter((s) => !actual.senales.includes(s));
        mejoraron.push(`${ruta}: ya no tiene (${sacadas.join(", ")}); actualizá la entrada`);
      }
    }
    expect(mejoraron, `Mejoró: dejá la mejora fijada en pureza-heredada-del-nucleo.ts.\n${mejoraron.join("\n")}`).toEqual([]);
  });

  it("toda entrada nombra la fase del plan que la limpia", () => {
    for (const [ruta, entrada] of Object.entries(PUREZA_HEREDADA_DEL_NUCLEO)) {
      expect(entrada.pendiente, ruta).toMatch(/^Fase [1-6]: .{20,}/);
      expect(entrada.senales.length, `${ruta}: sin señales no hay nada que limpiar`).toBeGreaterThan(0);
    }
  });
});
