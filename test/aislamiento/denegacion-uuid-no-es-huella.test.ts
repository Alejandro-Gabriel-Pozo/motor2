import { describe, expect, it } from "vitest";
import { sinUuids, traeMarcadorAjeno } from "./denegacion/ejecutar";

/**
 * Detector de la matriz de denegación por defecto (GT-3b): un id UUID no puede dar un falso «filtró filas ajenas» porque uno de sus grupos de 4 cifras caiga por azar en la familia 77xx/88xx de las huellas
 * (visto dos veces en la corrida combinada del gate de C1b: `f5f6ac79-7741-…`). Una huella real suelta sigue detectándose (lo que protege el aislamiento no se debilita).
 * Mutación que lo pone en rojo: sacar `sinUuids` de `correrPuerta` no lo nota (es la línea de la matriz), pero cambiar el cuerpo de `sinUuids` a `return texto` rompe la primera prueba.
 */
describe("el detector de filas ajenas y los ids UUID", () => {
  it("un UUID con un grupo 77xx o 88xx deja de leerse como huella ajena", () => {
    for (const id of ["f5f6ac79-7741-47de-b121-f77545e8dc11", "0a1b2c3d-8888-4abc-9def-0123456789ab", "aaaaaaaa-bbbb-4ccc-8ddd-777700000000"]) {
      expect(traeMarcadorAjeno(`{"sesionId":"${id}"}`), `el id ${id} sin tapar sí se leía (control)`).toBe(id.includes("-7741-") || id.includes("-8888-"));
      expect(traeMarcadorAjeno(sinUuids(`{"sesionId":"${id}"}`)), id).toBe(false);
    }
  });

  it("una huella real suelta, un marcador de otra empresa o de otra sucursal siguen detectándose aunque haya UUID al lado", () => {
    const id = "f5f6ac79-7741-47de-b121-f77545e8dc11";
    expect(traeMarcadorAjeno(sinUuids(`{"sesionId":"${id}","saldo":7784}`))).toBe(true);
    expect(traeMarcadorAjeno(sinUuids(`{"sesionId":"${id}","saldo":8888}`))).toBe(true);
    expect(traeMarcadorAjeno(sinUuids(`{"sesionId":"${id}","nombre":"Sucursal ZZ-E2"}`))).toBe(true);
    expect(traeMarcadorAjeno(sinUuids(`{"sesionId":"${id}","nombre":"ZZ-S2 Norte"}`))).toBe(true);
    expect(traeMarcadorAjeno(sinUuids(`{"sesionId":"${id}","nombre":"ZZ-A1"}`))).toBe(false);
  });
});
