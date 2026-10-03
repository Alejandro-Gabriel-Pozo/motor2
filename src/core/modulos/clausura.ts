import { MODULOS, type ModuloDef } from "./catalogo";

// Cálculo puro de los módulos activos de una empresa (ADR-014 §2, ADR-015 §4). Sin base ni React: lo usan el guard, el menú y la consola
// de plataforma, y por eso es UNA sola función (un test prueba que guard y menú coinciden).

function porId(catalogo: readonly ModuloDef[]): ReadonlyMap<string, ModuloDef> {
  return new Map(catalogo.map((m) => [m.id, m]));
}

/** Clausura por `requiere` (transitiva) de los módulos dados. Un id fuera del catálogo se ignora. */
function clausuraPorRequiere(raices: Iterable<string>, catalogo: readonly ModuloDef[]): Set<string> {
  const definiciones = porId(catalogo);
  const resultado = new Set<string>();
  const pendientes = [...raices];
  while (pendientes.length) {
    const id = pendientes.pop()!;
    const definicion = definiciones.get(id);
    if (!definicion || resultado.has(id)) continue;
    resultado.add(id);
    pendientes.push(...definicion.requiere);
  }
  return resultado;
}

/** Las filas del registro que cuentan: solo módulos vendibles y disponibles. Los de soporte se calculan y los `en_desarrollo` nunca están activos. */
function raicesDelRegistro(activos: Iterable<string>, catalogo: readonly ModuloDef[]): string[] {
  const definiciones = porId(catalogo);
  return [...activos].filter((id) => {
    const d = definiciones.get(id);
    return d?.tipo === "vendible" && d.estado === "disponible";
  });
}

/**
 * Los módulos con que cuenta una empresa: los fijos (Administración), los vendibles que tiene activos en el registro y todo lo que ellos
 * requieren (los de soporte y los vendibles requeridos, p. ej. Salón trae Stock). Con el registro vacío queda solo Administración.
 */
export function modulosEfectivos(activos: Iterable<string>, catalogo: readonly ModuloDef[] = MODULOS): ReadonlySet<string> {
  const efectivos = clausuraPorRequiere(raicesDelRegistro(activos, catalogo), catalogo);
  for (const m of catalogo) if (m.tipo === "fijo") efectivos.add(m.id);
  return efectivos;
}

/** Los módulos activos en el registro que traen `modulo` (él mismo o por `requiere`, transitivamente). Vacío si nadie lo trae: «incluido por X». */
export function modulosQueIncluyen(modulo: string, activos: Iterable<string>, catalogo: readonly ModuloDef[] = MODULOS): string[] {
  return raicesDelRegistro(activos, catalogo).filter((raiz) => clausuraPorRequiere([raiz], catalogo).has(modulo));
}

export type MotivoDeCambioInvalido = "NO_ES_VENDIBLE" | "EN_DESARROLLO" | "LO_REQUIEREN_OTROS" | "DESCONOCIDO";

export interface ErrorDeCambio {
  motivo: MotivoDeCambioInvalido;
  modulo: string;
  /** Para `LO_REQUIEREN_OTROS`: los módulos activos que lo traen y por eso no se puede desactivar. */
  requeridoPor?: readonly string[];
}

export type ResultadoDeCambio = { ok: true; activos: ReadonlySet<string> } | { ok: false; errores: readonly ErrorDeCambio[] };

/**
 * Valida un cambio de módulos de una empresa. Solo los vendibles se activan o desactivan; uno `en_desarrollo` nunca se activa; un módulo no
 * se desactiva mientras otro de los activos lo requiera (Stock con Salón activo). Activar uno que requiere otro vendible que no está en el
 * registro es válido: queda incluido por la clausura (ADR-015 §4). Devuelve el registro resultante (solo vendibles).
 */
export function validarCambioDeModulos(
  activosActuales: Iterable<string>,
  cambio: { activar?: readonly string[]; desactivar?: readonly string[] },
  catalogo: readonly ModuloDef[] = MODULOS
): ResultadoDeCambio {
  const definiciones = porId(catalogo);
  const errores: ErrorDeCambio[] = [];
  const registro = new Set(raicesDelRegistro(activosActuales, catalogo));

  for (const id of cambio.activar ?? []) {
    const d = definiciones.get(id);
    if (!d) errores.push({ motivo: "DESCONOCIDO", modulo: id });
    else if (d.tipo !== "vendible") errores.push({ motivo: "NO_ES_VENDIBLE", modulo: id });
    else if (d.estado !== "disponible") errores.push({ motivo: "EN_DESARROLLO", modulo: id });
    else registro.add(id);
  }

  for (const id of cambio.desactivar ?? []) {
    const d = definiciones.get(id);
    if (!d) errores.push({ motivo: "DESCONOCIDO", modulo: id });
    else if (d.tipo !== "vendible") errores.push({ motivo: "NO_ES_VENDIBLE", modulo: id });
    else registro.delete(id);
  }

  for (const id of cambio.desactivar ?? []) {
    if (definiciones.get(id)?.tipo !== "vendible" || registro.has(id)) continue;
    const requeridoPor = modulosQueIncluyen(id, registro, catalogo);
    if (requeridoPor.length) errores.push({ motivo: "LO_REQUIEREN_OTROS", modulo: id, requeridoPor });
  }

  return errores.length ? { ok: false, errores } : { ok: true, activos: registro };
}
