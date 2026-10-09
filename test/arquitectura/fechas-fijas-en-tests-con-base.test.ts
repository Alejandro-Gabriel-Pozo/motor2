import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Bombas de tiempo en los tests con base de datos. Una fecha ABSOLUTA reciente o futura, escrita a mano en un test que usa la base, se vuelve falsa con el solo paso del tiempo cuando se la compara
 * con algo que crea el reloj real (`now()` de la base, `new Date()` del código): el test pasa el día que se escribe y falla horas después, sin que nadie toque nada.
 *
 * La regla: en un test que usa la base, toda fecha absoluta (`new Date("2026-…")` o `Date.UTC(2026, …)`) tiene que ser PASADA desde hace más de `MARGEN_DIAS` día (una fecha ya pasada no puede cambiar de
 * lado: solo la que hoy es futura se vuelve pasada y rompe lo que daba por hecho que era futura) o muy lejana (el «nunca», p. ej. 2099). Lo demás se escribe con `test/setup/tiempo.ts` (relativo al reloj real). Una excepción se declara acá, con el archivo y el motivo.
 *
 * Las excepciones iniciales son el estado de cuando se creó la regla, revisado a mano: fechas que NO se comparan con el reloj real. NO se agrandan sin motivo; con el tiempo cada una se vuelve
 * inocua sola (la fecha pasa a ser pasada), y una entrada que sobra no rompe nada.
 */
const RAIZ = join(__dirname, "..");
const MARGEN_DIAS = 1;
const AÑO_LEJANO = 2090;
const USA_LA_BASE = /from\s+["'][^"']*setup\/(?:test-db|cliente-duenio|cliente-plataforma-real|base-temporal-migrada|empresa-de-prueba)["']/;

/** `archivo` (relativo a test/) → por qué sus fechas fijas no se comparan con el reloj real. */
const VENCIMIENTO_DE_LOTE =
  "fechas de vencimiento de LOTE: son la clave que agrupa el stock en el Kardex y los tests las comparan entre sí; ningún src/ compara loteVencimiento con la hora actual (verificado al crear la regla)";
const EXCEPCIONES: Record<string, string> = {
  "movimientos/compras-anular.test.ts": VENCIMIENTO_DE_LOTE,
  "movimientos/venta-reparto-entre-lineas.test.ts": VENCIMIENTO_DE_LOTE,
  "pos/cerrar-cuenta-habitual.test.ts": VENCIMIENTO_DE_LOTE,
  "pos/cerrar-cuenta-origen.test.ts": VENCIMIENTO_DE_LOTE,
  "pos/cerrar-cuenta-respaldo.test.ts": VENCIMIENTO_DE_LOTE,
  "persistencia/compras.test.ts": VENCIMIENTO_DE_LOTE,
  "persistencia/kardex-escritores-huella.test.ts": VENCIMIENTO_DE_LOTE,
  "stock/reclasificacion.test.ts": VENCIMIENTO_DE_LOTE,
  "auth/invitacion-gate.test.ts":
    "las fechas son argumentos de `opcionesCookieInvitacion(env, venceEn, ahora)`, una función PURA que recibe el reloj por parámetro: no se comparan con la base ni con la hora real",
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) return n === "e2e" || n === "e2e-demo" ? [] : archivos(ruta);
    return /\.test\.ts$/.test(n) ? [ruta] : [];
  });
}

