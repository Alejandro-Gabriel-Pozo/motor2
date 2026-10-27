import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián G2 del mostrador (ADR-039, etapa M1.3): el puesto mostrador es una `Mesa` (de tipo MOSTRADOR, número 0), así que toda consulta que MIDE MESAS tiene que filtrar por tipo de salón o contaría
 * al mostrador como una mesa más. TypeScript no lo ve (la consulta tipa igual con o sin el filtro): lo fija este test, mirando el código de las cinco consultas que no pueden olvidarlo.
 *
 *  - `abrirCuentaCasoDeUso`: la mesa que abre es de salón (`tipo: "SALON"`; el mostrador se abre con `abrirCuentaDeMostrador`) y el conteo del límite de mesas abiertas suma solo cuentas de salón (`tipoMesa: "SALON"`);
 *  - `generarReporteRotacionMesas`: la rotación mide comensales, que el mostrador no lleva (`tipoMesa: "SALON"`);
 *  - `obtenerMapaDeMesas`: el mapa, sus métricas y el «siguiente número» son de las mesas (`tipo: "SALON"`);
 *  - `obtenerDetalleDeMesa`: la pantalla de una mesa no abre el mostrador (`tipo: "SALON"`), y `obtenerDetalleDelMostrador` solo lee el mostrador (`tipo: "MOSTRADOR"`).
 * Lo que sí cuenta al mostrador a propósito: apagar la sucursal (no se apaga con una cuenta abierta, del puesto que sea).
 */
const RAIZ = join(__dirname, "../../src");

/** El texto de la llamada `ancla(...)` completa (con paréntesis balanceados), sin los comentarios de línea. */
function llamada(fuente: string, ancla: string): string {
  const sinComentarios = fuente.replace(/\/\/.*$/gm, "");
  const desde = sinComentarios.indexOf(ancla);
  if (desde < 0) throw new Error(`no se encontró «${ancla}»`);
  let i = sinComentarios.indexOf("(", desde);
  let nivel = 0;
  const inicio = i;
  for (; i < sinComentarios.length; i++) {
    if (sinComentarios[i] === "(") nivel++;
    if (sinComentarios[i] === ")" && --nivel === 0) return sinComentarios.slice(inicio, i + 1);
  }
  throw new Error(`paréntesis sin cerrar después de «${ancla}»`);
}

const CASOS: { donde: string; archivo: string; ancla: string; filtro: string }[] = [
  { donde: "abrirCuenta: la mesa que abre", archivo: "server/actions/pos/casos-de-uso/abrir-cuenta.ts", ancla: "tx.mesa.findFirst", filtro: 'tipo: "SALON"' },
  { donde: "abrirCuenta: el conteo del límite de mesas abiertas", archivo: "server/actions/pos/casos-de-uso/abrir-cuenta.ts", ancla: "tx.cuenta.count", filtro: 'tipoMesa: "SALON"' },
  { donde: "rotación de mesas", archivo: "server/consultas/reportes/rotacion-mesas.ts", ancla: "db.cuenta.findMany", filtro: 'tipoMesa: "SALON"' },
  { donde: "mapa de mesas", archivo: "server/consultas/pos/mesas.ts", ancla: "db.mesa.findMany", filtro: 'tipo: "SALON"' },
  { donde: "detalle de una mesa", archivo: "server/consultas/pos/detalle-de-mesa.ts", ancla: "leerDetalle(db, { id", filtro: 'tipo: "SALON"' },
  { donde: "detalle del mostrador", archivo: "server/consultas/pos/detalle-de-mesa.ts", ancla: "leerDetalle(db, { sucursalId", filtro: 'tipo: "MOSTRADOR"' },
];

describe("G2: lo que mide mesas filtra por tipo de salón", () => {
  it.each(CASOS)("$donde ($archivo) lleva $filtro", ({ archivo, ancla, filtro }) => {
    const texto = llamada(readFileSync(join(RAIZ, archivo), "utf8"), ancla);
    expect(texto, `${archivo}: la consulta ${ancla}(…) perdió el filtro ${filtro}: el mostrador contaría como una mesa más`).toContain(filtro);
  });

  it("el extractor devuelve la llamada completa y respeta los paréntesis anidados", () => {
    expect(llamada("antes\nx.contar({ donde: f(a, (b)) })\ndespués", "x.contar")).toBe("({ donde: f(a, (b)) })");
    expect(llamada("// x.contar(MAL)\nx.contar({ ok: 1 })", "x.contar")).toBe("({ ok: 1 })");
  });
});
