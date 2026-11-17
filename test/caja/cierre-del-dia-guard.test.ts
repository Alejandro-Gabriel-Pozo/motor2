import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  guardComandoCerrarJornada,
  guardComandoCorregirMedioDeCobro,
  guardComandoDarConformeGeneral,
  guardComandoDeJornada,
  guardComandoDeclararTotal,
  guardComandoRegistrarAjuste,
} from "../../src/core/features/caja/caja.guard";

/**
 * Los guards de formato del cierre del día (caja, etapa A, 2026-11-17), puros: cada comando se juzga por LISTA DE PERMITIDOS antes de tocar la base. La fecha es «AAAA-MM-DD» de un día real; la huella, 64 hexadecimales en minúscula; los importes, texto decimal
 * (el del ajuste admite «-» y no cero) que pasa a centavos sin `number`. Mutación: aceptar una fecha con otro formato deja en rojo «fecha»; aceptar «+5» o «0» en el ajuste deja en rojo «importe del ajuste»; aceptar más de 100 reconocimientos deja en rojo «reconocimientos».
 */
const u = () => randomUUID();
const HUELLA = "0123456789abcdef".repeat(4);

describe("fecha de negocio (iniciar y cancelar el cierre del día)", () => {
  it("acepta un día real y rechaza todo lo demás", () => {
    expect(guardComandoDeJornada({ fechaDeNegocio: "2026-11-17" })).toEqual({ ok: true, valor: { fechaDeNegocio: "2026-11-17" } });
    for (const mala of ["2026-02-30", "2026-13-01", "17/11/2026", "2026-1-5", "20261117", " 2026-11-17", "2026-11-17\n", "", "hoy"]) {
      expect(guardComandoDeJornada({ fechaDeNegocio: mala }), mala).toEqual({ ok: false, codigo: "FECHA_INVALIDA", campo: "fechaDeNegocio" });
    }
    expect(guardComandoDeJornada({ fechaDeNegocio: 20261117 as never })).toMatchObject({ ok: false, codigo: "FECHA_INVALIDA" });
    expect(guardComandoDeJornada(undefined as never)).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(guardComandoDeJornada([] as never)).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
  });
});

describe("corregir el medio de un cobro", () => {
  const base = { claveIdempotencia: u(), cobroId: u(), medioDestinoId: u(), motivo: "  Se cargó   en el medio equivocado " };
  it("valida y deja el motivo en su forma canónica", () => {
    expect(guardComandoCorregirMedioDeCobro(base)).toEqual({ ok: true, valor: { ...base, motivo: "Se cargó en el medio equivocado" } });
  });
  it("rechaza con código y dato", () => {
    expect(guardComandoCorregirMedioDeCobro({ ...base, claveIdempotencia: "x" })).toEqual({ ok: false, codigo: "CLAVE_INVALIDA", campo: "claveIdempotencia" });
    expect(guardComandoCorregirMedioDeCobro({ ...base, cobroId: "x" })).toEqual({ ok: false, codigo: "IDENTIFICADOR_INVALIDO", campo: "cobroId" });
    expect(guardComandoCorregirMedioDeCobro({ ...base, medioDestinoId: "x" })).toEqual({ ok: false, codigo: "IDENTIFICADOR_INVALIDO", campo: "medioDestinoId" });
    expect(guardComandoCorregirMedioDeCobro({ ...base, motivo: "" })).toEqual({ ok: false, codigo: "MOTIVO_INVALIDO", campo: "motivo" });
    expect(guardComandoCorregirMedioDeCobro({ ...base, motivo: "a".repeat(501) })).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
    expect(guardComandoCorregirMedioDeCobro({ ...base, motivo: 5 as never })).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
  });
});

describe("declarar el total de un medio", () => {
  const base = { claveIdempotencia: u(), fechaDeNegocio: "2026-11-17", medioDePagoId: u(), importe: "1234.5" };
  it("pasa el importe a centavos enteros y admite cero", () => {
    expect(guardComandoDeclararTotal(base)).toEqual({ ok: true, valor: { claveIdempotencia: base.claveIdempotencia, fechaDeNegocio: "2026-11-17", medioDePagoId: base.medioDePagoId, importeEnCentavos: BigInt(123450) } });
    expect(guardComandoDeclararTotal({ ...base, importe: "0" })).toMatchObject({ ok: true, valor: { importeEnCentavos: BigInt(0) } });
  });
  it.each(["", "-1", "+1", "1,5", "1.234", "1e3", " 1", "1000000000000"])("el importe «%s» NO vale", (importe) => {
    expect(guardComandoDeclararTotal({ ...base, importe })).toEqual({ ok: false, codigo: "IMPORTE_INVALIDO", campo: "importe" });
  });
  it("rechaza clave, fecha y medio que no valen", () => {
    expect(guardComandoDeclararTotal({ ...base, claveIdempotencia: "x" })).toMatchObject({ codigo: "CLAVE_INVALIDA" });
    expect(guardComandoDeclararTotal({ ...base, fechaDeNegocio: "mañana" })).toMatchObject({ codigo: "FECHA_INVALIDA" });
    expect(guardComandoDeclararTotal({ ...base, medioDePagoId: "x" })).toMatchObject({ codigo: "IDENTIFICADOR_INVALIDO", campo: "medioDePagoId" });
  });
});

describe("dar el conforme general", () => {
  it("valida clave y fecha", () => {
    const k = u();
    expect(guardComandoDarConformeGeneral({ claveIdempotencia: k, fechaDeNegocio: "2026-11-17" })).toEqual({ ok: true, valor: { claveIdempotencia: k, fechaDeNegocio: "2026-11-17" } });
    expect(guardComandoDarConformeGeneral({ claveIdempotencia: "x", fechaDeNegocio: "2026-11-17" })).toMatchObject({ codigo: "CLAVE_INVALIDA" });
    expect(guardComandoDarConformeGeneral({ claveIdempotencia: k, fechaDeNegocio: "x" })).toMatchObject({ codigo: "FECHA_INVALIDA" });
  });
});

