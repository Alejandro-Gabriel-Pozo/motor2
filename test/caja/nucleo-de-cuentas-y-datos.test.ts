import { describe, expect, it } from "vitest";
import { datosCompletados, datosEnFormaCompleta, decidirAltaDeCuenta, decidirAltaDeMedio, decidirCambioDeEstado, decidirConVersion, identificadorExternoValido, nombreDeConfiguracionValido, repartirCobro, sinDatos, sucursalEnAlcanceDeEscritura, tipoDeCuentaValido, tipoDeMedioValido, validarDatosDelCobro } from "../../src/core/caja/public";

/** Núcleo puro de C3: nombres e identificadores por lista de permitidos, datos del cobro, decisiones de alta/edición/estado y el orden canónico con cuenta y datos. */
const TODOS = { cupon: true, ultimos4: true, marca: true, cuotas: true, dni: true };

describe("nombres e identificadores (lista de permitidos)", () => {
  it("el nombre se deja canónico y solo entra lo permitido", () => {
    expect(nombreDeConfiguracionValido("  Posnet   1  ")).toEqual({ ok: true, valor: "Posnet 1" });
    expect(nombreDeConfiguracionValido("Terminal Ñandú/2_a.b-c")).toMatchObject({ ok: true });
    for (const malo of ["", " ", "x".repeat(61), "<a>", "=1+1", "+54", "Caja\t1", "Caja‮1", "Caja@1", "Caja&1", null, undefined, 5]) {
      expect(nombreDeConfiguracionValido(malo), String(malo)).toEqual({ ok: false, error: "NOMBRE_INVALIDO" });
    }
    expect(nombreDeConfiguracionValido("x".repeat(60)).ok).toBe(true);
  });

  it("el identificador es opcional, de 1 a 40, y nunca una credencial en la forma", () => {
    expect(identificadorExternoValido(null)).toEqual({ ok: true, valor: null });
    expect(identificadorExternoValido(" T-0481 ")).toEqual({ ok: true, valor: "T-0481" });
    for (const malo of ["", "a".repeat(41), "clave=1", "a;b", "á", undefined, 3]) expect(identificadorExternoValido(malo).ok, String(malo)).toBe(false);
  });

  it("el tipo es de lista cerrada", () => {
    expect(tipoDeCuentaValido("QR")).toEqual({ ok: true, valor: "QR" });
    expect(tipoDeCuentaValido("qr").ok).toBe(false);
    expect(tipoDeMedioValido("OTRO")).toEqual({ ok: true, valor: "OTRO" });
    expect(tipoDeMedioValido("CHEQUE").ok).toBe(false);
  });
});

describe("datos del cobro", () => {
  it("ausente es válido y todo lo bien escrito entra", () => {
    expect(validarDatosDelCobro({}, TODOS)).toEqual({ ok: true, valor: { cupon: null, ultimos4: null, marcaDeTarjetaId: null, cuotas: null, dni: null } });
    const r = validarDatosDelCobro({ cupon: "A-1", ultimos4: "0042", marcaDeTarjetaId: "0b7c4d3e-6c0a-4a4c-9d0e-2b6d9d1f7e11", cuotas: 36, dni: "1234567" }, TODOS);
    expect(r.ok).toBe(true);
  });

  it("el cupón nunca es un número de tarjeta (13 dígitos, separados o por Luhn) ni lleva espacios", () => {
    const motivo = (cupon: string) => {
      const r = validarDatosDelCobro({ cupon }, TODOS);
      return r.ok ? "OK" : r.error.codigo === "DATO_DE_COBRO_INVALIDO" ? r.error.motivo : r.error.codigo;
    };
    expect(motivo("4111111111111111")).toBe("NUMERO_DE_TARJETA");
    expect(motivo("4111-1111-1111-1111")).toBe("NUMERO_DE_TARJETA");
    expect(motivo("4111/1111/1111/1")).toBe("NUMERO_DE_TARJETA");
    expect(motivo("4111A1111A1111A1111")).toBe("NUMERO_DE_TARJETA");
    expect(motivo("123456789012")).toBe("OK");
    expect(motivo("A B")).toBe("FORMA");
    expect(motivo("..")).toBe("FORMA");
    expect(motivo("ñ1")).toBe("FORMA");
  });

  it("un dato no habilitado se rechaza antes que uno mal escrito, y se informa el primero en el orden cupón, últimos 4, marca, cuotas, DNI", () => {
    const sin = { ...TODOS, cuotas: false, dni: false };
    const r = validarDatosDelCobro({ ultimos4: "x", cuotas: 3, dni: "1" }, sin);
    expect(r).toMatchObject({ ok: false, error: { codigo: "DATO_DE_COBRO_INVALIDO", dato: "ultimos4" } });
    expect(validarDatosDelCobro({ cuotas: 3, dni: "12345678" }, sin)).toMatchObject({ ok: false, error: { codigo: "DATO_DE_COBRO_NO_HABILITADO", dato: "cuotas" } });
  });

  it("la forma completa y la lista de completados (nunca los valores)", () => {
    const d = { cupon: "A1", dni: "12345678" };
    expect(datosCompletados(d)).toEqual(["cupon", "dni"]);
    expect(datosCompletados({})).toEqual([]);
    expect(sinDatos(datosEnFormaCompleta(undefined))).toBe(true);
    expect(sinDatos(datosEnFormaCompleta(d))).toBe(false);
  });
});

