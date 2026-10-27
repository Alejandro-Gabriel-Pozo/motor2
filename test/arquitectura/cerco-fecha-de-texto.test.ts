import ts from "typescript";
import { describe, expect, it } from "vitest";
import { arbolDe, medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «fecha armada a mano desde un texto» (lote 6.33, «tipos de dato declarados y bloqueantes»): un día que escribe una persona (un campo de fecha, `?desde=` y `?hasta=` de la URL) se lee con `src/core/tiempo`
 * (`esDiaISOReal`: rechaza el `2026-02-30` que `new Date` corre al 2 de marzo; `inicioDelDia`/`rangoDeDias`: el corte de día en la hora argentina) y nunca con `new Date(texto)`, que acepta cualquier cosa que el motor
 * sepa leer, interpreta «2026-03-01» como medianoche UTC (las 21:00 del día anterior en Argentina) y corre las fechas que no existen. Cuenta, por archivo, los `new Date(x)` de UN argumento que es un nombre o una
 * propiedad con pinta de texto de fecha (`desde`, `hasta`, `desdeStr`, `hastaStr`, `fecha`, `valor`, `texto`, `dia`, `lote…`, `vencimiento`, o algo de `searchParams`/`sp`/`formData`) FUERA de `src/core/tiempo/`, en `src/` y en
 * `plataforma/src/`. Es una heurística de nombres a propósito (el tipo del argumento no se ve en el AST): lo que cuenta de más se exceptúa con motivo, lo que se escapa lo agarra la revisión. Mira el AST: un comentario o
 * un string no cuentan, ni `new Date()` sin argumento, ni con un número o una cuenta (`new Date(ahora.getTime() - n)`), ni una plantilla (`new Date(\`${dia}T00:00:00Z\`)`).
 * Meta: 0 (cada una pasa a `core/tiempo`). Hoy es deuda declarada, con su motivo por archivo.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const NOMBRE_DE_TEXTO_DE_FECHA = /^(?:desde|hasta|desdeStr|hastaStr|fecha|valor|texto|dia|loteOrigen|loteVencimiento|vencimiento)$/i;
const ORIGEN_DE_TEXTO = /^(?:sp|searchParams|formData|fd)$/;

function esTextoDeFecha(arg: ts.Expression): boolean {
  if (ts.isIdentifier(arg)) return NOMBRE_DE_TEXTO_DE_FECHA.test(arg.text);
  if (ts.isPropertyAccessExpression(arg)) {
    const origen = ts.isIdentifier(arg.expression) ? arg.expression.text : "";
    return ORIGEN_DE_TEXTO.test(origen) || NOMBRE_DE_TEXTO_DE_FECHA.test(arg.name.text);
  }
  if (ts.isElementAccessExpression(arg)) return ts.isIdentifier(arg.expression) && ORIGEN_DE_TEXTO.test(arg.expression.text);
  return false;
}

function contarFechasDeTexto(fuente: string, ruta: string): Record<string, number> {
  const cuenta: Record<string, number> = { "fecha-de-texto": 0 };
  const visitar = (nodo: ts.Node): void => {
    if (ts.isNewExpression(nodo) && ts.isIdentifier(nodo.expression) && nodo.expression.text === "Date" && nodo.arguments?.length === 1 && esTextoDeFecha(nodo.arguments[0])) cuenta["fecha-de-texto"]++;
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbolDe(fuente, ruta));
  return cuenta;
}

const CERCO_FECHA_DE_TEXTO: Cerco = {
  regla: "fecha-de-texto-a-mano",
  meta: "0 (lote 6.33: todo día tecleado o de la URL se lee con core/tiempo: esDiaISOReal, inicioDelDia, rangoDeDias)",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src"], extensiones: [".ts", ".tsx"], incluir: (ruta) => !ruta.startsWith("src/core/tiempo/"), contar: contarFechasDeTexto }),
  motivos: {
    "src/core/excel.ts": "Fecha de una celda de una planilla importada: se lee con su propio chequeo del formato (`AAAA-MM-DD` o un instante). Pasa a `esDiaISOReal` / `fechaDeColumnaDate` cuando se unifique la lectura de fechas de las planillas.",
    "src/server/actions/reportes/casos-de-uso/sincronizar-dolar.ts": "El día de una cotización que viene de la API de dólar (`dia.fecha`, `AAAA-MM-DD`), no de una persona: pasa a `fechaDeColumnaDate` (medianoche UTC del día) cuando se unifique con la persistencia.",
    "src/server/persistencia/reportes/cotizacion-dolar.ts": "El día de una cotización (`dia.fecha` y `fechaISO`, `AAAA-MM-DD`) como medianoche UTC: pasa a `fechaDeColumnaDate`.",
  },
};

describe("cerco «fecha de texto a mano»: el detector", () => {
  it("cuenta new Date(x) con un nombre o una propiedad de texto de fecha, de la URL o de un formulario", () => {
    const fuente = [
      "export function f(sp: { desde?: string }, desde: string, o: { fecha: string }, formData: FormData) {",
      "  const a = new Date(desde);",
      "  const b = new Date(sp.desde);",
      "  const c = new Date(o.fecha);",
      '  const d = new Date(sp["hasta"]);',
      "  const e = new Date(hastaStr);",
      "}",
    ].join("\n");
    expect(contarFechasDeTexto(fuente, "x.ts")).toEqual({ "fecha-de-texto": 5 });
  });

  it("no cuenta new Date() sin argumento, con cuentas, números, plantillas, dos argumentos, otros nombres ni un comentario", () => {
    const fuente = [
      "export function f(ahora: Date, n: number, dia: string, ultimoConteo: string) {",
      "  const a = new Date();",
      "  const b = new Date(ahora.getTime() - n);",
      "  const c = new Date(0);",
      "  const d = new Date(`${dia}T00:00:00Z`);",
      "  const e = new Date(2026, 1, 3);",
      "  const g = new Date(ultimoConteo);",
      "  // new Date(desde)",
      "}",
    ].join("\n");
    expect(contarFechasDeTexto(fuente, "x.ts")).toEqual({ "fecha-de-texto": 0 });
  });
});

probarCerco(CERCO_FECHA_DE_TEXTO);
