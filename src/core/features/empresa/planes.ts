import { MODULOS, type ModuloDef } from "@/core/modulos/catalogo";

/**
 * El cálculo PURO de los planes versionados (frente 4, M1; decisión del dueño 2026-11-16: «Planes con versiones desde el inicio, como Pedernal»). Sin base ni azar: lo escribe y lo audita
 * `server/operaciones-de-plataforma/planes.ts`. Un plan es un paquete de la plataforma, SIN precio; su versión PUBLICADA es inmutable y lleva el TECHO de módulos vendibles.
 */

export class PlanesError extends Error {
  constructor(
    motivo: string,
    readonly codigo: "PEDIDO_INVALIDO" | "NO_EXISTE" | "CLAVE_REUTILIZADA" | "VERSION_DESACTUALIZADA" | "ESTADO_INVALIDO" = "PEDIDO_INVALIDO",
  ) {
    super(motivo);
    this.name = "PlanesError";
  }
}

const FORMA_DEL_CODIGO = /^[a-z][a-z0-9-]{1,39}$/;
// Lo que se PERMITE en un texto libre: letras, dígitos, puntuación, símbolos y el espacio común (nada de controles, tabulaciones ni invisibles).
const FORMA_DEL_MOTIVO = /^[\p{L}\p{N}\p{P}\p{S} ]{1,500}$/u;
const FORMA_DEL_NOMBRE = /^[\p{L}\p{N}\p{P}\p{S} ]{1,80}$/u;
/** Lo único que se acepta como clave de reintento: un UUID (lo genera quien llama; repetir la misma clave repite el mismo pedido). */
const FORMA_DE_LA_CLAVE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validarClaveDeReintento(clave: string): string {
  if (!FORMA_DE_LA_CLAVE.test(clave)) throw new PlanesError("La clave de reintento tiene que ser un UUID (minúsculas).");
  return clave;
}

/** El código de un plan: minúsculas, dígitos y guion, empieza con letra, de 2 a 40. Fijo para siempre. */
export function validarCodigoDePlan(codigo: string): string {
  if (!FORMA_DEL_CODIGO.test(codigo)) throw new PlanesError("El código del plan va en minúsculas, dígitos y guion, empieza con letra y tiene de 2 a 40 caracteres.");
  return codigo;
}

export function validarNombreComercial(nombre: string): string {
  const limpio = nombre.trim();
  if (!FORMA_DEL_NOMBRE.test(limpio)) throw new PlanesError("El nombre del plan tiene que tener de 1 a 80 caracteres, sin caracteres de control.");
  return limpio;
}

export function validarMotivo(motivo: string): string {
  const limpio = motivo.trim();
  if (!FORMA_DEL_MOTIVO.test(limpio)) throw new PlanesError("El motivo tiene que tener de 1 a 500 caracteres, sin caracteres de control.");
  return limpio;
}

/**
 * Los módulos del techo de una versión: solo vendibles y disponibles del catálogo, sin repetir, ordenados (así dos pedidos iguales dan la misma huella). Un módulo desconocido, de soporte, fijo o
 * «en desarrollo» se rechaza: el techo declara lo que SE PERMITE, nunca lo que se prohíbe (regla «Todo nace cerrado»).
 */
export function validarModulosDelPlan(modulos: readonly string[], catalogo: readonly ModuloDef[] = MODULOS): string[] {
  const permitidos = new Set(catalogo.filter((m) => m.tipo === "vendible" && m.estado === "disponible").map((m) => m.id as string));
  const vistos = new Set<string>();
  for (const modulo of modulos) {
    if (!permitidos.has(modulo)) throw new PlanesError(`El módulo «${modulo}» no se puede incluir en un plan: solo los vendibles disponibles del catálogo.`);
    if (vistos.has(modulo)) throw new PlanesError(`El módulo «${modulo}» está repetido.`);
    vistos.add(modulo);
  }
  return [...vistos].sort();
}

/** Lo que identifica a un pedido para el reintento: la misma clave con OTRA huella es un error, nunca una segunda ejecución. */
export function huellaCanonica(valor: Record<string, string | number | readonly string[] | null>): string {
  return JSON.stringify(Object.keys(valor).sort().map((k) => [k, valor[k]]));
}

export interface AsignacionDeEmpresa {
  numero: number;
  versionDePlanId: string;
  aplicaDesde: Date;
}

/** La asignación vigente: la de número mayor que ya empezó. Sin ninguna, `null` (una empresa sin plan). Se CALCULA: nunca se marca ni se edita. */
export function asignacionVigenteEn<T extends AsignacionDeEmpresa>(asignaciones: readonly T[], ahora: Date): T | null {
  let vigente: T | null = null;
  for (const a of asignaciones) {
    if (a.aplicaDesde.getTime() > ahora.getTime()) continue;
    if (vigente === null || a.numero > vigente.numero) vigente = a;
  }
  return vigente;
}

export type EstadoDelModuloEnElPlan = "ACTIVO" | "SOLO_LECTURA";

/**
 * Cómo quedarían los módulos que la empresa tiene activos en el registro frente al techo de su plan: dentro del techo, ACTIVO; fuera, SOLO_LECTURA (ve lo que cargó, no carga más). M1 NO lo aplica al
 * guard (M1b): lo usa la plataforma para AVISAR, al asignar un plan, qué módulos quedarían en solo lectura.
 */
export function estadoDeModulosFrenteAlTecho(activosDelRegistro: readonly string[], techo: readonly string[]): Record<string, EstadoDelModuloEnElPlan> {
  const dentro = new Set(techo);
  return Object.fromEntries([...activosDelRegistro].sort().map((m) => [m, dentro.has(m) ? ("ACTIVO" as const) : ("SOLO_LECTURA" as const)]));
}
