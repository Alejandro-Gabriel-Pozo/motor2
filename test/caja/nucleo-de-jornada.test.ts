import { describe, expect, it } from "vitest";
import { CONTROLES_DEL_DIA, ESTADOS_DE_JORNADA, TOPE_EN_CENTAVOS, TRANSICIONES_DE_JORNADA, conciliarJornada, controlesDelDia, decidirAjuste, decidirCancelar, decidirCierre, decidirCorreccionDeMedio, decidirDeclaracion, decidirIniciar, explicacionDesdeTexto, fechaDeNegocio, medioVigenteDelCobro, ordenarControles, reconocimientosValidos, repiteElCierre } from "@/core/caja/public";
import type { ControlDelDia } from "@/core/caja/public";
import { ORACULO_DE_AJUSTE, ORACULO_DE_CONTROLES, ORACULO_DE_FECHA_DE_NEGOCIO, ORACULO_DE_SEVERIDAD } from "./oraculo-de-jornada";

/**
 * Núcleo puro de la jornada y el cierre del día (caja C2), recorrido contra las tablas del ORÁCULO escritas aparte (`oraculo-de-jornada.ts`). Sin base de datos.
 * Mutación: cambiar `<` por `<=` en `fechaDeNegocio` deja en rojo las filas de 05:59:59.999 y 06:00:00.000; sacar el chequeo `huellaVista !== huellaActual` de `decidirCierre` deja en rojo «la huella vista distinta»; en `controlesDelDia`,
 * cambiar la severidad de `sesiones_sin_cerrar` deja en rojo el oráculo de controles.
 */
const c = (n: number) => BigInt(n);
const ZONA = "America/Argentina/Buenos_Aires";

describe("fecha de negocio con hora de corte (oráculo de fechas)", () => {
  for (const f of ORACULO_DE_FECHA_DE_NEGOCIO) {
    it(`${f.instanteUtc} con corte ${f.corte} → ${f.fecha} (${f.porQue})`, () => {
      expect(fechaDeNegocio(new Date(f.instanteUtc), ZONA, f.corte)).toEqual({ ok: true, valor: f.fecha });
    });
  }

  it("los errores se devuelven en el orden de Pedernal: hora de corte, zona, instante", () => {
    const ahora = new Date("2026-01-15T12:00:00Z");
    expect(fechaDeNegocio(ahora, ZONA, "24:00")).toEqual({ ok: false, error: "HORA_DE_CORTE_INVALIDA" });
    expect(fechaDeNegocio(ahora, ZONA, "6:00")).toEqual({ ok: false, error: "HORA_DE_CORTE_INVALIDA" });
    expect(fechaDeNegocio(ahora, ZONA, "06:60")).toEqual({ ok: false, error: "HORA_DE_CORTE_INVALIDA" });
    expect(fechaDeNegocio(ahora, ZONA, "06:00:00")).toEqual({ ok: false, error: "HORA_DE_CORTE_INVALIDA" });
    expect(fechaDeNegocio(ahora, "Marte/Olympus", "00:00")).toEqual({ ok: false, error: "ZONA_HORARIA_INVALIDA" });
    expect(fechaDeNegocio(ahora, "-03:00", "00:00")).toEqual({ ok: false, error: "ZONA_HORARIA_INVALIDA" });
    expect(fechaDeNegocio(new Date(Number.NaN), ZONA, "00:00")).toEqual({ ok: false, error: "INSTANTE_INVALIDO" });
    expect(fechaDeNegocio(new Date("0001-01-01T00:00:00Z"), ZONA, "00:00")).toEqual({ ok: false, error: "INSTANTE_INVALIDO" });
    // Los tres a la vez: manda el primero.
    expect(fechaDeNegocio(new Date(Number.NaN), "Marte/Olympus", "99:99")).toEqual({ ok: false, error: "HORA_DE_CORTE_INVALIDA" });
  });

  it("los segundos del instante no cuentan: la jornada cambia exactamente a la hora de corte en punto", () => {
    expect(fechaDeNegocio(new Date("2026-01-15T08:59:59.999Z"), ZONA, "06:00")).toMatchObject({ valor: "2026-01-14" });
    expect(fechaDeNegocio(new Date("2026-01-15T09:00:00.000Z"), ZONA, "06:00")).toMatchObject({ valor: "2026-01-15" });
  });
});

