import type { ResultadoDato } from "@/core/datos/resultado";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «productos del catálogo» (Hito 4 de la pureza, bloque 4.3, pasos H4C-11 a H4C-13 — `docs/plan-hito-4-pureza.md` §3): los comandos y
 * resultados de los casos de uso de `src/server/actions/catalogo/casos-de-uso/` que vienen de las mutaciones de `src/server/actions/catalogo/productos.ts`. Mismo
 * criterio que `core/features/mesas/mesas.schema.ts`.
 */

/**
 * Los datos de un producto tal como llegan del formulario de alta o edición: los MISMOS campos que `DatosProducto` de la Server Action
 * (`src/server/actions/catalogo/productos.ts`, que es la que documenta cada uno), escritos acá porque el núcleo nace sin tipos de Prisma (`pureza-del-nucleo`;
 * mismo criterio que `EntradaPromoCarta` de `core/features/carta/promos.guard.ts`). `tipo` son los valores del enum `TipoProducto` de prisma/schema.prisma. SIN
 * validar: los valida `validarDatosDeProducto` (server/lecturas/catalogo/datos-de-producto.ts), que lee la unidad de stock a mitad de camino.
 */
export interface EntradaProducto {
  codigo?: string;
  nombre: string;
  tipo: "MP" | "PV";
  categoriaId?: string | null;
  unidadCompraId?: string | null;
  unidadStockId: string;
  factorConversion: number;
  observaciones?: string;
  insumoId?: string | null;
  precioVenta?: number;
  pasoVenta?: number | null;
  seProduce?: boolean;
  esConsignacion?: boolean;
  proveedorConsignacionId?: string | null;
  precioConsignacion?: number;
  activoEnTodasLasSucursales?: boolean;
}

/**
 * El resultado de `guardComandoDatosDeProducto` (S-52), POR ETAPA: lo que decide el formato y el rango de los datos de un producto sin mirar la base. `validarDatosDeProducto` aplica
 * cada etapa en el lugar donde antes vivía su chequeo —`antesDeLaUnidad` antes de leer la unidad de stock; las demás después de leerla, en el orden de siempre—, así un dato inválido
 * no cambia qué mensaje sale primero ni gana sobre «la unidad de stock es obligatoria» cuando la unidad no existe. `factor` y `pasoVenta` miden el rango con los decimales máximos de una
 * unidad: los decimales reales (y la regla R3 del paso) son de la unidad del producto y los decide `validarDatosDeProducto`.
 */
export interface PuertaDeDatosDeProducto {
  antesDeLaUnidad: ResultadoDato<null>;
  factor: ResultadoDato<null>;
  precioVenta: ResultadoDato<number | null>;
  precioConsignacion: ResultadoDato<number | null>;
  pasoVenta: ResultadoDato<null>;
}

/** Comando «alta rápida de una MP desde el wizard de compra»: el nombre YA recortado y validado y la unidad de stock presente (`guardComandoDarDeAltaProductoRapido`). */
export interface ComandoDarDeAltaProductoRapido {
  nombre: string;
  unidadStockId: string;
}

/** El id y el nombre del producto creado, para el `ResultadoConId` de la Server Action (la pantalla lleva a su ficha; el wizard lo pone en la fila). */
export interface DatosProductoCreado {
  id: string;
  nombre: string;
}

/**
 *  - `DATOS_INVALIDOS`: algún dato del formulario no es válido (`validarDatosDeProducto`; solo el alta completa);
 *  - `YA_EXISTE`: ya hay un producto DISPONIBLE (en alguna sucursal) con ese nombre;
 *  - `CODIGO_REPETIDO`: el código (manual, o el autogenerado agotados los reintentos) ya es de otro producto;
 *  - `SIN_PERMISO_COSTO`: el alta trae un costo de consignación (es consignación, proveedor o precio) y quien la pide no tiene `pagar_consignante` (S-12, D8);
 *  - `REFERENCIA_NO_ENCONTRADA`: un id del formulario (categoría, insumo, unidad de compra o de stock, proveedor de consignación) no es de esta empresa o no existe: la clave foránea compuesta de la base lo rechazó y se traduce a «No se encontró …» (O.175).
 */
export type ResultadoDarDeAltaProducto = ResultadoCaso<DatosProductoCreado, "DATOS_INVALIDOS" | "YA_EXISTE" | "CODIGO_REPETIDO" | "SIN_PERMISO_COSTO" | "REFERENCIA_NO_ENCONTRADA">;

