/**
 * INTERRUPTOR de la pantalla simple de «Colores del portal» (pestaña Portal de «Apariencia y publicación»; decisiones del dueño, 2026-11-17: «Te pedía color de marca nada más. Lo otro iba por contraste…» y, de los colores del
 * portal, «Sí, los tres fondos elegibles.»). Nace APAGADO (todo nace cerrado): con `false` la pestaña Portal y la carta pública del portal salen EXACTAMENTE como hasta hoy y la acción nueva se niega.
 *
 * Con `true`: la pestaña Portal pide lo que Pedernal pide del portal (tres fondos, línea superior, título, logo e imagen) y la carta pública usa los tres fondos y los textos derivados SOLO de la empresa que ya tiene su
 * portal nuevo (`PortalDeEmpresa`) con esos colores. Para encenderlo: poner `true` (nada más; la condición es que el spec `test/e2e/carta-portal-simple.spec.ts` y la comprobación de accesibilidad pasen en verde).
 *
 * OVERRIDE SOLO DE PRUEBA (no es una opción del producto, no se ofrece a nadie): `MOTOR2_PORTAL_SIMPLE_PRUEBA=1` lo enciende para un proceso (vitest y la captura local); y la cookie `m2_portal_simple_prueba=1` lo enciende para
 * UN navegador, pero SOLO si el servidor es el de los E2E (`MOTOR2_E2E_SERVIDOR` lo fija `playwright.config.ts`): así el spec lo prueba encendido sin encenderlo para los demás specs. Ninguna de las dos hace nada en producción.
 */
export const PORTAL_SIMPLE_VISIBLE: boolean = false;

/** Nombre de la cookie de prueba (la fija el spec E2E; la lee la pantalla y la acción, nunca la carta pública). */
export const COOKIE_PORTAL_SIMPLE_PRUEBA = "m2_portal_simple_prueba";

/** ¿Está encendida la pantalla simple? `cookiePrueba` es el valor de `COOKIE_PORTAL_SIMPLE_PRUEBA` si quien llama tiene la petición (la pantalla y la acción); la carta pública no la pasa. */
export function portalSimpleVisible(cookiePrueba?: string): boolean {
  if (PORTAL_SIMPLE_VISIBLE) return true;
  if (process.env.MOTOR2_PORTAL_SIMPLE_PRUEBA === "1") return true;
  return process.env.MOTOR2_E2E_SERVIDOR !== undefined && cookiePrueba === "1";
}
