import type { MensajeDeCorreo, ResultadoDeEnvio } from "@/core/correo/tipos";
import type { Instalacion } from "../entorno";
import type { DependenciasDeEmpresas } from "./empresas";

/**
 * Las dependencias de las acciones sobre empresas, armadas PARA UNA INSTALACIÓN (ADR-025): la dirección de la app a la que apuntan los enlaces de los mails es la de ESA instalación
 * —no la de la principal—, y los emails de los administradores salen de la base de identidad (otra base). Puro: el reloj, el envío y la lectura de administradores entran por parámetro.
 */
export function dependenciasParaInstalacion(
  instalacion: Pick<Instalacion, "urlApp">,
  externos: { emailsDeAdmins: () => Promise<readonly string[]>; enviar: (mensaje: MensajeDeCorreo) => Promise<ResultadoDeEnvio>; ahora?: () => Date },
): DependenciasDeEmpresas {
  return { ahora: externos.ahora ?? (() => new Date()), urlApp: instalacion.urlApp, emailsDeAdmins: externos.emailsDeAdmins, enviar: externos.enviar };
}