describe("ciclo de la jornada", () => {
  it("las transiciones permitidas son exactamente tres", () => {
    const pares = ESTADOS_DE_JORNADA.flatMap((d) => TRANSICIONES_DE_JORNADA[d].map((h) => `${d}>${h}`));
    expect(pares.sort()).toEqual(["ABIERTA>EN_AUDITORIA", "EN_AUDITORIA>ABIERTA", "EN_AUDITORIA>CERRADA"]);
  });

  it("iniciar y cancelar: por estado, repetir no escribe", () => {
    expect(decidirIniciar("ABIERTA")).toEqual({ ok: true, valor: "INICIAR" });
    expect(decidirIniciar("EN_AUDITORIA")).toEqual({ ok: true, valor: "YA_ESTABA" });
    expect(decidirIniciar("CERRADA")).toEqual({ ok: false, error: "JORNADA_CERRADA" });
    expect(decidirCancelar("EN_AUDITORIA")).toEqual({ ok: true, valor: "CANCELAR" });
    expect(decidirCancelar("ABIERTA")).toEqual({ ok: true, valor: "YA_ESTABA" });
    expect(decidirCancelar("CERRADA")).toEqual({ ok: false, error: "JORNADA_CERRADA" });
  });
});

describe("explicación, motivo y observación: lista de permitidos", () => {
  it("recorta, compone y deja pasar lo permitido; vacío es «sin explicación»", () => {
    expect(explicacionDesdeTexto("  Falta  un   vale  ")).toEqual({ ok: true, valor: "Falta un vale" });
    expect(explicacionDesdeTexto("Café ¿ok? ¡sí!")).toEqual({ ok: true, valor: "Café ¿ok? ¡sí!" });
    expect(explicacionDesdeTexto("   ")).toEqual({ ok: true, valor: null });
    expect(explicacionDesdeTexto(null)).toEqual({ ok: true, valor: null });
  });

  it("rechaza todo lo que no está en la lista: saltos de línea, invisibles, <, >, emojis y más de 500", () => {
    for (const malo of ["una\nlinea", "tab\taca", "a​b", "<b>x</b>", "x > y", "ok 😀", "a".repeat(501), "x\u0000y"]) expect(explicacionDesdeTexto(malo), JSON.stringify(malo)).toEqual({ ok: false, error: "EXPLICACION_INVALIDA" });
    expect(explicacionDesdeTexto("a".repeat(500))).toMatchObject({ ok: true });
  });
});

function control(severidad: "BLOQUEA" | "RECONOCIBLE" | "INFORMA", cantidad: number, clave = "caja.prueba"): ControlDelDia {
  return { modulo: "caja", clave, severidad, cantidad, detalle: [], referencias: [] };
}

