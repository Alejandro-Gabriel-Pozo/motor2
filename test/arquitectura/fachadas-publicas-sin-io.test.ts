import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { analizarFuente, delegadosDeModelos } from "../../scripts/arquitectura/analizar-fuente";

/**
 * Las fachadas `core/<dominio>/public.ts` no hacen entrada/salida, ni directa ni transitivamente (Pureza Fase 2, paso 2.2; regla C16 de la auditoría).
 *
 * `public.ts` es la que importan los módulos que terminan en el bundle del cliente; lo que toca la base va en `public-servidor.ts`. La regla
 * `publico-puro` de dependency-cruiser solo ve el acceso a `src/lib/db`; no ve una función que recibe la base POR PARÁMETRO y le hace consultas (así
 * se coló `recetas-vigentes` en `catalogo/public.ts`: «PURA» en su comentario, ocho consultas en runtime). Acá se mira el CÓDIGO: se recorre todo lo que
 * alcanza cada `public.ts` por imports de valor y se exige que ningún archivo lea o escriba la base, importe el cliente, use red o disco, ni dependa de
 * servidor o de React/Next.
 *
 * También se exige que no llegue al runtime de Prisma (C15): una fachada pública que lo arrastra lo lleva al bundle del cliente. Los imports de solo tipo no
 * cuentan: se borran al compilar. El reloj y el azar (P2) los vigila `pureza-del-nucleo.test.ts` archivo por archivo.
 */
const RAIZ = join(__dirname, "../..");
const SRC = join(RAIZ, "src");
const DELEGADOS = delegadosDeModelos(readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8"));

function fachadasPublicas(): string[] {
  const core = join(SRC, "core");
  return readdirSync(core)
    .filter((d) => statSync(join(core, d)).isDirectory())
    .map((d) => join(core, d, "public.ts"))
    .filter((f) => existsSync(f));
}

/** `./x`, `../x` o `@/x` → archivo `.ts`/`.tsx`/`index` dentro de `src/`; `null` si es un paquete o no existe. */
function resolverImport(desde: string, especificador: string): string | null {
  const base = especificador.startsWith("@/") ? join(SRC, especificador.slice(2)) : especificador.startsWith(".") ? resolve(dirname(desde), especificador) : null;
  if (!base) return null;
  for (const candidato of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(candidato) && statSync(candidato).isFile()) return candidato;
  return null;
}

interface Hallazgo {
  fachada: string;
  archivo: string;
  motivo: string;
  via: string;
}

function hallazgosDe(fachada: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const visto = new Set<string>([fachada]);
  const cola: Array<{ archivo: string; via: string }> = [{ archivo: fachada, via: "" }];
  const corto = (f: string) => relative(SRC, f).split(sep).join("/");
  while (cola.length) {
    const { archivo, via } = cola.shift()!;
    const senales = analizarFuente(readFileSync(archivo, "utf8"), archivo, DELEGADOS);
    const motivos = [
      senales.prismaDeValor && "importa el runtime de Prisma (C15)",
      senales.leeLaBase && "lee la base",
      senales.escribeEnLaBase && "escribe en la base",
      senales.importaCliente && "importa el cliente de base",
      senales.red && "usa la red",
      senales.disco && "usa el disco",
      senales.serverOnly && "es solo de servidor",
      senales.reactONext && "depende de React/Next",
    ].filter(Boolean) as string[];
    for (const motivo of motivos) hallazgos.push({ fachada: corto(fachada), archivo: corto(archivo), motivo, via: via || "(directo)" });
    for (const especificador of senales.importsDeValor) {
      const destino = resolverImport(archivo, especificador);
      if (destino && !visto.has(destino)) {
        visto.add(destino);
        cola.push({ archivo: destino, via: via ? `${via} → ${corto(destino)}` : corto(destino) });
      }
    }
  }
  return hallazgos;
}

describe("las fachadas public.ts no hacen entrada/salida (C16)", () => {
  const fachadas = fachadasPublicas();

  it("se encuentran las fachadas (si no, el test no mira nada)", () => {
    expect(fachadas.length).toBeGreaterThanOrEqual(8);
  });

  it("ninguna alcanza Prisma, una lectura/escritura de base, red, disco, servidor o React (lo que toca la base va en public-servidor.ts)", () => {
    const hallazgos = fachadas.flatMap(hallazgosDe).map((h) => `${h.fachada}: ${h.archivo} ${h.motivo} — llega por ${h.via}`);
    expect(hallazgos).toEqual([]);
  });
});
