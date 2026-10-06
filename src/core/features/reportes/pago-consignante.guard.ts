import { texto } from "@/core/texto";
import { validarFechaOperacion } from "@/core/datos/fecha-operacion";
import { validarImporte } from "@/core/datos/importe";
import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { LARGO_MAXIMO_NOTAS, validarTextoLibre } from "@/core/datos/limites";
import type { ComandoRegistrarPagoConsignante } from "./pago-consignante.schema";

/**
 * Guard del comando «registrar un pago a un proveedor de consignación» (convención "guard por feature", 2026-09-25; Task #41, Fase M,
 * M14 — docs/arquitectura-casos-de-uso-2026-09-27.md). Formato del comando, ANTES de abrir la transacción y ANTES de `conPermiso`.
 * Puro: sin Prisma ni permisos.
 *
 * Las validaciones (proveedor en blanco, importe con `validarImporte`, formato de la clave I3) son las MISMAS que antes corrían en
 * línea en `registrarPagoConsignante` (`src/server/actions/reportes/consignacion.ts`), con los MISMOS textos.
 *
 * A diferencia de otros guards de esta fase (que devuelven `entrada` tal cual, sin transformar), ACÁ el `importe` SÍ sale
 * normalizado al valor que devolvió `validarImporte` — el hash I3 (`calcularPayloadHash`, en el caso de uso) se calcula sobre el
 * comando YA VALIDADO por este guard, así que normalizarlo acá no cambia qué payload se hashea ni rompe ningún reintento.
 */
export function guardComandoRegistrarPagoConsignante(entrada: unknown): ResultadoDato<ComandoRegistrarPagoConsignante> {
  const { proveedorId, importe, fecha, notas, claveIdempotencia } = (entrada ?? {}) as {
    proveedorId?: unknown;
    importe?: unknown;
    fecha?: unknown;
    notas?: unknown;
    claveIdempotencia?: unknown;
  };

  if (!texto(proveedorId)) return rechazar("vacio", "Elegí un proveedor.");

  // Mismo validador que el formulario (CampoNumero tipo="importe"): número, no negativo, a lo sumo 2 decimales, dentro del tope.
  const validado = validarImporte(importe, { etiqueta: "El importe", obligatorio: true, permitirCero: false });
  if (!validado.ok) return rechazar(validado.codigo, validado.mensaje);

  const fechaValida = validarFechaOperacion(fecha);
  if (!fechaValida.ok) return rechazar(fechaValida.codigo, fechaValida.mensaje);
  const notasValidas = validarTextoLibre(notas, "Las notas", LARGO_MAXIMO_NOTAS);
  if (!notasValidas.ok) return rechazar(notasValidas.codigo, notasValidas.mensaje);

  if (claveIdempotencia !== undefined && !esClaveIdempotenciaValida(claveIdempotencia)) {
    return rechazar("formato", "Clave de reintento inválida.");
  }

  return aceptar({
    proveedorId: proveedorId as string,
    importe: validado.valor!, // obligatorio: nunca null
    fecha: fechaValida.valor,
    notas: notas as string | undefined,
    claveIdempotencia: claveIdempotencia as string | undefined,
  });
}
