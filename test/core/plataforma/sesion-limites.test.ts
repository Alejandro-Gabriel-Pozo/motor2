import { describe, expect, it } from "vitest";
import { esEmailReservadoDeAdminPlataforma, normalizarEmail } from "../../../src/core/plataforma/email-reservado";
import {
  BLOQUEO_POR_FALLOS_MS,
  MAXIMO_DE_FALLOS_DE_SEGUNDO_FACTOR,
  MAXIMO_DE_INTENTOS_POR_CODIGO,
  VIDA_DEL_CODIGO_DE_INGRESO_MS,
  bloqueoVigente,
  codigoAgotado,
  codigoVencido,
  despuesDeUnAcierto,
  despuesDeUnFallo,
} from "../../../src/core/plataforma/limites";
import {
  DURACION_MAXIMA_DE_SESION_MS,
  INACTIVIDAD_MAXIMA_MS,
  INTERVALO_DE_ACTIVIDAD_MS,
  debeAnotarActividad,
  motivoDeSesionInvalida,
  sesionPendienteVigente,
  sesionVigente,
  vencimientoDeSesion,
  VIDA_DE_SESION_PENDIENTE_MS,
} from "../../../src/core/plataforma/sesion";

const T0 = new Date("2026-10-04T12:00:00Z");
const despues = (ms: number) => new Date(T0.getTime() + ms);

describe("sesión: 8 horas como máximo y 30 minutos de inactividad", () => {
  const sesion = { creadaEn: T0, ultimaActividad: T0, cerradaEn: null };

  it("vale mientras no se cumpla ninguno de los dos límites (los bordes ya no valen)", () => {
    expect(sesionVigente(sesion, despues(INACTIVIDAD_MAXIMA_MS - 1))).toBe(true);
    expect(motivoDeSesionInvalida(sesion, despues(INACTIVIDAD_MAXIMA_MS))).toBe("INACTIVIDAD");
  });

  it("la actividad reciente extiende la inactividad pero no el tope de 8 horas", () => {
    const activa = { ...sesion, ultimaActividad: despues(DURACION_MAXIMA_DE_SESION_MS - 60_000) };
    expect(sesionVigente(activa, despues(DURACION_MAXIMA_DE_SESION_MS - 1))).toBe(true);
    expect(motivoDeSesionInvalida(activa, despues(DURACION_MAXIMA_DE_SESION_MS))).toBe("DURACION_MAXIMA");
  });

  it("una sesión cerrada no vale, aunque sea reciente", () => {
    expect(motivoDeSesionInvalida({ ...sesion, cerradaEn: despues(1000) }, despues(2000))).toBe("CERRADA");
  });

  it("la actividad se anota como mucho una vez por minuto", () => {
    expect(debeAnotarActividad(sesion, despues(INTERVALO_DE_ACTIVIDAD_MS - 1))).toBe(false);
    expect(debeAnotarActividad(sesion, despues(INTERVALO_DE_ACTIVIDAD_MS))).toBe(true);
  });

  it("la cookie vence a las 8 horas de creada la sesión", () => {
    expect(vencimientoDeSesion(T0).getTime() - T0.getTime()).toBe(8 * 60 * 60 * 1000);
  });
});

describe("límites del código de ingreso y del segundo factor", () => {
  it("el código vence a los 10 minutos", () => {
    expect(codigoVencido(T0, despues(VIDA_DEL_CODIGO_DE_INGRESO_MS - 1))).toBe(false);
    expect(codigoVencido(T0, despues(VIDA_DEL_CODIGO_DE_INGRESO_MS))).toBe(true);
  });

  it("el código se agota al quinto fallo", () => {
    expect(codigoAgotado(MAXIMO_DE_INTENTOS_POR_CODIGO - 1)).toBe(false);
    expect(codigoAgotado(MAXIMO_DE_INTENTOS_POR_CODIGO)).toBe(true);
  });

  it("al quinto fallo del segundo factor se bloquea 15 minutos y el contador vuelve a cero", () => {
    let estado = despuesDeUnAcierto();
    for (let i = 1; i < MAXIMO_DE_FALLOS_DE_SEGUNDO_FACTOR; i++) {
      estado = despuesDeUnFallo(estado, T0);
      expect(estado).toEqual({ fallos: i, bloqueadoHasta: null });
    }
    estado = despuesDeUnFallo(estado, T0);
    expect(estado).toEqual({ fallos: 0, bloqueadoHasta: despues(BLOQUEO_POR_FALLOS_MS) });
    expect(bloqueoVigente(estado.bloqueadoHasta, despues(BLOQUEO_POR_FALLOS_MS - 1))).toBe(true);
    expect(bloqueoVigente(estado.bloqueadoHasta, despues(BLOQUEO_POR_FALLOS_MS))).toBe(false);
    expect(bloqueoVigente(null, T0)).toBe(false);
  });

  it("un acierto limpia fallos y bloqueo", () => {
    expect(despuesDeUnAcierto()).toEqual({ fallos: 0, bloqueadoHasta: null });
  });
});

describe("email reservado del administrador de plataforma", () => {
  it("compara por la forma canónica: mayúsculas y espacios no lo esquivan", () => {
    expect(normalizarEmail("  Ana@Plataforma.COM ")).toBe("ana@plataforma.com");
    expect(esEmailReservadoDeAdminPlataforma(" ANA@plataforma.com ", ["ana@plataforma.com"])).toBe(true);
    expect(esEmailReservadoDeAdminPlataforma("ana@plataforma.com", ["Ana@Plataforma.com", "otro@x.com"])).toBe(true);
  });

  it("otro email, o ninguno registrado, no está reservado", () => {
    expect(esEmailReservadoDeAdminPlataforma("beto@cliente.com", ["ana@plataforma.com"])).toBe(false);
    expect(esEmailReservadoDeAdminPlataforma("ana@plataforma.com", [])).toBe(false);
  });
});

describe("sesión pendiente (código del mail verificado, TOTP todavía no)", () => {
  it("vive 10 minutos desde que se creó y una sesión cerrada no vuelve a valer", () => {
    expect(sesionPendienteVigente({ creadaEn: T0, cerradaEn: null }, despues(VIDA_DE_SESION_PENDIENTE_MS - 1))).toBe(true);
    expect(sesionPendienteVigente({ creadaEn: T0, cerradaEn: null }, despues(VIDA_DE_SESION_PENDIENTE_MS))).toBe(false);
    expect(sesionPendienteVigente({ creadaEn: T0, cerradaEn: T0 }, despues(1))).toBe(false);
  });
});
