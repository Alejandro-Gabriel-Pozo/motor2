/**
 * D2 (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md): resolución del valor efectivo de UNA línea de receta EN UNA
 * sucursal — override liviano por (RecetaIngrediente, Sucursal), con `null` en un campo significando "usar el central".
 *
 * Función pura, sin Prisma: filtra por `sucursalId` ADENTRO (defensa en profundidad — un llamador que ya filtró de más no
 * puede colar el override de otra sucursal, y uno que se olvida de filtrar tampoco). Sin ningún override para esa sucursal,
 * devuelve LOS MISMOS números que recibió (`Object.is`, sin ninguna operación aritmética de por medio) — ver el test de
 * propiedades en `rendimiento-local.test.ts`: garantiza que quien nunca calibra nada obtiene EXACTO lo mismo que hoy, sin
 * arriesgar un redondeo o una resta de punto flotante que hoy no existe.
 */

export interface RendimientoCentral {
  cantidad: number;
  mermaPorcentaje: number;
}

export interface OverrideRendimientoLocal {
  sucursalId: string;
  cantidad: number | null;
  mermaPorcentaje: number | null;
}

export interface RendimientoEfectivo {
  cantidad: number;
  mermaPorcentaje: number;
  /** true si CUALQUIERA de los dos campos vino de un override de esta sucursal (aunque el otro siga en el valor central). */
  calibrado: boolean;
}

export function rendimientoEfectivo(
  central: RendimientoCentral,
  overrides: readonly OverrideRendimientoLocal[] | undefined,
  sucursalId: string
): RendimientoEfectivo {
  const override = overrides?.find((o) => o.sucursalId === sucursalId);
  if (!override) return { cantidad: central.cantidad, mermaPorcentaje: central.mermaPorcentaje, calibrado: false };

  const cantidad = override.cantidad ?? central.cantidad;
  const mermaPorcentaje = override.mermaPorcentaje ?? central.mermaPorcentaje;
  const calibrado = override.cantidad !== null || override.mermaPorcentaje !== null;
  return { cantidad, mermaPorcentaje, calibrado };
}
