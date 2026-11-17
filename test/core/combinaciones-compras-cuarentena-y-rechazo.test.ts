import { describe, expect, it } from "vitest";
import {
  USO_PROPUESTO_POR_CONTROL,
  bloqueoPorFaltaDeDeposito,
  decidirDestinosDeRecepcion,
  ordenarSeccionesPorNombre,
  seccionPropuestaParaUso,
  type SeccionParaElDestino,
} from "../../src/core/compras/public";
import {
  dimensionesDeCuarentenaYRechazo,
  mundoDeLaFila,
  productoCartesiano,
  resultadoDeDestino,
  tablaDeCuarentenaYRechazo,
  type FilaDeDestino,
} from "../setup/oraculo-compras-cuarentena-y-rechazo";

/**
 * Oráculo de combinaciones de los depósitos de uso RECHAZO y CUARENTENA (regla «Combinaciones» del dueño): recorre TODAS las combinaciones de la regla real de destinos (módulo × control de la línea × depósitos especiales × elección de quien confirma, con el
 * guard de módulo y la regla pura) contra la tabla de `docs/oraculo-combinaciones-compras-cuarentena-y-rechazo-2026-11-17.md`, escrita aparte del código. Son 72, así que el recorrido es exhaustivo. Que la tabla sea EXACTAMENTE el producto de los valores
 * declarados es la mitad del test: una fila repetida, faltante o con un valor no declarado lo pone en rojo.
 */
const DIMENSIONES = dimensionesDeCuarentenaYRechazo();
const DIMS = ["M", "K", "U", "X"] as const;

describe("oráculo: destino de la línea al confirmar", () => {
  const tabla = tablaDeCuarentenaYRechazo("Destino de la línea al confirmar");

  it("la tabla es exactamente el producto cartesiano de los valores declarados (sin filas repetidas, faltantes ni valores no declarados)", () => {
    expect(tabla.columnas).toEqual([...DIMS, "Resultado"]);
    const declarado = productoCartesiano(Object.fromEntries(DIMS.map((d) => [d, DIMENSIONES[d] ?? []])));
    expect(declarado).toHaveLength(72);
    const clave = (f: Record<string, string>) => DIMS.map((d) => f[d]).join("|");
    expect(tabla.filas.map(clave).sort()).toEqual(declarado.map(clave).sort());
  });

  it("cada combinación da el resultado de la tabla", () => {
    for (const fila of tabla.filas) {
      expect(resultadoDeDestino(fila as FilaDeDestino), DIMS.map((d) => `${d}=${fila[d]}`).join(" ")).toBe(fila["Resultado"]);
    }
  });

  it("la tabla tiene de todo: confirma sin cambio, confirma cambiado, los dos bloqueos, el módulo apagado y lo que no se puede armar", () => {
    expect([...new Set(tabla.filas.map((f) => f["Resultado"]))].sort()).toEqual(
      ["CONFIRMA_CAMBIADO", "CONFIRMA_SIN_CAMBIO", "NO_APLICA", "RECHAZA_MODULO_NO_ACTIVO", "RECHAZA_SIN_DEPOSITO_DE_CUARENTENA", "RECHAZA_SIN_DEPOSITO_DE_RECHAZO"].sort()
    );
  });

  it("el mundo de cada fila tiene las secciones que dice la dimensión U (dos normales siempre; de cada uso especial 0, 1 o 2)", () => {
    expect(mundoDeLaFila({ K: "RECHAZADA", U: "NINGUNA", X: "PROPUESTA" }).secciones.map((s) => s.id)).toEqual(["A", "B"]);
    expect(mundoDeLaFila({ K: "RECHAZADA", U: "UNA", X: "PROPUESTA" }).secciones.map((s) => s.id)).toEqual(["A", "B", "C1", "D1"]);
    expect(mundoDeLaFila({ K: "RECHAZADA", U: "VARIAS", X: "PROPUESTA" }).secciones.map((s) => s.id)).toEqual(["A", "B", "C1", "C2", "D1", "D2"]);
  });
});

