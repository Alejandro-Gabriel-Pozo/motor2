import { ACCIONES, ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, claveEnCatalogo, type AccionSemilla, type NivelDeAccion } from "./acciones";
import { CLAVE_ROL_ADMIN, CLAVE_ROL_OPERADOR, nivelAlcanzaElPiso, nivelDelRolFrenteAlPiso } from "./jerarquia";

/**
 * Plantillas de rol, versiones y pisos de plataforma (EB-1 de roles propios; `docs/diseno-roles-propios-versiones-plantillas-pisos-2026-11-17.md`). Lógica PURA: la semilla que escribe la migración, las
 * reglas que una versión de plantilla tiene que cumplir (las mismas que impone el trigger de la base) y el plan de sincronización de acciones nuevas. Vive en `core/permisos` porque acá es donde se pueden
 * comparar niveles y claves de rol de sistema (regla 4 de `acceso-solo-por-el-guard`).
 *
 * EB-1 NO conecta nada al guard ni a las pantallas: son tablas de plataforma, escritas por script. Nada de lo que ve una empresa cambia.
 */

/** Las tres plantillas. GERENTE existe como fila pero NO tiene versiones (el gerente no pasa por la matriz: es `UsuarioEmpresa.rolEmpresa`). */
export const PLANTILLAS = ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const;
export type Plantilla = (typeof PLANTILLAS)[number];

/** Las plantillas que llevan lista de acciones (versiones de Ver y de Editar). */
export const PLANTILLAS_CON_LISTA = ["ADMINISTRADOR", "OPERADOR"] as const;
export type PlantillaConLista = (typeof PLANTILLAS_CON_LISTA)[number];

/** Los tipos de piso de plataforma. Sin fila = sin piso (la acción la decide la plantilla). */
export const TIPOS_DE_PISO = ["SOLO_GERENTE", "TODOS_LOS_ROLES"] as const;
export type TipoDePiso = (typeof TIPOS_DE_PISO)[number];

/** Qué rol de fábrica (clave de `ROLES_DE_FABRICA`, la que usa `rolesEditarSemilla`) corresponde a cada plantilla con lista. */
export const ROL_DE_FABRICA_DE_LA_PLANTILLA = { ADMINISTRADOR: "admin", OPERADOR: "operador" } as const satisfies Record<PlantillaConLista, "admin" | "operador">;

const CLAVE_DE_ROL_DE_LA_PLANTILLA: Readonly<Record<PlantillaConLista, string>> = { ADMINISTRADOR: CLAVE_ROL_ADMIN, OPERADOR: CLAVE_ROL_OPERADOR };

/**
 * El piso con el que nace cada acción según su nivel mínimo de hoy (equivalencia de la semilla): las del gerente y las del gobierno de la empresa (administrador de sistema) son SOLO_GERENTE; las demás
 * nacen sin piso. Ningún nivel nace con TODOS_LOS_ROLES.
 */
export const PISO_INICIAL_POR_NIVEL = {
  operario: null,
  administrador: null,
  administrador_sistema: "SOLO_GERENTE",
  gerente: "SOLO_GERENTE",
} as const satisfies Record<NivelDeAccion, TipoDePiso | null>;

export class PlantillasError extends Error {
  constructor(
    motivo: string,
    readonly codigo: "PEDIDO_INVALIDO" | "NO_EXISTE" | "CLAVE_REUTILIZADA" | "VERSION_DESACTUALIZADA" | "ESTADO_INVALIDO" = "PEDIDO_INVALIDO",
  ) {
    super(motivo);
    this.name = "PlantillasError";
  }
}

// Lo que se PERMITE como clave de acción (la misma forma que impone `clave_de_accion_valida` en la base).
const FORMA_DE_CLAVE_DE_ACCION = /^[a-z][a-z0-9_]{1,79}$/;

/** Una clave de acción: tiene la forma permitida Y está en el catálogo. */
export function validarClaveDeAccion(clave: string): string {
  if (!FORMA_DE_CLAVE_DE_ACCION.test(clave)) throw new PlantillasError(`La clave de acción "${clave}" no tiene la forma permitida (minúsculas, dígitos y guion bajo, empieza con letra, de 2 a 80).`);
  if (!claveEnCatalogo(clave)) throw new PlantillasError(`La acción "${clave}" no está en el catálogo de acciones.`);
  return clave;
}

