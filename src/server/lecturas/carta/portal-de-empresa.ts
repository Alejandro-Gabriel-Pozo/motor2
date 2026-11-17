import "server-only";
import { esVarianteDePortal, sonPartesDeImagenValidas, urlDeImagenExterna, type DatosDelPortal, type PartesDeImagen, type RegistroPublicoParaSembrar, type TarjetaDePortal, type ZonaDePortal } from "@/core/carta/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Lecturas del PORTAL de la empresa (`PortalDeEmpresa`, `PortalTarjeta`, `PortalZona`; PR-A del portal, docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md §9). Solo LEEN; las escribe el caso de uso `guardar-portal-de-empresa.ts`. El portal es de la EMPRESA del `db` (la RLS la fija desde el
 * contexto del servidor; además se filtra por `empresaId` explícito). Dos lecturas: `leerPortalDeLaEmpresa`, la que usa el caso de uso para decidir (todo lo cargado, en centésimas), y `consultarPortalDeEmpresa`, la de GESTIÓN para la pantalla (la variante activa Y lo cargado en la otra: cambiar de variante
 * no lo toca; en %). Sin portal, `null`: la pantalla muestra «todavía no hay portal» y la lectura pública sigue con `SucursalPublica` y el Json. Lo que falta NO se inventa: se informa como «pendiente de completar» (`pendientes`). Lo opcional vacío (textos y colores) NO es pendiente: es el valor por defecto.
 */

type ImagenGuardada = PartesDeImagen | null;

/** Una tarjeta tal como está guardada (con su versión). */
export interface TarjetaGuardada extends TarjetaDePortal {
  version: number;
}

/** Una zona tal como está guardada (en centésimas de porcentaje, con su versión). */
export interface ZonaGuardada extends ZonaDePortal {
  version: number;
}

/** El portal tal como está guardado: identidad, código, versión, datos, imagen y todo lo cargado en las dos variantes (ocultas incluidas). */
export interface PortalGuardado {
  id: string;
  codigo: string;
  version: number;
  datos: DatosDelPortal;
  imagen: ImagenGuardada;
  tarjetas: TarjetaGuardada[];
  zonas: ZonaGuardada[];
}

const imagenDe = (p: { imagenProveedor: string | null; imagenCuenta: string | null; imagenIdPublico: string | null; imagenVersion: string | null; imagenExtension: string | null }): ImagenGuardada => {
  const partes = { proveedor: p.imagenProveedor, cuenta: p.imagenCuenta, idPublico: p.imagenIdPublico, version: p.imagenVersion, extension: p.imagenExtension };
  return sonPartesDeImagenValidas(partes) ? partes : null;
};

const fotoDe = (t: { fotoProveedor: string | null; fotoCuenta: string | null; fotoIdPublico: string | null; fotoVersion: string | null; fotoExtension: string | null }): ImagenGuardada => {
  const partes = { proveedor: t.fotoProveedor, cuenta: t.fotoCuenta, idPublico: t.fotoIdPublico, version: t.fotoVersion, extension: t.fotoExtension };
  return sonPartesDeImagenValidas(partes) ? partes : null;
};

/** Decimal(5,2) → centésimas enteras (sin decimales flotantes: el valor ya viene con dos decimales). */
const aCentesimas = (d: { toNumber(): number }): number => Math.round(d.toNumber() * 100);

/** El portal de la empresa con todo lo cargado, o `null` si la empresa no tiene (todavía se lee `SucursalPublica` y el Json: lectura dual). */
export async function leerPortalDeLaEmpresa(db: Db, empresaId: string): Promise<PortalGuardado | null> {
  const p = await db.portalDeEmpresa.findFirst({ where: { empresaId }, include: { tarjetas: true, zonas: true } });
  if (!p || !esVarianteDePortal(p.variante)) return null;
  return {
    id: p.id,
    codigo: p.codigo,
    version: p.version,
    datos: {
      variante: p.variante,
      lineaSuperior: p.lineaSuperior,
      titulo: p.titulo,
      colorEncabezado: p.colorEncabezado,
      colorPagina: p.colorPagina,
      colorDetras: p.colorDetras,
      logoVisible: p.logoVisible,
    },
    imagen: imagenDe(p),
    tarjetas: p.tarjetas
      .map((t) => ({ sucursalId: t.sucursalId, orden: t.orden, visible: t.visible, nombre: t.nombre, telefono: t.telefono, foto: fotoDe(t), version: t.version }))
      .sort((a, b) => a.orden - b.orden || a.sucursalId.localeCompare(b.sucursalId)),
    zonas: p.zonas
      .map((z) => ({ id: z.id, sucursalId: z.sucursalId, x: aCentesimas(z.x), y: aCentesimas(z.y), ancho: aCentesimas(z.ancho), alto: aCentesimas(z.alto), visible: z.visible, version: z.version }))
      .sort((a, b) => a.sucursalId.localeCompare(b.sucursalId)),
  };
}

