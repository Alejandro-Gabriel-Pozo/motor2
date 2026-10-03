import { dominioDelRemitente } from "./direcciones";
import type { CanalDeCorreo } from "./tipos";

/**
 * La configuración de cada canal vive en variables de entorno del proyecto de Vercel (una instalación = un proyecto), nunca en la base.
 * Cada variable se lee por su nombre literal: así el test `variables-de-entorno-declaradas` las ve y exige que estén en `src/env.ts`.
 */
export interface ConfiguracionDeCanal {
  claveResend: string;
  remitente: string;
}

type Entorno = Record<string, string | undefined>;

const vacioANulo = (valor: string | undefined) => (valor?.trim() ? valor.trim() : null);

function variablesDelCanal(canal: CanalDeCorreo, source: Entorno): { clave: string | null; remitente: string | null } {
  return canal === "avisos"
    ? { clave: vacioANulo(source.CORREO_AVISOS_RESEND_API_KEY), remitente: vacioANulo(source.CORREO_AVISOS_REMITENTE) }
    : { clave: vacioANulo(source.CORREO_OPERATIVO_RESEND_API_KEY), remitente: vacioANulo(source.CORREO_OPERATIVO_REMITENTE) };
}

/** La clave y el remitente del canal, o `null` si falta alguno de los dos (el canal no está configurado). */
export function configuracionDelCanal(canal: CanalDeCorreo, source: Entorno): ConfiguracionDeCanal | null {
  const { clave, remitente } = variablesDelCanal(canal, source);
  return clave && remitente ? { claveResend: clave, remitente } : null;
}

const NOMBRES: Record<CanalDeCorreo, { clave: string; remitente: string }> = {
  avisos: { clave: "CORREO_AVISOS_RESEND_API_KEY", remitente: "CORREO_AVISOS_REMITENTE" },
  operativo: { clave: "CORREO_OPERATIVO_RESEND_API_KEY", remitente: "CORREO_OPERATIVO_REMITENTE" },
};

/**
 * Incoherencias entre variables que el schema de campo por campo no ve; las usa el arranque estricto (`validarEntornoAlArrancar`).
 * Los mensajes nombran variables, nunca valores.
 */
export function problemasDeConfiguracionDeCorreo(source: Entorno): string[] {
  const problemas: string[] = [];
  for (const canal of ["avisos", "operativo"] as const) {
    const { clave, remitente } = variablesDelCanal(canal, source);
    if (Boolean(clave) !== Boolean(remitente)) {
      problemas.push(`${NOMBRES[canal].clave} y ${NOMBRES[canal].remitente} se configuran juntas (falta ${clave ? NOMBRES[canal].remitente : NOMBRES[canal].clave})`);
    }
  }
  const avisos = variablesDelCanal("avisos", source);
  const operativo = variablesDelCanal("operativo", source);
  if (avisos.clave && avisos.clave === operativo.clave) {
    problemas.push(`${NOMBRES.avisos.clave} y ${NOMBRES.operativo.clave} no pueden ser la misma clave: cada canal tiene su propia cuenta y su propio cupo`);
  }
  const dominioAvisos = avisos.remitente ? dominioDelRemitente(avisos.remitente) : null;
  if (dominioAvisos && dominioAvisos === (operativo.remitente ? dominioDelRemitente(operativo.remitente) : null)) {
    problemas.push(`${NOMBRES.avisos.remitente} y ${NOMBRES.operativo.remitente} no pueden usar el mismo dominio: cada canal tiene el suyo`);
  }
  return problemas;
}
