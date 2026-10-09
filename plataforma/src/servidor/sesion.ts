import "server-only";
import { cookies } from "next/headers";
import { sirvePorHttps } from "@/core/auth/cookie-sesion";
import { hashDeToken } from "@/core/seguridad/tokens";
import { VIDA_DEL_CODIGO_DE_INGRESO_MS } from "@/core/plataforma/limites";
import { COOKIE_DE_PEDIDO_HTTP, COOKIE_DE_PEDIDO_HTTPS, leerPedidoDeIngreso, serializarPedidoDeIngreso, type PedidoDeIngreso } from "@/core/plataforma/pedido-de-ingreso";
import { VIDA_DE_SESION_PENDIENTE_MS, debeAnotarActividad, sesionVigente } from "@/core/plataforma/sesion";
import { dbDeIdentidad } from "../db";

/**
 * Cookie de sesión de la consola (ADR-012 §2). Propia: no es la de Auth.js ni se parece a ella. En https lleva el prefijo `__Host-` (el navegador la
 * acepta solo con `Secure`, `Path=/` y sin `Domain`: ningún subdominio hermano la puede pisar). Sin https (desarrollo local) no se puede usar `__Host-`.
 *
 * El valor es un token opaco; en la base queda solo su SHA-256. La misma cookie sirve para la sesión pendiente (entre el código del mail y el TOTP,
 * 10 minutos) y para la vigente (hasta 8 horas): lo que las distingue es `segundoFactorEn` en la base, nunca algo que viaje en la cookie.
 */
const COOKIE_HTTPS = "__Host-plataforma.sesion";
const COOKIE_HTTP = "plataforma.sesion";

const https = () => sirvePorHttps(process.env);
const nombreDeCookie = () => (https() ? COOKIE_HTTPS : COOKIE_HTTP);

export async function ponerCookieDeSesion(token: string, vence: Date): Promise<void> {
  (await cookies()).set(nombreDeCookie(), token, { httpOnly: true, secure: https(), sameSite: "strict", path: "/", expires: vence });
}

/** Cookie de la sesión pendiente: vive lo mismo que ella. */
export async function ponerCookieDePendiente(token: string, ahora: Date): Promise<void> {
  await ponerCookieDeSesion(token, new Date(ahora.getTime() + VIDA_DE_SESION_PENDIENTE_MS));
}

export async function borrarCookieDeSesion(): Promise<void> {
  (await cookies()).delete(nombreDeCookie());
}

/**
 * Cookie del PEDIDO de un código de ingreso (S-08): ata el código del mail al navegador que lo pidió. Mismas reglas que la de sesión (`__Host-` en https, `httpOnly`,
 * `SameSite=Strict`, `Path=/`) y vive lo que el código (10 minutos). Se pone SIEMPRE al pedir, exista o no el email, para que la respuesta no delate nada.
 */
const nombreDeCookieDePedido = () => (https() ? COOKIE_DE_PEDIDO_HTTPS : COOKIE_DE_PEDIDO_HTTP);

export async function ponerCookieDePedido(pedido: PedidoDeIngreso, ahora: Date): Promise<void> {
  (await cookies()).set(nombreDeCookieDePedido(), serializarPedidoDeIngreso(pedido), {
    httpOnly: true,
    secure: https(),
    sameSite: "strict",
    path: "/",
    expires: new Date(ahora.getTime() + VIDA_DEL_CODIGO_DE_INGRESO_MS),
  });
}

/** El pedido de la cookie, o `null` si falta o no tiene la forma que se genera. */
export async function pedidoDeLaCookie(): Promise<PedidoDeIngreso | null> {
  return leerPedidoDeIngreso((await cookies()).get(nombreDeCookieDePedido())?.value);
}

export async function borrarCookieDePedido(): Promise<void> {
  (await cookies()).delete(nombreDeCookieDePedido());
}

export async function tokenDeLaCookie(): Promise<string | null> {
  return (await cookies()).get(nombreDeCookie())?.value || null;
}

export interface AdministradorEnSesion {
  sesionId: string;
  adminId: string;
  email: string;
  nombre: string;
}

/**
 * El administrador de la sesión vigente, o `null`. Una sesión pendiente (sin segundo factor) NO cuenta. Anota la actividad (como mucho una vez por
 * minuto) para que corra el límite de 30 minutos sin actividad. No escribe cookies: se puede llamar desde cualquier Server Component.
 */
export async function administradorEnSesion(ahora: Date = new Date()): Promise<AdministradorEnSesion | null> {
  const token = await tokenDeLaCookie();
  if (!token) return null;
  const db = dbDeIdentidad();
  const sesion = await db.sesionPlataforma.findUnique({
    where: { hashToken: hashDeToken(token) },
    select: {
      id: true,
      segundoFactorEn: true,
      creadaEn: true,
      ultimaActividad: true,
      cerradaEn: true,
      admin: { select: { id: true, email: true, nombre: true, activo: true } },
    },
  });
  if (!sesion || sesion.segundoFactorEn === null || !sesion.admin.activo || !sesionVigente(sesion, ahora)) return null;
  if (debeAnotarActividad(sesion, ahora)) await db.sesionPlataforma.update({ where: { id: sesion.id }, data: { ultimaActividad: ahora } });
  return { sesionId: sesion.id, adminId: sesion.admin.id, email: sesion.admin.email, nombre: sesion.admin.nombre };
}

/** Cierra la sesión del token (vigente o pendiente) en la base. Idempotente. */
export async function cerrarSesionDelToken(token: string, ahora: Date = new Date()): Promise<void> {
  await dbDeIdentidad().sesionPlataforma.updateMany({ where: { hashToken: hashDeToken(token), cerradaEn: null }, data: { cerradaEn: ahora } });
}
