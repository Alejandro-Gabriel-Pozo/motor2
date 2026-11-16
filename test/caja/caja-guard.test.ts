import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { centavosDeTexto } from "../../src/core/caja/public";
import { guardComandoAbrirSesion, guardComandoAnularMovimiento, guardComandoCerrarSesion, guardComandoCobrarCuenta, guardComandoMovimientoManual } from "../../src/core/features/caja/caja.guard";

/**
 * Los guards de formato de la caja (C1, PR-B), puros: cada comando se juzga por LISTA DE PERMITIDOS antes de tocar la base. El dinero llega como TEXTO decimal y pasa a centavos enteros sin `number`. Mutación: aceptar un importe con coma, con
 * signo o con tres decimales deja en rojo «importes que NO valen»; aceptar una denominación fuera de la planilla deja en rojo «conteo».
 */
const clave = () => randomUUID();
const sesionId = randomUUID();

describe("centavosDeTexto: el texto decimal exacto, sin float", () => {
  it.each([
    ["0", BigInt(0)],
    ["0.5", BigInt(50)],
    ["0.05", BigInt(5)],
    ["1234.56", BigInt(123456)],
    ["10", BigInt(1000)],
    ["999999999999.99", BigInt(99999999999999)],
    ["0.10", BigInt(10)],
  ])("«%s» → %s centavos", (texto, esperado) => {
    expect(centavosDeTexto(texto)).toBe(esperado);
  });

  it.each(["", " ", "1,5", "-1", "+1", "1.", ".5", "1.234", "01", "00", "1e3", "1_000", "1 000", "0x10", "NaN", "Infinity", "1000000000000", "1000000000000.00", "١٢٣", "１２", "1.5 ", " 1.5", "1.5\n"])("«%j» NO vale", (texto) => {
    expect(centavosDeTexto(texto)).toBeNull();
  });

  it.each([1234.56, null, undefined, BigInt(12), {}, [], true])("un valor que no es texto (caso %#) NO vale (nunca number)", (valor) => {
    expect(centavosDeTexto(valor)).toBeNull();
  });

  it("no pierde un centavo donde un float sí (0.1 + 0.2, 1.005, 4.35 × 100)", () => {
    expect(centavosDeTexto("0.30")).toBe(BigInt(30));
    expect(centavosDeTexto("1.01")).toBe(BigInt(101));
    expect(centavosDeTexto("4.35")).toBe(BigInt(435));
  });
});

describe("guardComandoAbrirSesion", () => {
  it("valida la clave y el fondo (admite cero)", () => {
    const k = clave();
    expect(guardComandoAbrirSesion({ claveIdempotencia: k, fondo: "250.50" })).toEqual({ ok: true, valor: { claveIdempotencia: k, fondoEnCentavos: BigInt(25050) } });
    expect(guardComandoAbrirSesion({ claveIdempotencia: k, fondo: "0" })).toMatchObject({ ok: true, valor: { fondoEnCentavos: BigInt(0) } });
  });
  it("rechaza con código estable: clave que no es UUID, fondo con formato inválido o que no es texto, entrada que no es objeto", () => {
    expect(guardComandoAbrirSesion({ claveIdempotencia: "abc", fondo: "1" })).toEqual({ ok: false, codigo: "CLAVE_INVALIDA", campo: "claveIdempotencia" });
    expect(guardComandoAbrirSesion({ claveIdempotencia: clave(), fondo: "-1" })).toEqual({ ok: false, codigo: "IMPORTE_INVALIDO", campo: "fondo" });
    expect(guardComandoAbrirSesion({ claveIdempotencia: clave(), fondo: 100 as unknown as string })).toMatchObject({ ok: false, codigo: "IMPORTE_INVALIDO" });
    expect(guardComandoAbrirSesion(null as never)).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(guardComandoAbrirSesion([] as never)).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
  });
});