/** Las fechas absolutas del fuente, como `{ linea, fecha }`. Los comentarios no cuentan (se mira el AST). */
export function fechasAbsolutas(fuente: string): Array<{ linea: number; fecha: Date }> {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const salida: Array<{ linea: number; fecha: Date }> = [];
  const visitar = (n: ts.Node): void => {
    const linea = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date" && n.arguments?.length) {
      const a = n.arguments[0];
      if (ts.isStringLiteralLike(a) && /^\d{4}-\d{2}-\d{2}/.test(a.text)) {
        const f = new Date(a.text);
        if (!Number.isNaN(f.getTime())) salida.push({ linea, fecha: f });
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(sf) === "Date" && n.expression.name.text === "UTC") {
      const [a, m = undefined, d = undefined] = n.arguments;
      if (a && ts.isNumericLiteral(a) && Number(a.text) >= 2000 && (m === undefined || ts.isNumericLiteral(m)) && (d === undefined || ts.isNumericLiteral(d))) {
        salida.push({ linea, fecha: new Date(Date.UTC(Number(a.text), m ? Number(m.text) : 0, d ? Number(d.text) : 1)) });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return salida;
}

/** ¿Es una bomba de tiempo? Reciente o futura (a menos de `MARGEN_DIAS` días de hoy o después) y no «el nunca». */
export function esBombaDeTiempo(fecha: Date, hoy: Date): boolean {
  if (fecha.getUTCFullYear() >= AÑO_LEJANO) return false;
  return fecha.getTime() > hoy.getTime() - MARGEN_DIAS * 24 * 60 * 60 * 1000;
}

describe("tests con base: sin fechas absolutas recientes o futuras", () => {
  const hoy = new Date();
  const tests = archivos(RAIZ).map((ruta) => ({ ruta, nombre: relative(RAIZ, ruta).split(sep).join("/"), fuente: readFileSync(ruta, "utf8") }));
  const conBase = tests.filter((t) => USA_LA_BASE.test(t.fuente));

  it("sanidad: encuentra tests con base (no pasa en vacío)", () => {
    expect(conBase.length).toBeGreaterThan(50);
  });

  it("ningún test con base escribe una fecha absoluta reciente o futura (usá test/setup/tiempo.ts)", () => {
    // Mutación: poner `new Date("2099-…")` → no cuenta; poner la fecha de hoy en un test con base pone este test en rojo.
    const problemas = conBase
      .filter((t) => !(t.nombre in EXCEPCIONES))
      .flatMap((t) => fechasAbsolutas(t.fuente).filter((f) => esBombaDeTiempo(f.fecha, hoy)).map((f) => `${t.nombre}:${f.linea}  ${f.fecha.toISOString().slice(0, 10)}`));
    expect(problemas, "Estas fechas fijas se vuelven falsas con el tiempo: usá enElFuturo/enElPasado/AHORA_DE_LA_CORRIDA de test/setup/tiempo.ts, o declará la excepción con su motivo.").toEqual([]);
  });

  it("las excepciones declaradas existen y tienen motivo", () => {
    for (const [archivo, motivo] of Object.entries(EXCEPCIONES)) {
      expect(tests.some((t) => t.nombre === archivo), `${archivo} no existe`).toBe(true);
      expect(motivo.trim().length, `${archivo} sin motivo`).toBeGreaterThan(20);
    }
  });

  describe("el detector", () => {
    const hoyFijo = new Date("2026-10-20T12:00:00Z");
    it("reconoce new Date(string) y Date.UTC con números", () => {
      expect(fechasAbsolutas('const a = new Date("2026-10-05T12:00:00.000Z"); const b = Date.UTC(2027, 0, 31);').map((f) => f.fecha.toISOString().slice(0, 10))).toEqual(["2026-10-05", "2027-01-31"]);
    });
    it("ignora comentarios, texto común y new Date() sin argumentos", () => {
      expect(fechasAbsolutas('// new Date("2026-10-05")\nconst t = "2026-10-05"; const x = new Date(); const y = new Date(Date.now() + 5);')).toEqual([]);
    });
    it("una fecha clara y pasada es segura; reciente, de hoy o futura es bomba; el «nunca» (2099) no", () => {
      expect(esBombaDeTiempo(new Date("2026-09-01T00:00:00Z"), hoyFijo)).toBe(false);
      expect(esBombaDeTiempo(new Date("2026-10-18T12:00:00Z"), hoyFijo)).toBe(false);
      expect(esBombaDeTiempo(new Date("2026-10-20T00:00:00Z"), hoyFijo)).toBe(true);
      expect(esBombaDeTiempo(new Date("2026-10-20T13:00:00Z"), hoyFijo)).toBe(true);
      expect(esBombaDeTiempo(new Date("2027-01-01T00:00:00Z"), hoyFijo)).toBe(true);
      expect(esBombaDeTiempo(new Date("2099-01-01T00:00:00Z"), hoyFijo)).toBe(false);
    });
  });
});
