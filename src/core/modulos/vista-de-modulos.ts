import { MODULOS, type ModuloDef } from "./catalogo";
import { modulosEfectivos, modulosQueIncluyen, type ErrorDeCambio } from "./clausura";

// Vista de los módulos de UNA empresa para la consola de plataforma (E7, ADR-023): qué tiene, por qué lo tiene, qué se suma al activar cada uno y qué impide
// desactivarlo. Es cálculo PURO sobre las filas activas del registro: sin base, sin React, y la misma clausura que usa el guard (`modulosEfectivos`).

export const nombreDeModulo = (id: string, catalogo: readonly ModuloDef[] = MODULOS): string => catalogo.find((m) => m.id === id)?.nombre ?? id;

/** El texto de un cambio de módulos rechazado. Lo comparten el script de emergencia y la consola: dicen lo mismo. */
export function explicarErrorDeCambio(e: ErrorDeCambio): string {
  switch (e.motivo) {
    case "DESCONOCIDO":
      return `«${e.modulo}» no existe en el catálogo de módulos.`;
    case "NO_ES_VENDIBLE":
      return `${nombreDeModulo(e.modulo)} no se activa ni se desactiva: es un módulo fijo o de soporte (se calcula solo).`;
    case "EN_DESARROLLO":
      return `${nombreDeModulo(e.modulo)} está en desarrollo y todavía no se puede activar.`;
    case "LO_REQUIEREN_OTROS":
      return `${nombreDeModulo(e.modulo)} no se puede desactivar mientras estén activos: ${(e.requeridoPor ?? []).map((id) => nombreDeModulo(id)).join(", ")}.`;
  }
}

export interface FilaDeModulo {
  id: string;
  nombre: string;
  tipo: ModuloDef["tipo"];
  estado: ModuloDef["estado"];
  /** Tiene fila ACTIVO en el registro (solo los vendibles disponibles). */
  enRegistro: boolean;
  /** La empresa cuenta con el módulo: lo tiene en el registro o lo trae la clausura de otro (o es fijo). */
  efectivo: boolean;
  /** Los módulos del registro que lo traen, sin él mismo: «incluido por X». */
  incluidoPor: readonly string[];
  /** Al activarlo, los módulos que se suman a los que la empresa ya tiene. */
  alActivarSeSuman: readonly string[];
  /** Al desactivarlo, los módulos con que la empresa deja de contar. */
  alDesactivarSePierden: readonly string[];
  /** Los otros módulos del registro que lo traen: mientras estén activos no se puede desactivar. */
  bloqueadoPor: readonly string[];
  /** Dependencias blandas (informativas). */
  usaSiExiste: readonly string[];
  puedeActivar: boolean;
  puedeDesactivar: boolean;
}

function restar(a: ReadonlySet<string>, b: ReadonlySet<string>, sin: string): string[] {
  return [...a].filter((id) => !b.has(id) && id !== sin);
}

/** Una fila por módulo del catálogo, en el orden del catálogo. `activos` son los ids con fila ACTIVO en el registro (cualquier otro id se ignora). */
export function vistaDeModulos(activos: Iterable<string>, catalogo: readonly ModuloDef[] = MODULOS): FilaDeModulo[] {
  const registro = new Set([...activos].filter((id) => catalogo.some((m) => m.id === id && m.tipo === "vendible" && m.estado === "disponible")));
  const efectivos = modulosEfectivos(registro, catalogo);
  return catalogo.map((m): FilaDeModulo => {
    const vendibleDisponible = m.tipo === "vendible" && m.estado === "disponible";
    const enRegistro = registro.has(m.id);
    const sinEste = new Set([...registro].filter((id) => id !== m.id));
    return {
      id: m.id,
      nombre: m.nombre,
      tipo: m.tipo,
      estado: m.estado,
      enRegistro,
      efectivo: efectivos.has(m.id),
      incluidoPor: modulosQueIncluyen(m.id, registro, catalogo).filter((id) => id !== m.id),
      alActivarSeSuman: vendibleDisponible && !enRegistro ? restar(modulosEfectivos([...registro, m.id], catalogo), efectivos, m.id) : [],
      alDesactivarSePierden: enRegistro ? restar(efectivos, modulosEfectivos(sinEste, catalogo), m.id) : [],
      bloqueadoPor: enRegistro ? modulosQueIncluyen(m.id, sinEste, catalogo) : [],
      usaSiExiste: m.usaSiExiste,
      puedeActivar: vendibleDisponible && !enRegistro,
      puedeDesactivar: enRegistro && modulosQueIncluyen(m.id, sinEste, catalogo).length === 0,
    };
  });
}

/** Todos los módulos vendibles y disponibles que la empresa todavía no tiene en el registro: lo que hace «Activar todos los disponibles». */
export function modulosDisponiblesParaActivar(activos: Iterable<string>, catalogo: readonly ModuloDef[] = MODULOS): string[] {
  return vistaDeModulos(activos, catalogo)
    .filter((f) => f.puedeActivar)
    .map((f) => f.id);
}
