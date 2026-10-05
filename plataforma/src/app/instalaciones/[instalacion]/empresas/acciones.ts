"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enviarCorreo } from "@/core/correo/enviar";
import { esModuloDelCatalogo } from "@/core/modulos/catalogo";
import { modulosDisponiblesParaActivar } from "@/core/modulos/vista-de-modulos";
import { dbDeInstalacion } from "../../../../db";
import { rutaDeEmpresa } from "../../../../rutas";
import { resolverInstalacion } from "../../../../servidor/contexto";
import { dependenciasParaInstalacion } from "../../../../servidor/dependencias";
import { emailsDeAdministradores } from "../../../../servidor/identidad";
import { administradorEnSesion } from "../../../../servidor/sesion";
import { confirmarAltaDeEmpresa, corregirCuitDeEmpresa, reactivarEmpresa, reenviarAvisoDeActivacion, suspenderEmpresa, type ResultadoDeCiclo } from "../../../../servidor/ciclo-de-vida";
import { cambiarModulosDesdeLaConsola } from "../../../../servidor/modulos";
import { darDeAltaEmpresa, invitarDeNuevo, reenviarInvitacion, revocarInvitacion, type ResultadoDeEmpresa } from "../../../../servidor/empresas";

/**
 * Acciones de la consola sobre empresas e invitaciones (E5, ADR-020), por INSTALACIÓN (ADR-025). TODAS reciben el id de la instalación como PRIMER argumento (lo enlaza con `.bind` la
 * página que dibujó el formulario, así una pestaña desactualizada siempre manda la instalación que mostró) y abren con `contextoDeAccion(instalacionId)`: primero la sesión del
 * administrador (el control de acceso de la consola es la sesión, no un rol) y después la instalación contra la lista cerrada del despliegue. Un id desconocido es un 404, nunca la
 * principal. La lógica y su auditoría viven en `servidor/*.ts` y operan sobre la base de ESA instalación; la identidad se lee aparte.
 */
export type EstadoDeFormulario = { tipo: "ok" | "aviso" | "error"; mensaje: string } | null;

const texto = (formData: FormData, campo: string): string => {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor.slice(0, 320) : "";
};

async function contextoDeAccion(instalacionId: string) {
  const admin = await administradorEnSesion();
  if (!admin) redirect("/login");
  const instalacion = resolverInstalacion(instalacionId);
  const deps = dependenciasParaInstalacion(instalacion, { emailsDeAdmins: emailsDeAdministradores, enviar: (mensaje) => enviarCorreo("avisos", mensaje) });
  return { autor: { adminId: admin.adminId, adminEmail: admin.email, instalacionId: instalacion.id }, deps, db: dbDeInstalacion(instalacion), instalacion };
}

function estadoDe(r: ResultadoDeEmpresa): EstadoDeFormulario {
  if (!r.ok) return { tipo: "error", mensaje: r.mensaje };
  return { tipo: r.enviado ? "ok" : "aviso", mensaje: r.mensaje };
}

/** Alta: al salir bien manda al detalle de la empresa (con el aviso si el mail no salió, que ya figura allí como «sin enviar»). */
export async function darDeAlta(instalacionId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, deps, db, instalacion } = await contextoDeAccion(instalacionId);
  const r = await darDeAltaEmpresa(db, deps, autor, {
    nombre: texto(formData, "nombre"),
    slug: texto(formData, "slug"),
    zonaHoraria: texto(formData, "zonaHoraria"),
    moneda: texto(formData, "moneda"),
    nombreSucursal: texto(formData, "nombreSucursal"),
    emailDuenio: texto(formData, "emailDuenio"),
  });
  if (!r.ok) return estadoDe(r);
  redirect(rutaDeEmpresa(instalacion.id, r.empresaId));
}

export async function reenviar(instalacionId: string, empresaId: string): Promise<EstadoDeFormulario> {
  const { autor, deps, db, instalacion } = await contextoDeAccion(instalacionId);
  const r = estadoDe(await reenviarInvitacion(db, deps, autor, empresaId));
  revalidatePath(rutaDeEmpresa(instalacion.id, empresaId));
  return r;
}

export async function revocar(instalacionId: string, empresaId: string): Promise<EstadoDeFormulario> {
  const { autor, db, instalacion } = await contextoDeAccion(instalacionId);
  const r = await revocarInvitacion(db, autor, empresaId, new Date());
  if (r.ok) redirect(`${rutaDeEmpresa(instalacion.id, empresaId)}?hecho=revocada`);
  return { tipo: "error", mensaje: r.mensaje };
}

export async function invitarOtraVez(instalacionId: string, empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, deps, db, instalacion } = await contextoDeAccion(instalacionId);
  const r = estadoDe(await invitarDeNuevo(db, deps, autor, empresaId, texto(formData, "email")));
  revalidatePath(rutaDeEmpresa(instalacion.id, empresaId));
  return r;
}

function estadoDeCiclo(r: ResultadoDeCiclo): EstadoDeFormulario {
  if (!r.ok) return { tipo: "error", mensaje: r.mensaje };
  return { tipo: r.enviado === false ? "aviso" : "ok", mensaje: r.mensaje };
}

