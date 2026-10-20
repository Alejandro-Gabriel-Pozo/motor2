import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import ts from "typescript";
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
      // GO-2b: `node:crypto` en el navegador es `crypto-browserify`, que al cargarse prueba `Function("…")`: la CSP sin `unsafe-eval` lo bloquea en cada pantalla
      // (`test/e2e/csp-sin-violaciones.spec.ts`). Lo que lo usa va en `public-servidor.ts`.
      senales.importsDeValor.some((m) => m === "node:crypto" || m === "crypto") && "usa node:crypto (en el cliente, crypto-browserify y su eval)",
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

  it("ninguna alcanza Prisma, una lectura/escritura de base, red, disco, servidor, React o node:crypto (lo que toca la base o el hash va en public-servidor.ts)", () => {
    const hallazgos = fachadas.flatMap(hallazgosDe).map((h) => `${h.fachada}: ${h.archivo} ${h.motivo} — llega por ${h.via}`);
    expect(hallazgos).toEqual([]);
  });
});

/**
 * Ola «precio y carta», Fase 2, C4: `core/pos/opcion-para-precio.ts` es la ÚNICA función del precio de una opción, para la venta (`linea-configurada.ts`) y para la vista
 * previa del cliente (`precio-de-configuracion.ts`). De `linea-configurada.ts` (que arrastra `node:crypto`) no puede importar VALORES: ni un import de valor, ni uno de
 * efecto, ni un `import { X }` sin `type` (que se borra al compilar solo mientras X se use como tipo); a lo sumo `import type` (hoy ni eso: `linea-configurada.ts` lo
 * importa a él y la regla `sin-ciclos` de dependency-cruiser no deja ni un ciclo de solo tipos). La barrida de arriba lo cubre por transitividad; esto lo dice con nombre
 * propio y fija que el archivo siga alcanzado desde `core/pos/public.ts` (si dejara de estarlo, la barrida no lo miraría).
 */
describe("core/pos/opcion-para-precio.ts no importa valores de linea-configurada.ts (C4)", () => {
  const ARCHIVO = join(SRC, "core/pos/opcion-para-precio.ts");
  const LINEA_CONFIGURADA = join(SRC, "core/pos/linea-configurada.ts");

  it("está alcanzado desde core/pos/public.ts por imports de valor (lo mira la barrida C16)", () => {
    const visto = new Set<string>();
    const cola = [join(SRC, "core/pos/public.ts")];
    while (cola.length) {
      const archivo = cola.shift()!;
      if (visto.has(archivo)) continue;
      visto.add(archivo);
      for (const e of analizarFuente(readFileSync(archivo, "utf8"), archivo, DELEGADOS).importsDeValor) {
        const destino = resolverImport(archivo, e);
        if (destino) cola.push(destino);
      }
    }
    expect(visto.has(ARCHIVO)).toBe(true);
  });

  it("cada import o reexport que apunta a linea-configurada.ts es `import type` / `export type`", () => {
    const fuente = ts.createSourceFile(ARCHIVO, readFileSync(ARCHIVO, "utf8"), ts.ScriptTarget.Latest, true);
    const deValor: string[] = [];
    for (const sentencia of fuente.statements) {
      const esImport = ts.isImportDeclaration(sentencia);
      if (!esImport && !ts.isExportDeclaration(sentencia)) continue;
      const especificador = sentencia.moduleSpecifier;
      if (!especificador || !ts.isStringLiteral(especificador) || resolverImport(ARCHIVO, especificador.text) !== LINEA_CONFIGURADA) continue;
      const soloTipo = esImport ? sentencia.importClause?.isTypeOnly === true : sentencia.isTypeOnly;
      if (!soloTipo) deValor.push(sentencia.getText(fuente));
    }
    expect(deValor).toEqual([]);
  });
});
