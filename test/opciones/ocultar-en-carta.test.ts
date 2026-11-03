import { describe, expect, it } from "vitest";
import { MENSAJE_OCULTAR_SOLO_VARIANTE_O_INCLUIDA, opcionesQueCambianElPrecio, rechazoParaOcultarEnCarta, seOcultaEnLaCarta, type OpcionParaOcultarEnCarta } from "../../src/core/opciones/public";

/**
 * «Mostrar este grupo en la carta» (decisión del dueño, 2026-10-29): la REGLA PURA de `core/opciones/lectura-en-carta.ts`. Un grupo se oculta si y solo si el interruptor está apagado, es una VARIANTE o
 * una INCLUIDA y ninguna opción OFRECIDA (activa y admitida) cambia el precio. Ante la duda, se muestra (I2). Lo agotado hoy no entra en la regla (lo vigilan los tests de la carta).
 */

const opcion = (nombre: string, extra: Partial<OpcionParaOcultarEnCarta> = {}): OpcionParaOcultarEnCarta => ({
  nombre,
  esNinguna: false,
  ofrecida: true,
  diferencia: { tipo: "MONTO", monto: 0 },
  precioAbsoluto: null,
  ...extra,
});

const OJO = opcion("Ojo de bife");
const CHORIZO = opcion("Bife de chorizo");

describe("opcionesQueCambianElPrecio", () => {
  it("una diferencia 0 no cambia el precio; un monto o un porcentaje distinto de 0, sí", () => {
    expect(opcionesQueCambianElPrecio([OJO, CHORIZO])).toEqual([]);
    expect(opcionesQueCambianElPrecio([opcion("A", { diferencia: { tipo: "MONTO", monto: 500 } }), CHORIZO]).map((o) => o.nombre)).toEqual(["A"]);
    expect(opcionesQueCambianElPrecio([opcion("A", { diferencia: { tipo: "MONTO", monto: -200 } })]).map((o) => o.nombre)).toEqual(["A"]);
    expect(opcionesQueCambianElPrecio([opcion("A", { diferencia: { tipo: "PORCENTAJE", porcentaje: 10 } })]).map((o) => o.nombre)).toEqual(["A"]);
    expect(opcionesQueCambianElPrecio([opcion("A", { diferencia: { tipo: "PORCENTAJE", porcentaje: 0 } })])).toEqual([]);
  });

  it("sin diferencia (la «ninguna» o una opción sin cargar) no cambia el precio", () => {
    expect(opcionesQueCambianElPrecio([opcion("Sin guarnición", { esNinguna: true, diferencia: null })])).toEqual([]);
    expect(opcionesQueCambianElPrecio([opcion("A", { diferencia: null })])).toEqual([]);
  });

  it("la «ninguna» nunca cuenta, aunque traiga una diferencia", () => {
    expect(opcionesQueCambianElPrecio([opcion("Sin", { esNinguna: true, diferencia: { tipo: "MONTO", monto: 900 } })])).toEqual([]);
  });

  it("un precio propio cuenta como cambio de precio (en algo que no es un tamaño es una configuración inválida: nunca se oculta)", () => {
    expect(opcionesQueCambianElPrecio([opcion("A", { diferencia: null, precioAbsoluto: 500 })]).map((o) => o.nombre)).toEqual(["A"]);
  });

  it("solo cuentan las ofrecidas: una opción apagada o no admitida con recargo no impide ocultar", () => {
    expect(opcionesQueCambianElPrecio([opcion("A", { ofrecida: false, diferencia: { tipo: "MONTO", monto: 500 } })])).toEqual([]);
  });
});

