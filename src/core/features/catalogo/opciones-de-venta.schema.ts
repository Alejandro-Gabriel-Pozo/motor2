import type { ComoCambiaElPrecio, ConsumoDeConfiguracion, DiferenciaDePrecio, ModoDePrecioDeMedida, TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { ResultadoCaso } from "@/core/resultado-caso";

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

/** El motivo, cerrado, por el que una configuración no se puede guardar (el detalle va en el mensaje). */
type ConfiguracionInvalida = "CONFIGURACION_INVALIDA";

// ───────────────────────────── Grupos ─────────────────────────────

export interface ComandoCrearGrupoDeOpciones {
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
  /** Fase 4 (ADR-035): «se lee en la carta como» (`null` o ausente = sin prefijo). Solo VARIANTE y MEDIDA. */
  prefijoEnCarta?: string | null;
}

/**
 * `yaExistia`: había un grupo con ese nombre (sin distinguir mayúsculas), el mismo tipo, las mismas cantidades y el mismo «se lee en la carta como» — repetir el alta (un doble clic, un reintento) devuelve el existente
 * en vez de crear otro. Con el nombre de otro grupo distinto, `NOMBRE_REPETIDO`.
 */
export type ResultadoCrearGrupoDeOpciones = ResultadoCaso<{ grupoId: string; yaExistia: boolean }, "NOMBRE_REPETIDO" | ConfiguracionInvalida>;

export interface ComandoEditarGrupoDeOpciones {
  grupoId: string;
  versionEsperada: number;
  nombre: string;
  cantidadMinima: number;
  cantidadMaxima: number;
  activo: boolean;
  /**
   * Fase 4 (ADR-035): «se lee en la carta como» (`null` = sin prefijo; solo VARIANTE y MEDIDA). `undefined` = queda como estaba (un pedido que no lo manda). Como el resto de la fila, entra en la
   * comparación de la versión: un formulario viejo que cambia otra cosa arrastra el prefijo viejo y se rechaza con `VERSION_DESACTUALIZADA`.
   */
  prefijoEnCarta?: string | null;
}

/** `productosAfectados` (D-4): cuántos productos que admiten el grupo quedan sin poder venderse con este cambio (un grupo obligatorio apagado). Se avisa, no se bloquea. */
export type ResultadoEditarGrupoDeOpciones = ResultadoCaso<
  { version: number; huboCambio: boolean; productosAfectados: number },
  "GRUPO_NO_ENCONTRADO" | "VERSION_DESACTUALIZADA" | "NOMBRE_REPETIDO" | ConfiguracionInvalida
>;

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

/**
 * `yaExistia`: el grupo ya tenía una opción con ese nombre (sin distinguir mayúsculas), la misma «ninguna» y una versión 1 con el mismo contenido — repetir el alta devuelve la existente.
 * `NOMBRE_DE_ANCLA_REPETIDO`: ya hay un producto con el nombre del ancla. `REFERENCIA_NO_ENCONTRADA`: un insumo, un reemplazado o la unidad no son de la empresa. `MODULO_RECETAS_INACTIVO`
 * (D-3): los consumos exigen el módulo Recetas.
 */
export type ResultadoCrearOpcionDeGrupo = ResultadoCaso<
  { opcionId: string; versionDeOpcionId: string; productoAnclaId: string | null; yaExistia: boolean },
  "GRUPO_NO_ENCONTRADO" | "NOMBRE_REPETIDO" | "NOMBRE_DE_ANCLA_REPETIDO" | "REFERENCIA_NO_ENCONTRADA" | "MODULO_RECETAS_INACTIVO" | ConfiguracionInvalida
>;

export interface ComandoEditarOpcionDeGrupo {
  opcionId: string;
  versionEsperada: number;
  nombre: string;
  orden: number;
  activa: boolean;
}

export type ResultadoEditarOpcionDeGrupo = ResultadoCaso<
  { version: number; huboCambio: boolean; productosAfectados: number },
  "OPCION_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA" | "NOMBRE_REPETIDO"
>;

export interface ComandoAgregarVersionDeOpcion {
  opcionId: string;
  /** El número de la versión VIGENTE que vio la pantalla: la nueva será la siguiente. */
  numeroEsperado: number;
  version: DatosDeVersionDeOpcion;
}

/** `yaExistia`: la vigente ya es la siguiente a la esperada, la cargó la misma persona y tiene el mismo contenido (el mismo pedido repetido): no se agrega otra. */
export type ResultadoAgregarVersionDeOpcion = ResultadoCaso<
  { versionDeOpcionId: string; numero: number; yaExistia: boolean },
  "OPCION_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA" | "REFERENCIA_NO_ENCONTRADA" | "MODULO_RECETAS_INACTIVO" | ConfiguracionInvalida
>;

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

/** `avisos`: lo que no bloquea pero conviene saber (un REEMPLAZA que no encuentra su insumo en la receta central, S3). */
export type ResultadoFijarAdmisionDeGrupo = ResultadoCaso<
  { admisionId: string; version: number; huboCambio: boolean; avisos: string[] },
  "PRODUCTO_NO_ENCONTRADO" | "PRODUCTO_NO_ELEGIBLE" | "GRUPO_NO_ENCONTRADO" | "VERSION_DESACTUALIZADA" | "GRUPO_INACTIVO" | "OPCION_INACTIVA" | ConfiguracionInvalida
>;

// ───────────────────────────── GO-2d: el orden de las opciones de un grupo ─────────────────────────────

/** Una opción en el orden nuevo, con la `version` de su fila que vio la pantalla. */
export interface OpcionEnElOrden {
  opcionId: string;
  versionEsperada: number;
}

/**
 * «Mover tocando» (GO-2d): el orden COMPLETO de las opciones de un grupo, de la primera a la última. Tiene que traer TODAS las opciones del grupo (prendidas o no), cada una una
 * sola vez: así un orden armado sobre una lista vieja (otra persona agregó una opción) se rechaza en vez de dejar una mitad ordenada.
 */
export interface ComandoReordenarOpcionesDeGrupo {
  grupoId: string;
  opciones: OpcionEnElOrden[];
}

export type ResultadoReordenarOpcionesDeGrupo = ResultadoCaso<{ huboCambio: boolean }, "GRUPO_NO_ENCONTRADO" | "VERSION_DESACTUALIZADA">;

// ───────────────────────────── OPCIONES-LIMPIEZA: archivar, restaurar y quitar de un producto ─────────────────────────────

/**
 * ARCHIVAR (o RESTAURAR) grupos y opciones de una sola vez, todo o nada (decisión del dueño, 2026-10-14: lo que compone la venta se gestiona sin miedo). Archivar es
 * `activo = false` en el grupo o `activa = false` en la opción: deja de ofrecerse en la venta, la carta y los listados activos, pero se conserva y se restaura con un toque. Lo YA
 * VENDIDO no cambia (la foto de la línea, `OpcionElegidaEnLinea`, es de solo agregar). El mismo comando sirve para un elemento suelto y para un lote de «Limpiar»; restaurar es
 * el mismo pedido con `archivar = false` (el «Deshacer»).
 */
export interface ComandoArchivarOpciones {
  /** Sin repetidos (el guard los saca). */
  grupoIds: string[];
  /** Sin repetidos (el guard los saca). */
  opcionIds: string[];
  /** `true` archiva; `false` restaura. */
  archivar: boolean;
}

/**
 * `cambiados`: cuántos elementos cambiaron de estado (los que ya estaban así no cuentan ni se auditan). `productosAfectados` (D-4): cuántos productos quedan sin poder venderse
 * porque un grupo obligatorio para ellos quedó archivado o sin opciones suficientes; se avisa, no se bloquea. `NO_ENCONTRADO`: algún id no es de la empresa o no existe; en ese caso
 * no se toca NADA del lote.
 */
export type ResultadoArchivarOpciones = ResultadoCaso<{ cambiados: number; productosAfectados: number }, "NO_ENCONTRADO" | "VERSION_DESACTUALIZADA">;

/**
 * QUITAR un grupo de un producto (o VOLVER A VINCULARLO): «llevar al estado», sin la versión de la pantalla (así el «Deshacer» funciona aunque la pantalla ya se haya refrescado).
 * Quitar es `ProductoAdmiteGrupo.activo = false`: la fila y lo que el producto admitía de cada opción se conservan, y volver a vincular deja todo como estaba.
 */
export interface ComandoVincularGrupoEnProducto {
  productoId: string;
  grupoId: string;
  vinculado: boolean;
}

/**
 * `NO_VINCULADO`: el producto nunca tuvo ese grupo (no hay nada que quitar ni que volver a vincular: se agrega desde «Agregar grupo»). `BASE_SIN_PRECIO_FINAL` (Fase 4, ADR-035): el producto se vende
 * por opción y quitar ese grupo lo deja sin grupo de precio final (se vendería suelto a su precio guardado): primero se cambia «¿Cómo se vende?» a Directo.
 */
export type ResultadoVincularGrupoEnProducto = ResultadoCaso<
  { huboCambio: boolean },
  "PRODUCTO_NO_ENCONTRADO" | "PRODUCTO_NO_ELEGIBLE" | "GRUPO_NO_ENCONTRADO" | "NO_VINCULADO" | "VERSION_DESACTUALIZADA" | "GRUPO_INACTIVO" | "OPCION_INACTIVA" | "BASE_SIN_PRECIO_FINAL" | ConfiguracionInvalida
>;

// ───────────────────────────── Fase 6 (el espacio del producto): crear un grupo sin salir del producto ─────────────────────────────

/**
 * Una opción del grupo que se crea desde el producto. `importe`, según lo que responde «¿Cambia el precio?»: PRECIO_FINAL, el precio final de esa opción (mayor que 0); SUMA, lo que suma sobre el precio
 * del producto (0 o más); INCLUIDO, `null` (una opción incluida no lleva importe). Siempre en pesos, con a lo sumo 2 decimales.
 */
export interface OpcionNuevaEnElProducto {
  nombre: string;
  importe: number | null;
}

/**
 * El comando compuesto «crear un grupo de opciones y agregarlo a este producto», TODO O NADA (ADR-030, «El comando compuesto»): el grupo, sus opciones con su versión 1 y lo que el producto admite de
 * ellas, en UNA transacción. La forma del grupo (tipo y cantidades) sale de `respuesta` (`formaDelGrupoPorRespuesta`): no se elige aparte. Nunca modifica un grupo que ya está en la biblioteca.
 */
export interface ComandoCrearGrupoEnElProducto {
  productoId: string;
  nombre: string;
  respuesta: ComoCambiaElPrecio;
  /** «Se lee en la carta como» (`null` = sin prefijo). Solo SUMA y PRECIO_FINAL (el grupo es VARIANTE o MEDIDA). */
  prefijoEnCarta: string | null;
  /** De 1 a `MAX_OPCIONES_EN_UN_ALTA`, con nombres que no se repiten sin distinguir mayúsculas. */
  opciones: OpcionNuevaEnElProducto[];
}

/**
 * `yaExistia`: el grupo ya estaba en la biblioteca con ESAS mismas opciones (mismo conjunto de nombres activos y mismo precio de cada una) y se adoptó tal cual, o ya estaba en el producto exactamente
 * como se pedía (un doble clic, un reintento): no se creó otro. Un grupo de la biblioteca que se llama igual pero es otro se rechaza con `NOMBRE_REPETIDO` y no se toca. `GRUPO_INACTIVO`: el grupo
 * que se adoptaría está archivado.
 */
export type ResultadoCrearGrupoEnElProducto = ResultadoCaso<
  { grupoId: string; admisionId: string; yaExistia: boolean },
  "PRODUCTO_NO_ENCONTRADO" | "PRODUCTO_NO_ELEGIBLE" | "NOMBRE_REPETIDO" | "VERSION_DESACTUALIZADA" | "CONFIGURACION_INVALIDA" | "GRUPO_INACTIVO" | "REFERENCIA_NO_ENCONTRADA"
>;
