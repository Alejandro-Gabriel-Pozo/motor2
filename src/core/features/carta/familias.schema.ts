import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «familias de productos» (docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md, etapa F1): los comandos y resultados de los casos de uso
 * `src/server/actions/carta/casos-de-uso/{crear,editar,fijar-activa}-familia-de-producto.ts` y `{agregar,quitar}-producto-{a,de}-familia.ts`, que vienen de las Server Actions de `src/server/actions/carta/secciones.ts`.
 * La familia es de la EMPRESA (la empresa sale del contexto del servidor, nunca del comando). Los ids de las filas nuevas los genera el servidor (uuid): un reintento no crea dos.
 */

/** Comando «crear una familia» (CU-F1): solo el nombre. Los dos interruptores NACEN APAGADOS (todo nace cerrado). `id` es el uuid con el que se crearía la fila. */
export interface ComandoCrearFamiliaDeProducto {
  id: string;
  nombre: string;
}

/**
 *  - `NOMBRE_REPETIDO`: otra familia de la empresa ya tiene ese nombre (sin distinguir mayúsculas ni tildes), también si la ganó otro pedido a la vez;
 *  - `ID_REUTILIZADO`: ya existe una familia con ese id pero con otro contenido: no se pisa.
 * `yaExistia` es `true` si el mismo pedido ya se había aplicado (mismo id y mismo nombre): no se escribió ni se auditó nada.
 */
export type ResultadoCrearFamiliaDeProducto = ResultadoCaso<{ id: string; nombre: string; yaExistia: boolean }, "NOMBRE_REPETIDO" | "ID_REUTILIZADO">;

/** Comando «editar una familia» (CU-F2), por ESTADO deseado: el nombre y los dos interruptores. `versionEsperada` es la versión que vio la pantalla. */
export interface ComandoEditarFamiliaDeProducto {
  familiaId: string;
  versionEsperada: number;
  nombre: string;
  agruparEnCarta: boolean;
  agruparEnPos: boolean;
}

/**
 *  - `FAMILIA_NO_ENCONTRADA`: la familia no es de la empresa (o no existe);
 *  - `VERSION_DESACTUALIZADA`: otra persona la cambió mientras se miraba la pantalla: no se cambió nada;
 *  - `NOMBRE_REPETIDO`: otra familia ya tiene ese nombre;
 *  - `DATO_INVALIDO`: el nombre nuevo no cumple la regla de nombres (se aplica la estricta solo si el nombre CAMBIA: un nombre viejo que no la cumple no bloquea cambiar un interruptor).
 * `yaEstaba` es `true` si la familia ya tenía exactamente esos datos (no se escribió ni se auditó).
 */
export type ResultadoEditarFamiliaDeProducto = ResultadoCaso<{ yaEstaba: boolean }, "FAMILIA_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA" | "NOMBRE_REPETIDO" | "DATO_INVALIDO">;

/** Comando «desactivar o reactivar una familia» (CU-F5), por ESTADO deseado. Sus miembros siguen siéndolo. */
export interface ComandoFijarActivaFamiliaDeProducto {
  familiaId: string;
  versionEsperada: number;
  activa: boolean;
}

/** `FAMILIA_NO_ENCONTRADA` / `VERSION_DESACTUALIZADA` como en editar; `yaEstaba` es `true` si la familia ya estaba en ese estado. */
export type ResultadoFijarActivaFamiliaDeProducto = ResultadoCaso<{ yaEstaba: boolean }, "FAMILIA_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA">;

/** Comando «agregar un producto a una familia» (CU-F3). `miembroId` es el uuid con el que se crearía la fila. */
export interface ComandoAgregarProductoAFamilia {
  miembroId: string;
  familiaId: string;
  productoId: string;
}

/**
 *  - `FAMILIA_NO_ENCONTRADA`: la familia no es de la empresa (o no existe);
 *  - `PRODUCTO_NO_ENCONTRADO`: el producto no es de la empresa, no existe o no es un producto de venta (PV): misma respuesta para los tres;
 *  - `PRODUCTO_EN_OTRA_FAMILIA`: el producto ya es miembro de OTRA familia (mensaje genérico: no revela cuál);
 *  - `PRODUCTO_YA_AGRUPADO`: el producto está en un ítem agrupado de la carta (invariante transitorio: la familia reemplaza al ítem agrupado; primero hay que sacarlo de ahí);
 *  - `ID_REUTILIZADO`: ya existe una fila de miembro con ese id y es otra cosa: no se pisa;
 *  - `DATO_INVALIDO`: la familia no tiene ninguna posición libre (la base acota la posición de 1 a 1000: protección, no una regla de negocio).
 * `yaEstaba` es `true` si el producto ya era miembro vigente de esta familia (no se escribió ni se auditó).
 */
export type ResultadoAgregarProductoAFamilia = ResultadoCaso<
  { yaEstaba: boolean; posicion: number },
  "FAMILIA_NO_ENCONTRADA" | "PRODUCTO_NO_ENCONTRADO" | "PRODUCTO_EN_OTRA_FAMILIA" | "PRODUCTO_YA_AGRUPADO" | "ID_REUTILIZADO" | "DATO_INVALIDO"
>;

/** Comando «quitar un producto de una familia» (CU-F4). Quitar NO borra: escribe quién y cuándo. */
export interface ComandoQuitarProductoDeFamilia {
  familiaId: string;
  productoId: string;
  versionEsperada: number;
}

/**
 *  - `FAMILIA_NO_ENCONTRADA` / `VERSION_DESACTUALIZADA` como en editar.
 * `yaEstaba` es `true` si el producto ya no era miembro vigente de esta familia (no se escribió ni se auditó).
 */
export type ResultadoQuitarProductoDeFamilia = ResultadoCaso<{ yaEstaba: boolean }, "FAMILIA_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA">;
