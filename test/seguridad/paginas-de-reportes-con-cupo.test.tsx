import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

/**
 * I-3 de la auditoría intermedia (corrección de S-28, T11): el cupo de reportes pesados se esquivaba por una pantalla hermana, y las páginas de servidor no contaban contra ningún cupo.
 *  - El Resumen operativo (`/reportes`) corre `obtenerReportePorPeriodo` sobre un rango del usuario de hasta 366 días, igual que Período, pero no llevaba el cupo de reportes pesados.
 *    Ahora cuenta contra el MISMO cupo que Período (la misma consulta pesada: alternar las dos pantallas no duplica el presupuesto).
 *  - El cupo general de lecturas (600 por minuto) solo lo contaba `requerirSesion`, el primer paso de las Server Actions de lectura. Las páginas de servidor (un GET, que un script repite con su
 *    sesión) no pasaban por ahí: Rotación de mesas (hasta 250.001 filas por pedido), Ventas por sección, Márgenes de promociones, Devoluciones y Pérdidas se podían pedir en bucle. Ahora
 *    cada página de reportes cuenta su pedido en el MISMO contador, ANTES del gate (que lee la base) y de la consulta.
 *
 * La base, la sesión y las consultas se reemplazan por contadores: «no consulta» es exactamente «el gate y la consulta (que leen la base) no se llamaron». La FORMA (en todas las páginas de
 * reportes, y en el orden) la fija `test/arquitectura/lecturas-con-cupo.test.ts`.
 */
const mocks = vi.hoisted(() => ({
  contexto: { usuarioId: "u-0", empresaId: "e1", empresaZonaHoraria: "America/Argentina/Buenos_Aires", sucursalId: "s1", membresias: [{ sucursalId: "s1" }], db: {} } as Record<string, unknown>,
  gate: 0,
  resumen: 0,
  rotacion: 0,
}));
/** La consulta cuenta que la llamaron y corta: lo que importa es si se llegó a ella, no lo que dibuja la página con los datos. */
class LlegoALaConsulta extends Error {}
vi.mock("../../src/core/auth/contexto", () => ({ obtenerContextoUsuario: vi.fn(async () => mocks.contexto) }));
vi.mock("../../src/server/acceso/gate", () => ({
  requierePermisoVer: vi.fn(async () => {
    mocks.gate++;
    return { ok: true };
  }),
}));
vi.mock("../../src/server/consultas/reportes/resumen-operativo", () => ({
  obtenerResumenOperativo: vi.fn(async () => {
    mocks.resumen++;
    throw new LlegoALaConsulta();
  }),
}));
vi.mock("../../src/server/consultas/reportes/cotizacion-dolar", () => ({ obtenerUltimaCotizacionSinRomper: vi.fn(async () => null) }));
vi.mock("../../src/server/consultas/reportes/rotacion-mesas", () => ({
  generarReporteRotacionMesas: vi.fn(async () => {
    mocks.rotacion++;
    throw new LlegoALaConsulta();
  }),
}));

import ReportesResumenPage from "../../src/app/(app)/reportes/page";
import RotacionMesasPage from "../../src/app/(app)/reportes/rotacion-mesas/page";
import {
  MAXIMO_DE_LECTURAS_POR_MINUTO,
  MAXIMO_DE_REPORTES_PESADOS_POR_MINUTO,
  MENSAJE_DEMASIADAS_LECTURAS,
  lecturaSinCupo,
  reportePesadoSinCupo,
} from "../../src/server/actions/limitador-de-lecturas";

let n = 0;
/** Cada caso corre con SU usuario: el cupo es de memoria del proceso y los casos no se pisan. */
const usuarioNuevo = (): string => {
  const usuarioId = `u-paginas-${++n}`;
  mocks.contexto = { ...mocks.contexto, usuarioId };
  return usuarioId;
};