/** Qué le falta a la variante ACTIVA para verse: tarjetas visibles (A), imagen de fondo (B) y zonas visibles (B). */
export type PendienteDelPortal = "SIN_TARJETAS_VISIBLES" | "SIN_IMAGEN" | "SIN_ZONAS_VISIBLES";

export interface PortalDeEmpresaParaGestion {
  id: string;
  codigo: string;
  version: number;
  variante: "A" | "B";
  lineaSuperior: string | null;
  titulo: string | null;
  colorEncabezado: string | null;
  colorPagina: string | null;
  colorDetras: string | null;
  logoVisible: boolean;
  imagen: { partes: PartesDeImagen; direccion: string } | null;
  tarjetas: { sucursalId: string; nombreDeLaSucursal: string; orden: number; visible: boolean; nombre: string | null; telefono: string | null; foto: { partes: PartesDeImagen; direccion: string } | null }[];
  zonas: { sucursalId: string; nombreDeLaSucursal: string; x: number; y: number; ancho: number; alto: number; visible: boolean }[];
  pendientes: PendienteDelPortal[];
}

const conDireccion = (partes: PartesDeImagen | null) => (partes === null ? null : { partes, direccion: urlDeImagenExterna(partes) });

/** El portal de la empresa con todo lo cargado en las dos variantes, o `null` si todavía no tiene. Los porcentajes de las zonas salen en % (no en centésimas). */
export async function consultarPortalDeEmpresa(db: Db, args: { empresaId: string }): Promise<PortalDeEmpresaParaGestion | null> {
  const portal = await leerPortalDeLaEmpresa(db, args.empresaId);
  if (portal === null) return null;
  const sucursales = await db.sucursal.findMany({
    where: { empresaId: args.empresaId, id: { in: [...new Set([...portal.tarjetas.map((t) => t.sucursalId), ...portal.zonas.map((z) => z.sucursalId)])] } },
    select: { id: true, nombre: true },
  });
  const nombres = new Map(sucursales.map((s) => [s.id, s.nombre]));
  const nombreDe = (id: string) => nombres.get(id) ?? "";
  const pendientes: PendienteDelPortal[] = [];
  if (portal.datos.variante === "A" && !portal.tarjetas.some((t) => t.visible)) pendientes.push("SIN_TARJETAS_VISIBLES");
  if (portal.datos.variante === "B") {
    if (portal.imagen === null) pendientes.push("SIN_IMAGEN");
    if (!portal.zonas.some((z) => z.visible)) pendientes.push("SIN_ZONAS_VISIBLES");
  }
  return {
    id: portal.id,
    codigo: portal.codigo,
    version: portal.version,
    ...portal.datos,
    imagen: conDireccion(portal.imagen),
    tarjetas: portal.tarjetas.map((t) => ({ sucursalId: t.sucursalId, nombreDeLaSucursal: nombreDe(t.sucursalId), orden: t.orden, visible: t.visible, nombre: t.nombre, telefono: t.telefono, foto: conDireccion(t.foto) })),
    zonas: portal.zonas.map((z) => ({ sucursalId: z.sucursalId, nombreDeLaSucursal: nombreDe(z.sucursalId), x: z.x / 100, y: z.y / 100, ancho: z.ancho / 100, alto: z.alto / 100, visible: z.visible })),
    pendientes,
  };
}

/**
 * Lo que la empresa YA tiene cargado y se necesita para crear su portal nuevo sin cambiarlo (`sembrarTarjetasDelPortal`): el Json `PortalCartaEmpresa.valores` y TODOS los registros públicos de sucursal (también los no publicados), con `empresaId` explícito además del RLS.
 * Se lee dentro de la misma transacción del alta (la pantalla simple, `casos-de-uso/guardar-colores-del-portal.ts`).
 */
export async function leerLoCargadoDelPortal(db: Db, empresaId: string): Promise<{ valoresJson: unknown; registros: RegistroPublicoParaSembrar[] }> {
  const [json, publicas] = await Promise.all([
    db.portalCartaEmpresa.findFirst({ where: { empresaId }, select: { valores: true } }),
    db.sucursalPublica.findMany({ where: { empresaId }, select: { sucursalId: true, publicada: true, etiqueta: true, orden: true, posX: true, posY: true, posW: true, posH: true, sucursal: { select: { activo: true } } } }),
  ]);
  const numero = (d: { toNumber(): number } | null): number | null => (d === null ? null : d.toNumber());
  return {
    valoresJson: json?.valores ?? null,
    registros: publicas.map((p) => ({ sucursalId: p.sucursalId, publicada: p.publicada, activa: p.sucursal.activo, orden: p.orden, etiqueta: p.etiqueta, posX: numero(p.posX), posY: numero(p.posY), posW: numero(p.posW), posH: numero(p.posH) })),
  };
}
