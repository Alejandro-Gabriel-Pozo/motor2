import { CANTIDAD_MAXIMA_DE_OPCION, type TipoDeGrupoDeOpciones } from "./tipos";

/**
 * Validación de las opciones ELEGIDAS para un producto contra lo que ese producto PERMITE (GO-0b; diseño §5, invariantes I2 e I3). Función pura: sin base,
 * sin reloj, sin azar. Quien llama (GO-2) carga la lista de permitidos del producto y el estado de apagado de la sucursal y los pasa ya resueltos; acá solo
 * se decide, con un código de error explícito y un mensaje que se le puede mostrar a quien vende.
 *
 * Reglas:
 * - POR DEFECTO UN PRODUCTO NO ADMITE NADA: sin grupos admitidos en la lista, cualquier opción elegida es `OPCIONES_NO_ADMITIDAS` (fila ausente = no admite).
 * - Una opción que no está en la lista de permitidos del producto (o cuya fila está apagada: desasignar = apagar) es `OPCION_NO_PERMITIDA`.
 * - Apagada: el grupo (`GRUPO_APAGADO`), la opción para toda la empresa (`OPCION_APAGADA`) o la opción en la sucursal que vende (`OPCION_APAGADA_EN_SUCURSAL`).
 * - Versión: si quien eligió vio una versión de la opción y ya no es la vigente, `OPCION_CAMBIO` (el precio o el consumo pudieron cambiar). Sin versión
 *   (`versionDeOpcionId` ausente) no hay nada que comparar: rige la vigente, que es la que se congela en la foto de la línea.
 * - Cantidades: la cantidad de cada opción es un entero de 1 a 10 y no pasa el tope POR PRODUCTO Y POR OPCIÓN (`OPCION_TOPE_SUPERADO`); la misma opción
 *   dos veces es `OPCION_REPETIDA` (se usa la cantidad). Por grupo se cuentan UNIDADES (la suma de las cantidades elegidas del grupo): máximo `GRUPO_MAXIMO_SUPERADO`,
 *   mínimo `GRUPO_MINIMO_NO_ALCANZADO`. El mínimo se exige aunque quien llama no mande ninguna opción (un cliente viejo que no manda opciones a un producto con
 *   un grupo obligatorio no puede cobrar el precio base como si nada).
 * - Un grupo apagado para toda la empresa no participa, SALVO que sea obligatorio (mínimo mayor que 0): ahí falla cerrado con `GRUPO_APAGADO`, porque vender
 *   sin elegir lo obligatorio (el tamaño que fija el precio) cobraría mal.
 *
 * Devuelve el PRIMER problema, en este orden fijo: producto sin lista, cantidades, repetidas, cada opción en el orden recibido (permitida, grupo apagado,
 * opción apagada, apagada en la sucursal, versión, tope) y por último los grupos en el orden de la lista (máximo, mínimo). Si todo está bien devuelve las opciones
 * validadas en el orden de la LISTA DE PERMITIDOS (grupo y opción), no en el de entrada: la salida no depende de cómo llegaron.
 */

/** Una opción de un grupo, tal como la lista de permitidos del producto la describe para la sucursal que vende. */
export interface OpcionPermitida {
  opcionId: string;
  nombre: string;
  /** `OpcionDeGrupo.activa`: apagada para toda la empresa. */
  activa: boolean;
  /** `ProductoAdmiteOpcion.activo`: la fila del producto está activa (desasignar = apagar). */
  admitida: boolean;
  /** `OpcionApagadaEnSucursal.apagada` de la sucursal que vende (fila ausente = prendida = `false`). */
  apagadaEnSucursal: boolean;
  /** `ProductoAdmiteOpcion.cantidadMaxima`: el tope por producto y por opción (1 a 10). */
  cantidadMaxima: number;
  /** La versión vigente de la opción (`VersionDeOpcion` de mayor número). */
  versionVigenteId: string;
  /** La opción explícita «ninguna» (sin guarnición): cuenta como una elegida, sin precio ni consumo. */
  esNinguna: boolean;
}

