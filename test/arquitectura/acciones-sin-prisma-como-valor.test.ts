import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { analizarFuente, delegadosDeModelos } from "../../scripts/arquitectura/analizar-fuente";

/**
 * Ninguna Server Action ni caso de uso importa `Prisma` (o `PrismaClient`) como VALOR de `@prisma/client` (Fase 4 del plan de pureza, auditoría de la Fase 1: el hallazgo C12 «cdu-sin-prisma-runtime»).
 *
 * Por qué importa: los errores de la base se reconocen POR FORMA (`core/datos/errores-de-base.ts`, `esChoqueDeIndiceUnico`, `esConflictoDeEscritura`). Reconocerlos con
 * `e instanceof Prisma.PrismaClientKnownRequestError` falla con el adaptador `pg` (el mismo choque de unicidad puede llegar como un `DriverAdapterError` crudo): en
 * `registrar-conteo-fisico` y `registrar-pago-consignante` eso dejaba sin entrar a la rama de idempotencia I3 al perdedor de una carrera, que terminaba en un error genérico. Sin la clase de
 * Prisma a mano como valor no hay con qué escribir esa comparación, y los tipos (`import type`) siguen siendo libres.
 *
 * Lista de excepciones: vacía. Una entrada nueva exige el motivo; la lista se revisa en las dos direcciones (una excepción que ya no hace falta falla).
 */
const RAIZ = join(__dirname, "..", "..");
const EXCEPCIONES: Record<string, string> = {};

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    return e.isDirectory() ? archivos(ruta) : /\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

const delegados = delegadosDeModelos(readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8"));
const conPrismaDeValor = (codigo: string, ruta = "x.ts") => analizarFuente(codigo, ruta, delegados).prismaDeValor;

describe("el analizador distingue Prisma como valor de Prisma como tipo", () => {
  it("un import de valor (o uso en ejecución) cuenta; `import type` y los tipos, no", () => {
    expect(conPrismaDeValor('import { Prisma } from "@prisma/client";\nexport const f = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError;')).toBe(true);
    expect(conPrismaDeValor('import { Prisma } from "@prisma/client";\nexport const f = (x: Prisma.Decimal) => x;')).toBe(false); // solo en posición de tipo
    expect(conPrismaDeValor('import type { Prisma } from "@prisma/client";\nexport const f = (x: Prisma.Decimal) => x;')).toBe(false);
    expect(conPrismaDeValor('import { type Prisma, PrismaClient } from "@prisma/client";\nexport const c = new PrismaClient();')).toBe(true);
  });
});

describe("las Server Actions y los casos de uso no importan Prisma como valor", () => {
  const dir = join(RAIZ, "src", "server", "actions");
  const todos = archivos(dir).map((f) => relative(RAIZ, f).split(sep).join("/"));

  it("encuentra las acciones (si no, la regla está vacía)", () => {
    expect(todos.length).toBeGreaterThan(50);
  });

  it("ninguna lo hace, salvo las excepciones declaradas con motivo", () => {
    const infractores = todos.filter((ruta) => conPrismaDeValor(readFileSync(join(RAIZ, ruta), "utf8"), ruta) && !(ruta in EXCEPCIONES));
    expect(
      infractores,
      `Importan Prisma como valor (reconocé los errores de la base por forma con \`esChoqueDeIndiceUnico\`/\`esConflictoDeEscritura\` de core/movimientos/public-servidor, o usá \`import type\`):\n${infractores.join("\n")}`,
    ).toEqual([]);
  });

  it("la lista de excepciones no tiene entradas que ya no hagan falta", () => {
    const sobran = Object.keys(EXCEPCIONES).filter((ruta) => !todos.includes(ruta) || !conPrismaDeValor(readFileSync(join(RAIZ, ruta), "utf8"), ruta));
    expect(sobran).toEqual([]);
  });
});
