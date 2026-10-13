import "server-only";
import type { DiferenciaDePrecio, TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import { cargarGrupoDeOpciones, listarGruposDeOpciones } from "@/server/lecturas/catalogo/opciones-de-venta";
import { preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
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

/** Un consumo de una versión, con los nombres que la pantalla muestra (el insumo, el reemplazado y la unidad de stock). */
export interface ConsumoDelPanel {
  efecto: "SUMA" | "REEMPLAZA";
  insumoProductoId: string;
  insumoNombre: string;
  reemplazaAProductoId: string | null;
  reemplazaNombre: string | null;
  cantidad: number;
  unidadNombre: string;
  mermaPorcentaje: number;
  escalaConLaMedida: boolean;
}

/** Un cambio de precio o de consumo de una opción (una VERSIÓN, en la base), con quién la cargó y desde cuándo rige. */
export interface CambioDeOpcionDelPanel {
  numero: number;
  diferencia: DiferenciaDePrecio;
  factorEscala: number | null;
  consumos: ConsumoDelPanel[];
  creadoEn: Date;
  creadoPor: string;
}

export interface OpcionDelPanel {
  id: string;
  nombre: string;
  orden: number;
  activa: boolean;
  esNinguna: boolean;
  /** La `version` de la fila (la esperada de la próxima edición del nombre, el orden o el estado). */
  version: number;
  /** El producto interno que respalda el stock de un adicional (solo para leer). */
  anclaNombre: string | null;
  /** Del más nuevo al más viejo: `cambios[0]` es el que rige. */
  cambios: CambioDeOpcionDelPanel[];
}

export interface GrupoDetalleDelPanel {
  grupo: { id: string; nombre: string; tipo: TipoDeGrupoDeOpciones; cantidadMinima: number; cantidadMaxima: number; activo: boolean; version: number };
  opciones: OpcionDelPanel[];
  /** Los productos que lo admiten (filas activas), por nombre. */
  productos: { id: string; nombre: string }[];
  /** El precio base del primer producto que lo usa, en la sucursal activa: la REFERENCIA del espejo de una diferencia (`null` si ningún producto lo usa). */
  referencia: { productoNombre: string; precio: number } | null;
  /** Las materias primas de la empresa, para elegir el insumo de un consumo (el consumo va siempre en su unidad de stock, U7). */
  insumos: { id: string; nombre: string; unidadNombre: string; decimales: number }[];
  /** Las unidades activas, para la unidad de stock del producto interno de un adicional nuevo. */
  unidades: { id: string; nombre: string }[];
}

/**
 * La pantalla de UN grupo (`/catalogo/opciones/[grupoId]`): el grupo, sus opciones con su historial de cambios (la lectura de GO-2a, `cargarGrupoDeOpciones`) y lo que la pantalla
 * necesita para nombrar cada cosa. Sin N+1: una lectura del grupo y seis consultas más en paralelo (productos que lo usan, nombres de insumos, de quienes cargaron y de las unidades, materias
 * primas y unidades activas), más el precio de referencia. `null` si el grupo no existe o es de otra empresa (la RLS no lo deja ver).
 */
export async function cargarGrupoDelPanel(db: Db, grupoId: string, sucursalId: string): Promise<GrupoDetalleDelPanel | null> {
  const g = await cargarGrupoDeOpciones(db, grupoId);
  if (!g) return null;
  const versiones = g.opciones.flatMap((o) => o.versiones);
  const idsDeProductos = [...new Set(versiones.flatMap((v) => v.consumos.flatMap((c) => [c.insumoProductoId, ...(c.reemplazaAProductoId ? [c.reemplazaAProductoId] : [])])))];
  const idsDeUsuarios = [...new Set(versiones.map((v) => v.creadoPorId))];
  const idsDeUnidades = [...new Set(versiones.flatMap((v) => v.consumos.map((c) => c.unidadId)))];
  const [admisiones, nombresDeProductos, usuarios, insumos, unidades, unidadesDeConsumos] = await Promise.all([
    db.productoAdmiteGrupo.findMany({ where: { grupoId, activo: true }, select: { producto: { select: { id: true, nombre: true, precioVenta: true } } } }),
    idsDeProductos.length ? db.producto.findMany({ where: { id: { in: idsDeProductos } }, select: { id: true, nombre: true } }) : Promise.resolve([]),
    idsDeUsuarios.length ? db.user.findMany({ where: { id: { in: idsDeUsuarios } }, select: { id: true, name: true } }) : Promise.resolve([]),
    db.producto.findMany({ where: { tipo: "MP" }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true, unidadStock: { select: { nombre: true, decimales: true } } } }),
    db.unidad.findMany({ where: { activa: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
    idsDeUnidades.length ? db.unidad.findMany({ where: { id: { in: idsDeUnidades } }, select: { id: true, nombre: true } }) : Promise.resolve([]),
  ]);
  const unidadesPorId = new Map(unidadesDeConsumos.map((u) => [u.id, u.nombre]));
  const nombreDe = new Map(nombresDeProductos.map((p) => [p.id, p.nombre]));
  // Solo el nombre (el correo es un dato sensible, GT-1): sin nombre cargado se dice «alguien sin nombre cargado».
  const quien = new Map(usuarios.map((u) => [u.id, u.name?.trim() || SIN_NOMBRE]));
  const productos = admisiones.map((a) => a.producto).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  let referencia: GrupoDetalleDelPanel["referencia"] = null;
  const primero = productos[0];
  if (primero) {
    const local = (await preciosLocalesVigentes(sucursalId, db, [primero.id])).get(primero.id);
    referencia = { productoNombre: primero.nombre, precio: local?.precio ?? Number(primero.precioVenta) };
  }

  return {
    grupo: { id: g.id, nombre: g.nombre, tipo: g.tipo as TipoDeGrupoDeOpciones, cantidadMinima: g.cantidadMinima, cantidadMaxima: g.cantidadMaxima, activo: g.activo, version: g.version },
    opciones: g.opciones.map((o) => ({
      id: o.id,
      nombre: o.nombre,
      orden: o.orden,
      activa: o.activa,
      esNinguna: o.esNinguna,
      version: o.version,
      anclaNombre: o.producto?.nombre ?? null,
      cambios: o.versiones.map((v) => ({
        numero: v.numero,
        diferencia: diferenciaDe(v),
        factorEscala: v.factorEscala,
        creadoEn: v.creadoEn,
        creadoPor: quien.get(v.creadoPorId) ?? SIN_NOMBRE,
        consumos: v.consumos.map((c) => ({
          efecto: c.efecto as ConsumoDelPanel["efecto"],
          insumoProductoId: c.insumoProductoId,
          insumoNombre: nombreDe.get(c.insumoProductoId) ?? "un insumo",
          reemplazaAProductoId: c.reemplazaAProductoId,
          reemplazaNombre: c.reemplazaAProductoId ? (nombreDe.get(c.reemplazaAProductoId) ?? "un insumo") : null,
          cantidad: c.cantidad,
          unidadNombre: unidadesPorId.get(c.unidadId) ?? "",
          mermaPorcentaje: c.mermaPorcentaje,
          escalaConLaMedida: c.escalaConLaMedida,
        })),
      })),
    })),
    productos: productos.map((p) => ({ id: p.id, nombre: p.nombre })),
    referencia,
    insumos: insumos.map((i) => ({ id: i.id, nombre: i.nombre, unidadNombre: i.unidadStock.nombre, decimales: i.unidadStock.decimales })),
    unidades,
  };
}

/** Quién cargó un cambio, cuando la cuenta no tiene nombre (nunca se muestra el correo). */
const SIN_NOMBRE = "alguien sin nombre cargado";

/** La diferencia de una versión leída (MONTO o PORCENTAJE; la base guarda uno solo, el otro en NULL). */
function diferenciaDe(v: { tipoDeDiferencia: string; diferenciaPrecio: number | null; porcentaje: number | null }): DiferenciaDePrecio {
  return v.tipoDeDiferencia === "PORCENTAJE" ? { tipo: "PORCENTAJE", porcentaje: v.porcentaje ?? 0 } : { tipo: "MONTO", monto: v.diferenciaPrecio ?? 0 };
}
