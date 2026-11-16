import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";
import { fechaParaMostrar } from "../../src/core/tiempo/fecha-para-mostrar";

/**
 * `fechaParaMostrar`: «AAAA-MM-DD» → «DD/MM/AAAA». Función pura: no hay concurrencia ni idempotencia que probar (misma entrada, misma salida; la propiedad de abajo lo recorre).
 * Se prueba: ejemplos (bisiesto, fin y comienzo de año), propiedad 1900–2100 contra un oráculo escrito aparte, la MISMA salida con la zona del proceso en UTC, Buenos Aires, Los Ángeles y +14,
 * los bordes de la medianoche argentina (instante → día de la zona de la empresa → texto) y la falla cerrada con entradas inválidas.
 */
const ZONAS_DEL_PROCESO = ["UTC", "America/Argentina/Buenos_Aires", "America/Los_Angeles", "Pacific/Kiritimati"];
const zonaOriginal = process.env["TZ"];
afterEach(() => {
  if (zonaOriginal === undefined) delete process.env["TZ"];
  else process.env["TZ"] = zonaOriginal;
});

const dos = (n: number) => String(n).padStart(2, "0");
const bisiesto = (a: number) => a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0);
const diasDelMes = (a: number, m: number) => [31, bisiesto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

describe("fechaParaMostrar: ejemplos", () => {
  it.each([
    ["2026-11-15", "15/11/2026"],
    ["2026-03-05", "05/03/2026"],
    ["2026-01-01", "01/01/2026"],
    ["2026-12-31", "31/12/2026"],
    ["2028-02-29", "29/02/2028"], // bisiesto
    ["2000-02-29", "29/02/2000"], // bisiesto por divisible por 400
    ["2100-02-28", "28/02/2100"],
    ["0100-01-01", "01/01/0100"],
    ["9999-12-31", "31/12/9999"],
  ])("%s se muestra %s", (entrada, esperada) => {
    expect(fechaParaMostrar(entrada)).toBe(esperada);
  });
});

describe("fechaParaMostrar: falla cerrada", () => {
  it.each([
    ["30 de febrero", "2026-02-30"],
    ["29 de febrero de un año no bisiesto", "2026-02-29"],
    ["29 de febrero de 1900 (siglo no bisiesto)", "1900-02-29"],
    ["31 de abril", "2026-04-31"],
    ["mes 13", "2026-13-01"],
    ["mes 00", "2026-00-10"],
    ["día 32", "2026-01-32"],
    ["día 00", "2026-01-00"],
    ["AAAA-M-D sin ceros", "2026-1-5"],
    ["el formato de pantalla", "15/11/2026"],
    ["con espacio al final", "2026-11-15 "],
    ["un instante", "2026-11-15T00:00:00Z"],
    ["cadena vacía", ""],
    ["texto crudo", "no es una fecha"],
    ["año de 2 dígitos", "26-11-15"],
  ])("%s lanza y no devuelve nada", (_motivo, entrada) => {
    expect(() => fechaParaMostrar(entrada)).toThrow(RangeError);
  });

  it("lo que no es texto (tipo forzado) también lanza", () => {
    for (const malo of [undefined, null, 20261115, new Date("2026-11-15T00:00:00Z"), {}]) {
      expect(() => fechaParaMostrar(malo as unknown as string)).toThrow(RangeError);
    }
  });
});

describe("fechaParaMostrar: propiedad", () => {
  it("todo día real de 1900 a 2100 sale DD/MM/AAAA y coincide con el oráculo", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1900, max: 2100 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 31 }), (anio, mes, dia) => {
        fc.pre(dia <= diasDelMes(anio, mes));
        const salida = fechaParaMostrar(`${anio}-${dos(mes)}-${dos(dia)}`);
        expect(salida).toBe(`${dos(dia)}/${dos(mes)}/${anio}`);
        expect(salida).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      }),
    );
  });

  it("todo día que NO existe de 1900 a 2100 lanza (recorrida exhaustiva de los días 29 a 31 inexistentes y mes 13+)", () => {
    for (let anio = 1900; anio <= 2100; anio++) {
      for (let mes = 1; mes <= 12; mes++) {
        for (let dia = diasDelMes(anio, mes) + 1; dia <= 31; dia++) {
          expect(() => fechaParaMostrar(`${anio}-${dos(mes)}-${dos(dia)}`)).toThrow(RangeError);
        }
      }
    }
    for (const mes of [13, 14, 20, 99]) expect(() => fechaParaMostrar(`2026-${dos(mes)}-01`)).toThrow(RangeError);
  });
});

describe.each(ZONAS_DEL_PROCESO)("fechaParaMostrar con la zona del proceso en %s", (zona) => {
  it("no corre un día, ni en los bordes del día ni en los del año", () => {
    process.env["TZ"] = zona;
    for (const [entrada, esperada] of [
      ["2026-11-15", "15/11/2026"],
      ["2026-01-01", "01/01/2026"],
      ["2025-12-31", "31/12/2025"],
      ["2028-02-29", "29/02/2028"],
      ["2026-11-16", "16/11/2026"],
    ] as const) {
      expect(fechaParaMostrar(entrada)).toBe(esperada);
    }
  });

  it("los bordes de la medianoche argentina (instante → día de la empresa → texto) salen bien", () => {
    process.env["TZ"] = zona;
    const mostrada = (iso: string) => fechaParaMostrar(diaDeCalendario(new Date(iso), ZONA_ARGENTINA));
    // UTC−3 fijo: la medianoche argentina son las 03:00 UTC.
    expect(mostrada("2026-11-16T02:59:59.999Z")).toBe("15/11/2026");
    expect(mostrada("2026-11-16T03:00:00.000Z")).toBe("16/11/2026");
    expect(mostrada("2027-01-01T02:59:59.999Z")).toBe("31/12/2026");
    expect(mostrada("2027-01-01T03:00:00.000Z")).toBe("01/01/2027");
    expect(mostrada("2028-03-01T02:59:59.999Z")).toBe("29/02/2028");
    expect(mostrada("2028-03-01T03:00:00.000Z")).toBe("01/03/2028");
  });
});
