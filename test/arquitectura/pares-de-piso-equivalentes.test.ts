import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ACCIONES, nivelMinimoDeAccion, type AccionClave, type NivelDeAccion } from "../../src/core/permisos/acciones";
import { nivelAlcanzaElPiso } from "../../src/core/permisos/jerarquia";

/**
 * GT-2 (plan de endurecimiento de seguridad, tanda T5), el tramo «pares de acción equivalente»: cuando DOS caminos llegan al mismo efecto, el piso del camino hermano no puede ser menor
 * que el del principal, y el camino que lo evita tiene que exigir la clave del hermano. Hoy hay un par, el que cerró S-09 (D3, defecto del orquestador, pendiente de confirmar):
 *
 *   `proceso_control` (registrar un Conteo Físico, piso operario)  ⇒  `proceso_ajuste` (registrar un Ajuste, piso administrador)
 *
 * La acción AJUSTAR del conteo (y «ajustar» al resolver un pendiente) escribe en el Kardex la misma corrección que un Ajuste. Si solo se pidiera la clave del conteo, el piso del Ajuste se
 * saltearía por el costado: un operario con `conteo_resolver_pendiente` o `proceso_control` pondría `conteoReal: 0` sobre 60 productos y dejaría la sección en cero. Este guardián exige,
 * por cada par declarado (lista cerrada: un par nuevo se declara acá, con su motivo):
 *  1. que el piso del equivalente sea al menos el declarado (`pisoMinimo`) y al menos el del principal (bajar `proceso_ajuste` a operario → rojo);
 *  2. que cada puerta declarada (una función exportada de una Server Action) llame al ayudante que consulta la clave del equivalente, y que ese ayudante consulte `requierePermiso(…, "<equivalente>", …)`
 *     (sacar la llamada de una puerta, o cambiar la clave del ayudante → rojo).
 * Por AST: un comentario no cuenta.
 */
interface Puerta {
  /** Relativo a la raíz del repo. */
  archivo: string;
  /** Funciones exportadas que aplican el efecto y por eso tienen que pedir la clave del equivalente. */
  funciones: string[];
  /** Función local del mismo archivo que consulta `requierePermiso(…, equivalente, …)`. */
  ayudante: string;
}
interface ParDePiso {
  principal: AccionClave;
  equivalente: AccionClave;
  pisoMinimo: NivelDeAccion;
  motivo: string;
  puertas: Puerta[];
}

const PARES: ParDePiso[] = [
  {
    principal: "proceso_control",
    equivalente: "proceso_ajuste",
    pisoMinimo: "administrador",
    motivo:
      "Aplicar la diferencia de un conteo al stock (AJUSTAR en la grilla, «ajustar» al resolver un pendiente) es un Ajuste: sin la clave de Ajuste, un operario con la clave del conteo vaciaba el stock de la sucursal (S-09).",
    puertas: [
      {
        archivo: "src/server/actions/movimientos/conteo-fisico.ts",
        funciones: ["registrarConteoFisico", "registrarConteosFisicos", "resolverConteoPendiente"],
        ayudante: "puedeAjustar",
      },
    ],
  },
];

const RAIZ = join(__dirname, "../..");

function fuente(codigo: string): ts.SourceFile {
  return ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
}

function funcionNombrada(sf: ts.SourceFile, nombre: string): ts.FunctionDeclaration | null {
  return sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === nombre) ?? null;
}

/** Los nombres que el cuerpo de la función llama como `nombre(...)` (a cualquier profundidad). */
function llamadasDe(nodo: ts.Node): Set<string> {
  const nombres = new Set<string>();
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) nombres.add(n.expression.text);
    ts.forEachChild(n, visitar);
  };
  visitar(nodo);
  return nombres;
}

/** ¿El cuerpo de la función llama a `requierePermiso(…)` con la clave `clave` como literal de texto entre sus argumentos? */
function consultaLaClave(funcion: ts.FunctionDeclaration, clave: string): boolean {
  let encontrado = false;
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "requierePermiso") {
      if (n.arguments.some((a) => ts.isStringLiteralLike(a) && a.text === clave)) encontrado = true;
    }
    ts.forEachChild(n, visitar);
  };
  visitar(funcion);
  return encontrado;
}

