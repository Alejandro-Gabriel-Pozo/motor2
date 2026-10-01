import type { Prisma, PrismaClient } from "@prisma/client";
import { disponibilidadDeProductos, preciosLocalesVigentes, whereDisponibleEn } from "@/core/catalogo/public-servidor";
import { resolverMenuCartaConDiagnostico } from "./menu-consulta";
import { precioDeCarta, type MenuArmado, type ProductoSinSeccion } from "./armar-menu";
import { esClavePortal, posicionCompleta, type PosicionPortal } from "./portal";
import { esClaveTema } from "./tema";
import { precioDePromo, seleccionDeSucursalDePromo } from "./promo-sucursal";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Lectura de las pantallas de admin de la carta (/carta, docs/plan-carta-catalogo-2026-09-24.md, M10, y
 * /carta/portal, docs/plan-registro-tenants-2026-09-24.md, M7, y /carta/tema, docs/plan-tema-carta-2026-09-24.md,
 * M9). Solo lectura (la fija el guardián carta-solo-lectura); la pantalla la llama DESPUÉS de su propio `requierePermisoVer*(..., "carta_ver")`. No es una
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
  /**
   * Cuántos ítems ya están ubicados en esta sección (docs/plan-carta-seccion-directa-2026-09-25.md, DA6): productos sueltos visibles
   * (sin agrupar) + ítems agrupados prendidos — comparten la misma escala de orden. Es el orden que se sugiere para uno nuevo.
   */
  cantidadItems: number;
}

export interface ProductoCartaAdmin {
  id: string;
  nombre: string;
  /** Nombre de la sección de carta ACTIVA donde está su contenido, o null. */
  seccionCarta: string | null;
  precio: number;
  contenido:
    | { visibleEnCarta: boolean; seccionCartaId: string | null; descripcion: string | null; tags: string[]; especial: boolean; orden: number; generoCartaId: string | null }
    | null;
  /** Nombre del ítem agrupado donde está (docs/plan-agrupacion-items-carta-2026-09-24.md, M6), o null: si está, sale solo ahí. */
  agrupadoEn: string | null;
  /** Nombre de su género de carta si está ACTIVO (docs/plan-genero-carta-2026-09-26.md), o null: entonces sale suelto en el POS. */
  generoCarta: string | null;
}

/** Un género de carta (docs/plan-genero-carta-2026-09-26.md): carpeta VISUAL del POS, global. */
export interface GeneroCartaAdmin {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
}

/** Un cupo de una promo ARMABLE (Task #16, docs/plan-promo-combo-2026-09-26.md, D1), para el editor del admin. */
export interface CupoPromoCartaAdmin {
  id: string;
  seccionCartaId: string;
  /** Nombre de la sección elegida (aunque esté apagada: el admin necesita verla para poder corregirla). */
  seccionCarta: string;
  cantidadMinima: number;
  cantidadMaxima: number;
  orden: number;
}

export interface PromoCartaAdmin {
  id: string;
  seccionCartaId: string;
  seccionCarta: string;
  titulo: string;
  descripcion: string | null;
  /** Precio de la EMPRESA (el mismo para todas las sucursales salvo que alguna tenga el suyo). */
  precio: number;
  orden: number;
  /** Apagado/prendido GENERAL (de la empresa): apagada, ninguna sucursal la ofrece. */
  activa: boolean;
  /** Prendida en la sucursal activa (sin fila = no la ofrece: opt-in). */
  prendidaAca: boolean;
  /** Precio propio de la sucursal activa, o null si usa el de la empresa. */
  precioLocal: number | null;
  /** Lo que se cobra EN ESTA sucursal (precio local o, si no hay, el de la empresa). */
  precioAca: number;
  /** Vacío = puramente informativa (el POS la ignora). Uno o más = ARMABLE (D1). */
  cupos: CupoPromoCartaAdmin[];
}

export interface DatosAdminCarta {
  secciones: SeccionCartaAdmin[];
  /** TODOS los géneros (activos primero, orden, nombre) — para el select "Género (opcional)" de cada contenido. */
  generos: GeneroCartaAdmin[];
  /** PV disponibles en la sucursal (los únicos que pueden salir en su carta). */
  productos: ProductoCartaAdmin[];
  /**
   * Lo que se le avisa al admin para que no pase desapercibido (D3): disponibles acá SIN fila de contenido de carta. No incluye a
   * los que están en un ítem agrupado: esos salen en la carta a través del grupo, sin contenido propio.
   */
  sinContenido: ProductoCartaAdmin[];
  /** Visibles y disponibles que igual no salen porque no tienen sección de carta, o la suya está apagada. */
  visiblesSinSeccion: ProductoSinSeccion[];
  promos: PromoCartaAdmin[];
}

