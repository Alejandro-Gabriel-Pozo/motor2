import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { texto, validarTextoCatalogo } from "@/core/texto";

/** El comando «dar de alta una sucursal con su primer admin» ya validado: el nombre recortado y el email recortado en minúsculas. */
export interface ComandoCrearSucursal {
  nombre: string;
  email: string;
}

/**
 * Guard del comando «crear una sucursal con su primer admin» (Hito 3, Fase I, I.4 de `docs/plan-hito-3-pureza.md`). Formato, ANTES de tocar la base; lo llama
 * la Server Action `crearSucursalConAdmin` DENTRO de `conPermisoDeEmpresa("alta_sucursal", …)`, así que el rechazo por permiso sigue llegando antes que el de
 * formato. Puro: sin Prisma ni permisos.
 *
 * Son EXACTAMENTE las validaciones que antes corrían en línea en `src/server/actions/auth/sucursales.ts`, en el MISMO orden y con los MISMOS textos: el nombre
 * (vacío, charset y largo de catálogo) y el email del primer admin (obligatorio; se compara en minúsculas). Que el nombre esté libre y que el email sea de
 * alguien de la empresa son datos de la base: los resuelve el caso de uso. `input.nombre` se lee igual que antes (un `input` ausente sigue lanzando).
 */
export function guardComandoCrearSucursal(input: { nombre: string; emailPrimerAdmin: string }): ResultadoDato<ComandoCrearSucursal> {
  const nombre = texto(input.nombre);
  if (!nombre) return rechazar("vacio", "El nombre de la sucursal no puede estar vacío.");
  const invalido = validarTextoCatalogo(nombre, "El nombre de la sucursal");
  if (invalido) return rechazar("formato", invalido);

  const email = texto(input.emailPrimerAdmin).toLowerCase();
  if (!email) return rechazar("vacio", "El email del primer admin de la sucursal es obligatorio.");
  return aceptar({ nombre, email });
}
