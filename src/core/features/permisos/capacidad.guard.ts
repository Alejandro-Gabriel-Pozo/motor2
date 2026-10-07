import { esIdentificador } from "@/core/datos/identificador";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { claveEnCatalogo, type AccionClave } from "@/core/permisos/acciones";

/** El comando «prender o apagar una capacidad» ya validado: `sucursalId: null` es la fila default (ver `CapacidadSucursal` en schema.prisma). */
export interface ComandoActualizarCapacidad {
  accionClave: AccionClave;
  sucursalId: string | null;
  habilitado: boolean;
}

/**
 * Guard del comando «actualizar una capacidad por sucursal» (Hito 3, Fase I, I.1 de `docs/plan-hito-3-pureza.md`). Formato del comando, ANTES de
 * abrir la transacción; lo llama la Server Action `actualizarCapacidad` DENTRO de `conPermisoDeEmpresa("capacidades_sucursal", …)`, así que el
 * rechazo por permiso sigue llegando antes que el de formato. Puro: sin Prisma ni permisos.
 *
 * Las 4 validaciones son EXACTAMENTE las que antes corrían en línea en `src/server/actions/permisos/capacidades-sucursal.ts`, en el MISMO orden y
 * con los MISMOS textos: (1) `capacidades_sucursal` nunca se gobierna a sí misma (Sucursales.js:618, auto-protección); (2) `null` es la fila
 * default a propósito, pero un `undefined` o un objeto es un argumento roto y con `findFirst({ where: { sucursalId } })` tocaría la fila de
 * cualquier sucursal; (3) la clave tiene que ser del catálogo; (4) el valor, un booleano. Que la sucursal EXISTA es un dato de la base: lo
 * resuelve el caso de uso. Devuelve los tres valores tal cual llegaron.
 */
export function guardComandoActualizarCapacidad(entrada: { accionClave: AccionClave; sucursalId: string | null; habilitado: boolean }): ResultadoDato<ComandoActualizarCapacidad> {
  const { accionClave, sucursalId, habilitado } = entrada;
  if (accionClave === "capacidades_sucursal") return rechazar("formato", "Esta acción no se puede gobernar a sí misma.");
  if (sucursalId !== null && !esIdentificador(sucursalId)) return rechazar("formato", "Sucursal inválida.");
  if (!claveEnCatalogo(accionClave)) return rechazar("formato", "Acción inválida.");
  if (typeof habilitado !== "boolean") return rechazar("formato", "Valor inválido.");
  return aceptar({ accionClave, sucursalId, habilitado });
}
