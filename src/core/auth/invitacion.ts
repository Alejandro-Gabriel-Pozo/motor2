import type { EstadoEfectivoDeInvitacion } from "@/core/features/empresa/invitacion";
import { sirvePorHttps } from "./cookie-sesion";

/**
 * Invitación del primer gerente, del lado de la app de empresas (E5, ADR-020), y de usuario y de vinculación (E8, ADR-024): las reglas PURAS (sin base ni reloj propio). Lo que
 * lee la base por el token (`invitacionDelToken`), las aceptaciones y la vinculación de la cuenta de Google viven en `server/sesion/` (Hito 3, B3-3 de
 * `docs/plan-hito-3-pureza.md`): este archivo era P3 (leía y escribía la base y el reloj) y queda P0.
 *
 * El token viaja en el fragmento del enlace; `abrirInvitacion` lo pasa a una cookie httpOnly para que sobreviva al ida y vuelta con Google. Esa
 * cookie es `SameSite=Lax` a propósito: con Strict no viajaría en el regreso desde accounts.google.com.
 */

const COOKIE_INVITACION_HTTP = "motor2.invitacion";
const COOKIE_INVITACION_HOST = "__Host-motor2.invitacion";
/** La cookie vive como mucho una hora (o hasta el vencimiento de la invitación, lo que ocurra antes). */
const VIDA_MAXIMA_COOKIE_INVITACION_S = 3600;

interface EntornoCookie {
  NODE_ENV?: string;
  VERCEL?: string;
  AUTH_URL?: string;
}

export function nombreCookieInvitacion(env: EntornoCookie): string {
  return sirvePorHttps(env) ? COOKIE_INVITACION_HOST : COOKIE_INVITACION_HTTP;
}

export function opcionesCookieInvitacion(env: EntornoCookie, venceEn: Date, ahora: Date) {
  const hastaElVencimiento = Math.floor((venceEn.getTime() - ahora.getTime()) / 1000);
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: sirvePorHttps(env),
    maxAge: Math.max(0, Math.min(VIDA_MAXIMA_COOKIE_INVITACION_S, hastaElVencimiento)),
  };
}

/** Lo que la pantalla y el gate necesitan saber de una invitación. Nunca incluye el hash. */
/** El tipo de la invitación de E5 (primer gerente de una empresa en alta). Es un tipo de invitación, no una decisión de acceso. */
const TIPO_INVITACION_GERENTE = "gerente";
export const TIPO_INVITACION_USUARIO = "usuario";
export const TIPO_INVITACION_VINCULACION = "vinculacion";

export interface VistaDeInvitacion {
  id: string;
  empresaId: string;
  nombreEmpresa: string;
  estadoEmpresa: "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "DELETING";
  email: string;
  /** El tipo de invitación (columna `rolEmpresa`): hoy solo `gerente`; E8 suma `usuario` y `vinculacion`. */
  tipo: string;
  estado: EstadoEfectivoDeInvitacion;
  venceEn: Date;
}

/** La vía 3 la abren la invitación de gerente (empresa en alta) y la de usuario (empresa activa). La de vinculación NO abre nada: el ingreso lo decide la vía 2. */
export function abreLaVia3(vista: Pick<VistaDeInvitacion, "tipo" | "estadoEmpresa">): boolean {
  return (vista.tipo === TIPO_INVITACION_GERENTE && vista.estadoEmpresa === "PROVISIONING") || (vista.tipo === TIPO_INVITACION_USUARIO && vista.estadoEmpresa === "ACTIVE");
}

/**
 * Qué clase de invitación es, según su tipo y el estado de su empresa: `alta-de-empresa` (la del primer gerente, empresa en alta), `acceso-a-empresa` (la de usuario, empresa activa), `vinculacion` (empresa activa) o `inservible`
 * (un tipo con una empresa que no corresponde, por ejemplo una de usuario de una empresa suspendida). Lo usa la pantalla `/invitacion` para decidir qué mostrar.
 */
export function claseDeInvitacion(vista: Pick<VistaDeInvitacion, "tipo" | "estadoEmpresa">): "alta-de-empresa" | "acceso-a-empresa" | "vinculacion" | "inservible" {
  if (vista.tipo === TIPO_INVITACION_GERENTE && vista.estadoEmpresa === "PROVISIONING") return "alta-de-empresa";
  if (vista.tipo === TIPO_INVITACION_USUARIO && vista.estadoEmpresa === "ACTIVE") return "acceso-a-empresa";
  if (vista.tipo === TIPO_INVITACION_VINCULACION && vista.estadoEmpresa === "ACTIVE") return "vinculacion";
  return "inservible";
}

/** Una invitación sirve para VINCULAR la cuenta de Google si es de gerente (en alta), de usuario (activa) o de vinculación (activa). */
export function sirveParaVincular(vista: Pick<VistaDeInvitacion, "tipo" | "estadoEmpresa">): boolean {
  return abreLaVia3(vista) || (vista.tipo === TIPO_INVITACION_VINCULACION && vista.estadoEmpresa === "ACTIVE");
}

/** Los campos que Auth.js guardaría de la cuenta de Google (`defaultAccount`): el `id_token` en particular lo lee el detector de cuentas ajenas (S-01). */
export interface CuentaDeGoogle {
  providerAccountId: string;
  type?: string | undefined;
  access_token?: string | null | undefined;
  refresh_token?: string | null | undefined;
  id_token?: string | null | undefined;
  expires_at?: number | null | undefined;
  scope?: string | null | undefined;
  token_type?: string | null | undefined;
  session_state?: string | null | undefined;
}
