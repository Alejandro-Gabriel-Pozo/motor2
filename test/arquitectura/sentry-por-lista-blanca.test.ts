import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CABECERAS_PERMITIDAS, limpiarEventoSentry } from "../../src/lib/sentry-limpiar";

/**
 * GT-17 (S-29): lo que sale hacia Sentry sale por LISTA BLANCA y por UN solo limpiador. Tres cosas se fijan acá:
 *  1. Toda inicialización de Sentry (`Sentry.init({ dsn, … })`) está en una lista cerrada de archivos y cablea los TRES ganchos
 *     (`beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb`) con las funciones de `lib/sentry-limpiar`, y mantiene `sendDefaultPii: false`.
 *     Un `init` nuevo sin ganchos (la consola, por ejemplo, cuando S-47 la inicialice) o sin las migas limpias manda a Sentry lo que el
 *     limpiador evita: el fragmento `#t=<token>` de una invitación, la IP, la ruta pedida.
 *  2. Las cabeceras permitidas son exactamente `user-agent` y `content-type`: sumar una exige tocar este test, con su motivo.
 *  3. El limpiador recorta la URL en `?` Y en `#` (el token de la invitación viaja en el fragmento).
 */
const RAIZ = join(__dirname, "../..");
const CARPETAS = ["src", "plataforma/src"];

/** Archivos con un `init` de Sentry y cuántos hay en cada uno (instrumentation.ts: nodejs y edge). Un `init` más, o en otro archivo, es rojo. */
const INITS_ESPERADOS: Record<string, number> = {
  "src/instrumentation-client.ts": 1,
  "src/instrumentation.ts": 2,
};

const GANCHOS: Record<string, string> = {
  beforeSend: "limpiarEventoSentry",
  beforeSendTransaction: "limpiarEventoSentry",
  beforeBreadcrumb: "limpiarMigaSentry",
};

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

type Init = { archivo: string; propiedades: Map<string, string> };

/** Las llamadas `X.init({ dsn, … })` del código: propiedad → texto de su valor. */
function initsDeSentry(codigo: string, archivo: string): Init[] {
  const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inits: Init[] = [];
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "init") {
      const arg = n.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        const propiedades = new Map<string, string>();
        for (const p of arg.properties) {
          if (ts.isPropertyAssignment(p)) propiedades.set(p.name.getText(fuente), p.initializer.getText(fuente));
          else if (ts.isShorthandPropertyAssignment(p)) propiedades.set(p.name.text, p.name.text);
        }
        if (propiedades.has("dsn")) inits.push({ archivo, propiedades });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return inits;
}

function todosLosInits(): Init[] {
  return CARPETAS.flatMap((c) => archivos(join(RAIZ, c))).flatMap((a) => initsDeSentry(readFileSync(a, "utf8"), relative(RAIZ, a).replace(/\\/g, "/")));
}

describe("GT-17: Sentry sale por lista blanca", () => {
  it("el detector ve un init (sanidad: no pasa en vacío) y un init sin ganchos", () => {
    const sano = initsDeSentry(`Sentry.init({ dsn: "x", beforeSend: limpiarEventoSentry });`, "a.ts");
    expect(sano).toHaveLength(1);
    expect(sano[0].propiedades.get("beforeSend")).toBe("limpiarEventoSentry");
    expect(initsDeSentry(`otro.init({ nombre: "x" });`, "a.ts")).toEqual([]);
    expect(todosLosInits().length).toBeGreaterThan(0);
  });

  it("los init de Sentry están en la lista cerrada de archivos, con la cuenta exacta", () => {
    const cuenta: Record<string, number> = {};
    for (const i of todosLosInits()) cuenta[i.archivo] = (cuenta[i.archivo] ?? 0) + 1;
    expect(cuenta, "un `Sentry.init` nuevo se declara acá, con sus tres ganchos de limpieza").toEqual(INITS_ESPERADOS);
  });

  it("cada init cablea beforeSend, beforeSendTransaction y beforeBreadcrumb con el limpiador y mantiene sendDefaultPii en false", () => {
    for (const i of todosLosInits()) {
      for (const [gancho, funcion] of Object.entries(GANCHOS)) {
        expect(i.propiedades.get(gancho), `${i.archivo}: falta ${gancho}: ${funcion}`).toBe(funcion);
      }
      expect(i.propiedades.get("sendDefaultPii"), `${i.archivo}: sendDefaultPii tiene que ser false`).toBe("false");
    }
  });

  it("las cabeceras permitidas son exactamente user-agent y content-type", () => {
    expect([...CABECERAS_PERMITIDAS].sort()).toEqual(["content-type", "user-agent"]);
  });

  it("la URL del pedido pierde la query Y el fragmento (el token de la invitación viaja en `#t=`)", () => {
    const solo = limpiarEventoSentry({ request: { url: "https://app.test/invitacion#t=SECRETO" } } as never) as { request: { url: string } };
    const ambos = limpiarEventoSentry({ request: { url: "https://app.test/invitacion?a=1#t=SECRETO" } } as never) as { request: { url: string } };
    expect(solo.request.url).toBe("https://app.test/invitacion");
    expect(ambos.request.url).toBe("https://app.test/invitacion");
  });
});
