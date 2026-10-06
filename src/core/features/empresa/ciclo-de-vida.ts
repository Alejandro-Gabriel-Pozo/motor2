import { z } from "zod";
import type { MensajeDeCorreo } from "@/core/correo/tipos";
import { formatearCuit } from "@/core/fiscal/public";
import type { EstadoEmpresa } from "./empresa.schema";

/**
 * Ciclo de vida de una empresa desde la consola (E6, ADR-021): confirmar el alta, corregir el CUIT, suspender y reactivar. Reglas PURAS (sin base ni reloj): qué se
 * puede hacer en cada estado, cómo se agrupan los CUIT declarados repetidos y el texto del mail de activación. La lógica con base vive en
 * `plataforma/src/servidor/ciclo-de-vida.ts`.
 */

/** Motivo de una suspensión o de una corrección de CUIT: solo para la auditoría, obligatorio. */
export const motivoSchema = z.string().trim().min(3, "Escribí el motivo (al menos 3 letras).").max(200, "El motivo puede tener hasta 200 caracteres.");

export const confirmarAltaSchema = z.object({
  cuit: z.string().trim().min(1, "Falta el CUIT."),
  /** Quien confirma tildó que revisó el CUIT contra la constancia. */
  revisado: z.literal(true, { error: "Tildá que revisaste el CUIT." }),
  /** Obligatorio SOLO si el CUIT a confirmar difiere del que declaró el gerente. */
  aceptoCuitDistinto: z.boolean().default(false),
});

export const corregirCuitSchema = z.object({
  /** Vacío = quitar el CUIT (solo de una empresa suspendida). */
  cuit: z.string().trim(),
  motivo: motivoSchema,
});

export interface EmpresaParaElCiclo {
  estado: EstadoEmpresa;
  cuit: string | null;
  /** La última invitación de gerente, si la hay. */
  invitacion: { estado: "PENDIENTE" | "ACEPTADA" | "REVOCADA" | "VENCIDA"; cuitDeclarado: string | null } | null;
}

/** Una empresa en alta cuyo gerente ya aceptó y declaró su CUIT: la plataforma tiene que confirmarla. */
export function tieneCuitPendiente(e: EmpresaParaElCiclo): boolean {
  return e.estado === "PROVISIONING" && e.invitacion?.estado === "ACEPTADA" && Boolean(e.invitacion.cuitDeclarado);
}

export interface AccionesDeCicloDeVida {
  confirmar: boolean;
  corregirCuit: boolean;
  /** Quitar el CUIT: solo de una empresa SUSPENDIDA (el caso de quien se hizo pasar por otra y fue confirmado por error). */
  vaciarCuit: boolean;
  suspender: boolean;
  reactivar: boolean;
  reenviarAviso: boolean;
}

/**
 * Qué se ofrece en cada estado. `tieneFacturaAutorizada` es el predicado de `core/fiscal/factura-autorizada`: con una factura autorizada en PRODUCCIÓN el CUIT queda
 * inmutable. Una empresa en alta no se suspende (nadie opera en ella; para frenarla se revoca la invitación o no se confirma).
 */
export function accionesDeCicloDeVida(e: EmpresaParaElCiclo, contexto: { tieneFacturaAutorizada: boolean }): AccionesDeCicloDeVida {
  const operativa = e.estado === "ACTIVE" || e.estado === "SUSPENDED";
  const puedeCorregir = operativa && !contexto.tieneFacturaAutorizada;
  return {
    confirmar: tieneCuitPendiente(e),
    corregirCuit: puedeCorregir,
    vaciarCuit: puedeCorregir && e.estado === "SUSPENDED" && e.cuit !== null,
    suspender: e.estado === "ACTIVE",
    reactivar: e.estado === "SUSPENDED",
    reenviarAviso: e.estado === "ACTIVE",
  };
}

/** Agrupa por CUIT las empresas que declararon (o tienen) el mismo: solo devuelve los CUIT con más de una. La clave es el CUIT de 11 dígitos. */
export function cuitsRepetidos(filas: ReadonlyArray<{ id: string; cuit: string | null }>): Map<string, string[]> {
  const porCuit = new Map<string, string[]>();
  for (const f of filas) {
    if (!f.cuit) continue;
    porCuit.set(f.cuit, [...(porCuit.get(f.cuit) ?? []), f.id]);
  }
  for (const [cuit, ids] of porCuit) if (ids.length < 2) porCuit.delete(cuit);
  return porCuit;
}

/** Mail de activación para el gerente. Texto neutral: la plataforma puede activar módulos antes o después de confirmar (E7). */
export function mensajeDeEmpresaActiva(datos: { email: string; nombreEmpresa: string; cuit: string; urlApp: string }): MensajeDeCorreo {
  const texto = [
    `La plataforma confirmó el alta de «${datos.nombreEmpresa}» (CUIT ${formatearCuit(datos.cuit)}) y la empresa ya está activa.`,
    "",
    `Entrá con la cuenta de Google de ${datos.email}: ${datos.urlApp.replace(/\/+$/, "")}/login`,
    "",
    "La empresa cuenta con Administración (usuarios, roles y sucursales); los demás módulos los habilita la plataforma según lo contratado.",
    "Si no esperabas este mail, avisale a la plataforma.",
  ].join("\n");
  return { para: [datos.email], asunto: `Tu empresa «${datos.nombreEmpresa}» ya está activa en Motor2`, texto };
}