const comparar = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const ordenadas = (claves: Iterable<string>): string[] => [...new Set(claves)].sort(comparar);

export interface ListaDePlantilla {
  ver: readonly string[];
  editar: readonly string[];
}

export interface PisoDeAccion {
  accionClave: string;
  tipo: TipoDePiso;
}

type AccionParaSemilla = Pick<AccionSemilla, "clave" | "nivelMinimo" | "rolesEditarSemilla">;

export interface SemillaDePlantillas {
  pisos: PisoDeAccion[];
  listas: Record<PlantillaConLista, { ver: string[]; editar: string[] }>;
  introducidas: string[];
}

/**
 * Lo que la migración siembra, derivado del catálogo (nada a mano): los pisos por equivalencia de nivel, la versión 1 de ADMINISTRADOR y de OPERADOR (Ver = Editar, igual que `matrizDeFabrica`) y todas las claves como
 * «ya introducidas». Todo ordenado: dos corridas dan el mismo texto.
 */
export function semillaDePlantillas(acciones: readonly AccionParaSemilla[] = ACCIONES): SemillaDePlantillas {
  const pisos: PisoDeAccion[] = [];
  for (const a of acciones) {
    const tipo = PISO_INICIAL_POR_NIVEL[a.nivelMinimo];
    if (tipo !== null) pisos.push({ accionClave: a.clave, tipo });
  }
  pisos.sort((x, y) => comparar(x.accionClave, y.accionClave));
  const lista = (rol: "admin" | "operador"): string[] => ordenadas(acciones.filter((a) => (a.rolesEditarSemilla as readonly string[]).includes(rol)).map((a) => a.clave));
  const admin = lista(ROL_DE_FABRICA_DE_LA_PLANTILLA.ADMINISTRADOR);
  const operador = lista(ROL_DE_FABRICA_DE_LA_PLANTILLA.OPERADOR);
  return {
    pisos,
    listas: { ADMINISTRADOR: { ver: admin, editar: [...admin] }, OPERADOR: { ver: operador, editar: [...operador] } },
    introducidas: ordenadas(acciones.map((a) => a.clave)),
  };
}

export interface CambiosALaPlantilla {
  darVer?: readonly string[];
  darEditar?: readonly string[];
  quitar?: readonly string[];
  quitarEditar?: readonly string[];
}

export interface ListaCambiada {
  ver: string[];
  editar: string[];
  agregadas: string[];
  quitadas: string[];
}

/**
 * La lista nueva de una plantilla a partir de la última versión y de los cambios pedidos. Dar Editar implica dar Ver; quitar saca de las dos listas; quitar Editar deja Ver. Una clave que se da y se quita a la vez
 * es un pedido contradictorio, y un pedido que no cambia nada también es un error (no se publica una versión idéntica a la anterior).
 */
export function aplicarCambiosALaPlantilla(ultima: ListaDePlantilla, cambios: CambiosALaPlantilla): ListaCambiada {
  const darVer = (cambios.darVer ?? []).map(validarClaveDeAccion);
  const darEditar = (cambios.darEditar ?? []).map(validarClaveDeAccion);
  const quitar = (cambios.quitar ?? []).map(validarClaveDeAccion);
  const quitarEditar = (cambios.quitarEditar ?? []).map(validarClaveDeAccion);
  const doy = new Set([...darVer, ...darEditar]);
  const saco = new Set([...quitar, ...quitarEditar]);
  const contradictorias = [...doy].filter((c) => saco.has(c));
  if (contradictorias.length > 0) throw new PlantillasError(`Se pide dar y quitar a la vez: ${ordenadas(contradictorias).join(", ")}.`);
  if (quitar.some((c) => quitarEditar.includes(c))) throw new PlantillasError("Una acción no puede estar a la vez en «quitar» y en «quitar Editar».");

  const ver = new Set(ultima.ver);
  const editar = new Set(ultima.editar);
  for (const c of darVer) ver.add(c);
  for (const c of darEditar) {
    ver.add(c);
    editar.add(c);
  }
  for (const c of quitar) {
    ver.delete(c);
    editar.delete(c);
  }
  for (const c of quitarEditar) editar.delete(c);

  const verNueva = ordenadas(ver);
  const editarNueva = ordenadas(editar);
  const antesVer = new Set(ultima.ver);
  const antesEditar = new Set(ultima.editar);
  const agregadas = ordenadas([...verNueva.filter((c) => !antesVer.has(c)), ...editarNueva.filter((c) => !antesEditar.has(c))]);
  const quitadas = ordenadas([...ultima.ver.filter((c) => !ver.has(c)), ...ultima.editar.filter((c) => !editar.has(c))]);
  if (agregadas.length === 0 && quitadas.length === 0) throw new PlantillasError("El pedido no cambia nada de la última versión de la plantilla.");
  return { ver: verNueva, editar: editarNueva, agregadas, quitadas };
}

