import type { ConsumoDeConfiguracion, DiferenciaDePrecio, ModoDePrecioDeMedida, TipoDeGrupoDeOpciones } from "@/core/opciones/public";

/**
 * Tipos de la feature «catálogo de opciones de venta» (GO-2a; ADR-030): los comandos y resultados de los casos de uso de `src/server/actions/catalogo/casos-de-uso/` que vienen
 * de las Server Actions de `src/server/actions/catalogo/opciones-de-venta.ts` (clave `opciones_definir` para grupos, opciones y versiones; `producto_opciones_admitidas` para lo que
 * admite cada producto). Cada comando llega YA validado en formato y rango por su `guardComando…` (`opciones-de-venta.guard.ts`); las reglas de negocio puras son las de
 * `core/opciones` (`validarGrupo`, `validarVersion`…) y las que dependen de la base las aplica el caso de uso dentro de su transacción.
 *
 * Toda edición lleva la VERSIÓN que vio la pantalla (`versionEsperada`, control optimista): si otra persona cambió la fila en el medio, se rechaza (`VERSION_DESACTUALIZADA`) sin
 * escribir nada. Repetir una edición sin cambios no sube la versión ni deja auditoría.
 */

/** Lo que fija una versión de una opción: la diferencia de precio, el factor de escala (solo MEDIDA) y los consumos (el orden de la lista es el `orden` de cada fila). */
export interface DatosDeVersionDeOpcion {
  diferencia: DiferenciaDePrecio;
  factorEscala: number | null;
  consumos: ConsumoDeConfiguracion[];
}

// ───────────────────────────── Grupos ─────────────────────────────

export interface ComandoCrearGrupoDeOpciones {
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
}


export interface ComandoEditarGrupoDeOpciones {
  grupoId: string;
  versionEsperada: number;
  nombre: string;
  cantidadMinima: number;
  cantidadMaxima: number;
  activo: boolean;
}


// ───────────────────────────── Opciones y versiones ─────────────────────────────

/** D-1 (variante A′): el producto ancla de un ADICIONAL lo crea el caso de uso en la misma transacción; la pantalla solo elige su unidad de stock. */
export interface AnclaNueva {
  unidadStockId: string;
}

export interface ComandoCrearOpcionDeGrupo {
  grupoId: string;
  nombre: string;
  orden: number;
  esNinguna: boolean;
  version: DatosDeVersionDeOpcion;
  /** Solo en un ADICIONAL (obligatoria ahí). */
  ancla: AnclaNueva | null;
}


export interface ComandoEditarOpcionDeGrupo {
  opcionId: string;
  versionEsperada: number;
  nombre: string;
  orden: number;
  activa: boolean;
}


export interface ComandoAgregarVersionDeOpcion {
  opcionId: string;
  /** El número de la versión VIGENTE que vio la pantalla: la nueva será la siguiente. */
  numeroEsperado: number;
  version: DatosDeVersionDeOpcion;
}


// ───────────────────────────── Lo que admite cada producto ─────────────────────────────

export interface OpcionAdmitidaEnComando {
  opcionId: string;
  /** La `version` de la fila de `ProductoAdmiteOpcion` que vio la pantalla; 0 = todavía no existe. */
  versionEsperada: number;
  cantidadMaxima: number;
  precioAbsoluto: number | null;
  diferencia: DiferenciaDePrecio | null;
  activo: boolean;
}

/** Reemplaza, para un par (producto, grupo), la fila del grupo y las de sus opciones. Nunca borra: quitar es `activo = false`. */
export interface ComandoFijarAdmisionDeGrupo {
  productoId: string;
  grupoId: string;
  /** La `version` de la fila de `ProductoAdmiteGrupo` que vio la pantalla; 0 = todavía no existe. */
  versionEsperada: number;
  orden: number;
  cantidadMinima: number | null;
  cantidadMaxima: number | null;
  modoPrecio: ModoDePrecioDeMedida | null;
  activo: boolean;
  opciones: OpcionAdmitidaEnComando[];
}

