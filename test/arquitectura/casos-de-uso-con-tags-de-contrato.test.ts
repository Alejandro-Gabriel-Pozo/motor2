import { describe, expect, it } from "vitest";
import { descubrirCasosDeUsoReales } from "./guardas/casos-de-uso";

/**
 * Guardián de arquitectura (backlog post-cierre de Task #41, 2026-09-28, docs/pendientes-sesion-2026-09-27.md §7): todo caso de uso
 * REAL (un archivo bajo `casos-de-uso/` cuya función exportada llama directamente una Server Action, no un helper interno compartido
 * entre casos de uso — mismo criterio "es un caso de uso, no un paso intermedio" que ya distingue
 * `idempotencia-i3-cobertura-concurrente.test.ts`) tiene, en su docstring, los 4 tags de contrato: `@contract` (qué garantiza),
 * `@idempotency` (I3 / por estado / no aplica, y por qué), `@transaction` (qué mecanismo transaccional usa) y `@sideEffects` (qué
 * escribe además del efecto principal obvio) — un resumen escaneable sin tener que leer las ~30-90 líneas de prosa de cada archivo
 * para saber si algo tiene idempotencia real o no.
 *
 * DESCUBRE (no una lista a mano) todo archivo bajo `src/server/actions/<dominio>/casos-de-uso/<archivo>.ts` cuya función exportada la importa un
 * archivo UN nivel arriba de `casos-de-uso/` (la Server Action que lo envuelve) — mismo heurístico que separa, por ejemplo,
 * `armar-linea-de-movimiento.ts`/`producto-transferible.ts` (helpers internos, solo importados por archivos HERMANOS dentro de
 * `casos-de-uso/`, nunca por la Server Action) de los casos de uso reales. Un caso de uso nuevo que nadie se acuerde de tagear hace
 * FALLAR este test por default, no al revés.
 */
/** Casos de uso reales sin los 4 tags todavía — cada entrada exige motivo. Vacía: los 23 casos de uso reales descubiertos hoy ya los tienen. */
const SIN_TAGS_TODAVIA: Record<string, string> = {};

const TAGS_OBLIGATORIOS = ["@contract", "@idempotency", "@transaction", "@sideEffects"];

function tagsFaltantes(fuente: string): string[] {
  return TAGS_OBLIGATORIOS.filter((tag) => !fuente.includes(tag));
}

describe("arquitectura: todo caso de uso real tiene los 4 tags de contrato (@contract/@idempotency/@transaction/@sideEffects)", () => {
  const casos = descubrirCasosDeUsoReales();

  it("encuentra casos de uso reales en src/ (si esto da 0, algo rompió el descubrimiento, no que ya no haya ninguno)", () => {
    expect(casos.length).toBeGreaterThan(0);
  });

  it("cada caso de uso real tiene los 4 tags, o está en SIN_TAGS_TODAVIA con motivo", () => {
    const sinCubrirYSinExcepcion = casos
      .map((c) => ({ ruta: c.ruta, faltantes: tagsFaltantes(c.fuente) }))
      .filter((c) => c.faltantes.length > 0 && !(c.ruta in SIN_TAGS_TODAVIA));

    expect(
      sinCubrirYSinExcepcion,
      `Caso(s) de uso sin todos los tags de contrato — agregalos al docstring de la función exportada (@contract/@idempotency/` +
        `@transaction/@sideEffects) o sumalo a SIN_TAGS_TODAVIA con motivo:\n` +
        sinCubrirYSinExcepcion.map((c) => `  - ${c.ruta} (faltan: ${c.faltantes.join(", ")})`).join("\n")
    ).toEqual([]);
  });

  it("SIN_TAGS_TODAVIA no tiene entradas obsoletas (un caso que ya tiene los 4 tags, o que ya no existe)", () => {
    for (const ruta of Object.keys(SIN_TAGS_TODAVIA)) {
      const caso = casos.find((c) => c.ruta === ruta);
      expect(caso, `${ruta} está en SIN_TAGS_TODAVIA pero ya no se descubre como caso de uso real — sacala de la lista.`).toBeDefined();
      if (caso) {
        expect(tagsFaltantes(caso.fuente), `${ruta} está en SIN_TAGS_TODAVIA pero YA tiene los 4 tags — sacala de la lista, el hueco ya se cerró.`).not.toHaveLength(0);
      }
    }
  });
});
