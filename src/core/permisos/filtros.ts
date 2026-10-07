import { ROL_EMPRESA_GERENTE } from "./rol-empresa";

/**
 * Filtros de consulta PUROS sobre quién es quién en una empresa: un objeto `where` que se le pasa a Prisma, sin tocar la base. Los comparten la app
 * (`obtenerGerenteDeEmpresa`) y la consola de plataforma, que NO puede importar `src/server` y lee al gerente con su propia conexión (Pureza Fase 4, tramo B).
 * Viven en `core/permisos` porque comparan el rol de empresa (`ROL_EMPRESA_GERENTE`), que fuera de esta carpeta no se compara (regla 4 de `acceso-solo-por-el-guard`).
 */

/** El gerente de la empresa (a lo sumo uno: lo garantiza el índice único parcial de `20261001240000_gerente_unico_indice`). */
export function filtroDelGerente(empresaId: string) {
  return { empresaId, rolEmpresa: ROL_EMPRESA_GERENTE } as const;
}
