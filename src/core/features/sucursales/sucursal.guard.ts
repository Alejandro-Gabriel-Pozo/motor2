import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { nombreDeFicha } from "@/core/datos/nombre-de-ficha";
import { texto } from "@/core/texto";
import { horaDeCorteValida } from "@/core/tiempo/fecha-de-negocio";

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
 * (vacío; y charset, largo y letra por la ficha NOMBRE_DE_SUCURSAL de Pedernal, desde el 2026-11-16: dueño, «Sí, así (Recomendada)») y el email del primer admin (obligatorio; se compara en minúsculas). Que el nombre esté libre y que el email sea de
 * alguien de la empresa son datos de la base: los resuelve el caso de uso. `input.nombre` se lee igual que antes (un `input` ausente sigue lanzando).
 */
export function guardComandoCrearSucursal(input: { nombre: string; emailPrimerAdmin: string }): ResultadoDato<ComandoCrearSucursal> {
  const nombre = nombreDeFicha(input.nombre, "NOMBRE_DE_SUCURSAL", "El nombre de la sucursal no puede estar vacío.");
  if (!nombre.ok) return rechazar(nombre.codigo === "vacio" ? "vacio" : "formato", nombre.mensaje);

  const email = texto(input.emailPrimerAdmin).toLowerCase();
  if (!email) return rechazar("vacio", "El email del primer admin de la sucursal es obligatorio.");
  return aceptar({ nombre: nombre.valor, email });
}

/**
 * Guard del comando «renombrar una sucursal» (Hito 3, Fase I, I.4): el nombre nuevo, recortado, con EXACTAMENTE las validaciones y los textos que antes
 * corrían en línea en `renombrarSucursal` (vacío —con su propio mensaje, distinto del alta—; y desde el 2026-11-16 charset, largo y letra por la ficha NOMBRE_DE_SUCURSAL). Lo llama la Server Action DENTRO
 * de `conPermisoDeEmpresa("renombrar_sucursal", …)`. Que la sucursal exista y que el nombre esté libre los resuelve el caso de uso contra la base.
 */
export function guardComandoRenombrarSucursal(nombreNuevo: string): ResultadoDato<{ nombre: string }> {
  const nombre = nombreDeFicha(nombreNuevo, "NOMBRE_DE_SUCURSAL", "El nombre no puede estar vacío.");
  if (!nombre.ok) return rechazar(nombre.codigo === "vacio" ? "vacio" : "formato", nombre.mensaje);
  return aceptar({ nombre: nombre.valor });
}

/**
 * Guard del comando «cambiar la hora de corte de una sucursal» (etapa C2c de `docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md`). Lista de permitidos: un texto `HH:MM` estricto, 00:00 a 23:59
 * (`horaDeCorteValida`); todo lo demás (vacío, no texto, `24:00`, `6:00`, `06:00:00`) se rechaza antes de tocar la base. Lo llama la Server Action DENTRO de `conPermisoDeEmpresa("renombrar_sucursal", …)`.
 * Acepta `unknown`: el dato llega de afuera y los tipos solo protegen en compilación.
 */
export function guardComandoCambiarHoraDeCorteDeSucursal(horaDeCorte: unknown): ResultadoDato<{ horaDeCorte: string }> {
  if (!horaDeCorteValida(horaDeCorte)) return rechazar("formato", "La hora de corte tiene que ser una hora válida con formato HH:MM, de 00:00 a 23:59.");
  return aceptar({ horaDeCorte });
}
