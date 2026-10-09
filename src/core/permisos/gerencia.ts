import { ROL_EMPRESA_GERENTE } from "./rol-empresa";

/**
 * La gerencia de una empresa: lo PURO (Hito 3, Fase II, II.5 de `docs/plan-hito-3-pureza.md`; P0). Las lecturas (`obtenerGerenteDeEmpresa`,
 * `tuvoRolAdminEnLaEmpresa`, `gerentesQueQuedaranSinSucursalActiva`) viven en `server/lecturas/permisos/gerencia.ts` con el mismo nombre y firma; el traspaso, en el
 * paso compartido `server/actions/auth/casos-de-uso/transferir-gerencia-en-tx.ts` (I.5d), y el alta del primer gerente (`incorporarPrimerGerente`), en
 * `server/actions/auth/casos-de-uso/incorporar-primer-gerente-en-tx.ts`, los dos con sus escrituras en `server/persistencia/auth/gerencia.ts`.
 */

export type ResultadoGerencia = { ok: true; mensaje: string; gerenteAnteriorId: string | null } | { ok: false; mensaje: string };

/** Lo que de la cuenta del destino de un traspaso hace falta para decidir si puede recibir la gerencia (`null`: no pertenece a la empresa). */
export interface DestinoDeLaGerencia {
  activo: boolean;
  rolEmpresa: string | null;
  usuario: { activoGlobal: boolean };
}

/**
 * Por qué el destino de un traspaso NO puede recibir la gerencia, o `null` si su cuenta lo permite (Hito 3, I.5d0): que pertenezca a la empresa, que no sea ya el
 * gerente y que su cuenta esté activa en la empresa y en la plataforma, en ESE orden y con esos textos. Puro: la comparación con el rol de empresa queda acá, en
 * `core/permisos` (la regla 1 de `acceso-solo-por-el-guard` no la admite en otra capa), y la persistencia del traspaso solo escribe. Que además sea admin efectivo
 * en alguna sucursal es una lectura de la base y la hace quien llama, después de esto.
 */
export function mensajeSiElDestinoNoPuedeRecibirLaGerencia(destino: DestinoDeLaGerencia | null): string | null {
  if (!destino) return "Ese usuario no pertenece a esta empresa.";
  if (destino.rolEmpresa === ROL_EMPRESA_GERENTE) return "Esa persona ya es el gerente de la empresa.";
  if (!destino.activo || !destino.usuario.activoGlobal) return "Esa persona tiene la cuenta desactivada: no puede ser gerente.";
  return null;
}
