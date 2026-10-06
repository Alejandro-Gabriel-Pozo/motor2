import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La consola de plataforma declara TODOS los paquetes que su código alcanza (incluido el código compartido de `src/`).
 *
 * Por qué existe: la consola es otro proyecto de Vercel con su propio `package.json`, y Vercel instala solo lo que ese archivo declara. En local
 * `npm run plataforma:build` pasa igual aunque falte una declaración, porque el `node_modules` de la raíz tiene todo. El 2026-10-06 el paso 1.1
 * (`src/core/moneda.ts` pasó a importar `decimal.js`) rompió el despliegue de `plataforma-motor2` en `main` sin que ningún comando del gate lo notara.
 *
 * Se recorre el grafo real de imports de `plataforma/src` con dependency-cruiser (el mismo que `npm run arquitectura`) y se compara cada paquete
 * npm alcanzado con `plataforma/package.json`. Los tipos (`@types/*`) y las dependencias de desarrollo no cuentan: no se instalan para construir.
 */
const RAIZ = join(__dirname, "../..");
const CRUISER = join(RAIZ, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");

interface DependenciaCruzada {
  module: string;
  coreModule?: boolean;
  dependencyTypes?: string[];
}
interface ModuloCruzado {
  source: string;
  dependencies: DependenciaCruzada[];
}

/** Nombre del paquete de un especificador (`zod/v4` → `zod`, `@prisma/client/runtime` → `@prisma/client`). */
function nombreDePaquete(especificador: string): string {
  return especificador.startsWith("@") ? especificador.split("/").slice(0, 2).join("/") : especificador.split("/")[0]!;
}

/** Paquetes npm que alcanza el grafo, cada uno con el primer archivo que lo importa. */
function paquetesAlcanzados(modulos: ModuloCruzado[]): Map<string, string> {
  const paquetes = new Map<string, string>();
  for (const modulo of modulos) {
    for (const dependencia of modulo.dependencies) {
      if (dependencia.coreModule) continue;
      if (!(dependencia.dependencyTypes ?? []).some((tipo) => tipo.startsWith("npm"))) continue;
      const nombre = nombreDePaquete(dependencia.module);
      if (!paquetes.has(nombre)) paquetes.set(nombre, modulo.source);
    }
  }
  return paquetes;
}

let modulosCacheados: ModuloCruzado[] | undefined;

/** Corre dependency-cruiser sobre la consola y devuelve su JSON. Sale con código ≠ 0 si hay violaciones de OTRAS reglas: acá solo importa el grafo. */
function salidaDelRecorrido(): string {
  try {
    return execFileSync(process.execPath, [CRUISER, "plataforma/src", "--config", ".dependency-cruiser.cjs", "--output-type", "json"], {
      cwd: RAIZ,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    const stdout = (e as { stdout?: unknown }).stdout;
    if (typeof stdout === "string" && stdout.trimStart().startsWith("{")) return stdout;
    throw e;
  }
}

/** El grafo de imports de la consola (se calcula una sola vez: tarda unos segundos). */
function modulosDeLaConsola(): ModuloCruzado[] {
  modulosCacheados ??= (JSON.parse(salidaDelRecorrido()) as { modules: ModuloCruzado[] }).modules;
  return modulosCacheados;
}

describe("plataforma/package.json declara lo que la consola alcanza", () => {
  it("no falta ningún paquete (si falla: sumarlo a las dependencies de plataforma/package.json y a package-lock.json)", () => {
    const grafo = { modules: modulosDeLaConsola() };
    const declaradas = new Set(Object.keys((JSON.parse(readFileSync(join(RAIZ, "plataforma/package.json"), "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {}));

    const faltantes = [...paquetesAlcanzados(grafo.modules)].filter(([nombre]) => !declaradas.has(nombre) && !nombre.startsWith("@types/")).map(([nombre, archivo]) => `${nombre} (lo importa ${archivo})`);

    expect(faltantes).toEqual([]);
  }, 120_000);

  it("el recorrido alcanza paquetes (si no, el test no está mirando nada)", () => {
    const alcanzados = paquetesAlcanzados(modulosDeLaConsola());
    expect(alcanzados.has("decimal.js")).toBe(true);
    expect(alcanzados.size).toBeGreaterThanOrEqual(5);
  }, 120_000);
});
