import { describe, expect, it } from "vitest";
import { mensajeSiElDestinoNoPuedeRecibirLaGerencia, type DestinoDeLaGerencia } from "../../src/core/permisos/gerencia";

/**
 * Hito 3, I.5d0: la validación del destino de un traspaso de gerencia (pertenencia, «ya es el gerente», cuenta activa) es una función PURA de `core/permisos`, para
 * que la persistencia del traspaso no compare el rol de empresa (regla 1 de `acceso-solo-por-el-guard`). Mismos textos y mismo orden que tenía en línea
 * `transferirGerenciaDeEmpresa`: el comportamiento lo siguen fijando `gerente-unico.test.ts` y la huella `huella-de-gobierno`, que dan idéntico; acá, la tabla
 * completa (incluido qué gana cuando fallan varias cosas a la vez).
 */
const destino = (cambios: Partial<{ activo: boolean; rolEmpresa: string | null; activoGlobal: boolean }> = {}): DestinoDeLaGerencia => ({
  activo: cambios.activo ?? true,
  rolEmpresa: cambios.rolEmpresa === undefined ? null : cambios.rolEmpresa,
  usuario: { activoGlobal: cambios.activoGlobal ?? true },
});

const NO_PERTENECE = "Ese usuario no pertenece a esta empresa.";
const YA_ES_GERENTE = "Esa persona ya es el gerente de la empresa.";
const DESACTIVADA = "Esa persona tiene la cuenta desactivada: no puede ser gerente.";

describe("mensajeSiElDestinoNoPuedeRecibirLaGerencia", () => {
  it.each([
    ["sin pertenencia en la empresa", null, NO_PERTENECE],
    ["ya es el gerente", destino({ rolEmpresa: "gerente" }), YA_ES_GERENTE],
    ["cuenta apagada en la empresa", destino({ activo: false }), DESACTIVADA],
    ["cuenta apagada en la plataforma", destino({ activoGlobal: false }), DESACTIVADA],
    ["ya es el gerente Y tiene la cuenta apagada: gana «ya es el gerente»", destino({ rolEmpresa: "gerente", activo: false, activoGlobal: false }), YA_ES_GERENTE],
    ["cuenta activa sin rol de empresa: puede (falta que sea admin efectivo, lo lee quien llama)", destino(), null],
    ["un rol de empresa que no es el de gerente no lo impide", destino({ rolEmpresa: "otro" }), null],
  ])("%s", (_caso, entrada, esperado) => {
    expect(mensajeSiElDestinoNoPuedeRecibirLaGerencia(entrada)).toBe(esperado);
  });
});
