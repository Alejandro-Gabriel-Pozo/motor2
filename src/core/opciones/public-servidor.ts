/**
 * Fachada PÚBLICA DE SERVIDOR del dominio `opciones` (GO-2b, ADR-030; el mismo patrón que `core/movimientos/public-servidor.ts`).
 *
 * Reexporta, y solo eso, la HUELLA de las opciones (`huella-de-opciones.ts`: SHA-256 con `node:crypto`), que usa `core/pos/linea-configurada.ts` al armar una línea
 * en el caso de uso de agregar ítems. No va en `public.ts` a propósito: esa fachada la alcanzan módulos que terminan en el bundle del CLIENTE (`core/movimientos/public.ts`
 * y, por ella, el menú de toda pantalla), y en el navegador `node:crypto` se reemplaza por `crypto-browserify`, que al cargarse prueba `Function("…")`: la CSP de la
 * aplicación (sin `unsafe-eval`) lo bloquea en cada pantalla. Lo fija `test/arquitectura/fachadas-publicas-sin-io.test.ts`.
 *
 * Sin `import "server-only"`: Vitest y los scripts cargan `core/` fuera de la resolución de módulos de Next, donde ese paquete tira al importarse.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export { huellaDeOpciones } from "./huella-de-opciones";
