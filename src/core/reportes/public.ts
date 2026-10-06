/**
 * Fachada PÚBLICA y PURA del dominio `reportes` (Task #41, Fase C3).
 *
 * Fuera de `core/reportes/` se importa esta fachada o `public-servidor.ts`, nunca un archivo interno (regla
 * `sin-internals-de-otro-dominio` de `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan `@/lib/db` ni el
 * runtime de Prisma, ni directa ni transitivamente (regla `publico-puro`). Lo que sí toca la base va en
 * `public-servidor.ts`.
 *
 * Solo TIPOS (se borran al compilar): la función `compararRendimientosPorSucursal` hace consultas y va en `public-servidor.ts` (Pureza Fase 2, paso 2.2).
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export type { FiltroComparacionRendimiento, FilaComparacionRendimiento } from "./rendimiento-por-sucursal";
