import { CLAVE_ROL_ADMIN } from "./jerarquia";
import { ROL_EMPRESA_GERENTE } from "./rol-empresa";

/**
 * Filtros de consulta PUROS sobre quién es quién en una empresa: un objeto `where` que se le pasa a Prisma, sin tocar la base. Los comparten la app
 * (`obtenerGerenteDeEmpresa`) y la consola de plataforma, que NO puede importar `src/server` y lee al gerente con su propia conexión (Pureza Fase 4, tramo B).
 * Viven en `core/permisos` porque comparan el rol de empresa (`ROL_EMPRESA_GERENTE`), que fuera de esta carpeta no se compara (regla 4 de `acceso-solo-por-el-guard`).
 *
 * Contrato C1 del RBAC (O.35; Hito 3, Fase II, II.1 de `docs/plan-hito-3-pureza.md`): los filtros por la CLAVE del rol administrador también viven acá. Las lecturas de
 * decisión de gobierno (`server/lecturas/permisos`) los piden en vez de escribir `rol: { clave: CLAVE_ROL_ADMIN }` a mano: fuera de `core/permisos` nadie nombra la clave
 * (`CLAVE_ROL_ADMIN`, `esRolAdmin`), y cada predicado de «quién es administrador» está escrito UNA vez. Sin tipos de Prisma (P0): devuelven objetos literales (`as const`)
 * que Prisma acepta tal cual; `test/permisos/filtros-de-gobierno.test.ts` los fija campo por campo contra los literales que reemplazaron.
 */

/** El gerente de la empresa (a lo sumo uno: lo garantiza el índice único parcial de `20261001240000_gerente_unico_indice`). */
export function filtroDelGerente(empresaId: string) {
  return { empresaId, rolEmpresa: ROL_EMPRESA_GERENTE } as const;
}

/**
 * D1 — «admin efectivo» (antes `membresiaDeAdminEfectivo`, en `invariantes.ts`): la membresía que de verdad deja entrar a alguien como administrador. Membresía activa,
 * rol activo con la clave «admin», sucursal activa, pertenencia a la empresa activa, cuenta activa y empresa ACTIVE. Es la definición ESTRICTA: «queda alguien que pueda
 * entrar». La usan las invariantes de gobierno (a) y (f), el traspaso de la gerencia y la lista de candidatos a gerente: el MISMO predicado en los tres.
 */
export function filtroAdminEfectivo(empresaId: string) {
  return {
    empresaId,
    activo: true,
    rol: { clave: CLAVE_ROL_ADMIN, activo: true },
    sucursal: { activo: true },
    empresa: { estado: "ACTIVE" },
    usuario: { activoGlobal: true, empresas: { some: { empresaId, activo: true } } },
  } as const;
}

/**
 * La membresía de `usuarioId` con AUTORIDAD de administrador: activa y con el rol admin activo. Es la definición del techo de privilegio (quien actúa desde la base,
 * a quien se toca en la empresa), más laxa que `filtroAdminEfectivo`: no mira la sucursal, la pertenencia, la cuenta ni la empresa. Para una sola sucursal, quien llama
 * le suma `sucursalId`.
 */
export function filtroMembresiaConAutoridadDeAdmin(empresaId: string, usuarioId: string) {
  return { empresaId, usuarioId, activo: true, rol: { clave: CLAVE_ROL_ADMIN, activo: true } } as const;
}

/** El rol «admin» de la empresa, por su CLAVE técnica (el nombre se puede cambiar: bloque G3), activo o no. Para exigirlo activo, quien llama le suma `activo: true`. */
export function filtroRolAdmin(empresaId: string) {
  return { empresaId, clave: CLAVE_ROL_ADMIN } as const;
}

/** Las membresías de `usuarioId` con el rol admin, activas o no y con el rol activo o no: la pregunta HISTÓRICA «tiene o tuvo el rol admin» (Q2). */
export function filtroTuvoRolAdmin(empresaId: string, usuarioId: string) {
  return { empresaId, usuarioId, rol: { clave: CLAVE_ROL_ADMIN } } as const;
}
