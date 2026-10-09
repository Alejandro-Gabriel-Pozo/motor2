import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S-28 (T11 del endurecimiento): las lecturas (`requerirVer*`, el primer paso de toda Server Action de lectura) no tenían ningún límite de velocidad; el de las mutaciones
 * (`conPermiso`) no las cuenta. Un usuario autenticado de UNA empresa que las repetía en bucle le gastaba la base compartida a todas. Acá se prueba el cupo por usuario; la base y la
 * sesión se reemplazan por contadores: «no consulta» es exactamente «el gate (que lee la base) no se llamó».
 */
const mocks = vi.hoisted(() => ({
  contexto: { usuarioId: "u-0", empresaId: "e1", sucursalId: "s1", membresias: [{ sucursalId: "s1" }], db: {} } as Record<string, unknown>,
  gate: { llamadas: 0 },
  /** Cuántas veces se resolvió el contexto: lee la base (pertenencias, sucursales, rol). */
  resoluciones: 0,
}));
vi.mock("../../src/core/auth/contexto", () => ({
  obtenerContextoUsuario: vi.fn(async () => {
    mocks.resoluciones++;
    return mocks.contexto;
  }),
}));
// M-19: `requerirSesion` mira quién es el usuario ANTES de resolver el contexto; la sesión devuelve el mismo usuario que el contexto de prueba.
vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn(async () => ({ id: mocks.contexto.usuarioId, email: "u@test.com", nombre: null })) }));
vi.mock("../../src/server/acceso/gate", () => ({
  requierePermisoVer: vi.fn(async () => {
    mocks.gate.llamadas++;
    return { ok: true };
  }),
  requierePermisoVerDeEmpresa: vi.fn(async () => {
    mocks.gate.llamadas++;
    return { ok: true };
  }),
  accionesDelMenuQueElUsuarioPuedeVer: vi.fn(async () => {
    mocks.gate.llamadas++;
    return new Set(["gestion_usuarios"]);
  }),
}));

import { requerirVer, requerirVerAlguna, requerirVerDeEmpresa, requerirVerEnSucursal } from "../../src/server/actions/con-sesion";
import {
  MAXIMO_DE_LECTURAS_POR_MINUTO,
  MAXIMO_DE_REPORTES_PESADOS_POR_MINUTO,
  MENSAJE_DEMASIADAS_LECTURAS,
  REPORTES_PESADOS,
  lecturaSinCupo,
  reportePesadoSinCupo,
} from "../../src/server/actions/limitador-de-lecturas";

let n = 0;
/** Cada caso corre con SU usuario: el cupo es de memoria del proceso y los casos no se pisan. */
const usuarioNuevo = () => {
  mocks.contexto = { ...mocks.contexto, usuarioId: `u-lecturas-${++n}` };
  return mocks.contexto.usuarioId as string;
};

beforeEach(() => {
  mocks.gate.llamadas = 0;
  mocks.resoluciones = 0;
});
afterEach(() => vi.useRealTimers());

