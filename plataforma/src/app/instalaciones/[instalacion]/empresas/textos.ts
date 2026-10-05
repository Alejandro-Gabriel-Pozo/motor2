import type { EstadoEfectivoDeInvitacion } from "@/core/features/empresa/invitacion";
import { formatearCuit } from "@/core/fiscal/cuit";
import { esModuloDelCatalogo } from "@/core/modulos/catalogo";
import { nombreDeModulo } from "@/core/modulos/vista-de-modulos";
import type { FilaDeEmpresa } from "../../../../servidor/empresas";
import type { CoincidenciaDeCuit } from "../../../../servidor/cuit-en-instalaciones";
import type { Instalacion } from "../../../../entorno";

export const ESTADO_DE_EMPRESA: Record<FilaDeEmpresa["estado"], string> = {
  PROVISIONING: "En alta",
  ACTIVE: "Activa",
  SUSPENDED: "Suspendida",
  DELETING: "En baja",
};

export const ESTADO_DE_INVITACION: Record<EstadoEfectivoDeInvitacion, string> = {
  PENDIENTE: "Pendiente",
  ACEPTADA: "Aceptada",
  REVOCADA: "Revocada",
  VENCIDA: "Vencida",
};

/** «04/10/2026 12:00» en hora de Buenos Aires: la consola la usan personas de acá y la fecha es solo orientativa (el vencimiento real lo decide la base). */
export function fechaCorta(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(fecha);
}

/** Cómo se lee cada acción de la auditoría de plataforma en el historial de una empresa. */
export const ACCION_DE_AUDITORIA: Record<string, string> = {
  "alta-de-empresa": "Alta de la empresa",
  "invitacion-reenviada": "Invitación reenviada",
  "invitacion-revocada": "Invitación revocada",
  "invitacion-creada": "Invitación nueva",
  "empresa-confirmada": "Alta confirmada",
  "cuit-corregido": "CUIT corregido",
  "empresa-suspendida": "Empresa suspendida",
  "empresa-reactivada": "Empresa reactivada",
  "aviso-de-activacion": "Aviso de activación",
  "modulo-activado": "Módulo activado",
  "modulo-desactivado": "Módulo desactivado",
};

export const ETIQUETA_DE_FILTRO: Record<string, string> = {
  todas: "Todas",
  "cuit-pendiente": "CUIT pendiente",
  "en-alta": "En alta",
  activas: "Activas",
  "activas-sin-cuit": "Activas sin CUIT",
  suspendidas: "Suspendidas",
};

/**
 * Lo que acaba de pasar, tras un cambio que hace desaparecer su propio formulario (confirmar, suspender, reactivar, revocar): la acción redirige con `?hecho=<código>` y la
 * página muestra este texto FIJO. Nunca se refleja texto de la URL: un código desconocido no muestra nada.
 */
export function textoDeLoQueAcabaDePasar(codigo: string | undefined, empresa: { nombre: string; cuit: string | null }): string | null {
  const cuit = empresa.cuit ? formatearCuit(empresa.cuit) : "";
  switch (codigo) {
    case "confirmada":
      return `«${empresa.nombre}» quedó activa con el CUIT ${cuit}. Le avisamos al gerente.`;
    case "confirmada-sin-aviso":
      return `«${empresa.nombre}» quedó activa con el CUIT ${cuit}. El aviso por mail no salió: reenvialo desde acá.`;
    case "suspendida":
      return `«${empresa.nombre}» quedó suspendida: sus usuarios dejan de entrar en su próximo pedido.`;
    case "reactivada":
      return `«${empresa.nombre}» quedó activa de nuevo.`;
    case "revocada":
      return "Invitación revocada: el enlace ya no sirve.";
    default:
      return null;
  }
}

const TOPE_DE_NOMBRES_POR_INSTALACION = 5;

function listaConTope(nombres: readonly string[]): string {
  if (nombres.length <= TOPE_DE_NOMBRES_POR_INSTALACION) return nombres.join(", ");
  const resto = nombres.length - TOPE_DE_NOMBRES_POR_INSTALACION;
  return `${nombres.slice(0, TOPE_DE_NOMBRES_POR_INSTALACION).join(", ")} y ${resto} más`;
}

/**
 * Aviso informativo de CUIT repetido ENTRE instalaciones (ADR-025): una línea por instalación con coincidencias y una por cada que no se pudo revisar.
 * A propósito NO dice «CUIT repetido» ni usa alguna palabra que lo confunda con el aviso de la MISMA base (ese es `role="alert"`; este, `role="status"`).
 */
export function textosDeCuitEnOtrasInstalaciones(coincidencias: readonly CoincidenciaDeCuit[], sinLeer: readonly Pick<Instalacion, "nombre">[]): string[] {
  const porCoincidencia = coincidencias.map((c) => {
    const nombres = c.empresas.map((e) => `«${e.nombre}» (CUIT ${e.origen === "confirmado" ? "confirmado" : "declarado"})`);
    return `También existe en «${c.instalacion.nombre}»: ${listaConTope(nombres)}.`;
  });
  const porCaida = sinLeer.map((i) => `No pudimos revisar «${i.nombre}» ahora.`);
  return [...porCoincidencia, ...porCaida];
}

/** El aviso de la pantalla de módulos tras un cambio: texto FIJO por código; el módulo viene de la URL y solo se usa si es del catálogo. */
export function textoDeModuloCambiado(codigo: string | undefined, modulo: string | undefined): string | null {
  if (codigo === "modulos-todos") return "Se activaron todos los módulos disponibles. Rigen en el próximo pedido de los usuarios de la empresa.";
  if ((codigo !== "modulo-activado" && codigo !== "modulo-desactivado") || !modulo || !esModuloDelCatalogo(modulo)) return null;
  const nombre = nombreDeModulo(modulo);
  return codigo === "modulo-activado"
    ? `${nombre} quedó activado. Rige en el próximo pedido de los usuarios de la empresa.`
    : `${nombre} quedó desactivado. Sus pantallas dejan de verse en el próximo pedido; los datos quedan.`;
}
