import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import extractDepcruiseOptions from "dependency-cruiser/config-utl/extract-depcruise-options";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";

/**
 * Ningún componente de cliente (`"use client"`) ALCANZA —ni directa ni transitivamente— un módulo de servidor que NO lleva `import "server-only"` (reserva M2 de la auditoría independiente del Hito 5,
 * fila 5.6 de `docs/pureza-integracion.md`). `server-only` es la red del BUILD: si un componente de cliente llega a un módulo que la lleva, el build falla. Un puñado de módulos NO la lleva a propósito,
 * porque los cargan fixtures de Playwright o scripts con `tsx` que no corren con la condición `react-server` (donde el paquete tira al importarse). Ninguna regla impedía hoy que un `"use client"` los
 * importara: el riesgo práctico es casi nulo (solo tipos de Prisma, la base entra por parámetro, sin secretos ni sesión), pero la defensa tiene que ser MECÁNICA, no la memoria de quien escribe el import.
 *
 * Cómo: el conjunto de módulos sin `server-only` es CERRADO y está declarado acá (`SIN_SERVER_ONLY`, cada uno con el motivo), verificado en las dos direcciones contra los archivos reales (todo archivo sin
 * la marca de `server/acceso/` y `server/auditoria/` está en la lista; todo archivo de la lista existe y de verdad no la lleva). Los módulos de cliente se detectan por AST (`"use client"` como PRIMERA
 * sentencia: un comentario no cuenta) y el alcance sale del grafo REAL de dependency-cruiser (`cruise()` con las mismas opciones que el CLI, igual que `dependencias.test.ts`): imports, reexports e imports
 * dinámicos. Un `import type` no cuenta (se borra al compilar: no hay camino en ejecución) y un módulo `"use server"` es FRONTERA (el cliente recibe la referencia a la acción, no sus imports: así los
 * componentes que llaman Server Actions no arrastran, por su caso de uso, la transacción ni la auditoría). Lo que la regla NO cubre, a propósito: los otros módulos sin `server-only` de `server/consultas` y
 * `server/lecturas` (lista aparte, `server-only-en-consultas-y-lecturas.test.ts`) y `plataforma/src` (otra aplicación; la regla `plataforma-solo-puro` de dependency-cruiser le cierra `src/server`).
 */
const RAIZ = join(__dirname, "../..");

/** Los módulos de servidor SIN `import "server-only"` y por qué. Cerrado: agregar uno es una decisión de arquitectura; una entrada que ya lleva la marca (o ya no existe) se saca. */
const SIN_SERVER_ONLY: Record<string, string> = {
  "src/server/acceso/capacidades-sucursal.ts": "la carta pública llega hasta acá (lecturas/carta/menu → precioLocalActivoEn → sucursalTieneCapacidad) y la cargan fixtures de Playwright y scripts con tsx",
  "src/server/auditoria/registrar-cambio-auditado.ts": "lo cargan scripts/modulos-empresa.ts y scripts/politica-empresa.ts (tsx) vía las operaciones de plataforma",
  "src/server/lecturas/catalogo/precio-local.ts": "test/e2e/fixtures/carta-menu.ts (la carta pública lo alcanza)",
  "src/lib/transaccion-serializable.ts": "infraestructura transversal de los casos de uso, que cargan tests y scripts con tsx fuera de Next",
};
/** Las carpetas cuyos archivos sin `server-only` tiene que declarar la lista (la dirección «archivo real → lista»). */
const CARPETAS_VERIFICADAS = ["src/server/acceso", "src/server/auditoria"];

/** ¿El código abre con esa directiva (primera sentencia)? Un comentario con ese texto no cuenta. */
function abreConDirectiva(codigo: string, directiva: "use client" | "use server"): boolean {
  const primera = ts.createSourceFile("x.tsx", codigo, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX).statements[0];
  return !!primera && ts.isExpressionStatement(primera) && ts.isStringLiteral(primera.expression) && primera.expression.text === directiva;
}
const esDeCliente = (codigo: string) => abreConDirectiva(codigo, "use client");
const esServerAction = (codigo: string) => abreConDirectiva(codigo, "use server");

/** ¿La PRIMERA sentencia es exactamente `import "server-only";`? */
function abreConServerOnly(codigo: string): boolean {
  const primera = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, false).statements[0];
  return !!primera && ts.isImportDeclaration(primera) && primera.importClause === undefined && ts.isStringLiteral(primera.moduleSpecifier) && primera.moduleSpecifier.text === "server-only";
}

interface ModuloDelGrafo {
  source: string;
  dependencies: { resolved: string; soloTipo: boolean }[];
}

/**
 * Por cada módulo de cliente que alcanza (por imports de valor, transitivos) algún `objetivo`: la cadena de archivos desde el cliente hasta el primer objetivo que encuentra.
 * Un módulo `"use server"` es FRONTERA: un cliente que lo importa recibe una referencia a la acción, no el módulo (Next no lleva sus imports al navegador), así que el recorrido no sigue por dentro.
 */
