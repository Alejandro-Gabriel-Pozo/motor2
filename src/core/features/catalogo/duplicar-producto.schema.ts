import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «Duplicar producto» (etapa E4 de `docs/diseno-duplicar-producto-2026-11-12.md`): el comando y el resultado del caso de uso
 * `src/server/actions/catalogo/casos-de-uso/duplicar-producto.ts`, que viene de la Server Action `src/server/actions/catalogo/duplicar-producto.ts`. El comando llega YA validado en
 * formato y rango por `guardComandoDuplicarProducto` (`duplicar-producto.guard.ts`).
 */

/**
 * Crea un producto NUEVO a partir de otro. El permiso de cada cosa que se copia lo resuelve la Server Action (`alta_producto` para crear, `guardar_receta` si se copia la receta,
 * `producto_opciones_admitidas` si se copian las opciones) y el caso de uso recibe solo si quien duplica puede fijar el precio (`producto_campos_sensibles`).
 */
export interface ComandoDuplicarProducto {
  /** El id del producto NUEVO, que manda la aplicación: es la clave de idempotencia (el doble clic y el reintento caen sobre el mismo producto). */
  duplicadoId: string;
  /** El producto que se duplica. */
  origenId: string;
  /** El nombre propio del duplicado: obligatorio, ya recortado y validado como el de un alta. */
  nombre: string;
  /** Copiar la receta vigente (ingredientes, sustitutos, pasos y ficha técnica) como versión 1 del producto nuevo. */
  copiarReceta: boolean;
  /** Copiar lo que el producto admite: los mismos grupos y opciones de la biblioteca, con sus precios. */
  copiarOpciones: boolean;
  /** La sucursal de la que se toma la receta vigente (si tiene receta propia habilitada, esa; si no, la central); `null` = la Central. Solo cuenta con `copiarReceta`. */
  sucursalDeLaRecetaId: string | null;
  /** El precio de lista con el que nace (punto de partida editable). `null` = no viene: con `producto_campos_sensibles` nace con el del original; sin la clave, en 0. */
  precioVenta: number | null;
}

/** Lo que se copió de la receta (el producto nuevo la recibe como versión 1). */
export interface RecetaDuplicada {
  ingredientes: number;
  pasos: number;
  /** Algún paso nombra un ingrediente: el texto se copió tal cual y hay que revisarlo. */
  pasosParaRevisar: boolean;
  /** De qué versión del original salió y dónde regía (la central o la receta propia de una sucursal). */
  versionDeOrigen: number;
  dondeRegia: string;
}

/** Lo que se copió de las opciones vinculadas. */
export interface OpcionesDuplicadas {
  grupos: number;
  opciones: number;
  /** Cuántas de esas opciones llevan un precio propio (un precio final o una diferencia): lo que mueve dinero. */
  conPrecio: number;
  gruposArchivadosNoCopiados: number;
  opcionesArchivadasNoCopiadas: number;
}

/**
 * Con qué precio nació el producto nuevo: el del original (`COPIADO`), otro que se escribió al duplicar (`EDITADO`), o en 0 porque quien duplica no tiene `producto_campos_sensibles`: `EN_CERO_Y_APAGADO` en un producto
 * de venta (queda sin disponibilidad hasta que alguien con la clave le cargue el precio y lo active, regla M.2-A4 del alta) y `EN_CERO` en una materia prima (que no se vende). `POR_OPCION`: el original se vende por opción,
 * su precio guardado no se cobra (el precio final está en cada opción, que se copió) y el producto nuevo lo guarda en 0.
 */
export type PrecioDelDuplicado = "COPIADO" | "EDITADO" | "EN_CERO" | "EN_CERO_Y_APAGADO" | "POR_OPCION";