/** Todo el texto que dibuja un árbol de elementos de React (sin renderizarlo: la página es un componente de servidor `async`). */
function textoDe(nodo: ReactNode): string {
  if (nodo === null || nodo === undefined || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join(" ");
  return textoDe((nodo as { props?: { children?: ReactNode } }).props?.children);
}

const sinParametros = { searchParams: Promise.resolve({}) };

/** Un GET a la página: `true` si llegó hasta la consulta; `false` si la página contestó con el mensaje del cupo. */
async function pedir(pagina: (props: typeof sinParametros) => Promise<ReactNode>): Promise<boolean> {
  try {
    const resultado = await pagina(sinParametros);
    expect(textoDe(resultado), "si no llegó a la consulta, es por el cupo").toContain(MENSAJE_DEMASIADAS_LECTURAS);
    return false;
  } catch (e) {
    if (e instanceof LlegoALaConsulta) return true;
    throw e;
  }
}

beforeEach(() => {
  mocks.gate = 0;
  mocks.resumen = 0;
  mocks.rotacion = 0;
});

describe("Resumen operativo: bajo el cupo de reportes pesados (I-3)", () => {
  it("EL ATAQUE: 100 GET de /reportes con un rango de un año → solo los primeros llegan a la consulta pesada; el resto vuelve con el mensaje, sin consultar", async () => {
    usuarioNuevo();
    let llegaron = 0;
    for (let i = 0; i < 100; i++) if (await pedir(ReportesResumenPage)) llegaron++;
    expect(llegaron).toBe(MAXIMO_DE_REPORTES_PESADOS_POR_MINUTO);
    expect(mocks.resumen, "la consulta pesada (366 días de movimientos) no se llama pasado el cupo").toBe(MAXIMO_DE_REPORTES_PESADOS_POR_MINUTO);
  });

  it("comparte el cupo con Período (la misma consulta pesada): agotar el Resumen cierra Período, y no se duplica el presupuesto alternando las dos pantallas", async () => {
    const usuario = usuarioNuevo();
    for (let i = 0; i < MAXIMO_DE_REPORTES_PESADOS_POR_MINUTO; i++) await pedir(ReportesResumenPage);
    expect(reportePesadoSinCupo(usuario, "periodo", Date.now())).toBe(true);
  });

  it("es por usuario: otro usuario sigue viendo su Resumen", async () => {
    usuarioNuevo();
    for (let i = 0; i < MAXIMO_DE_REPORTES_PESADOS_POR_MINUTO + 5; i++) await pedir(ReportesResumenPage);
    usuarioNuevo();
    expect(await pedir(ReportesResumenPage)).toBe(true);
  });
});

describe("páginas de reportes: cuentan contra el cupo general de lecturas (I-3)", () => {
  it("EL ATAQUE: 700 GET de Rotación de mesas del mismo usuario → solo los primeros 600 llegan al gate y a la consulta; el resto vuelve con el mensaje", async () => {
    usuarioNuevo();
    let llegaron = 0;
    for (let i = 0; i < MAXIMO_DE_LECTURAS_POR_MINUTO + 100; i++) if (await pedir(RotacionMesasPage)) llegaron++;
    expect(llegaron).toBe(MAXIMO_DE_LECTURAS_POR_MINUTO);
    expect(mocks.rotacion).toBe(MAXIMO_DE_LECTURAS_POR_MINUTO);
    expect(mocks.gate).toBe(MAXIMO_DE_LECTURAS_POR_MINUTO);
  });

  it("es el MISMO contador que el de las Server Actions de lectura: lo gastado por ellas ya no le alcanza a la página", async () => {
    const usuario = usuarioNuevo();
    for (let i = 0; i < MAXIMO_DE_LECTURAS_POR_MINUTO; i++) lecturaSinCupo(usuario, Date.now());
    expect(await pedir(RotacionMesasPage)).toBe(false);
    expect(mocks.gate).toBe(0);
    expect(mocks.rotacion).toBe(0);
  });

  it("es por usuario: otro usuario sigue viendo la página", async () => {
    usuarioNuevo();
    for (let i = 0; i < MAXIMO_DE_LECTURAS_POR_MINUTO + 5; i++) await pedir(RotacionMesasPage);
    usuarioNuevo();
    expect(await pedir(RotacionMesasPage)).toBe(true);
  });
});