function clientesQueAlcanzan(grafo: readonly ModuloDelGrafo[], esCliente: (ruta: string) => boolean, objetivos: ReadonlySet<string>, esFrontera: (ruta: string) => boolean = () => false): string[] {
  const porRuta = new Map(grafo.map((m) => [m.source, m]));
  const hallazgos: string[] = [];
  for (const cliente of grafo.map((m) => m.source).filter(esCliente).sort()) {
    const padre = new Map<string, string | null>([[cliente, null]]);
    const pendientes = [cliente];
    let hallado: string | undefined;
    while (pendientes.length && hallado === undefined) {
      const actual = pendientes.shift()!;
      for (const d of porRuta.get(actual)?.dependencies ?? []) {
        if (d.soloTipo || padre.has(d.resolved)) continue;
        padre.set(d.resolved, actual);
        if (objetivos.has(d.resolved)) {
          hallado = d.resolved;
          break;
        }
        if (!esFrontera(d.resolved)) pendientes.push(d.resolved);
      }
    }
    if (hallado !== undefined) {
      const cadena: string[] = [];
      for (let r: string | null | undefined = hallado; r; r = padre.get(r)) cadena.unshift(r);
      hallazgos.push(cadena.join(" -> "));
    }
  }
  return hallazgos;
}

describe("el detector de «use client» y el de server-only ven la primera sentencia", () => {
  it("«use client» como directiva sí; un comentario, otra sentencia o un texto parecido no", () => {
    expect(esDeCliente('"use client";\nimport x from "y";')).toBe(true);
    expect(esDeCliente("'use client'\nexport const a = 1;")).toBe(true);
    expect(esDeCliente('// "use client"\nexport const a = 1;')).toBe(false);
    expect(esDeCliente('import x from "y";\n"use client";')).toBe(false);
    expect(esDeCliente('"use server";\nexport const a = 1;')).toBe(false);
    expect(esServerAction('"use server";\nexport async function f() {}')).toBe(true);
    expect(esServerAction('"use client";\nexport const a = 1;')).toBe(false);
  });

  it("server-only: solo `import \"server-only\";` como primera sentencia", () => {
    expect(abreConServerOnly('import "server-only";\nexport const a = 1;')).toBe(true);
    expect(abreConServerOnly('// import "server-only";\nexport const a = 1;')).toBe(false);
    expect(abreConServerOnly('export const a = 1;\nimport "server-only";')).toBe(false);
    expect(abreConServerOnly('import { x } from "server-only";')).toBe(false);
  });
});

describe("el alcance desde un componente de cliente (con un grafo sintético)", () => {
  const dep = (resolved: string, soloTipo = false) => ({ resolved, soloTipo });
  const modulo = (source: string, ...dependencies: { resolved: string; soloTipo: boolean }[]): ModuloDelGrafo => ({ source, dependencies });
  const objetivos = new Set(["src/server/sin-marca.ts"]);
  const esCliente = (ruta: string) => ruta.startsWith("src/components/");

  it("un import directo al módulo sin server-only se marca, con la cadena", () => {
    const grafo = [modulo("src/components/a.tsx", dep("src/server/sin-marca.ts")), modulo("src/server/sin-marca.ts")];
    expect(clientesQueAlcanzan(grafo, esCliente, objetivos)).toEqual(["src/components/a.tsx -> src/server/sin-marca.ts"]);
  });

  it("un import transitivo (por un intermedio que no es de cliente) se marca", () => {
    const grafo = [modulo("src/components/a.tsx", dep("src/lib/x.ts")), modulo("src/lib/x.ts", dep("src/lib/y.ts")), modulo("src/lib/y.ts", dep("src/server/sin-marca.ts")), modulo("src/server/sin-marca.ts")];
    expect(clientesQueAlcanzan(grafo, esCliente, objetivos)).toEqual(["src/components/a.tsx -> src/lib/x.ts -> src/lib/y.ts -> src/server/sin-marca.ts"]);
  });

  it("un `import type` (se borra al compilar), un cliente que no llega y un servidor que nadie de cliente importa no se marcan", () => {
    const grafo = [
      modulo("src/components/tipos.tsx", dep("src/server/sin-marca.ts", true)),
      modulo("src/components/otro.tsx", dep("src/lib/x.ts")),
      modulo("src/lib/x.ts"),
      modulo("src/app/pagina.tsx", dep("src/server/sin-marca.ts")),
      modulo("src/server/sin-marca.ts"),
    ];
    expect(clientesQueAlcanzan(grafo, esCliente, objetivos)).toEqual([]);
  });

  it("un módulo «use server» es frontera: el cliente recibe la referencia a la acción y el recorrido no sigue por dentro (pero sí si el cliente llega al objetivo por otro lado)", () => {
    const grafo = [
      modulo("src/components/a.tsx", dep("src/server/actions/accion.ts")),
      modulo("src/server/actions/accion.ts", dep("src/server/sin-marca.ts")),
      modulo("src/components/b.tsx", dep("src/server/actions/accion.ts"), dep("src/server/sin-marca.ts")),
      modulo("src/server/sin-marca.ts"),
    ];
    const frontera = (ruta: string) => ruta === "src/server/actions/accion.ts";
    expect(clientesQueAlcanzan(grafo, esCliente, objetivos, frontera)).toEqual(["src/components/b.tsx -> src/server/sin-marca.ts"]);
    expect(clientesQueAlcanzan(grafo, esCliente, objetivos)).toHaveLength(2); // sin la frontera, los dos se marcarían
  });

  it("un ciclo no cuelga el cálculo", () => {
    const grafo = [modulo("src/components/a.tsx", dep("src/lib/x.ts")), modulo("src/lib/x.ts", dep("src/lib/y.ts")), modulo("src/lib/y.ts", dep("src/lib/x.ts"))];
    expect(clientesQueAlcanzan(grafo, esCliente, objetivos)).toEqual([]);
  });
});