/**
 * Comando «editar un producto»: el id, los datos del formulario y la `puerta` (el resultado de `guardComandoDatosDeProducto`, S-52, que `validarDatosDeProducto` aplica en el lugar de
 * siempre: lee la unidad de stock a mitad de camino), y si quien lo pide puede gestionar el costo de consignación (S-12, D8 del dueño: tiene `pagar_consignante` EDITAR en la sucursal
 * activa; lo calcula la Server Action con el gate, el caso de uso no chequea permisos). Sin eso, el costo de consignación (es consignación, proveedor y precio) no se cambia: un campo que
 * no viene queda como estaba, uno distinto es `SIN_PERMISO_COSTO`.
 *
 * M.2: `puedeEditarCamposSensibles` dice si quien lo pide tiene `producto_campos_sensibles` EDITAR (la clave fina del precio de venta, el factor de conversión y las unidades; la calcula la Server
 * Action con el gate, el caso de uso no chequea permisos). Sin ella, un campo sensible que no viene queda como estaba y uno distinto del guardado es `SIN_PERMISO_CAMPOS_SENSIBLES`.
 */
export interface ComandoActualizarProducto {
  productoId: string;
  datos: EntradaProducto;
  puerta: PuertaDeDatosDeProducto;
  puedeGestionarConsignacion: boolean;
  puedeEditarCamposSensibles: boolean;
}

/**
 * El precio de venta global de antes y el que quedó (como número): la Server Action, DESPUÉS de revalidar la carta pública, ofrece sincronizar el precio con los
 * hermanos del ítem agrupado solo si cambió (como antes de la mudanza).
 */