describe("guardComandoMovimientoManual", () => {
  const base = { claveIdempotencia: clave(), sesionId, sentido: "EGRESO" as const, importe: "50", motivo: "Compra de hielo" };
  it("valida y deja el motivo en su forma canónica (espacios recortados y colapsados)", () => {
    expect(guardComandoMovimientoManual({ ...base, motivo: "  Compra   de hielo " })).toEqual({ ok: true, valor: { claveIdempotencia: base.claveIdempotencia, sesionId, sentido: "EGRESO", importeEnCentavos: BigInt(5000), motivo: "Compra de hielo" } });
  });
  it("importes que NO valen: cero, negativo, con coma, 3 decimales, número, vacío", () => {
    for (const importe of ["0", "0.00", "-5", "1,5", "1.234", "", "abc"]) expect(guardComandoMovimientoManual({ ...base, importe }), importe).toMatchObject({ ok: false, codigo: "IMPORTE_INVALIDO", campo: "importe" });
    expect(guardComandoMovimientoManual({ ...base, importe: 50 as unknown as string })).toMatchObject({ ok: false, codigo: "IMPORTE_INVALIDO" });
  });
  it("sentido: solo INGRESO o EGRESO", () => {
    for (const sentido of ["ingreso", "COBRO", "", null, 1]) expect(guardComandoMovimientoManual({ ...base, sentido: sentido as never }), String(sentido)).toMatchObject({ ok: false, codigo: "SENTIDO_INVALIDO" });
  });
  it("la sesión es un UUID", () => {
    for (const id of ["", "1", "../x", "' OR 1=1 --"]) expect(guardComandoMovimientoManual({ ...base, sesionId: id })).toMatchObject({ ok: false, codigo: "IDENTIFICADOR_INVALIDO", campo: "sesionId" });
  });
  it("motivo: 1 a 500 caracteres de la lista de permitidos, con al menos una letra", () => {
    expect(guardComandoMovimientoManual({ ...base, motivo: "a".repeat(500) })).toMatchObject({ ok: true });
    for (const motivo of ["", "   ", "a".repeat(501), "<script>", "con\nsalto", "con\u0000nulo", "con​invisible", "=SUMA(A1)", "+54 11", "12345", "emoji \u{1F600}", "tab\tadentro"]) {
      expect(guardComandoMovimientoManual({ ...base, motivo }), JSON.stringify(motivo)).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO", campo: "motivo" });
    }
    expect(guardComandoMovimientoManual({ ...base, motivo: 5 as unknown as string })).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
  });
});

describe("guardComandoAnularMovimiento", () => {
  it("valida clave, movimiento (UUID) y motivo", () => {
    const k = clave();
    const movimientoId = randomUUID();
    expect(guardComandoAnularMovimiento({ claveIdempotencia: k, movimientoId, motivo: "Error de carga" })).toEqual({ ok: true, valor: { claveIdempotencia: k, movimientoId, motivo: "Error de carga" } });
    expect(guardComandoAnularMovimiento({ claveIdempotencia: "x", movimientoId, motivo: "Error" })).toMatchObject({ codigo: "CLAVE_INVALIDA" });
    expect(guardComandoAnularMovimiento({ claveIdempotencia: k, movimientoId: "x", motivo: "Error" })).toMatchObject({ codigo: "IDENTIFICADOR_INVALIDO", campo: "movimientoId" });
    expect(guardComandoAnularMovimiento({ claveIdempotencia: k, movimientoId, motivo: "" })).toMatchObject({ codigo: "MOTIVO_INVALIDO" });
  });
});

describe("guardComandoCobrarCuenta", () => {
  const medioA = randomUUID();
  const medioB = randomUUID();
  const base = { claveIdempotencia: clave(), cuentaId: "cm0abc123def456ghi789jkl0", totalVisto: "100.50", renglones: [{ medioDePagoId: medioA, importe: "60" }, { medioDePagoId: medioB, importe: "40.50" }] };
  it("valida y pasa todo a centavos enteros", () => {
    expect(guardComandoCobrarCuenta(base)).toEqual({
      ok: true,
      valor: { claveIdempotencia: base.claveIdempotencia, cuentaId: base.cuentaId, totalVistoEnCentavos: BigInt(10050), renglones: [{ medioDePagoId: medioA, importeEnCentavos: BigInt(6000) }, { medioDePagoId: medioB, importeEnCentavos: BigInt(4050) }] },
    });
  });
  it("la cuenta: solo letras, dígitos, guion y guion bajo (hasta 64)", () => {
    for (const cuentaId of ["", "a b", "a/b", "a'b", "x".repeat(65), "caña", "a;b"]) expect(guardComandoCobrarCuenta({ ...base, cuentaId }), cuentaId).toMatchObject({ ok: false, codigo: "IDENTIFICADOR_INVALIDO", campo: "cuentaId" });
  });
  it("el total visto: mayor que cero y con formato válido", () => {
    for (const totalVisto of ["0", "-1", "10,5", "10.555", ""]) expect(guardComandoCobrarCuenta({ ...base, totalVisto }), totalVisto).toMatchObject({ ok: false, codigo: "IMPORTE_INVALIDO", campo: "totalVisto" });
  });
  it("cada renglón: medio UUID, importe mayor que cero; el rechazo dice cuál renglón", () => {
    expect(guardComandoCobrarCuenta({ ...base, renglones: [base.renglones[0]!, { medioDePagoId: "x", importe: "1" }] })).toEqual({ ok: false, codigo: "IDENTIFICADOR_INVALIDO", campo: "renglones.1.medioDePagoId" });
    expect(guardComandoCobrarCuenta({ ...base, renglones: [{ medioDePagoId: medioA, importe: "0" }] })).toEqual({ ok: false, codigo: "IMPORTE_INVALIDO", campo: "renglones.0.importe" });
    expect(guardComandoCobrarCuenta({ ...base, renglones: [null as never] })).toEqual({ ok: false, codigo: "RENGLONES_INVALIDOS", campo: "renglones.0" });
    expect(guardComandoCobrarCuenta({ ...base, renglones: "x" as never })).toMatchObject({ ok: false, codigo: "RENGLONES_INVALIDOS", campo: "renglones" });
  });
  it("hasta 50 renglones; más se rechaza sin recorrerlos; la lista vacía pasa (la juzga el caso de uso con COBRO_SIN_RENGLONES)", () => {
    const uno = { medioDePagoId: medioA, importe: "1" };
    expect(guardComandoCobrarCuenta({ ...base, renglones: Array.from({ length: 50 }, () => uno) })).toMatchObject({ ok: true });
    expect(guardComandoCobrarCuenta({ ...base, renglones: Array.from({ length: 51 }, () => uno) })).toMatchObject({ ok: false, codigo: "RENGLONES_INVALIDOS" });
    expect(guardComandoCobrarCuenta({ ...base, renglones: [] })).toMatchObject({ ok: true, valor: { renglones: [] } });
  });
});