describe("cierre: severidad × hallazgos × reconocido (oráculo de severidad), exhaustivo", () => {
  for (const f of ORACULO_DE_SEVERIDAD) {
    it(`${f.severidad} ${f.conHallazgos ? "con" : "sin"} hallazgos, ${f.reconocido ? "reconocido" : "sin reconocer"} → ${f.esperado}`, () => {
      const r = decidirCierre({ controles: [control(f.severidad, f.conHallazgos ? 2 : 0)], huellaActual: "h", huellaVista: "h", reconocimientos: f.reconocido ? [{ clave: "caja.prueba", texto: null }] : [] });
      expect(r.ok ? "OK" : r.error.codigo).toBe(f.esperado);
    });
  }

  it("la huella vista distinta de la actual manda sobre todo lo demás y devuelve los controles de ahora", () => {
    const controles = [control("BLOQUEA", 3)];
    const r = decidirCierre({ controles, huellaActual: "nueva", huellaVista: "vieja", reconocimientos: [] });
    expect(r).toEqual({ ok: false, error: { codigo: "CONTROLES_CAMBIARON", controles } });
  });

  it("un cierre bueno devuelve TODOS los controles (también los de cantidad 0 y los que solo informan) con su constancia", () => {
    const r = decidirCierre({ controles: [control("RECONOCIBLE", 1, "caja.a"), control("INFORMA", 5, "caja.b"), control("BLOQUEA", 0, "caja.c")], huellaActual: "h", huellaVista: "h", reconocimientos: [{ clave: "caja.a", texto: "Se explica" }] });
    expect(r.ok && r.valor.map((x) => [x.clave, x.reconocido, x.texto])).toEqual([["caja.a", true, "Se explica"], ["caja.b", false, null], ["caja.c", false, null]]);
  });

  it("reconocimientos: forma permitida, sin repetidos, texto de la lista y con tope", () => {
    expect(reconocimientosValidos([{ clave: "caja.a", texto: "  ok  " }])).toEqual({ ok: true, valor: [{ clave: "caja.a", texto: "ok" }] });
    for (const malo of [[{ clave: "CAJA.A", texto: null }], [{ clave: "caja", texto: null }], [{ clave: "caja.a", texto: null }, { clave: "caja.a", texto: null }], [{ clave: "caja.a", texto: "x<y" }], [{ clave: `a.${"b".repeat(90)}`, texto: null }]]) {
      expect(reconocimientosValidos(malo), JSON.stringify(malo)).toEqual({ ok: false, error: "RECONOCIMIENTO_INVALIDO" });
    }
    expect(reconocimientosValidos(Array.from({ length: 101 }, (_, i) => ({ clave: `caja.c${"a".repeat(i % 20)}${"_".repeat(Math.floor(i / 20))}`, texto: null })))).toEqual({ ok: false, error: "RECONOCIMIENTO_INVALIDO" });
  });

  it("repetir el cierre: misma huella, observación y reconocimientos es lo mismo; cualquier diferencia es otro cierre", () => {
    const cerrado = { huellaDeCierre: "h", observacion: "o", reconocidos: [{ clave: "caja.a", texto: "t" }] };
    const pedido = { huellaVista: "h", observacion: "o", reconocimientos: [{ clave: "caja.a", texto: "t" }] };
    expect(repiteElCierre(cerrado, pedido)).toBe(true);
    expect(repiteElCierre(cerrado, { ...pedido, huellaVista: "x" })).toBe(false);
    expect(repiteElCierre(cerrado, { ...pedido, observacion: null })).toBe(false);
    expect(repiteElCierre(cerrado, { ...pedido, reconocimientos: [{ clave: "caja.a", texto: "otro" }] })).toBe(false);
    expect(repiteElCierre(cerrado, { ...pedido, reconocimientos: [] })).toBe(false);
  });
});