describe("decisiones de configuración", () => {
  const medio = (tipo: "EFECTIVO" | "QR", nombre: string | null, activo = true) => ({ id: "m", tipo, nombre, activo, version: 1 });
  it("alta de medio: el efectivo es único; el mismo nombre del mismo tipo ya existía; otro tipo o inactivo son errores", () => {
    expect(decidirAltaDeMedio({ tipo: "QR", nombre: "QR" }, { conEseNombre: null, efectivo: null })).toEqual({ ok: true, valor: "CREAR" });
    expect(decidirAltaDeMedio({ tipo: "EFECTIVO", nombre: null }, { conEseNombre: null, efectivo: medio("EFECTIVO", null) })).toEqual({ ok: true, valor: "YA_EXISTIA" });
    expect(decidirAltaDeMedio({ tipo: "EFECTIVO", nombre: "Caja" }, { conEseNombre: null, efectivo: medio("EFECTIVO", null) })).toEqual({ ok: false, error: "EFECTIVO_YA_EXISTE" });
    expect(decidirAltaDeMedio({ tipo: "QR", nombre: "X" }, { conEseNombre: medio("EFECTIVO", "X"), efectivo: null })).toEqual({ ok: false, error: "MEDIO_DUPLICADO" });
    expect(decidirAltaDeMedio({ tipo: "QR", nombre: "X" }, { conEseNombre: medio("QR", "X", false), efectivo: null })).toEqual({ ok: false, error: "MEDIO_INACTIVO_CON_ESE_NOMBRE" });
  });

  it("alta de cuenta: la misma activa ya existía; cualquier otra cosa con ese nombre es duplicada", () => {
    const e = { id: "c", tipo: "TERMINAL" as const, nombre: "P", identificadorExterno: "T", sucursalId: "s", activa: true, version: 1 };
    const pedido = { tipo: "TERMINAL" as const, identificadorExterno: "T", sucursalId: "s" };
    expect(decidirAltaDeCuenta(pedido, null)).toEqual({ ok: true, valor: "CREAR" });
    expect(decidirAltaDeCuenta(pedido, e)).toEqual({ ok: true, valor: "YA_EXISTIA" });
    expect(decidirAltaDeCuenta(pedido, { ...e, activa: false })).toEqual({ ok: false, error: "CUENTA_DUPLICADA" });
    expect(decidirAltaDeCuenta({ ...pedido, sucursalId: "t" }, e)).toEqual({ ok: false, error: "CUENTA_DUPLICADA" });
  });

  it("versión, estado y alcance", () => {
    expect(decidirConVersion(true, 5, 1)).toEqual({ ok: true, valor: "SIN_CAMBIOS" });
    expect(decidirConVersion(false, 2, 2)).toEqual({ ok: true, valor: "EDITAR" });
    expect(decidirConVersion(false, 3, 2)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    expect(decidirCambioDeEstado(true, true)).toBe("YA_ESTABA");
    expect(decidirCambioDeEstado(true, false)).toBe("CAMBIAR");
    expect(sucursalEnAlcanceDeEscritura(undefined, "a")).toBe(true);
    expect(sucursalEnAlcanceDeEscritura({ escritura: ["a"] }, "a")).toBe(true);
    expect(sucursalEnAlcanceDeEscritura({ escritura: [] }, "a")).toBe(false);
  });
});

describe("orden canónico del cobro con cuenta y datos", () => {
  const r = (medioDePagoId: string, centavos: number, extra: object = {}) => ({ medioDePagoId, importeEnCentavos: BigInt(centavos), ...extra });
  it("sin cuenta ni datos queda el orden de C1 (medio e importe) y el mismo pedido en otro orden es el mismo", () => {
    const a = repartirCobro([r("b", 100), r("a", 300), r("a", 200)], BigInt(600));
    const b = repartirCobro([r("a", 200), r("b", 100), r("a", 300)], BigInt(600));
    expect(a).toEqual(b);
    expect(a.ok && a.valor.map((x) => [x.medioDePagoId, Number(x.importeEnCentavos)])).toEqual([["a", 200], ["a", 300], ["b", 100]]);
  });
  it("«sin cuenta» va antes que una cuenta y los datos desempatan (de forma determinista)", () => {
    const a = repartirCobro([r("a", 100, { cuentaDeCobroId: "z" }), r("a", 100), r("a", 100, { datos: { cupon: "B" } }), r("a", 100, { datos: { cupon: "A" } })], BigInt(400));
    expect(a.ok && a.valor.map((x) => x.cuentaDeCobroId ?? x.datos?.cupon ?? "-")).toEqual(["A", "B", "-", "z"]);
  });
});
