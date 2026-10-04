"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enviarCorreo } from "@/core/correo/enviar";
import { dbPlataforma } from "../../db";
import { entornoDePlataforma } from "../../entorno";
import { administradorEnSesion } from "../../servidor/sesion";
import { confirmarAltaDeEmpresa, corregirCuitDeEmpresa, reactivarEmpresa, reenviarAvisoDeActivacion, suspenderEmpresa, type ResultadoDeCiclo } from "../../servidor/ciclo-de-vida";
import { darDeAltaEmpresa, invitarDeNuevo, reenviarInvitacion, revocarInvitacion, type DependenciasDeEmpresas, type ResultadoDeEmpresa } from "../../servidor/empresas";

/**
 * Acciones de la consola sobre empresas e invitaciones (E5, ADR-020). TODAS abren con `administradorEnSesion()`: sin sesión vigente con segundo factor no
 * se hace nada (el control de acceso de la consola es la sesión, no un rol). La lógica y su auditoría viven en `servidor/empresas.ts`.
 */
export type EstadoDeFormulario = { tipo: "ok" | "aviso" | "error"; mensaje: string } | null;

const texto = (formData: FormData, campo: string): string => {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor.slice(0, 320) : "";
};

async function autorYDependencias() {
  const admin = await administradorEnSesion();
  if (!admin) redirect("/login");
  const deps: DependenciasDeEmpresas = {
    ahora: () => new Date(),
    urlApp: entornoDePlataforma().PLATAFORMA_URL_APP,
    enviar: (mensaje) => enviarCorreo("avisos", mensaje),
  };
  return { autor: { adminId: admin.adminId, adminEmail: admin.email }, deps };
}

function estadoDe(r: ResultadoDeEmpresa): EstadoDeFormulario {
  if (!r.ok) return { tipo: "error", mensaje: r.mensaje };
  return { tipo: r.enviado ? "ok" : "aviso", mensaje: r.mensaje };
}

/** Alta: al salir bien manda al detalle de la empresa (con el aviso si el mail no salió, que ya figura allí como «sin enviar»). */
export async function darDeAlta(_: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, deps } = await autorYDependencias();
  const r = await darDeAltaEmpresa(dbPlataforma(), deps, autor, {
    nombre: texto(formData, "nombre"),
    slug: texto(formData, "slug"),
    zonaHoraria: texto(formData, "zonaHoraria"),
    moneda: texto(formData, "moneda"),
    nombreSucursal: texto(formData, "nombreSucursal"),
    emailDuenio: texto(formData, "emailDuenio"),
  });
  if (!r.ok) return estadoDe(r);
  redirect(`/empresas/${r.empresaId}`);
}

export async function reenviar(empresaId: string): Promise<EstadoDeFormulario> {
  const { autor, deps } = await autorYDependencias();
  const r = estadoDe(await reenviarInvitacion(dbPlataforma(), deps, autor, empresaId));
  revalidatePath(`/empresas/${empresaId}`);
  return r;
}

export async function revocar(empresaId: string): Promise<EstadoDeFormulario> {
  const { autor } = await autorYDependencias();
  const r = await revocarInvitacion(dbPlataforma(), autor, empresaId, new Date());
  revalidatePath(`/empresas/${empresaId}`);
  return { tipo: r.ok ? "ok" : "error", mensaje: r.mensaje };
}

export async function invitarOtraVez(empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, deps } = await autorYDependencias();
  const r = estadoDe(await invitarDeNuevo(dbPlataforma(), deps, autor, empresaId, texto(formData, "email")));
  revalidatePath(`/empresas/${empresaId}`);
  return r;
}

function estadoDeCiclo(r: ResultadoDeCiclo): EstadoDeFormulario {
  if (!r.ok) return { tipo: "error", mensaje: r.mensaje };
  return { tipo: r.enviado === false ? "aviso" : "ok", mensaje: r.mensaje };
}

const marcado = (formData: FormData, campo: string): boolean => formData.get(campo) === "on";

/** E6: confirma el alta (PROVISIONING → ACTIVE) con el CUIT del formulario; avisa al gerente después del commit. */
export async function confirmar(empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, deps } = await autorYDependencias();
  const r = estadoDeCiclo(
    await confirmarAltaDeEmpresa(dbPlataforma(), deps, autor, empresaId, {
      cuit: texto(formData, "cuit"),
      revisado: marcado(formData, "revisado"),
      aceptoCuitDistinto: marcado(formData, "aceptoCuitDistinto"),
    }),
  );
  revalidatePath(`/empresas/${empresaId}`);
  revalidatePath("/empresas");
  return r;
}

export async function corregirCuit(empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, deps } = await autorYDependencias();
  const r = estadoDeCiclo(await corregirCuitDeEmpresa(dbPlataforma(), deps, autor, empresaId, { cuit: texto(formData, "cuit"), motivo: texto(formData, "motivo") }));
  revalidatePath(`/empresas/${empresaId}`);
  return r;
}

/** Quitar el CUIT (solo de una empresa suspendida): la misma función con el CUIT vacío. */
export async function quitarCuit(empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor, deps } = await autorYDependencias();
  const r = estadoDeCiclo(await corregirCuitDeEmpresa(dbPlataforma(), deps, autor, empresaId, { cuit: "", motivo: texto(formData, "motivo") }));
  revalidatePath(`/empresas/${empresaId}`);
  return r;
}

export async function suspender(empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor } = await autorYDependencias();
  const r = estadoDeCiclo(await suspenderEmpresa(dbPlataforma(), autor, empresaId, texto(formData, "motivo")));
  revalidatePath(`/empresas/${empresaId}`);
  revalidatePath("/empresas");
  return r;
}

export async function reactivar(empresaId: string, _: EstadoDeFormulario, formData: FormData): Promise<EstadoDeFormulario> {
  const { autor } = await autorYDependencias();
  const r = estadoDeCiclo(await reactivarEmpresa(dbPlataforma(), autor, empresaId, texto(formData, "motivo")));
  revalidatePath(`/empresas/${empresaId}`);
  revalidatePath("/empresas");
  return r;
}

export async function reenviarAviso(empresaId: string): Promise<EstadoDeFormulario> {
  const { autor, deps } = await autorYDependencias();
  const r = estadoDeCiclo(await reenviarAvisoDeActivacion(dbPlataforma(), deps, autor, empresaId));
  revalidatePath(`/empresas/${empresaId}`);
  return r;
}
