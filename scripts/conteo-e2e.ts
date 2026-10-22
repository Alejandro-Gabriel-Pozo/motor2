import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { evaluarConteo, type ResultadoPlaywright } from "./conteo-e2e-reparto";

/**
 * Job `conteo-e2e` de `.github/workflows/ci.yml`: junta el `resultado-playwright.json` de cada parte del E2E y comprueba el reparto (la lógica y sus chequeos viven en `conteo-e2e-reparto.ts`).
 * Uso: `npx tsx scripts/conteo-e2e.ts <carpeta con un resultado por parte> <lista.json de «playwright test --list --reporter=json»> <cantidad de partes esperada>` (el workflow pasa `$PARTES_E2E`).
 * Sale con 1 si algo no cierra; imprime el conteo y lo agrega al resumen del job (`GITHUB_STEP_SUMMARY`).
 */

function jsonsDe(carpeta: string): string[] {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(carpeta, e.name);
    if (e.isDirectory()) return jsonsDe(ruta);
    return e.name.endsWith(".json") ? [ruta] : [];
  });
}

function main(): number {
  const [carpeta, archivoLista, cantidad] = process.argv.slice(2);
  const esperadas = Number(cantidad);
  if (!carpeta || !archivoLista || !Number.isInteger(esperadas) || esperadas < 1) {
    console.error("uso: tsx scripts/conteo-e2e.ts <carpeta de resultados> <lista.json> <cantidad de partes>");
    return 2;
  }
  const partes = jsonsDe(carpeta)
    .sort()
    .map((ruta) => ({ nombre: relative(carpeta, ruta), json: JSON.parse(readFileSync(ruta, "utf8")) as ResultadoPlaywright }));
  const lista = JSON.parse(readFileSync(archivoLista, "utf8")) as ResultadoPlaywright;
  const { texto, errores } = evaluarConteo({ partes, lista, esperadas });
  console.log(texto);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${texto}\n`);
  return errores.length ? 1 : 0;
}

process.exitCode = main();
