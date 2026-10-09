"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/core/auth/session";
import { requierePermiso } from "@/server/acceso/gate";
import { nombreCookieInvitacion, opcionesCookieInvitacion } from "@/core/auth/invitacion";
import { invitacionDelToken } from "@/server/sesion/invitacion";
import { MENSAJE_ENLACE_NO_VALIDO } from "@/core/features/empresa/aceptar-invitacion";
import { esTokenConFormaValida } from "@/core/features/empresa/invitacion";
import { error, type ResultadoAccion } from "../tipos";
import { MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION, origenDelPedido, origenSinCupoParaAbrirInvitacion } from "../limitador-anonimo";
import { aceptarInvitacionDeGerenteCasoDeUso } from "./casos-de-uso/aceptar-invitacion-de-gerente";
import { aceptarInvitacionDeUsuarioCasoDeUso } from "./casos-de-uso/aceptar-invitacion-de-usuario";

/**
 * Invitación del primer gerente, pantalla `/invitacion` (E5, ADR-020). Las dos acciones son previas al contexto de empresa: la primera es pública (su
 * control de acceso es conocer el token) y la segunda exige la sesión de quien aceptará.
 *
 * El token llega en el fragmento del enlace, que el navegador no manda al servidor: un componente del cliente lo lee y lo pasa a `abrirInvitacion`,
 * que lo guarda en una cookie httpOnly para que sobreviva al ida y vuelta con Google (no queda en la URL ni en logs).
 */

/** Guarda el token del enlace en la cookie de invitación y recarga `/invitacion`. Un enlace que no corresponde a ninguna invitación vuelve como error sin más datos. */
export async function abrirInvitacion(token: string): Promise<ResultadoAccion> {
  if (typeof token !== "string" || !esTokenConFormaValida(token)) return error(MENSAJE_ENLACE_NO_VALIDO);
  const ahora = new Date();
  // S-27 (GT-8): es una puerta ANÓNIMA que consulta la base compartida con cada token de forma válida. El cupo por origen (best effort, en memoria) corta el bucle de un solo
  // origen ANTES de la consulta; un token mal formado ya volvió arriba sin gastar nada ni contar.
  if (origenSinCupoParaAbrirInvitacion(origenDelPedido(await headers()), ahora.getTime())) return error(MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION);
  const vista = await invitacionDelToken(token, ahora);
  // Solo una invitación pendiente merece cookie: una vencida (maxAge 0) ni se guardaría, y el resto no tiene nada más que mostrar que «ya no sirve».
  if (!vista || vista.estado !== "PENDIENTE") return error(MENSAJE_ENLACE_NO_VALIDO);
  const cookieStore = await cookies();
  cookieStore.set(nombreCookieInvitacion(process.env), token, opcionesCookieInvitacion(process.env, vista.venceEn, ahora));
  redirect("/invitacion");
}

/**
 * Acepta la invitación del token de la cookie con la cuenta de la sesión y el CUIT del formulario. Al salir bien, borra la cookie y manda a `/login`, que explica que la empresa está en alta.
 * Adaptador de su caso de uso (`casos-de-uso/aceptar-invitacion-de-gerente.ts`, Hito 3, B3-5): sesión, token de la cookie y la hora del pedido entran; los efectos de Next (cookie,
 * redirect) se quedan acá. Sin `conPermiso*` (quien acepta no tiene membresía todavía: `CASOS_SIN_PERMISO`), sin `guardComando*` (el token lo valida el caso de uso contra la base:
 * `SIN_GUARD`) y sin `aResultadoAccion` (de su resultado solo sale el mensaje, por `error`: `SIN_ENVOLTORIO_TODAVIA`).
 */
export async function aceptarMiInvitacion(formData: FormData): Promise<ResultadoAccion> {
  const usuario = await getUsuarioActual();
  if (!usuario) return error("Tu sesión venció. Entrá de nuevo con Google.");
  const cookieStore = await cookies();
  const token = cookieStore.get(nombreCookieInvitacion(process.env))?.value;
  if (!token) return error(MENSAJE_ENLACE_NO_VALIDO);
  const cuit = formData.get("cuit");
  const resultado = await aceptarInvitacionDeGerenteCasoDeUso({ token, usuario: { id: usuario.id, email: usuario.email }, cuit: typeof cuit === "string" ? cuit : "", ahora: new Date() });
  if (!resultado.ok) return error(resultado.mensaje);
  cookieStore.delete(nombreCookieInvitacion(process.env));
  redirect("/login");
}

/**
 * Acepta la invitación de USUARIO del token de la cookie con la cuenta de la sesión (E8, ADR-024): se crean sus membresías, revalidando el permiso de quien las otorgó.
 * Al salir bien borra la cookie y manda a `/login`, que lo lleva a la empresa (o a elegir una). Adaptador de su caso de uso (`casos-de-uso/aceptar-invitacion-de-usuario.ts`,
 * Hito 3, B3-7), al que le pasa el `requierePermiso` REAL del gate para revalidar a quien otorgó (`invitacion-recibe-el-guard`). Como la de gerente: sin `conPermiso*`
 * (`CASOS_SIN_PERMISO`), sin `guardComando*` (`SIN_GUARD`) y sin `aResultadoAccion` (`SIN_ENVOLTORIO_TODAVIA`).
 */
export async function aceptarMiInvitacionDeUsuario(): Promise<ResultadoAccion> {
  const usuario = await getUsuarioActual();
  if (!usuario) return error("Tu sesión venció. Entrá de nuevo con Google.");
  const cookieStore = await cookies();
  const token = cookieStore.get(nombreCookieInvitacion(process.env))?.value;
  if (!token) return error(MENSAJE_ENLACE_NO_VALIDO);
  const resultado = await aceptarInvitacionDeUsuarioCasoDeUso({ token, usuario: { id: usuario.id, email: usuario.email }, ahora: new Date() }, requierePermiso);
  if (!resultado.ok) return error(resultado.mensaje);
  cookieStore.delete(nombreCookieInvitacion(process.env));
  redirect("/login");
}
