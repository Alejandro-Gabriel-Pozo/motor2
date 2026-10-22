import "server-only";

/**
 * Qué «le falta algo» puede pedir quien mira la lista de Productos (Fase 6, bloque 3, 3b). La página lo pide acá (las páginas leen por `server/consultas`); el cálculo es el de la lectura compartida, el
 * mismo que usa la Server Action al filtrar: así lo que la pantalla ofrece y lo que el servidor aplica no pueden distinguirse.
 */
export { faltasQueSePuedenFiltrar } from "@/server/lecturas/catalogo/filtros-de-productos";
