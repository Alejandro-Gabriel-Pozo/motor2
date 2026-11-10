import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { arbolDe, medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «número mostrado sin la función central» (regla del dueño, 2026-11-09; diseño en `docs/diseno-formato-de-numero-salida-2026-11-09.md`): todo número que se le muestra a una
 * persona sale de `src/core/formato-de-numero.ts` («1.000,00»: punto de miles, coma decimal, dinero con 2 decimales, unidad pegada). Cuenta, por archivo y por tipo, las formas de
 * mostrar un número que NO pasan por ahí, en `src/` y en la consola (`plataforma/src/`), mirando el AST (un comentario o un string no cuentan):
 *  - `to-locale-string`: `x.toLocaleString(...)` que no es de una fecha (las opciones no nombran `timeZone`, `dateStyle`, `timeStyle`, `hour`, `weekday`, `month`, `year` ni `day`, y el receptor no se llama `fecha`/`hora`/`date`: heurística de nombres, el tipo no se ve en el AST);
 *  - `to-fixed`: `x.toFixed(...)`;
 *  - `intl-number-format`: `new Intl.NumberFormat(...)`;
 *  - `number-pelado`: `Number(x)` puesto tal cual en un hijo de JSX (`{Number(ing.cantidad)}`) o en una interpolación de plantilla (`${Number(p.precio)}`);
 *  - `signo-pesos-pelado`: una interpolación de plantilla pegada a un «$» escrito a mano: dinero mostrado sin `formatearMonto` (cierre del 2026-11-10: 0, y debe seguir en 0).
 * Lo que NO mide (límite declarado): un número que ya viene como `number` y se imprime tal cual (`{a.saldoActual}`: el AST no ve el tipo) y los enteros sueltos (versión, orden, conteos
 * de filas). Esos los cubre la revisión y el inventario del diseño, no este cerco. Las fechas no son de este cerco.
 * Meta: 0 (cada pantalla pasa a `formatearMonto` / `formatearCantidad` / `formatearCantidadConUnidad` / `formatearEntero` / `formatearPorcentaje`). La línea de base solo baja con cada etapa.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const OPCIONES_DE_FECHA = /\b(?:timeZone|dateStyle|timeStyle|hour|weekday|month|year|day)\b/;
const RECEPTOR_DE_FECHA = /fecha|hora|date/i;

function esNumberDeUnaExpresion(e: ts.Expression): boolean {
  const interna = ts.isParenthesizedExpression(e) ? e.expression : e;
  return ts.isCallExpression(interna) && ts.isIdentifier(interna.expression) && interna.expression.text === "Number";
}

export function contarNumerosSinFormatoCentral(fuente: string, ruta: string): Record<string, number> {
  const cuenta: Record<string, number> = { "to-locale-string": 0, "to-fixed": 0, "intl-number-format": 0, "number-pelado": 0, "signo-pesos-pelado": 0 };
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression)) {
      const metodo = nodo.expression.name.text;
      if (metodo === "toLocaleString" && !RECEPTOR_DE_FECHA.test(nodo.expression.expression.getText()) && !nodo.arguments.some((a) => OPCIONES_DE_FECHA.test(a.getText()))) cuenta["to-locale-string"]++;
      if (metodo === "toFixed") cuenta["to-fixed"]++;
    }
    if (ts.isNewExpression(nodo) && nodo.expression.getText() === "Intl.NumberFormat") cuenta["intl-number-format"]++;
    if (ts.isJsxExpression(nodo) && nodo.expression && (ts.isJsxElement(nodo.parent) || ts.isJsxFragment(nodo.parent)) && esNumberDeUnaExpresion(nodo.expression)) cuenta["number-pelado"]++;
    if (ts.isTemplateSpan(nodo) && esNumberDeUnaExpresion(nodo.expression)) cuenta["number-pelado"]++;
    // Un «$» escrito a mano delante de una interpolación de plantilla: dinero mostrado sin `formatearMonto` (regla del dueño, 2026-11-10).
    if (ts.isTemplateSpan(nodo) && ts.isTemplateExpression(nodo.parent)) {
      const spans = nodo.parent.templateSpans;
      const i = spans.indexOf(nodo);
      const previo = i === 0 ? nodo.parent.head.text : spans[i - 1]!.literal.text;
      if (previo.endsWith("$")) cuenta["signo-pesos-pelado"]++;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbolDe(fuente, ruta));
  return cuenta;
}

/**
 * CIERRE DEL DINERO (decisión del dueño, 2026-11-10: «si es dinero no puede quedar como deuda»; clasificación en `docs/diseno-dinero-mostrado-2026-11-10.md`).
 * La línea de base ya no puede contener dinero mostrado: cada archivo que queda es uno de estos, con su motivo. Un archivo nuevo en la línea de base que no esté acá
 * hace fallar el test: tiene que migrarse a `core/formato-de-numero.ts` o declararse con motivo.
 */