describe("seOcultaEnLaCarta", () => {
  const g = (tipo: "MEDIDA" | "VARIANTE" | "INCLUIDA" | "ADICIONAL", seMuestraEnCarta: boolean | undefined, opciones = [OJO, CHORIZO]) => ({
    tipo,
    ...(seMuestraEnCarta === undefined ? {} : { seMuestraEnCarta }),
    opciones,
  });

  it("sin el dato o con el interruptor prendido, el grupo se muestra", () => {
    for (const tipo of ["MEDIDA", "VARIANTE", "INCLUIDA", "ADICIONAL"] as const) {
      expect(seOcultaEnLaCarta(g(tipo, undefined))).toBe(false);
      expect(seOcultaEnLaCarta(g(tipo, true))).toBe(false);
    }
  });

  it("apagado y sin efecto en el precio: solo una VARIANTE o una INCLUIDA se oculta", () => {
    expect(seOcultaEnLaCarta(g("VARIANTE", false))).toBe(true);
    expect(seOcultaEnLaCarta(g("INCLUIDA", false))).toBe(true);
    expect(seOcultaEnLaCarta(g("MEDIDA", false))).toBe(false);
    expect(seOcultaEnLaCarta(g("ADICIONAL", false))).toBe(false);
  });

  it("apagado pero con una opción ofrecida que cambia el precio: la carta lo muestra igual", () => {
    expect(seOcultaEnLaCarta(g("VARIANTE", false, [OJO, opcion("Bife de chorizo", { diferencia: { tipo: "MONTO", monto: 2000 } })]))).toBe(false);
  });

  it("apagado, con el recargo en una opción que no se ofrece: se oculta", () => {
    expect(seOcultaEnLaCarta(g("VARIANTE", false, [OJO, opcion("Lomo", { ofrecida: false, diferencia: { tipo: "MONTO", monto: 2000 } })]))).toBe(true);
  });

  it("si el recargo vuelve a 0, vuelve a ocultarse solo (la decisión del dueño sigue guardada)", () => {
    const conRecargo = [opcion("A", { diferencia: { tipo: "MONTO", monto: 500 } }), CHORIZO];
    const sinRecargo = [opcion("A", { diferencia: { tipo: "MONTO", monto: 0 } }), CHORIZO];
    expect([seOcultaEnLaCarta(g("VARIANTE", false, conRecargo)), seOcultaEnLaCarta(g("VARIANTE", false, sinRecargo))]).toEqual([false, true]);
  });
});

describe("rechazoParaOcultarEnCarta", () => {
  const e = (tipo: "MEDIDA" | "VARIANTE" | "INCLUIDA" | "ADICIONAL", opciones: OpcionParaOcultarEnCarta[]) => ({ tipo, grupo: "Corte", producto: "Bife", opciones });

  it("un tamaño o un adicional no se pueden ocultar", () => {
    expect(rechazoParaOcultarEnCarta(e("MEDIDA", [OJO]))).toBe(MENSAJE_OCULTAR_SOLO_VARIANTE_O_INCLUIDA);
    expect(rechazoParaOcultarEnCarta(e("ADICIONAL", [OJO]))).toBe(MENSAJE_OCULTAR_SOLO_VARIANTE_O_INCLUIDA);
  });

  it("una variante o una incluida sin efecto en el precio se pueden ocultar", () => {
    expect(rechazoParaOcultarEnCarta(e("VARIANTE", [OJO, CHORIZO]))).toBeNull();
    expect(rechazoParaOcultarEnCarta(e("INCLUIDA", [OJO, CHORIZO]))).toBeNull();
  });

  it("con una opción que cambia el precio, nombra cuál y qué hacer (singular)", () => {
    expect(rechazoParaOcultarEnCarta(e("VARIANTE", [opcion("Ojo de bife", { diferencia: { tipo: "MONTO", monto: 2000 } }), CHORIZO]))).toBe(
      "Para ocultar «Corte» en la carta de «Bife», ninguna opción puede cambiar el precio: «Ojo de bife» cambia el precio. Dejala sin recargo o mostralo en la carta."
    );
  });

  it("con varias, las nombra a todas (plural)", () => {
    const m = rechazoParaOcultarEnCarta(e("VARIANTE", [opcion("Ojo", { diferencia: { tipo: "MONTO", monto: 1 } }), opcion("Lomo", { diferencia: { tipo: "PORCENTAJE", porcentaje: 5 } })]));
    expect(m).toBe("Para ocultar «Corte» en la carta de «Bife», ninguna opción puede cambiar el precio: «Ojo» y «Lomo» cambian el precio. Dejalas sin recargo o mostralo en la carta.");
  });

  it("coincide con la regla de la carta: se rechaza si y solo si la carta no la podría ocultar", () => {
    const casos: OpcionParaOcultarEnCarta[][] = [
      [OJO, CHORIZO],
      [opcion("A", { diferencia: { tipo: "MONTO", monto: 10 } })],
      [opcion("A", { ofrecida: false, diferencia: { tipo: "MONTO", monto: 10 } })],
      [opcion("A", { diferencia: null, precioAbsoluto: 100 })],
    ];
    for (const tipo of ["MEDIDA", "VARIANTE", "INCLUIDA", "ADICIONAL"] as const) {
      for (const opciones of casos) {
        expect(rechazoParaOcultarEnCarta(e(tipo, opciones)) === null).toBe(seOcultaEnLaCarta({ tipo, seMuestraEnCarta: false, opciones }));
      }
    }
  });
});
