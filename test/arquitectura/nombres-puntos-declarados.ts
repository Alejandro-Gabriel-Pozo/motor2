/**
 * La TABLA de los puntos de validación de nombres de Motor2 (etapa E1, `docs/e1-recuento-de-textos-y-cuit-2026-11-15.md` §5), escrita a mano y aparte del código: para cada archivo de `src/`
 * que valida un nombre, qué regla usa. `nombres-puntos-de-validacion.test.ts` la compara con lo que el código hace de verdad y falla si aparece un punto nuevo sin declarar.
 *  - `pedernal`: las fichas de la regla de Pedernal (`src/core/datos/fichas-de-texto.ts`) que el archivo aplica.
 *  - `viejos`: los validadores viejos (`validarTextoCatalogo`, `nombreDeCatalogo`, `validarNombreCatalogo`, `RE_TEXTO_CATALOGO`) que TODAVÍA usa y para qué dato, con lo que hace Pedernal con ese dato
 *    («sin regla de Pedernal; decisión pendiente»: el dueño decide con esa evidencia; no se conectan ni se inventan).
 */
export type Ficha = "PRODUCTO" | "ELECCION" | "RAZON_SOCIAL" | "NOMBRE_DE_SUCURSAL";
export type PuntoDeNombre = Readonly<{ pedernal: readonly Ficha[]; viejos: readonly string[]; dato: string; pedernalHace?: string }>;

const SIN_REGLA = "sin regla de Pedernal; decisión pendiente";

export const PUNTOS_DE_NOMBRE: Readonly<Record<string, PuntoDeNombre>> = {
  // --- Conectados a la regla de Pedernal (alta estricta; edición estricta solo si el nombre cambia) ---
  "src/core/features/catalogo/productos.guard.ts": { pedernal: ["PRODUCTO"], viejos: [], dato: "nombre de producto (alta rápida y alta/edición completa)" },
  "src/server/lecturas/catalogo/datos-de-producto.ts": { pedernal: ["PRODUCTO"], viejos: [], dato: "nombre de producto (estricta en el alta; en la edición solo si cambió)" },
  "src/core/features/catalogo/duplicar-producto.guard.ts": { pedernal: ["PRODUCTO"], viejos: [], dato: "nombre del producto duplicado" },
  "src/core/features/catalogo/insumos.guard.ts": { pedernal: ["PRODUCTO"], viejos: ["nombreDeCatalogo"], dato: "insumo (conectado); grupo de insumos (viejo)", pedernalHace: `grupo de insumos: ${SIN_REGLA}` },
  "src/server/actions/catalogo/casos-de-uso/renombrar-o-fusionar-insumo.ts": { pedernal: ["PRODUCTO"], viejos: [], dato: "renombrar un insumo (estricta solo si cambia)" },
  "src/core/features/catalogo/categorias-producto.guard.ts": { pedernal: ["ELECCION"], viejos: [], dato: "categoría de producto" },
  "src/core/features/catalogo/proveedores.guard.ts": { pedernal: ["RAZON_SOCIAL"], viejos: [], dato: "alta de proveedor" },
  "src/server/actions/catalogo/casos-de-uso/actualizar-proveedor.ts": { pedernal: ["RAZON_SOCIAL"], viejos: [], dato: "edición de proveedor (estricta solo si cambia)" },
  "src/core/features/clientes/clientes.guard.ts": { pedernal: ["RAZON_SOCIAL"], viejos: [], dato: "alta y edición de cliente" },
  "src/server/actions/clientes/casos-de-uso/actualizar-cliente.ts": { pedernal: ["RAZON_SOCIAL"], viejos: [], dato: "edición de cliente (estricta solo si cambia)" },
  "src/core/features/carta/secciones.guard.ts": { pedernal: ["ELECCION"], viejos: [], dato: "sección de carta" },
  "src/server/actions/carta/casos-de-uso/guardar-seccion-carta.ts": { pedernal: ["ELECCION"], viejos: [], dato: "edición de sección de carta (estricta solo si cambia)" },
  "src/core/features/catalogo/opciones-de-venta.guard.ts": { pedernal: ["ELECCION"], viejos: ["RE_TEXTO_CATALOGO", "validarTextoCatalogo"], dato: "grupo y opción de venta (conectado); descripción y prefijo «se lee en la carta como» (viejo, no son nombres)", pedernalHace: `descripción y prefijo en la carta: ${SIN_REGLA}` },
  "src/server/actions/catalogo/casos-de-uso/editar-grupo-de-opciones.ts": { pedernal: ["ELECCION"], viejos: [], dato: "edición de grupo de opciones (estricta solo si cambia)" },
  "src/server/actions/catalogo/casos-de-uso/editar-opcion-de-grupo.ts": { pedernal: ["ELECCION"], viejos: [], dato: "edición de opción (estricta solo si cambia)" },
  // --- Sin regla de Pedernal verificada: siguen con la regla vieja de Motor2 (NO se conectan ni se inventan) ---
  "src/core/permisos/nombres-de-rol.ts": { pedernal: [], viejos: ["validarTextoCatalogo"], dato: "nombre de rol", pedernalHace: `rol: ${SIN_REGLA} (NO VERIFICADO si Pedernal lo valida; no se encontró)` },
  "src/core/features/sucursales/sucursal.guard.ts": { pedernal: ["NOMBRE_DE_SUCURSAL"], viejos: [], dato: "nombre de sucursal (alta y renombrar; dueño 2026-11-16, «Sí, así (Recomendada)»)", pedernalHace: "sucursal: regla propia (NFC, recorte, 1 a 100, solo rechaza controles); acá rige la lista de permitidos común y el largo de 80 (diferencia declarada en fichas-de-texto.ts)" },
  "src/core/features/carta/contenido-producto.guard.ts": { pedernal: [], viejos: ["RE_TEXTO_CATALOGO"], dato: "«Nombre en la carta» del producto", pedernalHace: `nombre en la carta: ${SIN_REGLA} (NO VERIFICADO)` },
  "src/core/features/catalogo/unidades.guard.ts": { pedernal: [], viejos: ["nombreDeCatalogo"], dato: "nombre de unidad", pedernalHace: "unidad: catálogo FIJO de 14 unidades (etapa E2, otra decisión)" },
  "src/core/features/movimientos/secciones.guard.ts": { pedernal: [], viejos: ["nombreDeCatalogo"], dato: "sección de movimientos", pedernalHace: "depósito de stock: usa la ficha de elección y la base lo repite; la equivalencia con la «sección» de Motor2 NO está verificada" },
  "src/core/features/movimientos/motivos.guard.ts": { pedernal: [], viejos: ["nombreDeCatalogo"], dato: "motivo de merma y destino de consumo", pedernalHace: "motivos de movimiento: catálogo FIJO sembrado por código (clase cerrada), no texto libre; merma y destino: no encontrado" },
  "src/core/carta/validaciones.ts": { pedernal: [], viejos: ["validarTextoCatalogo"], dato: "ítem agrupado y género de la carta", pedernalHace: `ítem agrupado y género: ${SIN_REGLA} (no encontrado en Pedernal)` },
};
