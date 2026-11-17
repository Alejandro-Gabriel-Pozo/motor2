/**
 * ORÁCULO DE LA DIFERENCIA EN CENTAVOS de la conciliación (caja C2/C2b). Escrito APARTE del código (regla del dueño, 2026-10-28): el dinero se recalcula acá desde cero, con otra forma que la del núcleo
 * (`src/core/caja/conciliacion.ts` junta por `Map`; esto recorre la lista entera por medio), y la prueba compara. La regla: diferencia = declarado − (registrado + correcciones), EXACTA al centavo, nunca redondeada al peso.
 * Todo en `bigint`: no hay `number` decimal en ninguna cuenta.
 */

export interface MovimientoDeEntrada { readonly medioDePagoId: string; readonly importeEnCentavos: bigint }
export interface CorreccionDeEntrada { readonly importeEnCentavos: bigint; readonly medioAntesId: string; readonly medioDespuesId: string }
export interface DeclaracionDeEntrada { readonly medioDePagoId: string; readonly secuencia: number; readonly importeEnCentavos: bigint }

/** Lo registrado en un medio: Σ de sus movimientos. */
export function registradoEsperado(medio: string, movimientos: readonly MovimientoDeEntrada[]): bigint {
  return movimientos.filter((m) => m.medioDePagoId === medio).reduce((s, m) => s + m.importeEnCentavos, BigInt(0));
}

/** Lo que las correcciones le suman al medio de destino y le restan al de origen. */
export function correccionesEsperadas(medio: string, correcciones: readonly CorreccionDeEntrada[]): bigint {
  const entra = correcciones.filter((k) => k.medioDespuesId === medio).reduce((s, k) => s + k.importeEnCentavos, BigInt(0));
  const sale = correcciones.filter((k) => k.medioAntesId === medio).reduce((s, k) => s + k.importeEnCentavos, BigInt(0));
  return entra - sale;
}

/** La declaración vigente del medio (la de mayor secuencia), o `null`. */
export function declaradoVigenteEsperado(medio: string, declaraciones: readonly DeclaracionDeEntrada[]): bigint | null {
  const propias = declaraciones.filter((d) => d.medioDePagoId === medio).sort((a, b) => b.secuencia - a.secuencia);
  return propias.length === 0 ? null : propias[0]!.importeEnCentavos;
}

/** La diferencia de un medio con total conocido: declarado − (registrado + correcciones), al centavo. */
export function diferenciaEsperada(declarado: bigint, registrado: bigint, correcciones: bigint): bigint {
  return declarado - registrado - correcciones;
}

/** El importe en centavos como pesos con dos decimales (texto exacto; así lo guarda y lo lee la columna `Decimal(14,2)`), sin pasar por `number`. */
export function pesosDeCentavos(centavos: bigint): string {
  const signo = centavos < BigInt(0) ? "-" : "";
  const abs = centavos < BigInt(0) ? -centavos : centavos;
  return `${signo}${abs / BigInt(100)}.${String(abs % BigInt(100)).padStart(2, "0")}`;
}