describe("requerirVer*: cupo de lecturas por usuario (S-28)", () => {
  it("EL ATAQUE: 1000 lecturas seguidas del mismo usuario → solo las primeras llegan al gate (a la base); desde la siguiente lanza el mensaje, sin consultar", async () => {
    usuarioNuevo();
    let rechazadas = 0;
    let primerRechazo = -1;
    for (let i = 0; i < 1000; i++) {
      try {
        await requerirVer("gestion_usuarios");
      } catch (e) {
        expect((e as Error).message).toBe(MENSAJE_DEMASIADAS_LECTURAS);
        rechazadas++;
        if (primerRechazo < 0) primerRechazo = i;
      }
    }
    expect(mocks.gate.llamadas).toBe(MAXIMO_DE_LECTURAS_POR_MINUTO);
    expect(primerRechazo).toBe(MAXIMO_DE_LECTURAS_POR_MINUTO);
    expect(rechazadas).toBe(1000 - MAXIMO_DE_LECTURAS_POR_MINUTO);
  });

  // M-19 (T16): pasado el cupo, el pedido igual gastaba base porque el contexto (pertenencias, sucursales, rol: varias lecturas) se resolvía ANTES de contar.
  it("EL DEFECTO (M-19): pasado el cupo, el pedido ya no resuelve el contexto (no lee la base); el conteo sigue siendo después de resolver al usuario", async () => {
    usuarioNuevo();
    for (let i = 0; i < MAXIMO_DE_LECTURAS_POR_MINUTO; i++) await requerirVer("gestion_usuarios");
    expect(mocks.resoluciones).toBe(MAXIMO_DE_LECTURAS_POR_MINUTO);

    // El que pasa el tope exacto todavía resuelve el contexto (lo cuenta recién ahí y recién ahí se sabe que se pasó)…
    await expect(requerirVer("gestion_usuarios")).rejects.toThrow(MENSAJE_DEMASIADAS_LECTURAS);
    expect(mocks.resoluciones).toBe(MAXIMO_DE_LECTURAS_POR_MINUTO + 1);
    // …pero desde ahí ninguno de los siguientes toca la base: ni el contexto ni el gate.
    for (let i = 0; i < 200; i++) await expect(requerirVer("gestion_usuarios")).rejects.toThrow(MENSAJE_DEMASIADAS_LECTURAS);
    expect(mocks.resoluciones, "pasado el cupo no se resuelve el contexto").toBe(MAXIMO_DE_LECTURAS_POR_MINUTO + 1);
    expect(mocks.gate.llamadas).toBe(MAXIMO_DE_LECTURAS_POR_MINUTO);
  });

  it("el corte previo es por usuario y vence con la ventana: otro usuario resuelve su contexto, y pasado el minuto el abusador también", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    const abusador = usuarioNuevo();
    for (let i = 0; i < MAXIMO_DE_LECTURAS_POR_MINUTO + 2; i++) await requerirVer("gestion_usuarios").catch(() => undefined);
    const antes = mocks.resoluciones;
    await expect(requerirVer("gestion_usuarios")).rejects.toThrow(MENSAJE_DEMASIADAS_LECTURAS);
    expect(mocks.resoluciones).toBe(antes);

    usuarioNuevo();
    await expect(requerirVer("gestion_usuarios")).resolves.toBeDefined();

    vi.setSystemTime(new Date("2026-10-09T12:01:01Z"));
    mocks.contexto = { ...mocks.contexto, usuarioId: abusador };
    await expect(requerirVer("gestion_usuarios")).resolves.toBeDefined();
  });

  it("el cupo cuenta TODAS las guardas de lectura juntas (por sucursal, de empresa, «alguna»): no se esquiva alternándolas", async () => {
    usuarioNuevo();
    const guardas = [
      () => requerirVer("gestion_usuarios"),
      () => requerirVerEnSucursal("s1", "gestion_usuarios"),
      () => requerirVerDeEmpresa("producto_ver_catalogo" as never),
      () => requerirVerAlguna(["gestion_usuarios"]),
    ];
    let aceptadas = 0;
    for (let i = 0; i < MAXIMO_DE_LECTURAS_POR_MINUTO + 50; i++) {
      try {
        await guardas[i % guardas.length]!();
        aceptadas++;
      } catch {
        /* rechazada por el cupo */
      }
    }
    expect(aceptadas).toBe(MAXIMO_DE_LECTURAS_POR_MINUTO);
  });

  it("es por usuario: otro usuario sigue leyendo, y pasado el minuto el primero también", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    const abusador = usuarioNuevo();
    for (let i = 0; i < MAXIMO_DE_LECTURAS_POR_MINUTO; i++) await requerirVer("gestion_usuarios");
    await expect(requerirVer("gestion_usuarios")).rejects.toThrow(MENSAJE_DEMASIADAS_LECTURAS);

    usuarioNuevo();
    await expect(requerirVer("gestion_usuarios")).resolves.toBeDefined();

    vi.setSystemTime(new Date("2026-10-09T12:01:01Z"));
    mocks.contexto = { ...mocks.contexto, usuarioId: abusador };
    await expect(requerirVer("gestion_usuarios")).resolves.toBeDefined();
  });
});

describe("reportes pesados: cupo por usuario y por reporte (S-28)", () => {
  const t0 = 5_000_000;

  it("EL ATAQUE: un reporte pesado pedido en bucle se corta al llegar al cupo; el siguiente minuto vuelve a andar", () => {
    for (const reporte of REPORTES_PESADOS) {
      const usuario = `u-pesado-${reporte}`;
      for (let i = 0; i < MAXIMO_DE_REPORTES_PESADOS_POR_MINUTO; i++) expect(reportePesadoSinCupo(usuario, reporte, t0 + i), `${reporte} #${i + 1}`).toBe(false);
      expect(reportePesadoSinCupo(usuario, reporte, t0 + 100), `${reporte} pasado el cupo`).toBe(true);
      expect(reportePesadoSinCupo(usuario, reporte, t0 + 61_000), `${reporte} un minuto después`).toBe(false);
    }
  });

  it("cada reporte lleva su cuenta y cada usuario la suya: agotar uno no cierra los otros", () => {
    for (let i = 0; i < MAXIMO_DE_REPORTES_PESADOS_POR_MINUTO + 1; i++) reportePesadoSinCupo("u-cuenta", "periodo", t0 + i);
    expect(reportePesadoSinCupo("u-cuenta", "periodo", t0 + 100)).toBe(true);
    expect(reportePesadoSinCupo("u-cuenta", "rendimiento-recetas", t0 + 100)).toBe(false);
    expect(reportePesadoSinCupo("u-otro", "periodo", t0 + 100)).toBe(false);
  });

  it("la lectura suelta comparte el tope de una sola vez por usuario: lecturaSinCupo cuenta cada llamada (sin ventana compartida con los reportes)", () => {
    for (let i = 0; i < MAXIMO_DE_LECTURAS_POR_MINUTO; i++) expect(lecturaSinCupo("u-suelta", t0 + i)).toBe(false);
    expect(lecturaSinCupo("u-suelta", t0 + 700)).toBe(true);
    expect(reportePesadoSinCupo("u-suelta", "periodo", t0 + 700)).toBe(false);
  });
});
