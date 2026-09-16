import { describe, expect, it } from "vitest";
import { PROCESOS_UI, obtenerConfigProceso } from "../../src/core/movimientos/ui-config";
import { TRANSICIONES } from "../../src/core/movimientos/transiciones";

describe("PROCESOS_UI.exigeSeccion", () => {
  it("se deriva de TRANSICIONES para cada uno de los 9 procesos del panel genérico, nunca a mano", () => {
    for (const config of Object.values(PROCESOS_UI)) {
      expect(config.exigeSeccion).toBe(TRANSICIONES[config.proceso].exigeSeccion);
    }
  });

  it("Compra/Producción/Transferencia/Dev. cliente no exigen elegir sección (pueden preseleccionar una)", () => {
    expect(obtenerConfigProceso("compra")?.exigeSeccion).toBe(false);
    expect(obtenerConfigProceso("produccion")?.exigeSeccion).toBe(false);
    expect(obtenerConfigProceso("transferencia")?.exigeSeccion).toBe(false);
    expect(obtenerConfigProceso("devolucion-cliente")?.exigeSeccion).toBe(false);
  });

  it("Consumo/Ajuste/Merma/Dev. consignación/Dev. proveedor exigen elegir sección explícitamente (nunca se adivina)", () => {
    expect(obtenerConfigProceso("consumo")?.exigeSeccion).toBe(true);
    expect(obtenerConfigProceso("ajuste")?.exigeSeccion).toBe(true);
    expect(obtenerConfigProceso("merma")?.exigeSeccion).toBe(true);
    expect(obtenerConfigProceso("devolucion-consignacion")?.exigeSeccion).toBe(true);
    expect(obtenerConfigProceso("devolucion-proveedor")?.exigeSeccion).toBe(true);
  });
});
