import "server-only";
import type { TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import { listarGruposDeOpciones } from "@/server/lecturas/catalogo/opciones-de-venta";
import type { Db } from "@/lib/db-tipos";

/**
 * Las CONSULTAS de las pantallas del catálogo de opciones de venta (GO-2d; ADR-030 «Pantallas»). Las páginas leen por acá y no por `server/lecturas` (regla
 * `paginas-solo-consultas`, ADR-026): la lectura de GO-2a (`server/lecturas/catalogo/opciones-de-venta.ts`) es la misma que usan los casos de uso y los tests; esta capa solo le
 * da a cada pantalla la forma que dibuja. Sin guarda de permiso adentro: la página la pone antes (`opciones_definir`). Ningún precio se decide acá.
 */

export interface GrupoDelPanel {
  id: string;
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
  activo: boolean;
  /** Cuántas opciones prendidas tiene. */
  opcionesActivas: number;
  /** Cuántos productos lo admiten (filas activas). */
  productosQueLoAdmiten: number;
}

/** La tabla de «Opciones de venta»: todos los grupos de la empresa (prendidos o no), por nombre. Las mismas tres consultas de la lectura de GO-2a. */
export async function listarGruposDelPanel(db: Db): Promise<GrupoDelPanel[]> {
  const grupos = await listarGruposDeOpciones(db, { incluirInactivos: true });
  return grupos.map((g) => ({
    id: g.id,
    nombre: g.nombre,
    tipo: g.tipo as TipoDeGrupoDeOpciones,
    cantidadMinima: g.cantidadMinima,
    cantidadMaxima: g.cantidadMaxima,
    activo: g.activo,
    opcionesActivas: g.opciones.filter((o) => o.activa).length,
    productosQueLoAdmiten: g.productosQueLoAdmiten,
  }));
}