describe("guardComandoCerrarSesion", () => {
  const base = { sesionId, billetes: { "20000": 1, "1000": 3, "10": 0 }, monedas: "125.50", conformeDeLosDemasMedios: false, observacion: null };
  it("valida el conteo (billetes por denominación y monedas en centavos) y deja la observación en null si no hay", () => {
    expect(guardComandoCerrarSesion(base)).toEqual({ ok: true, valor: { sesionId, conteo: { billetes: { 20000: 1, 1000: 3, 10: 0 }, monedasEnCentavos: BigInt(12550) }, conformeDeLosDemasMedios: false, observacion: null } });
    expect(guardComandoCerrarSesion({ ...base, billetes: {}, monedas: "0" })).toMatchObject({ ok: true, valor: { conteo: { billetes: {}, monedasEnCentavos: BigInt(0) } } });
  });
  it("conteo: solo las 10 denominaciones de la planilla, cantidades enteras de 0 a 99999, monedas como texto", () => {
    for (const billetes of [{ "5": 1 }, { "50000": 1 }, { "0": 1 }, { "": 1 }, { "1e3": 1 }, { "1000": -1 }, { "1000": 1.5 }, { "1000": 100000 }, { "1000": "3" }, { "1000": null }, { "1000": Number.NaN }, [] as never, null as never, "x" as never]) {
      expect(guardComandoCerrarSesion({ ...base, billetes: billetes as never }), JSON.stringify(billetes)).toMatchObject({ ok: false, codigo: "CONTEO_INVALIDO" });
    }
    for (const monedas of ["-1", "1,5", "1.234", "", 5 as unknown as string]) expect(guardComandoCerrarSesion({ ...base, monedas }), String(monedas)).toMatchObject({ ok: false, codigo: "CONTEO_INVALIDO" });
    expect(guardComandoCerrarSesion({ ...base, billetes: { "1000": 99999 } })).toMatchObject({ ok: true });
  });
  it("una clave __proto__ en el conteo no se cuela (solo las denominaciones permitidas)", () => {
    expect(guardComandoCerrarSesion({ ...base, billetes: JSON.parse('{"__proto__": 1}') as never })).toMatchObject({ ok: false, codigo: "CONTEO_INVALIDO" });
  });
  it("«conforme» es booleano; la observación, opcional, 1 a 500 de la lista de permitidos", () => {
    expect(guardComandoCerrarSesion({ ...base, conformeDeLosDemasMedios: "si" as never })).toMatchObject({ ok: false, codigo: "CONFORME_INVALIDO" });
    expect(guardComandoCerrarSesion({ ...base, observacion: "Faltó un billete de mil" })).toMatchObject({ ok: true, valor: { observacion: "Faltó un billete de mil" } });
    expect(guardComandoCerrarSesion({ ...base, observacion: "<b>x</b>" })).toMatchObject({ ok: false, codigo: "OBSERVACION_INVALIDA" });
    expect(guardComandoCerrarSesion({ ...base, observacion: "" })).toMatchObject({ ok: false, codigo: "OBSERVACION_INVALIDA" });
    expect(guardComandoCerrarSesion({ ...base, sesionId: "x" })).toMatchObject({ ok: false, codigo: "IDENTIFICADOR_INVALIDO" });
  });
});
