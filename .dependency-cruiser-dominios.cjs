/**
 * Clasificación de TODAS las carpetas de `src/core/` (la usan `.dependency-cruiser.cjs` y `test/arquitectura/dominios-clasificados.test.ts`).
 *
 * Cada carpeta de `src/core/` figura en EXACTAMENTE UNA de las dos listas: o es un dominio de negocio (con "internals" que protege la regla
 * `sin-internals-de-otro-dominio`: fuera de la carpeta solo se importa su fachada) o es infraestructura transversal (se consume desde
 * cualquier lado por diseño). Una carpeta nueva que no esté en ninguna de las dos hace fallar `dominios-clasificados.test.ts`: el default es
 * que alguien decida, no que quede sin protección porque nadie se acordó de sumarla.
 */

/** Dominios de NEGOCIO: carpetas con lógica/estado propio que no deberían filtrarse fuera por sus archivos internos. */
const DOMINIOS_DE_NEGOCIO = ["catalogo", "movimientos", "reportes", "pos", "stock", "compras", "carta"];

/** Infraestructura transversal: sin "internals" que proteger. Cada una con el motivo de por qué no es un dominio de negocio. */
const INFRA_TRANSVERSAL = {
  auth: "base por empresa y sesión: se consume desde toda la capa de servidor; sus accesos ya los limitan reglas propias (core/auth/base.ts solo desde una lista cerrada).",
  permisos: "catálogo de acciones/capacidades y la guarda: se importa desde cualquier pantalla y acción por diseño.",
  datos: "valores y validaciones de entrada (importe, cantidad, límites): utilidades puras compartidas.",
  features: "contratos (schemas) y guards de comandos de cada feature: son la frontera de entrada de las Server Actions, no la lógica de un dominio.",
  estadistica: "cálculos estadísticos puros sin estado propio.",
  navegacion: "estructura del menú: la leen las pantallas y los shells.",
  modulos: "catálogo de módulos y su clausura por dependencias (ADR-011/014/015): puro, lo consumen la guarda, el menú y la consola de plataforma.",
  precios: "sincronización de precios: una sola pieza, sin dominio propio todavía; si crece, pasa a DOMINIOS_DE_NEGOCIO con su fachada.",
  fiscal: "identificadores fiscales puros (CUIT); si crece con ARCA pasa a DOMINIOS_DE_NEGOCIO con su fachada (mismo criterio que precios).",
  tiempo: "zona horaria de la empresa: formato de horas y límites de día con Intl; puro, lo consumen reportes, POS y validaciones de fecha.",
  seguridad: "cabeceras HTTP y auditoría de dependencias: se consumen desde la configuración y los scripts.",
  correo: "envío de mails por canal (avisos / operativo): interfaz con implementaciones Resend, consola y memoria (E3, ADR-018); lo consumen las acciones de servidor y el arranque.",
  plataforma: "primitivas puras de la consola de plataforma (TOTP, códigos, cifrado, sesión, límites, email reservado; E4, ADR-012/019): las consumen la app plataforma/ y el alta de empresa.",
};

module.exports = { DOMINIOS_DE_NEGOCIO, INFRA_TRANSVERSAL };
