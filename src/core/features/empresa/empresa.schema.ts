import { z } from "zod";
import { esZonaHorariaValida } from "@/core/tiempo/zona-horaria";

/**
 * Fase 1.4 del checklist de multi-tenancy (Downloads/Motor 2/motor2-multitenancy-checklist (1).md): "Provisioning de empresa
 * (contrato, no automatización completa)". El alta de una empresa real sigue siendo manual/semi-manual en la v1 (aclaración del
 * dueño, 2026-09-28): esto es el contrato de FORMA + la máquina de estados documentada. Lo consume `crearEmpresa`
 * (`crear-empresa.ts`, ADR-007 A7) desde `scripts/crear-empresa.ts`: no hay UI ni circuito de suscripción.
 *
 * Campos tomados EXACTOS del modelo `Empresa` planeado: `nombre` (único global), `slug` (único, minúsculas/dígitos/guiones —
 * usado como prefijo del slug público de la carta, `<empresa>-<sucursal>`), `zonaHoraria` (IANA, validada), `moneda` (ISO 4217, 3 letras).
 */
export const crearEmpresaSchema = z.object({
  nombre: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .max(63, "Hasta 63 caracteres (un subdominio no admite más).")
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Solo minúsculas, dígitos y guiones, sin empezar ni terminar con guion."),
  zonaHoraria: z.string().refine(esZonaHorariaValida, "Tiene que ser una zona horaria IANA válida (continente/ciudad)."),
  moneda: z.string().length(3),
});

export type ComandoCrearEmpresa = z.infer<typeof crearEmpresaSchema>;

/** Lo que pide `crearEmpresa` (ADR-007, A7): la empresa, su primera sucursal y el email de su primer admin (que queda como `gerente`). */
export const crearEmpresaConAdminSchema = crearEmpresaSchema.extend({
  emailPrimerAdmin: z.string().trim().toLowerCase().pipe(z.email()),
  nombreSucursal: z.string().trim().min(1).max(120).default("Central"),
});

export type ComandoCrearEmpresaConAdmin = z.input<typeof crearEmpresaConAdminSchema>;

/**
 * `EstadoEmpresa` — mismo enum planeado para el modelo Prisma (sección 2.1 del plan del panel). Una empresa `SUSPENDED`: su
 * carta pública responde 404 (idéntico a una carta inexistente) y su portal no la lista (v3, "Respuestas del
 * dueño"). El circuito de suscripción/alta todavía no existe (aclaración del dueño, 2026-09-28): el alta sigue siendo
 * manual/semi-manual, así que estas transiciones documentan la intención, no un flujo automatizado de facturación.
 */
export const ESTADOS_EMPRESA = ["PROVISIONING", "ACTIVE", "SUSPENDED", "DELETING"] as const;
export type EstadoEmpresa = (typeof ESTADOS_EMPRESA)[number];

/**
 * Máquina de estados — DISEÑO TENTATIVO (DoD de la Fase 1.4 pide "la máquina de estados documentada", los documentos fuente
 * no especifican cada arista con una decisión propia del dueño): `DELETING` es terminal (sin vuelta atrás, coherente con que
 * borrar una empresa no es algo de lo que se pueda "reactivar"); `PROVISIONING` puede abortarse hacia `DELETING` sin pasar por
 * `ACTIVE` (un alta a medias que se cancela); `ACTIVE`/`SUSPENDED` se alternan libremente entre sí. Cualquier arista de acá
 * que no coincida con lo que el dueño decida en el circuito real de alta/baja se corrige cuando exista ese circuito — esto no
 * es una decisión de negocio cerrada, es el punto de partida documentado que pedía el checklist.
 */
const TRANSICIONES_VALIDAS: Record<EstadoEmpresa, readonly EstadoEmpresa[]> = {
  PROVISIONING: ["ACTIVE", "DELETING"],
  ACTIVE: ["SUSPENDED", "DELETING"],
  SUSPENDED: ["ACTIVE", "DELETING"],
  DELETING: [],
};

export function transicionesValidasDesde(estado: EstadoEmpresa): readonly EstadoEmpresa[] {
  return TRANSICIONES_VALIDAS[estado];
}

export function esTransicionValida(desde: EstadoEmpresa, hacia: EstadoEmpresa): boolean {
  return TRANSICIONES_VALIDAS[desde].includes(hacia);
}
