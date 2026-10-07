import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { mensajeSiNombreDeRolNoPermitido, normalizarNombreDeRol } from "@/core/permisos/nombres-de-rol";

/**
 * Guard del comando «crear un rol» (Hito 3, Fase I, I.2 de `docs/plan-hito-3-pureza.md`). Formato, ANTES de tocar la base; lo llama la Server Action `crearRol`
 * DENTRO de `conEdicionDePermisos("gestion_roles", …)`, así que el rechazo por permiso (y por la política de plataforma) sigue llegando antes que el de
 * formato. Puro: sin Prisma ni permisos.
 *
 * Es EXACTAMENTE lo que antes corría en línea en `src/server/actions/permisos/roles.ts`: el nombre se normaliza (`normalizarNombreDeRol`) y se juzga con
 * las reglas de `core/permisos/nombres-de-rol` para un rol creado a mano (clave `null`: los nombres de fábrica están reservados), con el MISMO mensaje.
 * Devuelve el nombre YA normalizado: es el que se busca, se guarda y se audita.
 *
 * Renombrar no tiene guard: la regla del nombre depende de la clave del rol, que se lee dentro de la transacción serializable (y «No se encontró ese rol»
 * va antes que el nombre); por eso `renombrarRol` está en `SIN_GUARD` (`acciones-migradas-con-guard.test.ts`).
 */
export function guardComandoCrearRol(nombre: unknown): ResultadoDato<{ nombre: string }> {
  const n = normalizarNombreDeRol(nombre);
  const rechazo = mensajeSiNombreDeRolNoPermitido(n, null);
  if (rechazo) return rechazar(n ? "formato" : "vacio", rechazo);
  return aceptar({ nombre: n });
}
