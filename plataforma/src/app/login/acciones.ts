"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { azarDelProceso } from "@/lib/azar";
import { enviarCorreo } from "@/lib/enviar-correo";
import { reportarError } from "@/lib/reportar-error";
import { generarPedidoDeIngreso } from "@/core/plataforma/pedido-de-ingreso";
import { dbDeIdentidad } from "../../db";
import { entornoDePlataforma } from "../../entorno";
import { auditarAccionDePlataforma } from "../../servidor/auditoria";
import { prepararCodigoDeIngreso, verificarCodigoDeIngreso, verificarSegundoFactor, type DependenciasDeIngreso } from "../../servidor/ingreso";
import { origenDelPedido, origenSinCupoDeCodigos } from "../../servidor/limitador-de-pedidos";
import {
  borrarCookieDePedido,
  borrarCookieDeSesion,
  cerrarSesionDelToken,
  administradorEnSesion,
  pedidoDeLaCookie,
  ponerCookieDePedido,
  ponerCookieDePendiente,
  ponerCookieDeSesion,
  tokenDeLaCookie,
} from "../../servidor/sesion";

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

/**
 * Paso 1: pide el código. La respuesta es la misma exista o no el email, y llega al mismo tiempo: acá NO se toca la base. Se genera SIEMPRE un pedido nuevo
 * (el código del mail queda atado a la cookie de ESTE navegador) y toda la preparación —buscar al administrador, contar el cupo, crear el código y mandar el
 * mail— corre después de responder, en `after()` (S-08, B-C15). Si este origen ya gastó su cupo de pedidos, no se prepara nada y se responde igual.
 */
export async function pedirCodigo(_: EstadoDeIngreso, formData: FormData): Promise<EstadoDeIngreso> {
  const email = texto(formData, "email").trim();
  if (email === "") return { paso: "email", email, error: "Ingresá tu email." };
  const deps = dependencias();
  const pedido = generarPedidoDeIngreso(azarDelProceso);
  await ponerCookieDePedido(pedido, deps.ahora());
  if (!origenSinCupoDeCodigos(origenDelPedido(await headers()), deps.ahora().getTime())) {
    after(async () => {
      try {
        const mensaje = await prepararCodigoDeIngreso(dbDeIdentidad(), deps, email, pedido);
        if (mensaje) await enviarCorreo("avisos", mensaje);
      } catch (error) {
        // Sin el mensaje original: un error de la base puede nombrar valores (el email). Solo el tipo.
        await reportarError(new Error(`Consola: no se pudo preparar el código de ingreso (${error instanceof Error ? error.name : "desconocido"})`), "consola-ingreso");
      }
    });
  }
  return { paso: "codigo", email, error: null };
}

/** Paso 2: verifica el código del mail con el pedido de la cookie de este navegador y abre la sesión pendiente. */
export async function enviarCodigoDelMail(estado: EstadoDeIngreso, formData: FormData): Promise<EstadoDeIngreso> {
  const email = texto(formData, "email").trim();
  const deps = dependencias();
  const resultado = await verificarCodigoDeIngreso(dbDeIdentidad(), deps, email, texto(formData, "codigo"), await pedidoDeLaCookie());
  if (!resultado.ok) return { paso: "codigo", email: estado.email || email, error: CODIGO_INVALIDO };
  await borrarCookieDePedido();
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