/** Las secciones de carta (orden, nombre) con cuántos ítems ya tiene cada una (`cantidadItems`, DA6). */
async function seccionesConCantidad(db: Db): Promise<SeccionCartaAdmin[]> {
  const secciones = await db.seccionCarta.findMany({
    include: {
      _count: {
        select: {
          // Mismo criterio que la carta: un PV agrupado no sale suelto (D3), aunque tenga contenido visible.
          contenidos: { where: { visibleEnCarta: true, producto: { opcionItemAgrupadoCarta: { is: null } } } },
          agrupados: { where: { activo: true } },
        },
      },
    },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
  });
  return secciones.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    titulo: s.titulo,
    descripcion: s.descripcion,
    imagenUrl: s.imagenUrl,
    orden: s.orden,
    activa: s.activa,
    cantidadItems: s._count.contenidos + s._count.agrupados,
  }));
}

/** Todos los géneros (docs/plan-genero-carta-2026-09-26.md), activos primero, orden, nombre — reusado por las dos pantallas. */
async function generosOrdenados(db: Db): Promise<GeneroCartaAdmin[]> {
  const generos = await db.generoCarta.findMany({ orderBy: [{ activo: "desc" }, { orden: "asc" }, { nombre: "asc" }] });
  return generos.map((g) => ({ id: g.id, nombre: g.nombre, orden: g.orden, activo: g.activo }));
}