describe("cerrar el día", () => {
  const base = { fechaDeNegocio: "2026-11-17", huellaVista: HUELLA, reconocimientos: [{ clave: "caja.diferencia_de_arqueo", texto: "Faltó vuelto" }, { clave: "ventas.tickets_por_cobrar", texto: null }], observacion: " Cierre   sin novedades " };
  it("valida y deja los textos en su forma canónica", () => {
    expect(guardComandoCerrarJornada(base)).toEqual({ ok: true, valor: { ...base, observacion: "Cierre sin novedades" } });
    expect(guardComandoCerrarJornada({ ...base, reconocimientos: [], observacion: null })).toMatchObject({ ok: true, valor: { reconocimientos: [], observacion: null } });
  });
  it.each(["", "abc", "A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65), `${"a".repeat(63)}\n`])("la huella «%s» NO vale", (huellaVista) => {
    expect(guardComandoCerrarJornada({ ...base, huellaVista })).toEqual({ ok: false, codigo: "HUELLA_INVALIDA", campo: "huellaVista" });
  });
  it("reconocimientos: solo lista de hasta 100 con clave `modulo.control` y texto opcional válido", () => {
    expect(guardComandoCerrarJornada({ ...base, reconocimientos: "x" as never })).toMatchObject({ codigo: "RECONOCIMIENTOS_INVALIDOS", campo: "reconocimientos" });
    expect(guardComandoCerrarJornada({ ...base, reconocimientos: Array.from({ length: 101 }, () => ({ clave: "caja.x", texto: null })) })).toMatchObject({ codigo: "RECONOCIMIENTOS_INVALIDOS" });
    expect(guardComandoCerrarJornada({ ...base, reconocimientos: Array.from({ length: 100 }, () => ({ clave: "caja.x", texto: null })) })).toMatchObject({ ok: true });
    for (const clave of ["CAJA.x", "caja", "caja.x.y", "caja.1", "", "a".repeat(82), "caja.x\n"]) {
      expect(guardComandoCerrarJornada({ ...base, reconocimientos: [{ clave, texto: null }] }), clave).toMatchObject({ codigo: "RECONOCIMIENTOS_INVALIDOS", campo: "reconocimientos.0.clave" });
    }
    expect(guardComandoCerrarJornada({ ...base, reconocimientos: [{ clave: "caja.x", texto: "<b>" }] })).toMatchObject({ codigo: "RECONOCIMIENTOS_INVALIDOS", campo: "reconocimientos.0.texto" });
    expect(guardComandoCerrarJornada({ ...base, reconocimientos: [null as never] })).toMatchObject({ codigo: "RECONOCIMIENTOS_INVALIDOS", campo: "reconocimientos.0" });
  });
  it("observación opcional: una línea válida o nada", () => {
    expect(guardComandoCerrarJornada({ ...base, observacion: "<script>" })).toEqual({ ok: false, codigo: "OBSERVACION_INVALIDA", campo: "observacion" });
    expect(guardComandoCerrarJornada({ ...base, observacion: 7 as never })).toMatchObject({ codigo: "OBSERVACION_INVALIDA" });
    expect(guardComandoCerrarJornada({ ...base, observacion: undefined as never })).toMatchObject({ ok: true, valor: { observacion: null } });
  });
});

describe("registrar un ajuste", () => {
  const base = { claveIdempotencia: u(), sesionId: u(), medioDePagoId: u(), importe: "-5.50", motivo: "Faltó un vale", corrigeJornada: "2026-01-08" };
  it("el importe admite el signo «-» y pasa a centavos con signo", () => {
    expect(guardComandoRegistrarAjuste(base)).toEqual({ ok: true, valor: { claveIdempotencia: base.claveIdempotencia, sesionId: base.sesionId, medioDePagoId: base.medioDePagoId, importeEnCentavos: BigInt(-550), motivo: "Faltó un vale", corrigeJornada: "2026-01-08" } });
    expect(guardComandoRegistrarAjuste({ ...base, importe: "5.5" })).toMatchObject({ ok: true, valor: { importeEnCentavos: BigInt(550) } });
  });
  it.each(["0", "-0", "0.00", "-", "+5", "--5", "- 5", "5-", "1,5", "-1.234", "-1000000000000", ""])("el importe del ajuste «%s» NO vale", (importe) => {
    expect(guardComandoRegistrarAjuste({ ...base, importe })).toEqual({ ok: false, codigo: "IMPORTE_INVALIDO", campo: "importe" });
  });
  it("rechaza ids, motivo y la jornada que corrige (obligatoria)", () => {
    expect(guardComandoRegistrarAjuste({ ...base, sesionId: "x" })).toMatchObject({ codigo: "IDENTIFICADOR_INVALIDO", campo: "sesionId" });
    expect(guardComandoRegistrarAjuste({ ...base, medioDePagoId: "x" })).toMatchObject({ codigo: "IDENTIFICADOR_INVALIDO", campo: "medioDePagoId" });
    expect(guardComandoRegistrarAjuste({ ...base, motivo: " " })).toMatchObject({ codigo: "MOTIVO_INVALIDO" });
    expect(guardComandoRegistrarAjuste({ ...base, corrigeJornada: null as never })).toEqual({ ok: false, codigo: "FECHA_INVALIDA", campo: "corrigeJornada" });
    expect(guardComandoRegistrarAjuste({ ...base, corrigeJornada: "2026-02-31" })).toMatchObject({ codigo: "FECHA_INVALIDA" });
  });
});