describe("SIN_SERVER_ONLY es el conjunto real de módulos sin server-only (en las dos direcciones)", () => {
  const lee = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

  it("toda entrada existe y de verdad NO lleva `import \"server-only\"` (si ya la lleva, se saca de la lista)", () => {
    const sobran = Object.keys(SIN_SERVER_ONLY).filter((ruta) => abreConServerOnly(lee(ruta)));
    expect(sobran, `Estas entradas ya llevan server-only: sacalas de SIN_SERVER_ONLY:\n${sobran.join("\n")}`).toEqual([]);
  });

  it("todo archivo sin server-only de server/acceso y server/auditoria figura en la lista (un archivo nuevo sin la marca tiene que declararse con su motivo)", () => {
    const sinMarca = CARPETAS_VERIFICADAS.flatMap((carpeta) =>
      readdirSync(join(RAIZ, carpeta))
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => `${carpeta}/${f}`)
        .filter((ruta) => !abreConServerOnly(lee(ruta)))
    );
    const sinDeclarar = sinMarca.filter((ruta) => !(ruta in SIN_SERVER_ONLY));
    expect(sinDeclarar, `Estos archivos no llevan server-only y no están en SIN_SERVER_ONLY:\n${sinDeclarar.join("\n")}`).toEqual([]);
    // La otra dirección, para las carpetas verificadas: una entrada de esas carpetas cuyo archivo no existe ya falla arriba (lee() tira); acá, que las dos carpetas aporten lo que la lista dice.
    const enLista = Object.keys(SIN_SERVER_ONLY).filter((ruta) => CARPETAS_VERIFICADAS.some((c) => ruta.startsWith(`${c}/`))).sort();
    expect(sinMarca.sort()).toEqual(enLista);
  });
});

describe("ningún componente de cliente alcanza un módulo de servidor sin server-only", () => {
  let grafo: ModuloDelGrafo[] = [];

  beforeAll(async () => {
    const opciones = await extractDepcruiseOptions(join(RAIZ, ".dependency-cruiser.cjs"));
    const resultado = await cruise(["src"], opciones, {}, { tsConfig: extractTSConfig(join(RAIZ, "tsconfig.json")) });
    grafo = (resultado.output as ICruiseResult).modules.map((m) => ({
      source: m.source,
      dependencies: m.dependencies.map((d) => ({ resolved: d.resolved, soloTipo: d.dependencyTypes.includes("type-only") })),
    }));
  }, 120_000);

  const cache = new Map<string, { cliente: boolean; serverAction: boolean }>();
  const directivasDe = (ruta: string) => {
    if (!cache.has(ruta)) {
      const codigo = /^src\/.*\.tsx?$/.test(ruta) ? readFileSync(join(RAIZ, ruta), "utf8") : "";
      cache.set(ruta, { cliente: esDeCliente(codigo), serverAction: esServerAction(codigo) });
    }
    return cache.get(ruta)!;
  };
  const esClienteReal = (ruta: string) => directivasDe(ruta).cliente;
  const esFronteraReal = (ruta: string) => directivasDe(ruta).serverAction;

  it("el grafo ve los módulos de la lista y hay componentes de cliente (si no, la regla pasaría en vacío)", () => {
    const rutas = new Set(grafo.map((m) => m.source));
    const ausentes = Object.keys(SIN_SERVER_ONLY).filter((r) => !rutas.has(r));
    expect(ausentes, `El grafo de dependency-cruiser no incluye estos módulos de SIN_SERVER_ONLY:\n${ausentes.join("\n")}`).toEqual([]);
    expect(grafo.filter((m) => esClienteReal(m.source)).length).toBeGreaterThan(50);
  });

  it("ninguno, ni directa ni transitivamente (con la cadena de imports para corregirlo)", () => {
    const hallazgos = clientesQueAlcanzan(grafo, esClienteReal, new Set(Object.keys(SIN_SERVER_ONLY)), esFronteraReal);
    expect(hallazgos, `Un componente de cliente no puede alcanzar un módulo sin server-only (la base y el servidor no viajan al navegador):\n${hallazgos.join("\n")}`).toEqual([]);
  });
});