describe("regla pura de destinos: lo que la tabla no recorre", () => {
  const A: SeccionParaElDestino = { id: "A", nombre: "Depósito", uso: "NORMAL", activa: true };
  const rechazo: SeccionParaElDestino = { id: "R", nombre: "Rechazo 1", uso: "RECHAZO", activa: true };
  const cuarentena: SeccionParaElDestino = { id: "C", nombre: "Cuarentena 1", uso: "CUARENTENA", activa: true };

  it("un depósito especial INACTIVO no cuenta como tener: bloquea igual que no tenerlo", () => {
    expect(bloqueoPorFaltaDeDeposito(["RECHAZADA"], [A, { ...rechazo, activa: false }])?.codigo).toBe("SIN_DEPOSITO_DE_RECHAZO");
    expect(bloqueoPorFaltaDeDeposito(["CON_OBSERVACIONES"], [A, { ...cuarentena, activa: false }])?.codigo).toBe("SIN_DEPOSITO_DE_CUARENTENA");
    expect(bloqueoPorFaltaDeDeposito(["RECHAZADA", "CON_OBSERVACIONES"], [A, rechazo, cuarentena])).toBeNull();
  });

  it("con varios renglones basta que UNO pida un depósito que falta para bloquear todo; si faltan los dos se dice el de rechazo", () => {
    const lineas = [{ renglonId: "r1", condicion: null }, { renglonId: "r2", condicion: "CONFORME" as const }, { renglonId: "r3", condicion: "RECHAZADA" as const }];
    const elegidas = lineas.map((l) => ({ renglonId: l.renglonId, seccionId: "A" }));
    expect(decidirDestinosDeRecepcion({ lineas, secciones: [A, cuarentena], elegidas })).toMatchObject({ ok: false, codigo: "SIN_DEPOSITO_DE_RECHAZO" });
    expect(decidirDestinosDeRecepcion({ lineas: [...lineas, { renglonId: "r4", condicion: "CON_OBSERVACIONES" }], secciones: [A], elegidas })).toMatchObject({ ok: false, codigo: "SIN_DEPOSITO_DE_RECHAZO" });
    expect(decidirDestinosDeRecepcion({ lineas, secciones: [A, rechazo], elegidas })).toMatchObject({ ok: true });
  });

  it("la propuesta es la primera ACTIVA por nombre del uso (sin distinguir mayúsculas), y un renglón mandado a un depósito normal queda «cambiado»", () => {
    const r2: SeccionParaElDestino = { id: "R2", nombre: "rechazo 0", uso: "RECHAZO", activa: true };
    const r3: SeccionParaElDestino = { id: "R3", nombre: "Rechazo -1", uso: "RECHAZO", activa: false };
    expect(seccionPropuestaParaUso("RECHAZO", [rechazo, r2, r3])?.id).toBe("R2");
    expect(seccionPropuestaParaUso("CUARENTENA", [rechazo, r2])).toBeNull();
    expect(ordenarSeccionesPorNombre([{ id: "2", nombre: "b" }, { id: "1", nombre: "B" }, { id: "0", nombre: "a" }]).map((s) => s.id)).toEqual(["0", "1", "2"]);
    const d = decidirDestinosDeRecepcion({ lineas: [{ renglonId: "r1", condicion: "RECHAZADA" }], secciones: [A, rechazo], elegidas: [{ renglonId: "r1", seccionId: "A" }] });
    expect(d).toEqual({ ok: true, destinos: [{ renglonId: "r1", seccionPropuestaId: "R", seccionElegidaId: "A", cambiado: true }] });
  });

  it("sin depósito normal activo no hay propuesta y la elegida cuenta como cambiada", () => {
    const d = decidirDestinosDeRecepcion({ lineas: [{ renglonId: "r1", condicion: "CONFORME" }], secciones: [rechazo], elegidas: [{ renglonId: "r1", seccionId: "R" }] });
    expect(d).toEqual({ ok: true, destinos: [{ renglonId: "r1", seccionPropuestaId: null, seccionElegidaId: "R", cambiado: true }] });
  });

  it("USO_PROPUESTO_POR_CONTROL: sin control y conforme van a normal; con observaciones, a cuarentena; rechazada, a rechazo", () => {
    expect(USO_PROPUESTO_POR_CONTROL).toEqual({ SIN_CONTROL: "NORMAL", CONFORME: "NORMAL", CON_OBSERVACIONES: "CUARENTENA", RECHAZADA: "RECHAZO" });
  });
});