describe("controles del día: claves y severidades (oráculo de controles)", () => {
  it("son exactamente los ocho del oráculo, con su severidad", () => {
    const hechos = Object.fromEntries(Object.values(CONTROLES_DEL_DIA).map((d) => [d.clave, d.severidad]));
    expect(hechos).toEqual(ORACULO_DE_CONTROLES);
  });

  const vacio = { sesiones: [], conciliacion: [], cobradoContraTicket: [], correcciones: [], ajustes: [], cuentasAbiertas: [], cuentasPorCobrar: [] };

  it("sin datos: ocho controles en cero, en el orden del catálogo, y todo se cierra", () => {
    const controles = controlesDelDia(vacio);
    expect(controles.map((x) => [x.clave, x.cantidad])).toEqual(Object.keys(ORACULO_DE_CONTROLES).map((k) => [k, 0]));
  });

  it("cuenta lo que corresponde: sesiones sin cerrar, sesiones con diferencia (no líneas), tickets que difieren, lo que hay que explicar", () => {
    const r = controlesDelDia({
      ...vacio,
      sesiones: [{ id: "s1", estado: "ABIERTA", diferenciaDeEfectivoEnCentavos: null }, { id: "s2", estado: "CERRADA", diferenciaDeEfectivoEnCentavos: c(500) }, { id: "s3", estado: "CERRADA", diferenciaDeEfectivoEnCentavos: c(0) }],
      cobradoContraTicket: [{ cobranzaId: "c1", cuentaId: "u1", cobradoEnCentavos: c(1000), totalDelTicketEnCentavos: c(1000) }, { cobranzaId: "c2", cuentaId: "u2", cobradoEnCentavos: c(1000), totalDelTicketEnCentavos: c(0) }],
      cuentasAbiertas: ["a1", "a2"],
      cuentasPorCobrar: ["p1"],
    });
    const cantidad = Object.fromEntries(r.map((x) => [x.clave, x.cantidad]));
    expect(cantidad).toMatchObject({ "caja.sesiones_sin_cerrar": 1, "caja.diferencia_de_arqueo": 1, "caja.cobrado_contra_ticket": 1, "ventas.cuentas_abiertas": 2, "ventas.tickets_por_cobrar": 1 });
  });

  it("el orden en que llegan las filas no cambia el control (misma huella con otro orden)", () => {
    const a = controlesDelDia({ ...vacio, cuentasAbiertas: ["x", "y", "z"] });
    const b = controlesDelDia({ ...vacio, cuentasAbiertas: ["z", "x", "y"] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(ordenarControles([...a].reverse()).map((x) => x.clave)).toEqual(ordenarControles(a).map((x) => x.clave));
  });
});

describe("conciliación por medio", () => {
  const efectivoId = "ef";
  const base = { efectivoId, movimientos: [], correcciones: [], declaraciones: [], conformeGeneral: null, cierres: [] };

  it("efectivo: siempre CONTADO con la suma de lo contado; la diferencia es contado − (registrado + correcciones)", () => {
    const l = conciliarJornada({ ...base, movimientos: [{ medioDePagoId: "ef", importeEnCentavos: c(310000) }], cierres: [{ medioDePagoId: "ef", conforme: false, contadoEnCentavos: c(309000) }] });
    expect(l).toEqual([expect.objectContaining({ medioDePagoId: "ef", estado: "CONTADO", declaradoEnCentavos: c(309000), diferenciaEnCentavos: c(-1000) })]);
  });

  it("no efectivo: la declaración gana al conforme general, y este a lo derivado de los cierres; mezcla o nada es SIN_DATO", () => {
    const mov = [{ medioDePagoId: "t", importeEnCentavos: c(300000) }];
    const conformeCierre = { medioDePagoId: "t", conforme: true as const, conformePorId: "u", conformeEn: new Date("2026-01-15T20:00:00Z") };
    const general = { porId: "g", en: new Date("2026-01-15T22:00:00Z") };
    const declaracion = [{ medioDePagoId: "t", secuencia: 1, importeEnCentavos: c(299000) }, { medioDePagoId: "t", secuencia: 2, importeEnCentavos: c(300000) }];
    expect(conciliarJornada({ ...base, movimientos: mov, declaraciones: declaracion, conformeGeneral: general, cierres: [conformeCierre] })[0]).toMatchObject({ estado: "DECLARADO", declaradoEnCentavos: c(300000), diferenciaEnCentavos: c(0) });
    expect(conciliarJornada({ ...base, movimientos: mov, conformeGeneral: general, cierres: [] })[0]).toMatchObject({ estado: "CONFORME", conformePorId: "g", declaradoEnCentavos: null, diferenciaEnCentavos: null });
    expect(conciliarJornada({ ...base, movimientos: mov, cierres: [conformeCierre] })[0]).toMatchObject({ estado: "CONFORME", conformePorId: "u" });
    expect(conciliarJornada({ ...base, movimientos: mov, cierres: [conformeCierre, { medioDePagoId: "t", conforme: false, contadoEnCentavos: c(1) }] })[0]).toMatchObject({ estado: "SIN_DATO", diferenciaEnCentavos: null });
    expect(conciliarJornada({ ...base, movimientos: mov })[0]).toMatchObject({ estado: "SIN_DATO" });
  });

  it("una corrección saca el importe del medio de antes y lo pone en el de después (en cadena queda neto)", () => {
    const l = conciliarJornada({
      ...base,
      movimientos: [{ medioDePagoId: "a", importeEnCentavos: c(1000) }],
      correcciones: [{ importeEnCentavos: c(1000), medioAntesId: "a", medioDespuesId: "b" }, { importeEnCentavos: c(1000), medioAntesId: "b", medioDespuesId: "c" }],
      declaraciones: [{ medioDePagoId: "c", secuencia: 1, importeEnCentavos: c(1000) }],
    });
    expect(l.map((x) => [x.medioDePagoId, x.registradoEnCentavos, x.correccionesEnCentavos])).toEqual([["a", c(1000), c(-1000)], ["b", c(0), c(0)], ["c", c(0), c(1000)]]);
    expect(l.find((x) => x.medioDePagoId === "c")).toMatchObject({ estado: "DECLARADO", diferenciaEnCentavos: c(0) });
  });
});

describe("corrección de medio, declaración de total y ajuste", () => {
  it("la corrección parte del medio vigente y toma la secuencia siguiente; corregir a lo vigente no cambia nada", () => {
    expect(medioVigenteDelCobro("m0", [])).toBe("m0");
    expect(medioVigenteDelCobro("m0", [{ secuencia: 1, medioDespuesId: "m1" }, { secuencia: 2, medioDespuesId: "m2" }])).toBe("m2");
    expect(decidirCorreccionDeMedio({ medioOriginalId: "m0", correcciones: [{ secuencia: 1, medioDespuesId: "m1" }], destinoId: "m2" })).toEqual({ ok: true, valor: { medioAntesId: "m1", secuencia: 2 } });
    expect(decidirCorreccionDeMedio({ medioOriginalId: "m0", correcciones: [], destinoId: "m0" })).toEqual({ ok: false, error: "MEDIO_DEL_COBRO_SIN_CAMBIOS" });
    expect(decidirCorreccionDeMedio({ medioOriginalId: "m0", correcciones: [{ secuencia: 1, medioDespuesId: "m1" }], destinoId: "m0" })).toMatchObject({ ok: true });
  });

  it("la declaración: el efectivo no se declara, el importe va de 0 al tope, la secuencia sigue", () => {
    expect(decidirDeclaracion({ tipoDeMedio: "EFECTIVO", importeEnCentavos: c(1), secuenciasDelMedio: [] })).toEqual({ ok: false, error: "MEDIO_NO_DECLARABLE" });
    expect(decidirDeclaracion({ tipoDeMedio: "QR", importeEnCentavos: c(-1), secuenciasDelMedio: [] })).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(decidirDeclaracion({ tipoDeMedio: "QR", importeEnCentavos: c(0), secuenciasDelMedio: [] })).toEqual({ ok: true, valor: { secuencia: 1 } });
    expect(decidirDeclaracion({ tipoDeMedio: "QR", importeEnCentavos: TOPE_EN_CENTAVOS, secuenciasDelMedio: [] })).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(decidirDeclaracion({ tipoDeMedio: "QR", importeEnCentavos: TOPE_EN_CENTAVOS - c(1), secuenciasDelMedio: [] })).toMatchObject({ ok: true });
    expect(decidirDeclaracion({ tipoDeMedio: "QR", importeEnCentavos: c(100), secuenciasDelMedio: [1, 2, 3] })).toEqual({ ok: true, valor: { secuencia: 4 } });
  });

  it("el ajuste del oráculo, regla por regla sobre la jornada a corregir (la de la sesión es 2026-01-15)", () => {
    const FECHAS = { anterior: "2026-01-10", igual: "2026-01-15", posterior: "2026-01-20" } as const;
    for (const f of ORACULO_DE_AJUSTE.filter((x) => x.puedeAjustar && x.sesion === "ABIERTA")) {
      const relacion = f.jornada.slice(0, f.jornada.indexOf("_")) as keyof typeof FECHAS;
      const estado = f.jornada.slice(f.jornada.indexOf("_") + 1);
      const r = decidirAjuste({ importeEnCentavos: c(500), motivo: "Falto un vale", corrigeJornada: FECHAS[relacion], estadoDeLaJornadaACorregir: estado === "SIN_ACTIVIDAD" ? null : estado, fechaDeLaSesion: "2026-01-15" });
      expect(r.ok ? "OK" : r.error, f.jornada).toBe(f.esperado);
    }
  });

  it("el ajuste: importe con signo y distinto de cero, dentro del tope; motivo obligatorio; el ajuste común no mira jornadas", () => {
    const ok = { motivo: "Falto un vale", corrigeJornada: null, estadoDeLaJornadaACorregir: null, fechaDeLaSesion: "2026-01-15" };
    expect(decidirAjuste({ ...ok, importeEnCentavos: c(0) })).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(decidirAjuste({ ...ok, importeEnCentavos: TOPE_EN_CENTAVOS })).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(decidirAjuste({ ...ok, importeEnCentavos: -TOPE_EN_CENTAVOS })).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(decidirAjuste({ ...ok, importeEnCentavos: c(-500) })).toEqual({ ok: true, valor: { motivo: "Falto un vale" } });
    expect(decidirAjuste({ ...ok, importeEnCentavos: c(500), motivo: null })).toEqual({ ok: false, error: "MOTIVO_INVALIDO" });
    expect(decidirAjuste({ ...ok, importeEnCentavos: c(500), motivo: "x<y" })).toEqual({ ok: false, error: "MOTIVO_INVALIDO" });
  });
});
