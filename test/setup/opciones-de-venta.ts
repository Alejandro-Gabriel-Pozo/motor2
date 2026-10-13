import { baseDeTest, EMPRESA_POR_DEFECTO_ID } from "./test-db";
import { AHORA_DE_LA_CORRIDA } from "./tiempo";

/**
 * Ayudas de los tests de ADMINISTRACIÓN del catálogo de opciones de venta (GO-2a): el actor con el que se llama a un caso de uso directo, como lo arma `conPermiso` en producción
 * (`motor2_app`, con el alcance de su sucursal activa para lectura y escritura) y con la hora del pedido fija. Lo usan `opciones-grupos`, `opciones-versiones`, `opciones-adicional`,
 * `opciones-admision`, `opciones-por-sucursal` y sus pruebas de concurrencia.
 */
export function actorDePrueba(usuarioId: string, sucursalId: string, ahora: Date = AHORA_DE_LA_CORRIDA) {
  return {
    usuarioId,
    empresaId: EMPRESA_POR_DEFECTO_ID,
    sucursalId,
    sucursalNombre: "Central",
    ahora,
    ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }),
  };
}