/** Un grupo que el producto admite, con las cantidades EFECTIVAS (las del producto si las sobrescribe, si no las del grupo) y sus opciones. */
export interface GrupoPermitido {
  grupoId: string;
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  /** `GrupoDeOpciones.activo`: apagado para toda la empresa. */
  activo: boolean;
  /** `ProductoAdmiteGrupo.activo`: la fila del producto está activa (desasignar = apagar). */
  admitido: boolean;
  cantidadMinima: number;
  cantidadMaxima: number;
  opciones: readonly OpcionPermitida[];
}

/** Lo que vino del cliente: la opción, cuántas y (si la tiene) la versión que quien vende vio al elegirla. */
export interface OpcionElegida {
  opcionId: string;
  cantidad: number;
  versionDeOpcionId?: string | null;
}

export const CODIGOS_DE_ERROR_DE_OPCIONES = [
  "OPCIONES_NO_ADMITIDAS",
  "CANTIDAD_INVALIDA",
  "OPCION_REPETIDA",
  "OPCION_NO_PERMITIDA",
  "GRUPO_APAGADO",
  "OPCION_APAGADA",
  "OPCION_APAGADA_EN_SUCURSAL",
  "OPCION_CAMBIO",
  "OPCION_TOPE_SUPERADO",
  "GRUPO_MAXIMO_SUPERADO",
  "GRUPO_MINIMO_NO_ALCANZADO",
] as const;
export type CodigoDeErrorDeOpciones = (typeof CODIGOS_DE_ERROR_DE_OPCIONES)[number];

/** Una opción elegida y aceptada, con lo que el resto de las funciones necesita saber de ella. `versionDeOpcionId` es la VIGENTE (la que se congela). */
export interface OpcionValidada {
  grupoId: string;
  nombreGrupo: string;
  tipo: TipoDeGrupoDeOpciones;
  opcionId: string;
  nombreOpcion: string;
  versionDeOpcionId: string;
  cantidad: number;
  esNinguna: boolean;
}

export type ResultadoDeValidacionDeOpciones =
  | { ok: true; opciones: OpcionValidada[] }
  | { ok: false; codigo: CodigoDeErrorDeOpciones; mensaje: string; grupoId?: string; opcionId?: string };

function error(codigo: CodigoDeErrorDeOpciones, mensaje: string, ids: { grupoId?: string; opcionId?: string } = {}): ResultadoDeValidacionDeOpciones {
  return { ok: false, codigo, mensaje, ...ids };
}

function cuantasOpciones(n: number): string {
  return n === 1 ? "1 opción" : `${n} opciones`;
}