/** Problemas de una puerta respecto del par: vacío si todas las funciones piden el ayudante y el ayudante consulta la clave. */
export function problemasDeLaPuerta(codigo: string, puerta: Pick<Puerta, "funciones" | "ayudante">, equivalente: string): string[] {
  const sf = fuente(codigo);
  const problemas: string[] = [];
  const ayudante = funcionNombrada(sf, puerta.ayudante);
  if (!ayudante) problemas.push(`no existe el ayudante «${puerta.ayudante}»`);
  else if (!consultaLaClave(ayudante, equivalente)) problemas.push(`«${puerta.ayudante}» no consulta requierePermiso(…, "${equivalente}", …)`);
  for (const nombre of puerta.funciones) {
    const f = funcionNombrada(sf, nombre);
    if (!f) problemas.push(`no existe la función «${nombre}»`);
    else if (!llamadasDe(f).has(puerta.ayudante)) problemas.push(`«${nombre}» no llama a «${puerta.ayudante}»: aplica el efecto sin la clave "${equivalente}"`);
  }
  return problemas;
}

describe("el detector de puertas ve las llamadas reales (un comentario no cuenta)", () => {
  const puerta = { funciones: ["a"], ayudante: "puede" };
  const bueno = `async function puede(ctx) { return (await requierePermiso(ctx.u, ctx.s, "proceso_ajuste", ctx.db)).ok; }
    export async function a(ctx) { if (!(await puede(ctx))) return 1; return 2; }`;
  it("completa / sin llamar al ayudante / ayudante con otra clave / ayudante ausente / función ausente", () => {
    expect(problemasDeLaPuerta(bueno, puerta, "proceso_ajuste")).toEqual([]);
    expect(problemasDeLaPuerta(bueno.replace("if (!(await puede(ctx))) return 1;", "// puede(ctx)"), puerta, "proceso_ajuste")).toHaveLength(1);
    expect(problemasDeLaPuerta(bueno.replace('"proceso_ajuste"', '"proceso_control"'), puerta, "proceso_ajuste")).toHaveLength(1);
    expect(problemasDeLaPuerta("export async function a() {}", puerta, "proceso_ajuste")).toHaveLength(2);
    expect(problemasDeLaPuerta(bueno, { funciones: ["b"], ayudante: "puede" }, "proceso_ajuste")).toHaveLength(1);
  });
});

describe("pares de acción equivalente (GT-2): el camino hermano no baja el piso", () => {
  const clavesDelCatalogo = new Set<string>(ACCIONES.map((a) => a.clave));

  for (const par of PARES) {
    describe(`${par.principal} ⇒ ${par.equivalente}`, () => {
      it("las dos claves existen en el catálogo", () => {
        expect(clavesDelCatalogo.has(par.principal), par.principal).toBe(true);
        expect(clavesDelCatalogo.has(par.equivalente), par.equivalente).toBe(true);
      });

      it(`el piso del equivalente es al menos «${par.pisoMinimo}» y al menos el del principal`, () => {
        const pisoEquivalente = nivelMinimoDeAccion(par.equivalente);
        expect(nivelAlcanzaElPiso(pisoEquivalente, par.pisoMinimo), `${par.equivalente} bajó a ${pisoEquivalente}: ${par.motivo}`).toBe(true);
        expect(nivelAlcanzaElPiso(pisoEquivalente, nivelMinimoDeAccion(par.principal)), `${par.equivalente} (${pisoEquivalente}) no puede ser menos que ${par.principal}`).toBe(true);
      });

      it.each(par.puertas.map((p) => [p.archivo, p] as const))("%s: cada puerta pide la clave del equivalente", (archivo, puerta) => {
        const codigo = readFileSync(join(RAIZ, archivo), "utf8");
        expect(problemasDeLaPuerta(codigo, puerta, par.equivalente)).toEqual([]);
      });
    });
  }
});
