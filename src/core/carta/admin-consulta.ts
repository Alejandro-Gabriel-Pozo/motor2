import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { whereDisponibleEn } from "@/core/catalogo/disponibilidad-producto-consulta";
import { resolverMenuCartaConDiagnostico } from "./menu-consulta";
import type { ProductoSinSeccion } from "./armar-menu";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Lectura de las pantallas de admin de la carta (/catalogo/carta, docs/plan-carta-catalogo-2026-09-24.md, M10, y
 * /catalogo/carta/portal, docs/plan-registro-tenants-2026-09-24.md, M7). Solo lectura (la
 * fija el guardián carta-solo-lectura); la pantalla la llama DESPUÉS de su propio `requierePermisoVer(..., "carta")`. No es una
 * Server Action a propósito: así no queda expuesta como endpoint.
 */
export interface SeccionCartaAdmin {
  id: string;
  nombre: string;
  titulo: string | null;
  descripcion: string | null;
  imagenUrl: string | null;
  orden: number;
  activa: boolean;
  cantidadCategorias: number;
}

export interface CategoriaAdmin {
  id: string;
  nombre: string;
  activo: boolean;
  seccionCartaId: string | null;
  orden: number;
}

export interface ProductoCartaAdmin {
  id: string;
  nombre: string;
  categoria: string | null;
  /** Nombre de la sección de carta ACTIVA donde cae por su categoría, o null. */
  seccionCarta: string | null;
  precio: number;
  contenido: { visibleEnCarta: boolean; descripcion: string | null; imagenUrl: string | null; tags: string[]; especial: boolean; orden: number } | null;
}

export interface PromoCartaAdmin {
  id: string;
  seccionCartaId: string;
  seccionCarta: string;
  titulo: string;
  descripcion: string | null;
  precio: number;
  orden: number;
  activa: boolean;
}

export interface DatosAdminCarta {
  secciones: SeccionCartaAdmin[];
  categorias: CategoriaAdmin[];
  /** PV disponibles en la sucursal (los únicos que pueden salir en su carta). */
  productos: ProductoCartaAdmin[];
  /** Lo que se le avisa al admin para que no pase desapercibido (D3): disponibles acá SIN fila de contenido de carta. */
  sinContenido: ProductoCartaAdmin[];
  /** Visibles y disponibles que igual no salen porque su categoría no está en ninguna sección de carta activa. */
  visiblesSinSeccion: ProductoSinSeccion[];
  promos: PromoCartaAdmin[];
}

export async function cargarAdminCarta(sucursalId: string, db: Db = prisma): Promise<DatosAdminCarta> {
  const [secciones, categorias, productos, promos, armado] = await Promise.all([
    db.seccionCarta.findMany({ include: { _count: { select: { categorias: true } } }, orderBy: [{ orden: "asc" }, { nombre: "asc" }] }),
    db.categoriaProducto.findMany({ include: { seccionCarta: true }, orderBy: { nombre: "asc" } }),
    db.producto.findMany({
      where: { tipo: "PV", ...whereDisponibleEn(sucursalId) },
      select: {
        id: true,
        nombre: true,
        precioVenta: true,
        categoria: { select: { nombre: true, seccionCarta: { select: { seccionCarta: { select: { nombre: true, activa: true } } } } } },
        contenidoCarta: { select: { visibleEnCarta: true, descripcion: true, imagenUrl: true, tags: true, especial: true, orden: true } },
      },
      orderBy: { nombre: "asc" },
    }),
    db.promoCarta.findMany({ where: { sucursalId }, include: { seccionCarta: { select: { nombre: true } } }, orderBy: [{ activa: "desc" }, { orden: "asc" }, { titulo: "asc" }] }),
    resolverMenuCartaConDiagnostico(sucursalId, db),
  ]);

  const productosAdmin: ProductoCartaAdmin[] = productos.map((p) => {
    const seccion = p.categoria?.seccionCarta?.seccionCarta;
    return {
      id: p.id,
      nombre: p.nombre,
      categoria: p.categoria?.nombre ?? null,
      seccionCarta: seccion?.activa ? seccion.nombre : null,
      precio: Number(p.precioVenta),
      contenido: p.contenidoCarta,
    };
  });

  return {
    secciones: secciones.map((s) => ({
      id: s.id,
      nombre: s.nombre,
      titulo: s.titulo,
      descripcion: s.descripcion,
      imagenUrl: s.imagenUrl,
      orden: s.orden,
      activa: s.activa,
      cantidadCategorias: s._count.categorias,
    })),
    categorias: categorias.map((c) => ({ id: c.id, nombre: c.nombre, activo: c.activo, seccionCartaId: c.seccionCarta?.seccionCartaId ?? null, orden: c.seccionCarta?.orden ?? 0 })),
    productos: productosAdmin,
    sinContenido: productosAdmin.filter((p) => !p.contenido),
    visiblesSinSeccion: armado?.diagnostico.visiblesSinSeccion ?? [],
    promos: promos.map((pr) => ({
      id: pr.id,
      seccionCartaId: pr.seccionCartaId,
      seccionCarta: pr.seccionCarta.nombre,
      titulo: pr.titulo,
      descripcion: pr.descripcion,
      precio: Number(pr.precio),
      orden: pr.orden,
      activa: pr.activa,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Portal de sucursales (/catalogo/carta/portal, docs/plan-registro-tenants-2026-09-24.md, M7)
// ---------------------------------------------------------------------------------------------------------------------------

export interface RegistroPublicoAdmin {
  slug: string;
  etiqueta: string | null;
  dominio: string | null;
  subtituloPortal: string | null;
  posX: number | null;
  posY: number | null;
  posW: number | null;
  posH: number | null;
  orden: number;
  publicada: boolean;
  menuDesdeMotor2: boolean;
  sheetId: string | null;
  sheetMenuNombre: string;
}

export interface SucursalPortalAdmin {
  id: string;
  nombre: string;
  activo: boolean;
  /** null = la sucursal no está en el registro de motor2 (la carta sigue con la fila de la sheet, si la hay). */
  publica: RegistroPublicoAdmin | null;
}

/** TODAS las sucursales (el mapa del portal es entre sucursales, no depende de la activa), activas primero, con su fila si la tienen. */
export async function cargarAdminPortal(db: Db = prisma): Promise<SucursalPortalAdmin[]> {
  const sucursales = await db.sucursal.findMany({
    select: { id: true, nombre: true, activo: true, publica: true },
    orderBy: [{ activo: "desc" }, { nombre: "asc" }],
  });
  const num = (v: { toString(): string } | null) => (v === null ? null : Number(v));
  return sucursales.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    activo: s.activo,
    publica: s.publica && {
      slug: s.publica.slug,
      etiqueta: s.publica.etiqueta,
      dominio: s.publica.dominio,
      subtituloPortal: s.publica.subtituloPortal,
      posX: num(s.publica.posX),
      posY: num(s.publica.posY),
      posW: num(s.publica.posW),
      posH: num(s.publica.posH),
      orden: s.publica.orden,
      publicada: s.publica.publicada,
      menuDesdeMotor2: s.publica.menuDesdeMotor2,
      sheetId: s.publica.sheetId,
      sheetMenuNombre: s.publica.sheetMenuNombre,
    },
  }));
}