export function validarOpcionesElegidas(permitidos: readonly GrupoPermitido[], elegidas: readonly OpcionElegida[] | null | undefined): ResultadoDeValidacionDeOpciones {
  const lista = elegidas ?? [];
  const grupos = permitidos.filter((g) => g.admitido);

  const ubicar = (opcionId: string) => {
    for (const grupo of grupos) {
      const opcion = grupo.opciones.find((o) => o.opcionId === opcionId);
      if (opcion) return { grupo, opcion };
    }
    return null;
  };
  const nombreDe = (opcionId: string): string | null => ubicar(opcionId)?.opcion.nombre ?? null;

  if (lista.length > 0 && grupos.length === 0) return error("OPCIONES_NO_ADMITIDAS", "Este producto no admite opciones.");

  for (const e of lista) {
    if (!Number.isInteger(e.cantidad) || e.cantidad < 1 || e.cantidad > CANTIDAD_MAXIMA_DE_OPCION) {
      const nombre = nombreDe(e.opcionId);
      return error("CANTIDAD_INVALIDA", `${nombre === null ? "La cantidad de una opción" : `La cantidad de «${nombre}»`} tiene que ser un número entero entre 1 y ${CANTIDAD_MAXIMA_DE_OPCION}.`, {
        opcionId: e.opcionId,
      });
    }
  }

  const vistas = new Set<string>();
  for (const e of lista) {
    if (vistas.has(e.opcionId)) {
      const nombre = nombreDe(e.opcionId);
      return error("OPCION_REPETIDA", `${nombre === null ? "Una opción" : `La opción «${nombre}»`} está repetida: usá la cantidad en vez de cargarla dos veces.`, { opcionId: e.opcionId });
    }
    vistas.add(e.opcionId);
  }

  const cantidadPorGrupo = new Map<string, number>();
  const cantidadPorOpcion = new Map<string, number>();
  for (const e of lista) {
    const ubicada = ubicar(e.opcionId);
    if (ubicada === null || !ubicada.opcion.admitida) {
      return error(
        "OPCION_NO_PERMITIDA",
        ubicada === null ? "Una de las opciones elegidas no se puede elegir para este producto." : `La opción «${ubicada.opcion.nombre}» no se puede elegir para este producto.`,
        { opcionId: e.opcionId }
      );
    }
    const { grupo, opcion } = ubicada;
    if (!grupo.activo) return error("GRUPO_APAGADO", `«${grupo.nombre}» no está disponible por ahora.`, { grupoId: grupo.grupoId, opcionId: e.opcionId });
    if (!opcion.activa) return error("OPCION_APAGADA", `«${opcion.nombre}» ya no está disponible.`, { grupoId: grupo.grupoId, opcionId: e.opcionId });
    if (opcion.apagadaEnSucursal) {
      return error("OPCION_APAGADA_EN_SUCURSAL", `«${opcion.nombre}» no está disponible en esta sucursal por ahora.`, { grupoId: grupo.grupoId, opcionId: e.opcionId });
    }
    if (e.versionDeOpcionId != null && e.versionDeOpcionId !== opcion.versionVigenteId) {
      return error("OPCION_CAMBIO", `«${opcion.nombre}» cambió desde que la elegiste: volvé a elegirla para ver el precio y el detalle actuales.`, {
        grupoId: grupo.grupoId,
        opcionId: e.opcionId,
      });
    }
    if (e.cantidad > opcion.cantidadMaxima) {
      return error("OPCION_TOPE_SUPERADO", `De «${opcion.nombre}» se pueden pedir como máximo ${opcion.cantidadMaxima}.`, { grupoId: grupo.grupoId, opcionId: e.opcionId });
    }
    cantidadPorGrupo.set(grupo.grupoId, (cantidadPorGrupo.get(grupo.grupoId) ?? 0) + e.cantidad);
    cantidadPorOpcion.set(e.opcionId, e.cantidad);
  }

  for (const grupo of grupos) {
    if (!grupo.activo) {
      if (grupo.cantidadMinima > 0) return error("GRUPO_APAGADO", `«${grupo.nombre}» no está disponible por ahora y este producto lo necesita para venderse.`, { grupoId: grupo.grupoId });
      continue;
    }
    const total = cantidadPorGrupo.get(grupo.grupoId) ?? 0;
    if (total > grupo.cantidadMaxima) {
      return error("GRUPO_MAXIMO_SUPERADO", `En «${grupo.nombre}» podés elegir como máximo ${cuantasOpciones(grupo.cantidadMaxima)}.`, { grupoId: grupo.grupoId });
    }
    if (total < grupo.cantidadMinima) {
      return error("GRUPO_MINIMO_NO_ALCANZADO", `Elegí al menos ${cuantasOpciones(grupo.cantidadMinima)} de «${grupo.nombre}».`, { grupoId: grupo.grupoId });
    }
  }

  const validadas: OpcionValidada[] = [];
  for (const grupo of grupos) {
    for (const opcion of grupo.opciones) {
      const cantidad = cantidadPorOpcion.get(opcion.opcionId);
      if (cantidad === undefined) continue;
      validadas.push({
        grupoId: grupo.grupoId,
        nombreGrupo: grupo.nombre,
        tipo: grupo.tipo,
        opcionId: opcion.opcionId,
        nombreOpcion: opcion.nombre,
        versionDeOpcionId: opcion.versionVigenteId,
        cantidad,
        esNinguna: opcion.esNinguna,
      });
    }
  }
  return { ok: true, opciones: validadas };
}
