"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { enviarCorreo } from "@/core/correo/enviar";
import { dbDeIdentidad } from "../../db";
import { entornoDePlataforma } from "../../entorno";
import { auditarAccionDePlataforma } from "../../servidor/auditoria";
import { prepararCodigoDeIngreso, verificarCodigoDeIngreso, verificarSegundoFactor, type DependenciasDeIngreso } from "../../servidor/ingreso";
import { borrarCookieDeSesion, cerrarSesionDelToken, administradorEnSesion, ponerCookieDePendiente, ponerCookieDeSesion, tokenDeLaCookie } from "../../servidor/sesion";

export type EstadoDeIngreso = { paso: "email" | "codigo" | "segundo-factor"; email: string; error: string | null };

function dependencias(): DependenciasDeIngreso {
  const entorno = entornoDePlataforma();
  return { ahora: () => new Date(), secretoDeCodigos: entorno.PLATAFORMA_SECRETO_CODIGOS, claveTotp: entorno.PLATAFORMA_CLAVE_TOTP };
}

const texto = (formData: FormData, campo: string): string => {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor.slice(0, 320) : "";
};

// Mismo texto para todo fallo del código del mail: no se dice si el email existe, si el código venció o si estaba mal.
const CODIGO_INVALIDO = "El código no es válido o venció. Pedí uno nuevo.";

/** Paso 1: pide el código. La respuesta es la misma exista o no el email; el mail sale después de responder. */
export async function pedirCodigo(_: EstadoDeIngreso, formData: FormData): Promise<EstadoDeIngreso> {
  const email = texto(formData, "email").trim();
  if (email === "") return { paso: "email", email, error: "Ingresá tu email." };
  const mensaje = await prepararCodigoDeIngreso(dbDeIdentidad(), dependencias(), email);
  if (mensaje) after(() => enviarCorreo("avisos", mensaje));
  return { paso: "codigo", email, error: null };
}

/** Paso 2: verifica el código del mail y abre la sesión pendiente. */
export async function enviarCodigoDelMail(estado: EstadoDeIngreso, formData: FormData): Promise<EstadoDeIngreso> {
  const email = texto(formData, "email").trim();
  const deps = dependencias();
  const resultado = await verificarCodigoDeIngreso(dbDeIdentidad(), deps, email, texto(formData, "codigo"));
  if (!resultado.ok) return { paso: "codigo", email: estado.email || email, error: CODIGO_INVALIDO };
  await ponerCookieDePendiente(resultado.token, deps.ahora());
  return { paso: "segundo-factor", email, error: null };
}

/** Paso 3: verifica el TOTP (o un código de recuperación). Si acierta, la sesión queda vigente y entra a la consola. */
export async function enviarSegundoFactor(estado: EstadoDeIngreso, formData: FormData): Promise<EstadoDeIngreso> {
  const token = await tokenDeLaCookie();
  if (!token) return { paso: "email", email: "", error: "La sesión venció. Empezá de nuevo." };
  const resultado = await verificarSegundoFactor(dbDeIdentidad(), dependencias(), token, texto(formData, "factor"));
  if (!resultado.ok) {
    if (resultado.motivo === "SESION_INVALIDA") {
      await borrarCookieDeSesion();
      return { paso: "email", email: "", error: "La sesión venció. Empezá de nuevo." };
    }
    if (resultado.adminId && resultado.adminEmail) {
      const autor = { adminId: resultado.adminId, adminEmail: resultado.adminEmail };
      if (resultado.motivo === "INCORRECTO") await auditarAccionDePlataforma(autor, "segundo-factor-fallido");
      if (resultado.seBloqueo) await auditarAccionDePlataforma(autor, "bloqueo-por-fallos");
    }
    if (resultado.motivo === "BLOQUEADO" || resultado.seBloqueo) {
      await borrarCookieDeSesion();
      return { paso: "email", email: "", error: "Demasiados intentos. Esperá un rato antes de volver a intentar." };
    }
    return { paso: "segundo-factor", email: estado.email, error: "El código no es válido." };
  }
  await auditarAccionDePlataforma({ adminId: resultado.adminId, adminEmail: resultado.adminEmail }, "ingreso");
  await ponerCookieDeSesion(resultado.token, resultado.vencimiento);
  redirect("/");
}

export async function salir(): Promise<void> {
  const admin = await administradorEnSesion();
  const token = await tokenDeLaCookie();
  if (token) await cerrarSesionDelToken(token);
  if (admin) await auditarAccionDePlataforma({ adminId: admin.adminId, adminEmail: admin.email }, "cierre-de-sesion");
  await borrarCookieDeSesion();
  redirect("/login");
}
