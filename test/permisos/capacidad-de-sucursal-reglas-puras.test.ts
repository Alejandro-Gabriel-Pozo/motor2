import { describe, expect, it } from "vitest";
import { ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE } from "../../src/core/permisos/acciones";
import { esCapacidadSiempreHabilitada, resolverCapacidad } from "../../src/core/permisos/capacidades-sucursal";

/**
 * Las dos reglas PURAS de las capacidades por sucursal (Hito 5, pieza 5.2, bloque 2, paso 3a de `docs/plan-hito-5-pureza.md`). Son lo que se queda en `core/permisos/capacidades-sucursal.ts`
 * cuando el LECTOR (`sucursalTieneCapacidad`, `capacidadesDeSucursal`) pasa a `server/acceso/capacidades-sucursal.ts`. Hasta acá solo las cubrían tests con base (`test/core/capacidades-sucursal`) o
 * con una base falsa (`test/core/semantica-sin-fila`); este archivo las prueba SOLAS, sin base, en tabla: es la decisión de acceso que comparten el gate y el precio local de la carta pública.
 */
const SUCURSAL = "suc-1";
const OTRA = "suc-2";

describe("resolverCapacidad: la fila de la sucursal le gana a la «por defecto»", () => {
  const tabla: Array<{ caso: string; candidatas: Array<{ sucursalId: string | null; habilitado: boolean }>; esperado: boolean }> = [
    { caso: "sin ninguna fila: habilitado (opt-out)", candidatas: [], esperado: true },
    { caso: "solo la por defecto apagada: apagado", candidatas: [{ sucursalId: null, habilitado: false }], esperado: false },
    { caso: "solo la por defecto prendida: habilitado", candidatas: [{ sucursalId: null, habilitado: true }], esperado: true },
    { caso: "solo la de la sucursal apagada: apagado", candidatas: [{ sucursalId: SUCURSAL, habilitado: false }], esperado: false },
    { caso: "solo la de la sucursal prendida: habilitado", candidatas: [{ sucursalId: SUCURSAL, habilitado: true }], esperado: true },
    { caso: "la de la sucursal prendida le gana a la por defecto apagada", candidatas: [{ sucursalId: null, habilitado: false }, { sucursalId: SUCURSAL, habilitado: true }], esperado: true },
    { caso: "la de la sucursal apagada le gana a la por defecto prendida", candidatas: [{ sucursalId: null, habilitado: true }, { sucursalId: SUCURSAL, habilitado: false }], esperado: false },
    { caso: "el orden de las candidatas no cambia nada (la de la sucursal primero)", candidatas: [{ sucursalId: SUCURSAL, habilitado: true }, { sucursalId: null, habilitado: false }], esperado: true },
    { caso: "una fila de OTRA sucursal no cuenta (ni apaga ni prende)", candidatas: [{ sucursalId: OTRA, habilitado: false }], esperado: true },
    { caso: "una fila de otra sucursal más la por defecto apagada: manda la por defecto", candidatas: [{ sucursalId: OTRA, habilitado: true }, { sucursalId: null, habilitado: false }], esperado: false },
  ];

  it.each(tabla)("$caso", ({ candidatas, esperado }) => {
    expect(resolverCapacidad(candidatas, SUCURSAL)).toBe(esperado);
  });
});

describe("esCapacidadSiempreHabilitada: la autoprotección de la matriz y del gobierno de accesos", () => {
  it("capacidades_sucursal, gestion_usuarios y gestion_permisos nunca se pueden apagar", () => {
    expect(esCapacidadSiempreHabilitada("capacidades_sucursal")).toBe(true);
    expect(esCapacidadSiempreHabilitada("gestion_usuarios")).toBe(true);
    expect(esCapacidadSiempreHabilitada("gestion_permisos")).toBe(true);
  });

  it("todas las de ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE están protegidas", () => {
    for (const clave of ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE) expect(esCapacidadSiempreHabilitada(clave), clave).toBe(true);
  });

  it("una acción cualquiera (o una clave inexistente) no está protegida: la perilla sí la puede apagar", () => {
    expect(esCapacidadSiempreHabilitada("precio_local")).toBe(false);
    expect(esCapacidadSiempreHabilitada("proceso_venta")).toBe(false);
    expect(esCapacidadSiempreHabilitada("no_existe")).toBe(false);
    expect(esCapacidadSiempreHabilitada("")).toBe(false);
  });
});