export const RESTANTES_DECLARADOS_NO_DINERO: Record<string, string> = {
  "src/core/datos/campo-numero-logica.ts": "ENTRADA (lo que se TECLEA; dueña: sesión E-N entrada). No es salida.",
  "src/core/opciones/componer-precio-de-linea.ts": "Validación interna: compara el factor de escala redondeado a 4 decimales; no se muestra.",
  "src/core/opciones/factor-de-escala.ts": "Un FACTOR (1,3 = 30 % más), no dinero.",
  "src/core/opciones/huella-de-opciones.ts": "Cálculo interno: huella canónica (hash) de opciones; nunca se muestra.",
  "src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor.ts": "Cálculo interno: redondeo a 4 decimales del precio por unidad de stock antes de guardarlo; no se muestra.",
  "src/server/actions/auth/casos-de-uso/actualizar-activo-sucursal.ts": "CANTIDAD de stock en un mensaje de bloqueo («3 kg de X»): no es dinero; vence con la deuda general de cantidades.",
  "src/server/actions/catalogo/casos-de-uso/actualizar-decimales-unidad.ts": "CANTIDAD (paso de venta) en un mensaje: no es dinero; vence con la deuda general de cantidades.",
};

const CERCO_NUMERO_SIN_FORMATO_CENTRAL: Cerco = {
  regla: "numero-sin-formato-central",
  meta: "0 (cada pantalla muestra sus números con core/formato-de-numero.ts: «1.000,00», dinero con 2 decimales, unidad pegada); baja con cada etapa",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src"], extensiones: [".ts", ".tsx"], incluir: (ruta) => ruta !== "src/core/formato-de-numero.ts", contar: contarNumerosSinFormatoCentral }),
  excepciones: [
    { ruta: "src/core/catalogo/lectura-de-cantidad.ts", motivo: "Lectura en vivo de lo que se TECLEA (lado de entrada, dueña: la sesión «E-N entrada»): sin separador de miles a propósito («1.205» en kilos es ambiguo y no se adivina). No es un número de salida." },
  ],
};

describe("cerco «número sin formato central»: el detector", () => {
  it("cuenta toLocaleString de un número, toFixed, Intl.NumberFormat y Number(x) pelado en JSX o en una plantilla", () => {
    const fuente = [
      "export const F = ({ a, ing }: { a: number; ing: { cantidad: string } }) => (",
      "  <p>",
      '    {a.toLocaleString("es-AR")} {a.toFixed(2)} {Number(ing.cantidad)} {`x ${Number(a)}`}',
      "  </p>",
      ");",
      'export const G = new Intl.NumberFormat("es-AR");',
    ].join("\n");
    expect(contarNumerosSinFormatoCentral(fuente, "x.tsx")).toEqual({ "to-locale-string": 1, "to-fixed": 1, "intl-number-format": 1, "number-pelado": 2, "signo-pesos-pelado": 0 });
  });

  it("no cuenta las fechas (por opciones o por el nombre del receptor), los números ya formateados, los comentarios ni los strings", () => {
    const fuente = [
      "export const F = ({ d, n }: { d: Date; n: number }) => (",
      "  <p>",
      '    {d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit" })} {formatearMonto(n)} {n}',
      '    {/* {n.toFixed(2)} */} {"n.toFixed(2)"}',
      "  </p>",
      ");",
    ].join("\n");
    expect(contarNumerosSinFormatoCentral(fuente, "x.tsx")).toEqual({ "to-locale-string": 0, "to-fixed": 0, "intl-number-format": 0, "number-pelado": 0, "signo-pesos-pelado": 0 });
  });
});

describe("cierre del dinero mostrado: lo que queda en la línea de base no es dinero", () => {
  it("cada archivo con usos sin formato central está declarado como no-dinero, con su motivo", () => {
    const base = JSON.parse(readFileSync("test/arquitectura/cercos/linea-de-base/numero-sin-formato-central.json", "utf8")) as { cuentas: Record<string, Record<string, number>> };
    const sinDeclarar = Object.keys(base.cuentas).filter((ruta) => !(ruta in RESTANTES_DECLARADOS_NO_DINERO));
    expect(sinDeclarar, "dinero mostrado fuera de formato-de-numero.ts (migrarlo a formatearMonto) o archivo sin declarar").toEqual([]);
    expect(Object.values(base.cuentas).every((c) => !c["signo-pesos-pelado"]), "signo pesos pelado: usar formatearMonto").toBe(true);
  });

  it("el detector cuenta un «$» escrito a mano delante de una interpolación", () => {
    expect(contarNumerosSinFormatoCentral("export const m = (n: number) => `Faltan $${n} y ${n}`;", "x.ts")["signo-pesos-pelado"]).toBe(1);
  });
});

probarCerco(CERCO_NUMERO_SIN_FORMATO_CENTRAL);