export interface DatosProductoDuplicado {
  productoId: string;
  nombre: string;
  /** El pedido ya se había atendido (el mismo `duplicadoId`, origen y nombre): se devuelve el producto que ya estaba, sin copiar ni auditar de nuevo. */
  yaExistia: boolean;
  receta: RecetaDuplicada | null;
  opciones: OpcionesDuplicadas | null;
  /** `null` cuando `yaExistia` (no se vuelve a decidir nada). */
  precio: PrecioDelDuplicado | null;
}

/**
 * Lo que produce el caso de uso (el formato lo rechaza antes el guard, y el permiso de la receta y de las opciones, la Server Action):
 *  - `SIN_PERMISO_CAMPOS_SENSIBLES`: sin `producto_campos_sensibles` el pedido trae un precio, o el original se vende por opción (el modo de venta es un campo sensible);
 *  - `PRECIO_BLOQUEADO_EN_BASE`: el original se vende por opción y el pedido trae un precio (el precio guardado de una base no se cobra ni se cambia);
 *  - `ORIGEN_NO_ENCONTRADO`: el producto no existe en la empresa (o es de otra);
 *  - `PRODUCTO_NO_ELEGIBLE`: el original es el producto de respaldo de un adicional (lo maneja el sistema) o no admite lo que se pidió copiar;
 *  - `ORIGEN_SUCURSAL_NO_ENCONTRADO` / `ORIGEN_SUCURSAL_SIN_ACCESO`: la sucursal de la receta no existe, está desactivada o quien duplica no tiene membresía y el «Ver» de `receta_sucursal_copiar` en ella (S-07);
 *  - `ORIGEN_SIN_RECETA` / `ORIGEN_SIN_OPCIONES`: se pidió copiar algo que el original no tiene;
 *  - `NOMBRE_REPETIDO`: ya hay un producto con ese nombre (sin distinguir mayúsculas);
 *  - `ID_REUTILIZADO`: el `duplicadoId` ya es de otro producto, o del mismo producto pero con otro origen u otro nombre;
 *  - `RECETA_CIRCULAR`: el producto nuevo aparecería como ingrediente de su propia receta;
 *  - `INGREDIENTES_INVALIDOS` / `PASOS_INVALIDOS` / `CABECERA_INVALIDA`: la receta del original no pasa la validación de siempre (un ingrediente dado de baja, la unidad de stock…): se nombran todos;
 *  - `OPCIONES_INVALIDAS`: lo que el original admite no pasa las reglas de siempre en el producto nuevo (por ejemplo, un precio que lo contradice);
 *  - `BASE_INVALIDA`: el original se vende por opción y el producto nuevo no cumple lo que esa forma de venta exige (hace falta copiar también las opciones);
 *  - `REFERENCIA_NO_ENCONTRADA`: la categoría, las unidades o lo que apunta el original no existe en la empresa;
 *  - `CONFLICTO`: el conflicto de escritura agotó los reintentos (otra persona cambiaba lo mismo a la vez).
 */
export type ResultadoDuplicarProducto = ResultadoCaso<
  DatosProductoDuplicado,
  | "SIN_PERMISO_CAMPOS_SENSIBLES"
  | "PRECIO_BLOQUEADO_EN_BASE"
  | "ORIGEN_NO_ENCONTRADO"
  | "PRODUCTO_NO_ELEGIBLE"
  | "ORIGEN_SUCURSAL_NO_ENCONTRADO"
  | "ORIGEN_SUCURSAL_SIN_ACCESO"
  | "ORIGEN_SIN_RECETA"
  | "ORIGEN_SIN_OPCIONES"
  | "NOMBRE_REPETIDO"
  | "ID_REUTILIZADO"
  | "RECETA_CIRCULAR"
  | "INGREDIENTES_INVALIDOS"
  | "PASOS_INVALIDOS"
  | "CABECERA_INVALIDA"
  | "OPCIONES_INVALIDAS"
  | "BASE_INVALIDA"
  | "REFERENCIA_NO_ENCONTRADA"
  | "CONFLICTO"
>;
