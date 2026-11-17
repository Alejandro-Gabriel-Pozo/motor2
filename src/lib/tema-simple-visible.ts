import { TEMA_SIMPLE_VISIBLE } from "@/core/carta/public";

/**
 * ¿Está encendida la pantalla simple del Tema de la carta? La constante de `core/carta/tema-simple.ts` manda; el dominio no lee `process.env` (Pureza 1.4), así que el único encendido que no pasa por el código vive acá:
 * la variable `MOTOR2_PRUEBAS_TEMA_SIMPLE` con el valor exacto `si`, que existe SOLO para el e2e y las capturas (`test/e2e/carta-tema-simple.spec.ts`). Solo puede ENCENDER, nunca apagar, y cualquier otro valor se
 * ignora (todo nace cerrado). No está en ningún archivo de entorno ni en la configuración de despliegue.
 */
export function temaSimpleVisible(entorno: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return TEMA_SIMPLE_VISIBLE || entorno.MOTOR2_PRUEBAS_TEMA_SIMPLE === "si";
}
