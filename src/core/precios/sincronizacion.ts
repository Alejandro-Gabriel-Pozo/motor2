import type { Resultado } from "@/core/carta/public";

/**
 * Sincronización de precio local entre sucursales de una misma empresa (Fase A de multi-tenancy, `Downloads/Motor 2/plan-panel-
 * gerenciamiento-empresa-sucursal-2026-09-27.md`, sección 2.5): peer-to-peer, sin cabecera, por producto (no por sucursal
 * entera) — no confundir con `sincronizarPrecioLocalGrupoCarta` (`src/server/actions/movimientos/precio-local.ts`), que iguala
 * precios entre PRODUCTOS HERMANOS de un ítem agrupado DENTRO de una sola sucursal; son dos ejes distintos (P12 del catálogo de
 * flujos). PURO — sin Prisma: `GrupoSincroPrecio`/`GrupoSincroPrecioSucursal`/`PrecioLocalProducto.sincronizado` TODAVÍA NO
 * EXISTEN en `prisma/schema.prisma` real, solo en el schema experimental (`prisma/fase-a/schema.prisma`, ver ADR-004). El único
 * escritor real de `PrecioLocalProducto` hoy es `guardarPrecioLocal` (mismo archivo de arriba) — el día que se conecte esta
 * lógica, es ahí y en ningún otro lado.
 */

export interface FilaPrecioLocalMinima {
  habilitado: boolean;
  precio: number;
}

/** P5: deshabilitar el precio local apaga `sincronizado` en la misma operación — la sucursal vuelve al precio central. */
export function alDeshabilitar(): { habilitado: false; sincronizado: false } {
  return { habilitado: false, sincronizado: false };
}

/** P9/P10: salir del grupo (o que el grupo se desarme) apaga `sincronizado` sin tocar el precio — la fila queda independiente. */
export function alSalirDelGrupo(): { sincronizado: false } {
  return { sincronizado: false };
}

/**
 * P3: precondiciones para prender `sincronizado` — la sucursal tiene que estar en un grupo, la fila ya tiene que existir
 * (no se crea una al prender el tilde) y estar `habilitado=true`.
 */
export function puedeSincronizar(fila: FilaPrecioLocalMinima | null, perteneceAGrupo: boolean): Resultado<true> {
  if (!fila) return { ok: false, mensaje: "Primero hay que cargar el precio local antes de sincronizarlo." };
  if (!perteneceAGrupo) return { ok: false, mensaje: "Esta sucursal no pertenece a ningún grupo de sincronización de precios." };
  if (!fila.habilitado) return { ok: false, mensaje: "El precio local tiene que estar habilitado para poder sincronizarlo." };
  return { ok: true, valor: true };
}

export type ResultadoActivarSincronizado =
  | { ok: true; requiereEleccion: false }
  | { ok: true; requiereEleccion: true; precioPropio: number; precioDelGrupo: number }
  | { ok: false; mensaje: string };

/**
 * P3: al prender `sincronizado`, si no hay pares prendidos o están al mismo precio, no pasa nada más. Si hay pares prendidos a
 * OTRO precio, hay que preguntar — nunca decidir en silencio (pendiente 4.3, sin resolver: "adoptar el precio del grupo" o
 * "propagar el propio" quedan como opciones para quien llama, esta función solo detecta el conflicto).
 * Asume `paresPrendidos` ya filtrados al mismo (grupo, producto) — ver `filasAActualizarPorPropagacion`.
 */
export function evaluarActivacionSincronizado(
  fila: FilaPrecioLocalMinima | null,
  perteneceAGrupo: boolean,
  paresPrendidos: readonly { precio: number }[]
): ResultadoActivarSincronizado {
  const precondicion = puedeSincronizar(fila, perteneceAGrupo);
  if (!precondicion.ok) return precondicion;
  if (paresPrendidos.length === 0) return { ok: true, requiereEleccion: false };
  const precioDelGrupo = paresPrendidos[0].precio;
  if (precioDelGrupo === fila!.precio) return { ok: true, requiereEleccion: false };
  return { ok: true, requiereEleccion: true, precioPropio: fila!.precio, precioDelGrupo };
}

/**
 * P2: al editar una fila con `sincronizado=true`, se propagan solo los pares del MISMO producto, MISMO grupo, con
 * `sincronizado=true` Y `habilitado=true` — nunca crea filas nuevas (P7: un par sin fila sigue con el precio central).
 */
export function filasAActualizarPorPropagacion<T extends { sucursalId: string; productoId: string; grupoId: string | null; sincronizado: boolean; habilitado: boolean }>(
  filaEditada: { sucursalId: string; productoId: string; grupoId: string | null },
  candidatas: readonly T[]
): T[] {
  if (!filaEditada.grupoId) return [];
  return candidatas.filter(
    (c) =>
      c.sucursalId !== filaEditada.sucursalId &&
      c.productoId === filaEditada.productoId &&
      c.grupoId === filaEditada.grupoId &&
      c.sincronizado &&
      c.habilitado
  );
}

/**
 * Invariante de P3: todas las filas `sincronizado=true` del mismo (grupo, producto) tienen que compartir precio. Detector puro
 * para un test de integridad — no reemplaza la propagación en sí (P2), que es lo que la mantiene cierta en el camino feliz.
 */
export function filasSincronizadasCompartenElMismoPrecio(filas: readonly { precio: number; sincronizado: boolean }[]): boolean {
  const precios = new Set(filas.filter((f) => f.sincronizado).map((f) => f.precio));
  return precios.size <= 1;
}
