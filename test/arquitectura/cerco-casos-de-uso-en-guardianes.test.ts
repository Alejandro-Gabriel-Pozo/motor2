import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { descubrirCasosDeUsoReales } from "./guardas/casos-de-uso";
import { leer, listarArchivos, RAIZ_DEL_REPO, sinComentarios, type Cerco, type Cuentas } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «casos de uso en los guardianes» (ola «precio y carta», Fase 1; contexto «dueño del dato»: los atajos de Carta usan el permiso y
 * el caso de uso del dueño, pero «3 casos de uso de Carta están fuera de los guardianes»).
 *
 * Los guardianes de los casos de uso (`casos-de-uso-con-tags-de-contrato.test.ts` y `ficha-de-caso-de-uso.test.ts`) revisan lo que
 * `descubrirCasosDeUsoReales` (`guardas/casos-de-uso.ts`) descubre: un archivo de `server/actions/<d>/casos-de-uso/` que importa una Server
 * Action de SU MISMO dominio (`server/actions/<d>/*.ts`, un nivel arriba). Un caso de uso que solo invoca la Server Action de OTRO dominio —el
 * atajo, p. ej. `carta/mantenimiento.ts` → `catalogo/casos-de-uso/fijar-disponibilidad-de-hoy.ts`— es un caso de uso real, pero el
 * descubrimiento no lo ve y nadie le revisa los tags ni la ficha.
 *
 * Este cerco lista los casos de uso (de cualquier dominio) que alguna Server Action importa y que el descubrimiento NO devuelve, y congela la
 * lista con un motivo por entrada. No cambia los guardianes: arreglar el descubrimiento (o mover el caso de uso) baja la línea de base.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const RE_CASO_DE_USO = /^src\/server\/actions\/[^/]+\/casos-de-uso\/[^/]+\.tsx?$/;
const RE_SERVER_ACTION = /^src\/server\/actions\/[^/]+\/[^/]+\.tsx?$/;
const RE_IMPORT = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

const MOTIVO_ATAJO = (dominio: string, accion: string) =>
  `Atajo de Carta (regla 7: un comando del dueño del dato): caso de uso de ${dominio} que solo invoca la Server Action ${accion}. El descubrimiento de los guardianes busca la acción en su propio dominio y no lo ve: sus tags de contrato y su ficha quedan sin revisar.`;

const MOTIVOS: Readonly<Record<string, string>> = {
  "src/server/actions/catalogo/casos-de-uso/fijar-disponibilidad-de-hoy.ts": MOTIVO_ATAJO("Catálogo", "carta/mantenimiento.ts (fijarDisponibilidadDeHoy)"),
};

/** El archivo de `src/` al que apunta un especificador de import (`@/…` o relativo), si es uno de `candidatos`. */
function resolver(desde: string, especificador: string, candidatos: ReadonlySet<string>): string | null {
  const base = especificador.startsWith("@/") ? `src/${especificador.slice(2)}` : especificador.startsWith(".") ? posix.join(posix.dirname(desde), especificador) : null;
  if (base === null) return null;
  return [base, `${base}.ts`, `${base}.tsx`].find((r) => candidatos.has(r)) ?? null;
}

/** Caso de uso → Server Actions (de cualquier dominio) que lo importan. */
function importadoresDeCasosDeUso(raizDelRepo: string): Map<string, string[]> {
  const archivos = listarArchivos(raizDelRepo, ["src/server/actions"], [".ts", ".tsx"]);
  const casos = new Set(archivos.filter((r) => RE_CASO_DE_USO.test(r)));
  const importadores = new Map<string, string[]>();
  for (const accion of archivos.filter((r) => RE_SERVER_ACTION.test(r))) {
    const fuente = sinComentarios(leer(raizDelRepo, accion), accion);
    for (const [, especificador] of fuente.matchAll(RE_IMPORT)) {
      const caso = resolver(accion, especificador, casos);
      if (caso) importadores.set(caso, [...new Set([...(importadores.get(caso) ?? []), accion])]);
    }
  }
  return importadores;
}

function medirFueraDeLosGuardianes(raizDelRepo: string): Cuentas {
  const descubiertos = new Set(descubrirCasosDeUsoReales().map((c) => `src/${c.ruta}`));
  const cuentas: Cuentas = {};
  for (const caso of importadoresDeCasosDeUso(raizDelRepo).keys()) if (!descubiertos.has(caso)) cuentas[caso] = { "fuera-de-los-guardianes": 1 };
  return cuentas;
}

const CERCO_CASOS_DE_USO_EN_GUARDIANES: Cerco = {
  regla: "casos-de-uso-en-guardianes",
  meta: "0: todo caso de uso que invoca una Server Action, de su dominio o de otro, lo revisan los guardianes (tags de contrato y ficha)",
  medir: medirFueraDeLosGuardianes,
  motivos: MOTIVOS,
};

describe("cerco «casos de uso en los guardianes»: el cálculo", () => {
  it("encuentra las Server Actions que importan casos de uso, también de otro dominio (no pasa en vacío)", () => {
    const importadores = importadoresDeCasosDeUso(RAIZ_DEL_REPO);
    expect(importadores.size).toBeGreaterThan(100);
    expect(importadores.get("src/server/actions/catalogo/casos-de-uso/fijar-disponibilidad-de-hoy.ts")).toEqual(["src/server/actions/carta/mantenimiento.ts"]);
  });

  it("todo caso de uso que descubren los guardianes lo importa alguna Server Action (los dos cálculos hablan de lo mismo)", () => {
    const importados = new Set(importadoresDeCasosDeUso(RAIZ_DEL_REPO).keys());
    expect(descubrirCasosDeUsoReales().filter((c) => !importados.has(`src/${c.ruta}`)).map((c) => c.ruta)).toEqual([]);
  });

  it("resuelve imports con alias y relativos, con o sin extensión", () => {
    const candidatos = new Set(["src/server/actions/carta/casos-de-uso/a.ts", "src/server/actions/catalogo/casos-de-uso/b.ts"]);
    expect(resolver("src/server/actions/carta/x.ts", "./casos-de-uso/a", candidatos)).toBe("src/server/actions/carta/casos-de-uso/a.ts");
    expect(resolver("src/server/actions/carta/x.ts", "@/server/actions/catalogo/casos-de-uso/b", candidatos)).toBe("src/server/actions/catalogo/casos-de-uso/b.ts");
    expect(resolver("src/server/actions/carta/x.ts", "../catalogo/casos-de-uso/b.ts", candidatos)).toBe("src/server/actions/catalogo/casos-de-uso/b.ts");
    expect(resolver("src/server/actions/carta/x.ts", "zod", candidatos)).toBeNull();
  });
});

probarCerco(CERCO_CASOS_DE_USO_EN_GUARDIANES);