const marcado = (formData: FormData, campo: string): boolean => formData.get(campo) === "on";

/** E6: confirma el alta (PROVISIONING → ACTIVE) con el CUIT del formulario; avisa al gerente después del commit. */
export async function confirmar(instalacionId: string, empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, deps, db, instalacion } = await contextoDeAccion(instalacionId);
  const r = await confirmarAltaDeEmpresa(db, deps, autor, empresaId, {
    cuit: texto(formData, "cuit"),
    revisado: marcado(formData, "revisado"),
    aceptoCuitDistinto: marcado(formData, "aceptoCuitDistinto"),
  });
  if (r.ok) redirect(`${rutaDeEmpresa(instalacion.id, empresaId)}?hecho=${r.enviado === false ? "confirmada-sin-aviso" : "confirmada"}`);
  return estadoDeCiclo(r);
}

export async function corregirCuit(instalacionId: string, empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, deps, db, instalacion } = await contextoDeAccion(instalacionId);
  const r = estadoDeCiclo(await corregirCuitDeEmpresa(db, deps, autor, empresaId, { cuit: texto(formData, "cuit"), motivo: texto(formData, "motivo") }));
  revalidatePath(rutaDeEmpresa(instalacion.id, empresaId));
  return r;
}

/** Quitar el CUIT (solo de una empresa suspendida): la misma función con el CUIT vacío. */
export async function quitarCuit(instalacionId: string, empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, deps, db, instalacion } = await contextoDeAccion(instalacionId);
  const r = estadoDeCiclo(await corregirCuitDeEmpresa(db, deps, autor, empresaId, { cuit: "", motivo: texto(formData, "motivo") }));
  revalidatePath(rutaDeEmpresa(instalacion.id, empresaId));
  return r;
}

export async function suspender(instalacionId: string, empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, db, instalacion } = await contextoDeAccion(instalacionId);
  const r = await suspenderEmpresa(db, autor, empresaId, texto(formData, "motivo"));
  if (r.ok) redirect(`${rutaDeEmpresa(instalacion.id, empresaId)}?hecho=suspendida`);
  return estadoDeCiclo(r);
}

export async function reactivar(instalacionId: string, empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, db, instalacion } = await contextoDeAccion(instalacionId);
  const r = await reactivarEmpresa(db, autor, empresaId, texto(formData, "motivo"));
  if (r.ok) redirect(`${rutaDeEmpresa(instalacion.id, empresaId)}?hecho=reactivada`);
  return estadoDeCiclo(r);
}

export async function reenviarAviso(instalacionId: string, empresaId: string): Promise<EstadoDeFormulario> {
  const { autor, deps, db, instalacion } = await contextoDeAccion(instalacionId);
  const r = estadoDeCiclo(await reenviarAvisoDeActivacion(db, deps, autor, empresaId));
  revalidatePath(rutaDeEmpresa(instalacion.id, empresaId));
  return r;
}

/**
 * Activar o desactivar UN módulo de la empresa (E7, ADR-023). Si sale bien redirige con `?hecho=` y el módulo (validado contra el catálogo): el botón que se usó cambia de
 * lugar y su formulario no sobrevive, así que el resultado se muestra con texto fijo en la página.
 */
export async function cambiarModulo(instalacionId: string, empresaId: string, modulo: string, operacion: "activar" | "desactivar"): Promise<EstadoDeFormulario> {
  const { autor, db, instalacion } = await contextoDeAccion(instalacionId);
  if (!esModuloDelCatalogo(modulo)) return { tipo: "error", mensaje: "Ese módulo no existe." };
  const r = await cambiarModulosDesdeLaConsola(db, autor, empresaId, { [operacion]: [modulo] });
  if (!r.ok) return { tipo: "error", mensaje: r.mensaje };
  revalidatePath(rutaDeEmpresa(instalacion.id, empresaId));
  redirect(`${rutaDeEmpresa(instalacion.id, empresaId, "modulos")}?hecho=${operacion === "activar" ? "modulo-activado" : "modulo-desactivado"}&modulo=${modulo}`);
}

/** Activar de una vez todos los módulos disponibles que la empresa todavía no tiene. */
export async function activarTodosLosModulos(instalacionId: string, empresaId: string): Promise<EstadoDeFormulario> {
  const { autor, db, instalacion } = await contextoDeAccion(instalacionId);
  const actuales = await db.moduloEmpresa.findMany({ where: { empresaId, estado: "ACTIVO" }, select: { modulo: true } });
  const r = await cambiarModulosDesdeLaConsola(db, autor, empresaId, { activar: modulosDisponiblesParaActivar(actuales.map((f) => f.modulo)) });
  if (!r.ok) return { tipo: "error", mensaje: r.mensaje };
  revalidatePath(rutaDeEmpresa(instalacion.id, empresaId));
  redirect(`${rutaDeEmpresa(instalacion.id, empresaId, "modulos")}?hecho=modulos-todos`);
}
