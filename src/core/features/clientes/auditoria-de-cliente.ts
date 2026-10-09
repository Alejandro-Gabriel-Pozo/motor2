/**
 * La fila de auditoría de un cambio de cliente (entidad «Cliente», sin sucursal: es del catálogo central), tal como la armaba `auditarCliente` de
 * `src/server/actions/clientes/cliente.ts` (Hito 4 de la pureza, paso H4C-15): misma entidad, mismo id, mismo campo y la MISMA descripción
 * (`Cliente "<nombre>": % de descuento | activo | nombre`). Puro: solo arma el objeto; lo escribe cada caso de uso con `registrarCambioAuditado`, en la MISMA
 * transacción que el cambio (así `escrituras-auditadas` ve la auditoría en la misma función que escribe el %).
 */
export function cambioDeCliente(
  actorId: string,
  clienteId: string,
  nombre: string,
  campo: "nombre" | "descuentoPorcentaje" | "activo",
  anterior: unknown,
  nuevo: unknown,
): { entidad: "Cliente"; entidadId: string; campo: string; descripcion: string; valorAnterior: unknown; valorNuevo: unknown; actorId: string } {
  return {
    entidad: "Cliente",
    entidadId: clienteId,
    campo,
    descripcion: `Cliente "${nombre}": ${campo === "descuentoPorcentaje" ? "% de descuento" : campo === "activo" ? "activo" : "nombre"}`,
    valorAnterior: anterior,
    valorNuevo: nuevo,
    actorId,
  };
}
