import { PERFILES_DE_POLITICA, type NombreDePerfilDePolitica, type PoliticaDeEmpresa } from "@/core/permisos/politica-de-empresa";

/**
 * El cálculo PURO de «cambiar la política de plataforma de una empresa» (add-on, ADR-008/ADR-010): armar las perillas pedidas y decidir cuáles cambian de valor. Sin
 * base: lo escribe y lo audita `server/operaciones-de-plataforma/cambiar-politica-de-empresa.ts` (Pureza Fase 4, tramo B), que se lo pide a esta función con la
 * política actual ya leída.
 */

/** Una perilla (o un perfil de política, que fija las dos) que la plataforma quiere cambiar. Sin ninguna, no hay nada que hacer. */
export interface CambioDePoliticaPedido {
  slug: string;
  perfil?: NombreDePerfilDePolitica;
  permisosEditables?: boolean;
  dosPaneles?: boolean;
}

export interface CambioDePoliticaHecho {
  empresaId: string;
  politica: PoliticaDeEmpresa;
  /** Las perillas que de verdad cambiaron de valor (vacío si todo ya estaba así). */
  cambiadas: Array<keyof PoliticaDeEmpresa>;
}

export class PoliticaDeEmpresaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "PoliticaDeEmpresaError";
  }
}

/** Las perillas pedidas: el perfil fija las dos y las perillas sueltas se aplican después y lo pisan. Sin ninguna es un error. */
export function perillasPedidas(pedido: Pick<CambioDePoliticaPedido, "perfil" | "permisosEditables" | "dosPaneles">): Partial<PoliticaDeEmpresa> {
  const pedidas: Partial<PoliticaDeEmpresa> = { ...(pedido.perfil ? PERFILES_DE_POLITICA[pedido.perfil] : {}) };
  if (pedido.permisosEditables !== undefined) pedidas.permisosEditables = pedido.permisosEditables;
  if (pedido.dosPaneles !== undefined) pedidas.dosPaneles = pedido.dosPaneles;
  if (Object.keys(pedidas).length === 0) throw new PoliticaDeEmpresaError("No pediste ningún cambio: indicá un perfil o alguna perilla.");
  return pedidas;
}

/** La política que queda y qué perillas cambiaron de valor. */
export function planDeCambioDePolitica(antes: PoliticaDeEmpresa, pedidas: Partial<PoliticaDeEmpresa>): { despues: PoliticaDeEmpresa; cambiadas: Array<keyof PoliticaDeEmpresa> } {
  const despues: PoliticaDeEmpresa = { ...antes, ...pedidas };
  const cambiadas = (Object.keys(despues) as Array<keyof PoliticaDeEmpresa>).filter((perilla) => despues[perilla] !== antes[perilla]);
  return { despues, cambiadas };
}
