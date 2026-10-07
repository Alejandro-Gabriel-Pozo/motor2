import { describe, expect, it } from "vitest";
import { PUREZA_HEREDADA_DEL_NUCLEO } from "./pureza-heredada-del-nucleo";

/**
 * La fase que limpia un archivo heredado NO retrocede (Pureza, auditoría de la Fase 4: durante cuatro PR seguidos #84 a #87 `core/auth/base.ts` volvió de la «Fase 6» a la «Fase 4» por una
 * resolución de conflictos, y nada lo vio: las dos fases son válidas para `pureza-del-nucleo.test.ts`). `base.ts` es lo más sensible de la fase: se mueve UNA sola vez, a `server/sesion`, en
 * la Fase 6 (D-4 del plan de la Fase 4).
 *
 * `FASE_REGISTRADA` guarda la fase de cada heredado tal como quedó acordada. Una entrada puede ADELANTARSE a una fase posterior (de la 4 a la 6) sin tocar nada; no puede volver a una
 * fase anterior a la registrada. Una entrada que sale de la lista (porque se la limpió) deja de importar; una entrada nueva la frena la regla «lo nuevo nace puro» y el tope de la lista.
 * Para cambiar una fase a propósito, se cambia acá en el mismo commit y se explica en el mensaje.
 */
const FASE_REGISTRADA: Record<string, 4 | 6> = {
  "src/core/auth/base.ts": 6,
  "src/core/auth/contexto.ts": 6,
  "src/core/auth/invitacion.ts": 4,
  "src/core/auth/ir-al-login.ts": 6,
  "src/core/auth/rol-de-ejecucion.ts": 6,
  "src/core/auth/session.ts": 6,
  "src/core/carta/promo-sucursal.ts": 6,
  "src/core/catalogo/filtro-selector-producto.ts": 6,
  "src/core/catalogo/precio-local-consulta.ts": 4,
  "src/core/catalogo/receta-a-input.ts": 6,
  "src/core/catalogo/recetas-vigentes.ts": 6,
  "src/core/features/empresa/aceptar-invitacion-de-usuario.ts": 4,
  "src/core/features/empresa/aceptar-invitacion.ts": 4,
  "src/core/features/empresa/invitacion-de-usuario.ts": 4,
  "src/core/features/movimientos/conteo-fisico.guard.ts": 6,
  "src/core/features/movimientos/conteo-fisico.schema.ts": 6,
  "src/core/features/movimientos/movimiento.schema.ts": 6,
  "src/core/features/traspasos/traspaso.guard.ts": 6,
  "src/core/features/traspasos/traspaso.schema.ts": 6,
  "src/core/fiscal/factura-autorizada.ts": 6,
  "src/core/movimientos/anulaciones.ts": 6,
  "src/core/movimientos/armar-filas-de-movimiento.ts": 6,
  "src/core/movimientos/con-reintento.ts": 6,
  "src/core/movimientos/precio-venta.ts": 6,
  "src/core/movimientos/public.ts": 6,
  "src/core/movimientos/transiciones.ts": 6,
  "src/core/movimientos/ui-config.ts": 6,
  "src/core/permisos/auditoria.ts": 4,
  "src/core/permisos/capacidades-sucursal.ts": 4,
  "src/core/permisos/gerencia.ts": 4,
  "src/core/permisos/gestion-de-usuarios.ts": 4,
  "src/core/permisos/invariantes.ts": 4,
  "src/core/reportes/historial-producto.ts": 6,
  "src/core/reportes/historial-vistas.ts": 6,
  "src/core/reportes/margen-real.ts": 6,
  "src/core/reportes/periodo-tipos.ts": 6,
  "src/core/stock/seccion-habitual.ts": 6,
};

/** El número de la fase con la que empieza el `pendiente` de una entrada («Fase 6: …»), o `null` si no empieza así. */
export function faseDe(pendiente: string): number | null {
  const m = /^Fase (\d+)/.exec(pendiente);
  return m ? Number(m[1]) : null;
}

/** Las entradas cuya fase actual es anterior a la registrada. */
export function retrocesos(actual: Record<string, { pendiente: string }>, registrada: Record<string, number>): string[] {
  return Object.entries(registrada)
    .filter(([ruta]) => ruta in actual)
    .filter(([ruta, fase]) => (faseDe(actual[ruta].pendiente) ?? 0) < fase)
    .map(([ruta, fase]) => `${ruta}: estaba en la Fase ${fase} y ahora dice «${actual[ruta].pendiente.slice(0, 40)}…»`);
}

describe("la fase de un heredado no retrocede", () => {
  it("el detector ve un retroceso, no un adelanto ni una entrada que salió", () => {
    expect(retrocesos({ a: { pendiente: "Fase 4: x" } }, { a: 6 })).toHaveLength(1);
    expect(retrocesos({ a: { pendiente: "Fase 6: x" } }, { a: 4 })).toEqual([]);
    expect(retrocesos({ a: { pendiente: "Fase 6: x" } }, { a: 6 })).toEqual([]);
    expect(retrocesos({}, { a: 6 })).toEqual([]);
    expect(retrocesos({ a: { pendiente: "sin fase" } }, { a: 4 })).toHaveLength(1);
  });

  it("ningún heredado del núcleo volvió a una fase anterior a la acordada", () => {
    const problemas = retrocesos(PUREZA_HEREDADA_DEL_NUCLEO, FASE_REGISTRADA);
    expect(problemas, `La fase de un heredado no retrocede (D-4: core/auth/base.ts va UNA vez, en la Fase 6):\n${problemas.join("\n")}`).toEqual([]);
  });

  it("toda entrada de la lista tiene una fase registrada (una entrada nueva se registra acá, con su motivo en el commit)", () => {
    const sinRegistrar = Object.keys(PUREZA_HEREDADA_DEL_NUCLEO).filter((ruta) => !(ruta in FASE_REGISTRADA));
    expect(sinRegistrar, `Registrá la fase de estos heredados en FASE_REGISTRADA:\n${sinRegistrar.join("\n")}`).toEqual([]);
  });

  it("core/auth/base.ts sigue en la Fase 6 (D-4)", () => {
    expect(faseDe(PUREZA_HEREDADA_DEL_NUCLEO["src/core/auth/base.ts"].pendiente)).toBe(6);
  });
});
