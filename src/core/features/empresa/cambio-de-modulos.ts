import { modulosEfectivos, validarCambioDeModulos } from "@/core/modulos/clausura";
import { explicarErrorDeCambio, nombreDeModulo } from "@/core/modulos/vista-de-modulos";

/**
 * El cálculo PURO de «activar y desactivar módulos vendibles de una empresa» (ADR-011, ADR-014, ADR-015): validar el pedido, decidir qué filas del registro
 * `ModuloEmpresa` cambian y con qué quedó la empresa. Sin base: lo escribe y lo audita `server/operaciones-de-plataforma/cambiar-modulos-de-empresa.ts`
 * (Pureza Fase 4, tramo B), que se lo pide a esta función con las filas ya leídas.
 */

/** Los módulos vendibles que la plataforma quiere activar o desactivar en una empresa. Sin ninguno, no hay nada que hacer. */
export interface CambioDeModulosPedido {
  slug: string;
  /** Email del operador de la plataforma que hace el cambio: queda en la auditoría de la empresa. Tiene que ser un usuario existente. */
  actorEmail: string;
  activar?: readonly string[];
  desactivar?: readonly string[];
}

export interface CambioDeModulosHecho {
  empresaId: string;
  /** Lo que de verdad cambió en el registro (vacío si todo ya estaba así). `antes` es `null` si el módulo no tenía fila. */
  cambiados: Array<{ modulo: string; antes: "ACTIVO" | "INACTIVO" | null; despues: "ACTIVO" | "INACTIVO" }>;
  /** Los módulos vendibles activos en el registro tras el cambio. */
  activos: string[];
  /** Con lo que cuenta la empresa tras el cambio: fijos, vendibles activos y todo lo que ellos requieren. */
  efectivos: string[];
}

export class ModulosDeEmpresaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ModulosDeEmpresaError";
  }
}

/** El pedido sin repetidos, validado: algo que hacer y nada a activar y desactivar a la vez. */
export function normalizarPedidoDeModulos(pedido: Pick<CambioDeModulosPedido, "activar" | "desactivar">): { activar: string[]; desactivar: string[] } {
  const activar = [...new Set(pedido.activar ?? [])];
  const desactivar = [...new Set(pedido.desactivar ?? [])];
  if (activar.length === 0 && desactivar.length === 0) throw new ModulosDeEmpresaError("No pediste ningún cambio: indicá módulos a activar o a desactivar.");
  const enAmbos = activar.filter((m) => desactivar.includes(m));
  if (enAmbos.length) throw new ModulosDeEmpresaError(`Pediste activar y desactivar a la vez: ${enAmbos.join(", ")}.`);
  return { activar, desactivar };
}

/**
 * Qué filas del registro cambian. La validación es la de `validarCambioDeModulos` (la misma clausura que usa el guard): no se activa un módulo en desarrollo, no
 * se desactiva uno que otro activo requiere. Desactivar deja la fila en INACTIVO; nunca se borra (ADR-012 §3: la plataforma no tiene DELETE), y desactivar un
 * módulo que nunca tuvo fila no crea una. Primero se recorre lo que se activa y después lo que se desactiva.
 */
export function planDeCambioDeModulos(
  filas: readonly { modulo: string; estado: "ACTIVO" | "INACTIVO" }[],
  pedido: { activar: readonly string[]; desactivar: readonly string[] }
): Pick<CambioDeModulosHecho, "cambiados" | "activos" | "efectivos"> {
  const estadoActual = new Map(filas.map((f) => [f.modulo, f.estado]));
  const validacion = validarCambioDeModulos(filas.filter((f) => f.estado === "ACTIVO").map((f) => f.modulo), { activar: [...pedido.activar], desactivar: [...pedido.desactivar] });
  if (!validacion.ok) throw new ModulosDeEmpresaError(validacion.errores.map(explicarErrorDeCambio).join(" "));

  const cambiados: CambioDeModulosHecho["cambiados"] = [];
  for (const [modulos, despues] of [[pedido.activar, "ACTIVO"], [pedido.desactivar, "INACTIVO"]] as const) {
    for (const modulo of modulos) {
      const antes = estadoActual.get(modulo) ?? null;
      if (antes === despues || (antes === null && despues === "INACTIVO")) continue;
      cambiados.push({ modulo, antes, despues });
    }
  }
  const activos = [...validacion.activos].sort();
  return { cambiados, activos, efectivos: [...modulosEfectivos(activos)].sort() };
}

/** La descripción de la fila de auditoría de un cambio de módulo. */
export function descripcionDeCambioDeModulo(empresaNombre: string, modulo: string): string {
  return `Empresa "${empresaNombre}": módulo ${nombreDeModulo(modulo)}`;
}