export interface DatosActualizarProducto {
  precioAnterior: number;
  precioNuevo: number;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO`: el id no es de un producto;
 *  - `TIPO_DISTINTO`: el formulario trae otro tipo (MP/PV) que el del producto: no se puede cambiar;
 *  - `DATOS_INVALIDOS`: algún dato del formulario no es válido (`validarDatosDeProducto`);
 *  - `UNIDAD_CON_HISTORIA`: el formulario trae otra unidad de stock y el producto ya tiene historia (movimientos, recetas, presentaciones, proveedores…; CAT-1, S-05);
 *  - `CONSIGNANTE_CON_HISTORIA`: el formulario cambia el consignante (o el «es consignación») de un producto que ya tiene liquidaciones (S-05);
 *  - `SIN_PERMISO_COSTO`: el formulario cambia el costo de consignación (es consignación, proveedor o precio) y quien lo pide no tiene `pagar_consignante` (S-12, D8);
 *  - `SIN_PERMISO_CAMPOS_SENSIBLES`: el formulario cambia el precio de venta, el factor de conversión o una unidad (de stock o de compra) y quien lo pide no tiene `producto_campos_sensibles` (M.2); va ANTES de `UNIDAD_CON_HISTORIA` y `CONSIGNANTE_CON_HISTORIA`;
 *  - `REFERENCIA_NO_ENCONTRADA`: un id del formulario (categoría, insumo, unidad, proveedor de consignación) no es de esta empresa o no existe: la clave foránea compuesta de la base rechazó el `update` y se traduce a «No se encontró …» fuera de la transacción abortada (O.175).
 */
export type ResultadoActualizarProducto = ResultadoCaso<
  DatosActualizarProducto,
  "PRODUCTO_NO_ENCONTRADO" | "TIPO_DISTINTO" | "DATOS_INVALIDOS" | "UNIDAD_CON_HISTORIA" | "CONSIGNANTE_CON_HISTORIA" | "SIN_PERMISO_COSTO" | "SIN_PERMISO_CAMPOS_SENSIBLES" | "REFERENCIA_NO_ENCONTRADA"
>;

/**
 * Comando «aplicar el mismo precio de venta global a varios productos de un ítem agrupado de la carta»: los ids SIN repetir (al menos uno) y el precio, YA
 * validados por `guardComandoSincronizarPrecioGrupoCarta` (un número estricto, no negativo).
 */
export interface ComandoSincronizarPrecioGrupoCarta {
  productoIds: string[];
  precio: number;
}

/** `NO_MISMO_ITEM`: los productos no son todos del mismo ítem agrupado de la carta (en la sucursal activa). */
export type ResultadoSincronizarPrecioGrupoCarta = ResultadoCaso<null, "NO_MISMO_ITEM">;

/** Comando «asignar un insumo a una materia prima existente» (la mitad retroactiva del asistente de hermanar): los dos ids, sin validar (sin guard). */
export interface ComandoAsignarInsumoAProducto {
  productoId: string;
  insumoId: string;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO`: el id no es de un producto;
 *  - `NO_ES_MP`: solo una materia prima puede tener insumo;
 *  - `UNIDAD_MEZCLADA`: el insumo ya tiene productos disponibles con otra unidad de stock (`validarUnidadInsumo`).
 */
export type ResultadoAsignarInsumoAProducto = ResultadoCaso<null, "PRODUCTO_NO_ENCONTRADO" | "NO_ES_MP" | "UNIDAD_MEZCLADA">;

/**
 * Comando «agregar (o reactivar con otro factor) una presentación de compra alternativa»: los ids, el factor y el `factor` que decidió `guardComandoAgregarPresentacionAlternativa`
 * (S-52: el rango del factor, que la acción calcula con lo que mandó el cliente). Sus DECIMALES son los de la unidad de STOCK del producto: los valida el caso de uso, que también
 * aplica el rechazo del `factor` DESPUÉS de leer el producto (un producto inexistente gana sobre un factor inválido), en el mismo orden de siempre.
 */
export interface ComandoAgregarPresentacionAlternativa {
  productoId: string;
  unidadCompraId: string;
  factorConversion: number;
  factor: ResultadoDato<null>;
  /**
   * M.2: si quien lo pide tiene `producto_campos_sensibles` EDITAR (lo calcula la Server Action con el gate; el caso de uso no chequea permisos). Sin ella, definir un factor —crear la presentación
   * o cambiar el de una existente— es `SIN_PERMISO_CAMPOS_SENSIBLES`; reactivar una con el MISMO factor sigue libre.
   */
  puedeEditarCamposSensibles: boolean;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO`: el id no es de un producto;
 *  - `ES_LA_UNIDAD_POR_DEFECTO`: la unidad pedida ya es la unidad de compra por defecto del producto;
 *  - `FACTOR_INVALIDO`: el factor no es una cantidad válida para la unidad de stock del producto;
 *  - `FACTOR_CON_USO` (M-4): la presentación ya existe, ya se usó en compras y el factor pedido es DISTINTO del guardado: no se cambia (reactivarla con el mismo factor sí);
 *  - `SIN_PERMISO_CAMPOS_SENSIBLES` (M.2): la presentación no existía, o existe y el factor pedido es distinto del guardado, y quien lo pide no tiene `producto_campos_sensibles`; va ANTES de `FACTOR_CON_USO`.
 */
export type ResultadoAgregarPresentacionAlternativa = ResultadoCaso<
  null,
  "PRODUCTO_NO_ENCONTRADO" | "ES_LA_UNIDAD_POR_DEFECTO" | "FACTOR_INVALIDO" | "FACTOR_CON_USO" | "SIN_PERMISO_CAMPOS_SENSIBLES"
>;

/** Comando «activar o desactivar una presentación de compra»: el id y el booleano, sin validar (sin guard). */
export interface ComandoActualizarActivaPresentacion {
  presentacionId: string;
  activa: boolean;
}

/**
 * `PRESENTACION_NO_ENCONTRADA`: no hay una presentación con ese id (o es de otra empresa). Desde O.44; antes un id roto hacía lanzar a Prisma (un 500: hallazgo
 * informado por el plan y migrado tal cual en H4C-11).
 */
export type ResultadoActualizarActivaPresentacion = ResultadoCaso<null, "PRESENTACION_NO_ENCONTRADA">;

/** Comando «disponibilidad de un producto en la sucursal activa»: el id y el booleano, sin validar (sin guard). */
export interface ComandoActualizarDisponibilidadProducto {
  productoId: string;
  disponible: boolean;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO`: el id no es de un producto;
 *  - `TIENE_DEPENDENCIAS`: al desactivar, algo depende de él en esta sucursal (la receta vigente de un plato disponible acá, o saldo en una sección de acá).
 */
export type ResultadoActualizarDisponibilidadProducto = ResultadoCaso<null, "PRODUCTO_NO_ENCONTRADO" | "TIENE_DEPENDENCIAS">;