/** Lo que las reglas miran de cada acción: su nivel de hoy y si es de las que el administrador conserva siempre. Por defecto, el catálogo real; las pruebas de combinaciones inyectan uno sintético. */
export interface CatalogoParaLasReglas {
  nivelDe: (clave: string) => NivelDeAccion | undefined;
  requierenAdminSiempre: readonly string[];
}

const CATALOGO_REAL: CatalogoParaLasReglas = {
  nivelDe: (clave) => ACCIONES.find((a) => a.clave === clave)?.nivelMinimo,
  requierenAdminSiempre: ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE,
};

/** Qué regla se incumplió (la categoría que el oráculo de combinaciones compara) y el mensaje para quien publica. */
export interface IncumplimientoDeLaPlantilla {
  regla: "SIN_LISTA" | "CATALOGO" | "EDITAR_SIN_VER" | "NIVEL" | "SOLO_GERENTE" | "TODOS_LOS_ROLES" | "ADMIN_SIEMPRE" | "SIN_PISOS";
  mensaje: string;
}

/**
 * Las reglas que una versión de plantilla tiene que cumplir (las mismas que impone la base: la app las revisa primero para dar un mensaje claro; la base manda). Devuelve los incumplimientos en este orden, vacío si no hay:
 *  1. una clave fuera del catálogo; 2. Editar fuera de Ver; 3. REGLA TRANSITORIA de nivel (hasta que el guard lea las plantillas, T5): una acción que el rol de fábrica de la plantilla no alcanza hoy por su nivel;
 *  4. una acción con piso SOLO_GERENTE en OPERADOR (en ADMINISTRADOR no se controla: lleva las del gobierno, respuesta (b) del dueño); 5. una acción con piso TODOS_LOS_ROLES ausente de Ver;
 *  6. ADMINISTRADOR sin Ver y Editar de alguna de las acciones que conserva siempre; 7. sin pisos legibles: se rechaza (no se publica a ciegas).
 */
