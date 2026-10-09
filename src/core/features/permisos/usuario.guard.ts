import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { texto } from "@/core/texto";

/** El comando «agregar o actualizar a una persona en una sucursal» ya validado: el email recortado y en minúsculas; el resto, tal como llegó. */
export interface ComandoAgregarOActualizarUsuario {
  email: string;
  sucursalId: string;
  rolId: string;
  notas?: string;
}

/**
 * Guard del comando «agregar o actualizar a una persona en una sucursal» (Hito 3, Fase I, I.5j de `docs/plan-hito-3-pureza.md`). Formato, ANTES de tocar la base; lo
 * llama la Server Action `agregarOActualizarUsuario` DENTRO de `conPermiso("gestion_usuarios", …)`, así que el rechazo por permiso sigue llegando antes que el de
 * formato. Puro: sin Prisma ni permisos.
 *
 * Es EXACTAMENTE lo que antes corría en línea al principio de la acción: el email recortado y en minúsculas, obligatorio («El email es obligatorio.»). La sucursal, el
 * rol y las notas pasan tal cual llegaron (que existan y sean de la empresa lo resuelve el caso de uso contra la base, dentro de la transacción de gobierno; las notas
 * se guardan solo si vinieron, sin normalizar, como siempre). `input.email` se lee igual que antes (un `input` ausente sigue lanzando).
 */
export function guardComandoAgregarOActualizarUsuario(input: { email: string; sucursalId: string; rolId: string; notas?: string }): ResultadoDato<ComandoAgregarOActualizarUsuario> {
  const email = texto(input.email).toLowerCase();
  if (!email) return rechazar("vacio", "El email es obligatorio.");
  return aceptar({ email, sucursalId: input.sucursalId, rolId: input.rolId, ...(input.notas !== undefined && { notas: input.notas }) });
}