export async function cargarAdminCarta(sucursalId: string, db: Db): Promise<DatosAdminCarta> {
  const [secciones, generos, productos, promos, armado] = await Promise.all([
    seccionesConCantidad(db),
    generosOrdenados(db),
    db.producto.findMany({
      where: { tipo: "PV", ...whereDisponibleEn(sucursalId) },
      select: {
        id: true,
        nombre: true,
        precioVenta: true,
        contenidoCarta: {
          select: {
            visibleEnCarta: true,
            seccionCartaId: true,
            seccionCarta: { select: { nombre: true, activa: true } },
            descripcion: true,
            tags: true,
            especial: true,
            orden: true,
            generoCartaId: true,
            generoCarta: { select: { nombre: true, activo: true } },
          },
        },
        opcionItemAgrupadoCarta: { select: { itemAgrupadoCarta: { select: { nombre: true } } } },
      },
      orderBy: { nombre: "asc" },
    }),
    db.promoCarta.findMany({
      include: {
        sucursales: seleccionDeSucursalDePromo(sucursalId),
        seccionCarta: { select: { nombre: true } },
        cupos: { select: { id: true, seccionCartaId: true, cantidadMinima: true, cantidadMaxima: true, orden: true, seccionCarta: { select: { nombre: true } } }, orderBy: { orden: "asc" } },
      },
      orderBy: [{ activa: "desc" }, { orden: "asc" }, { titulo: "asc" }],
    }),
    resolverMenuCartaConDiagnostico(sucursalId, db),
  ]);

  const productosAdmin: ProductoCartaAdmin[] = productos.map((p) => {
    const c = p.contenidoCarta;
    return {
      id: p.id,
      nombre: p.nombre,
      seccionCarta: c?.seccionCarta?.activa ? c.seccionCarta.nombre : null,
      precio: Number(p.precioVenta),
      contenido: c && {
        visibleEnCarta: c.visibleEnCarta,
        seccionCartaId: c.seccionCartaId,
        descripcion: c.descripcion,
        tags: c.tags,
        especial: c.especial,
        orden: c.orden,
        generoCartaId: c.generoCartaId,
      },
      agrupadoEn: p.opcionItemAgrupadoCarta?.itemAgrupadoCarta.nombre ?? null,
      generoCarta: c?.generoCarta?.activo ? c.generoCarta.nombre : null,
    };
  });

  return {
    secciones,
    generos,
    productos: productosAdmin,
    sinContenido: productosAdmin.filter((p) => !p.contenido && !p.agrupadoEn),
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
      prendidaAca: pr.sucursales[0]?.activa ?? false,
      precioLocal: pr.sucursales[0]?.precioLocal != null ? Number(pr.sucursales[0].precioLocal) : null,
      precioAca: precioDePromo(pr.precio, pr.sucursales[0]),
      cupos: pr.cupos.map((c) => ({ id: c.id, seccionCartaId: c.seccionCartaId, seccionCarta: c.seccionCarta.nombre, cantidadMinima: c.cantidadMinima, cantidadMaxima: c.cantidadMaxima, orden: c.orden })),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Ítems agrupados de la carta (/carta/agrupados, docs/plan-agrupacion-items-carta-2026-09-24.md, M6/M7)
// ---------------------------------------------------------------------------------------------------------------------------

export interface OpcionItemAgrupadoAdmin {
  /** Id de la fila de opción (para reordenar o quitar). */
  id: string;
  productoId: string;
  nombre: string;
  orden: number;
  disponibleAca: boolean;
  /** Precio en esta sucursal, con la regla de la carta (`precioDeCarta`). */
  precioAca: number;
}

export interface ItemAgrupadoAdmin {
  id: string;
  nombre: string;
  /** La sección de carta donde se ubica, directo (docs/plan-carta-seccion-directa-2026-09-25.md). */
  seccionCartaId: string;
  /** Nombre de su sección de carta si está ACTIVA, o null (entonces no sale). */
  seccionCarta: string | null;
  descripcion: string | null;
  tags: string[];
  especial: boolean;
  orden: number;
  activo: boolean;
  /** Su género de carta (docs/plan-genero-carta-2026-09-26.md), para preseleccionarlo en el form; null = sin género. */
  generoCartaId: string | null;
  /** Nombre de su género si está ACTIVO, o null (entonces sale suelto en el POS). */
  generoCarta: string | null;
  opciones: OpcionItemAgrupadoAdmin[];
  /** Cuántas opciones están disponibles en esta sucursal. */
  disponiblesAca: number;
  /** Rango de precios de las opciones disponibles acá (null si no hay ninguna). */
  precio: { minimo: number; maximo: number } | null;
  avisos: {
    /** D5 (red de seguridad): las opciones disponibles acá no cuestan lo mismo; la carta muestra `mostrado` (el mayor). */
    preciosDistintos: { minimo: number; maximo: number; mostrado: number } | null;
    /** Ninguna opción disponible acá: el ítem no sale en la carta de esta sucursal. */
    sinOpcionesAca: boolean;
    /** Su sección de carta está apagada: el ítem no sale. */
    sinSeccion: boolean;
  };
}

export interface DatosAdminItemsAgrupados {
  items: ItemAgrupadoAdmin[];
  /** Todas las secciones de carta (para el select del ítem), con cuántos ítems ya tiene cada una (orden sugerido, DA6). */
  secciones: SeccionCartaAdmin[];
  /** Todos los géneros (activos primero, orden, nombre) — para el select "Género (opcional)" del ítem. */
  generos: GeneroCartaAdmin[];
  /** PV disponibles acá que no están en ningún ítem agrupado (para el select "Agregar producto"). */
  productosSinGrupo: { id: string; nombre: string; precioAca: number }[];
  diagnostico: Pick<MenuArmado["diagnostico"], "agrupadosSinSeccion" | "agrupadosSinOpciones" | "agrupadosConPreciosDistintos">;
}

/** Todos los ítems agrupados (activos primero, orden, nombre), con lo que se ve y se avisa en la sucursal activa. */
export async function cargarAdminItemsAgrupados(sucursalId: string, db: Db): Promise<DatosAdminItemsAgrupados> {
  const [items, secciones, generos, sinGrupo, armado] = await Promise.all([
    db.itemAgrupadoCarta.findMany({
      select: {
        id: true,
        nombre: true,
        seccionCartaId: true,
        seccionCarta: { select: { nombre: true, activa: true } },
        descripcion: true,
        tags: true,
        especial: true,
        orden: true,
        activo: true,
        generoCartaId: true,
        generoCarta: { select: { nombre: true, activo: true } },
        opciones: {
          select: {
            id: true,
            orden: true,
            producto: { select: { id: true, nombre: true, tipo: true, precioVenta: true } },
          },
        },
      },
      orderBy: [{ activo: "desc" }, { orden: "asc" }, { nombre: "asc" }],
    }),
    seccionesConCantidad(db),
    generosOrdenados(db),
    db.producto.findMany({
      where: { tipo: "PV", ...whereDisponibleEn(sucursalId), opcionItemAgrupadoCarta: { is: null } },
      select: { id: true, nombre: true, precioVenta: true },
      orderBy: { nombre: "asc" },
    }),
    resolverMenuCartaConDiagnostico(sucursalId, db),
  ]);

  const idsOpciones = items.flatMap((it) => it.opciones.map((o) => o.producto.id));
  const idsConPrecio = [...new Set([...idsOpciones, ...sinGrupo.map((p) => p.id)])];
  const [disponibilidad, localPorProducto] = await Promise.all([
    disponibilidadDeProductos(sucursalId, idsOpciones, db),
    preciosLocalesVigentes(sucursalId, db, idsConPrecio),
  ]);
  const precioAca = (productoId: string, precioVenta: { toString(): string }) => precioDeCarta(Number(precioVenta), localPorProducto.get(productoId));
  const comparar = (a: string, b: string) => a.localeCompare(b, "es");

  return {
    items: items.map((it) => {
      const seccionCarta = it.seccionCarta.activa ? it.seccionCarta.nombre : null;
      const opciones: OpcionItemAgrupadoAdmin[] = it.opciones
        .map((o) => ({
          id: o.id,
          productoId: o.producto.id,
          nombre: o.producto.nombre,
          orden: o.orden,
          // Mismo criterio que la carta (menu-consulta.ts): solo un PV disponible acá cuenta.
          disponibleAca: o.producto.tipo === "PV" && disponibilidad.get(o.producto.id) === true,
          precioAca: precioAca(o.producto.id, o.producto.precioVenta),
        }))
        .sort((a, b) => a.orden - b.orden || comparar(a.nombre, b.nombre));
      const precios = opciones.filter((o) => o.disponibleAca).map((o) => o.precioAca);
      const precio = precios.length ? { minimo: Math.min(...precios), maximo: Math.max(...precios) } : null;
      return {
        id: it.id,
        nombre: it.nombre,
        seccionCartaId: it.seccionCartaId,
        seccionCarta,
        descripcion: it.descripcion,
        tags: it.tags,
        especial: it.especial,
        orden: it.orden,
        activo: it.activo,
        generoCartaId: it.generoCartaId,
        generoCarta: it.generoCarta?.activo ? it.generoCarta.nombre : null,
        opciones,
        disponiblesAca: precios.length,
        precio,
        avisos: {
          preciosDistintos: precio && precio.minimo !== precio.maximo ? { ...precio, mostrado: precio.maximo } : null,
          sinOpcionesAca: precios.length === 0,
          sinSeccion: seccionCarta === null,
        },
      };
    }),
    secciones,
    generos,
    productosSinGrupo: sinGrupo.map((p) => ({ id: p.id, nombre: p.nombre, precioAca: precioAca(p.id, p.precioVenta) })),
    diagnostico: {
      agrupadosSinSeccion: armado?.diagnostico.agrupadosSinSeccion ?? [],
      agrupadosSinOpciones: armado?.diagnostico.agrupadosSinOpciones ?? [],
      agrupadosConPreciosDistintos: armado?.diagnostico.agrupadosConPreciosDistintos ?? [],
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Portal de sucursales (/carta/portal, docs/plan-registro-tenants-2026-09-24.md, M7)
// ---------------------------------------------------------------------------------------------------------------------------

export interface RegistroPublicoAdmin {
  slug: string;
  etiqueta: string | null;
  subtituloPortal: string | null;
  posX: number | null;
  posY: number | null;
  posW: number | null;
  posH: number | null;
  orden: number;
  publicada: boolean;
}

export interface SucursalPortalAdmin {
  id: string;
  nombre: string;
  activo: boolean;
  /** null = la sucursal no está en el registro de motor2 (no sale en el portal). */
  publica: RegistroPublicoAdmin | null;
  /** true = tiene un tema aplicado en motor2 (/carta/tema): el registro emite `temaDesdeMotor2` (docs/plan-tema-carta-2026-09-24.md, M6). */
  temaDesdeMotor2: boolean;
}

/** TODAS las sucursales (el mapa del portal es entre sucursales, no depende de la activa), activas primero, con su fila si la tienen. */
export async function cargarAdminPortal(db: Db): Promise<SucursalPortalAdmin[]> {
  const sucursales = await db.sucursal.findMany({
    select: { id: true, nombre: true, activo: true, publica: true, temaCarta: { select: { aplicarEnCarta: true } } },
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
      subtituloPortal: s.publica.subtituloPortal,
      posX: num(s.publica.posX),
      posY: num(s.publica.posY),
      posW: num(s.publica.posW),
      posH: num(s.publica.posH),
      orden: s.publica.orden,
      publicada: s.publica.publicada,
    },
    temaDesdeMotor2: s.temaCarta?.aplicarEnCarta === true,
  }));
}

// ---------------------------------------------------------------------------------------------------------------------------
// Tema de la carta (/carta/tema, docs/plan-tema-carta-2026-09-24.md, M4/M9)
// ---------------------------------------------------------------------------------------------------------------------------

export interface TemaAdmin {
  sucursalId: string;
  nombre: string;
  /** null = la sucursal todavía no tiene tema en motor2 (la carta usa el estilo por defecto). */
  tema: {
    /**
     * Lo guardado TAL CUAL (sin volver a validar), solo las claves del catálogo con valor de texto: si alguien cargó algo inválido
     * por `db:studio`, el formulario lo muestra para corregirlo (el endpoint, en cambio, lo emite como null).
     */
    valores: Record<string, string>;
    aplicarEnCarta: boolean;
    actualizadoEn: Date;
  } | null;
  /** null = la sucursal no está en el portal: el tema se puede preparar igual, pero no tiene efecto hasta agregarla. */
  publica: { slug: string; publicada: boolean } | null;
}

/** El tema de la sucursal (la activa de quien llama) y su lugar en el portal, en una sola consulta. */
export async function cargarTemaAdmin(sucursalId: string, db: Db): Promise<TemaAdmin | null> {
  const s = await db.sucursal.findUnique({
    where: { id: sucursalId },
    select: {
      id: true,
      nombre: true,
      temaCarta: { select: { valores: true, aplicarEnCarta: true, actualizadoEn: true } },
      publica: { select: { slug: true, publicada: true } },
    },
  });
  if (!s) return null;
  const json = s.temaCarta?.valores;
  const obj: Record<string, unknown> = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const valores: Record<string, string> = {};
  for (const clave of Object.keys(obj)) {
    const v = obj[clave];
    if (esClaveTema(clave) && typeof v === "string") valores[clave] = v;
  }
  return {
    sucursalId: s.id,
    nombre: s.nombre,
    tema: s.temaCarta && { valores, aplicarEnCarta: s.temaCarta.aplicarEnCarta, actualizadoEn: s.temaCarta.actualizadoEn },
    publica: s.publica,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Apariencia del portal de la empresa (/carta/portal, ADR-006)
// ---------------------------------------------------------------------------------------------------------------------------

export interface PortalEmpresaAdmin {
  /**
   * Lo guardado TAL CUAL (sin volver a validar), solo las claves del catálogo del portal con valor de texto: si alguien cargó algo
   * inválido por `db:studio`, el formulario lo muestra para corregirlo (el portal público, en cambio, cae al default).
   */
  valores: Record<string, string>;
  /** null = todavía no se guardó nada (el portal usa los defaults). Sirve de `key` del formulario para que se reinicie al guardar. */
  actualizadoEn: Date | null;
}

/** La apariencia del portal de la empresa activa (una fila por empresa; RLS deja ver solo la propia). */
export async function cargarPortalEmpresaAdmin(db: Db): Promise<PortalEmpresaAdmin> {
  const fila = await db.portalCartaEmpresa.findFirst({ select: { valores: true, actualizadoEn: true } });
  const json = fila?.valores;
  const obj: Record<string, unknown> = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const valores: Record<string, string> = {};
  for (const clave of Object.keys(obj)) {
    const v = obj[clave];
    if (esClavePortal(clave) && typeof v === "string") valores[clave] = v;
  }
  return { valores, actualizadoEn: fila?.actualizadoEn ?? null };
}

export interface EntradaVistaPreviaPortal {
  id: string;
  slug: string;
  etiqueta: string;
  subtitulo: string | null;
  posicion: PosicionPortal | null;
}

/**
 * Lo que el portal público mostraría hoy (publicada y con la sucursal activa), en el mismo orden (`orden`, después etiqueta): la
 * vista previa del admin dibuja con esto. Solo lo guardado: cambiar una posición o publicar una sucursal se ve al guardarla.
 */
export function entradasVistaPreviaPortal(sucursales: readonly SucursalPortalAdmin[]): EntradaVistaPreviaPortal[] {
  return sucursales
    .flatMap((s) => (s.publica?.publicada && s.activo ? [{ s, p: s.publica }] : []))
    .map(({ s, p }) => ({
      id: s.id,
      slug: p.slug,
      etiqueta: p.etiqueta ?? s.nombre,
      subtitulo: p.subtituloPortal,
      posicion: posicionCompleta(p.posX, p.posY, p.posW, p.posH),
      orden: p.orden,
    }))
    .sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta, "es"))
    .map(({ id, slug, etiqueta, subtitulo, posicion }) => ({ id, slug, etiqueta, subtitulo, posicion }));
}