export function incumplimientosDeLaPlantilla(
  plantilla: string,
  ver: readonly string[],
  editar: readonly string[],
  pisos: readonly PisoDeAccion[],
  catalogo: CatalogoParaLasReglas = CATALOGO_REAL,
): IncumplimientoDeLaPlantilla[] {
  if (plantilla !== "ADMINISTRADOR" && plantilla !== "OPERADOR") return [{ regla: "SIN_LISTA", mensaje: `La plantilla "${plantilla}" no lleva versiones.` }];
  const salida: IncumplimientoDeLaPlantilla[] = [];
  const verSet = new Set(ver);
  const editarSet = new Set(editar);

  const fueraDelCatalogo = ordenadas([...ver, ...editar]).filter((c) => catalogo.nivelDe(c) === undefined);
  if (fueraDelCatalogo.length > 0) salida.push({ regla: "CATALOGO", mensaje: `Acciones que no están en el catálogo: ${fueraDelCatalogo.join(", ")}.` });

  const editarSinVer = ordenadas(editar).filter((c) => !verSet.has(c));
  if (editarSinVer.length > 0) salida.push({ regla: "EDITAR_SIN_VER", mensaje: `Editar sin Ver: ${editarSinVer.join(", ")}.` });

  const rol = { clave: CLAVE_DE_ROL_DE_LA_PLANTILLA[plantilla] };
  const sobreElNivel = ordenadas([...ver, ...editar]).filter((c) => {
    const nivel = catalogo.nivelDe(c);
    return nivel !== undefined && !nivelAlcanzaElPiso(nivelDelRolFrenteAlPiso(rol), nivel);
  });
  if (sobreElNivel.length > 0) salida.push({ regla: "NIVEL", mensaje: `Acciones que el rol ${plantilla} no alcanza por su nivel: ${sobreElNivel.join(", ")}.` });

  if (plantilla === "OPERADOR") {
    const soloGerente = ordenadas(pisos.filter((p) => p.tipo === "SOLO_GERENTE").map((p) => p.accionClave)).filter((c) => verSet.has(c) || editarSet.has(c));
    if (soloGerente.length > 0) salida.push({ regla: "SOLO_GERENTE", mensaje: `Acciones de piso SOLO_GERENTE en OPERADOR: ${soloGerente.join(", ")}.` });
  }

  const todosAusentes = ordenadas(pisos.filter((p) => p.tipo === "TODOS_LOS_ROLES").map((p) => p.accionClave)).filter((c) => !verSet.has(c));
  if (todosAusentes.length > 0) salida.push({ regla: "TODOS_LOS_ROLES", mensaje: `Acciones de piso TODOS_LOS_ROLES que faltan en Ver: ${todosAusentes.join(", ")}.` });

  if (plantilla === "ADMINISTRADOR") {
    const sinAdmin = ordenadas(catalogo.requierenAdminSiempre).filter((c) => !verSet.has(c) || !editarSet.has(c));
    if (sinAdmin.length > 0) salida.push({ regla: "ADMIN_SIEMPRE", mensaje: `ADMINISTRADOR tiene que conservar Ver y Editar de: ${sinAdmin.join(", ")}.` });
  }

  if (pisos.length === 0) salida.push({ regla: "SIN_PISOS", mensaje: "No se pueden leer los pisos de la plataforma." });
  return salida;
}

export interface PlanDeSincronizacion {
  pisosNuevos: PisoDeAccion[];
  versiones: Partial<Record<PlantillaConLista, { ver: string[]; editar: string[]; agregadas: string[] }>>;
}

/**
 * Qué hay que escribir cuando el catálogo trae acciones que la base todavía no conoce: cada acción nueva se suma a las plantillas que su semilla indica (Ver = Editar) y crea su piso por la equivalencia de nivel,
 * salvo que ya haya una fila de piso. NUNCA quita ni repone: si la plataforma sacó una acción de una plantilla, una acción vieja no vuelve sola. Solo figuran las plantillas que cambian.
 */
export function planDeSincronizacion(
  nuevas: readonly AccionParaSemilla[],
  ultimas: Record<PlantillaConLista, ListaDePlantilla>,
  pisosExistentes: readonly string[],
): PlanDeSincronizacion {
  const conPiso = new Set(pisosExistentes);
  const pisosNuevos: PisoDeAccion[] = [];
  for (const a of nuevas) {
    const tipo = PISO_INICIAL_POR_NIVEL[a.nivelMinimo];
    if (tipo !== null && !conPiso.has(a.clave)) pisosNuevos.push({ accionClave: a.clave, tipo });
  }
  pisosNuevos.sort((x, y) => comparar(x.accionClave, y.accionClave));

  const versiones: PlanDeSincronizacion["versiones"] = {};
  for (const plantilla of PLANTILLAS_CON_LISTA) {
    const rol = ROL_DE_FABRICA_DE_LA_PLANTILLA[plantilla];
    const yaTiene = new Set(ultimas[plantilla].ver);
    const agregadas = ordenadas(nuevas.filter((a) => (a.rolesEditarSemilla as readonly string[]).includes(rol) && !yaTiene.has(a.clave)).map((a) => a.clave));
    if (agregadas.length === 0) continue;
    versiones[plantilla] = { ver: ordenadas([...ultimas[plantilla].ver, ...agregadas]), editar: ordenadas([...ultimas[plantilla].editar, ...agregadas]), agregadas };
  }
  return { pisosNuevos, versiones };
}
