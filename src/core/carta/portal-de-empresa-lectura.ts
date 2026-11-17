import { urlDeImagenExterna, type PartesDeImagen } from "./imagen-externa";
import type { VarianteDePortal } from "./portal-de-empresa";
import type { EntradaPortalCarta } from "./portal";

/**
 * LECTURA DUAL del portal público (PR-A del portal; diseño `docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md` §8): si la empresa tiene su fila de `PortalDeEmpresa`, el portal sale de las tablas nuevas; si no, de `SucursalPublica` y del Json (`PortalCartaEmpresa.valores`) EXACTAMENTE
 * como hasta hoy (esas dos lecturas no se tocan). Este archivo es la parte PURA de la lectura nueva (la base la lee `server/lecturas/carta/publica.ts`), escrita así para que el oráculo de `test/carta/portal-de-empresa-lectura.oraculo.ts` la recorra entera.
 *
 * Dos productos: (1) los VALORES del estilo (`valoresDelPortalDual`: lo que `resolverEstiloPortal` ya sabe leer) y (2) las TARJETAS que el portal dibuja (`entradasDelPortalNuevo`). Nada nuevo se inventa para la pantalla: se reusa la forma `EntradaPortalCarta` y las claves del Json, así la página pública no cambia.
 */

/** Lo que el portal nuevo dice de su estilo (las columnas de `PortalDeEmpresa`; `colorDetras` no tiene todavía dónde dibujarse: la pantalla es del Frente 6). */
export interface EstiloDelPortalNuevo {
  variante: VarianteDePortal;
  lineaSuperior: string | null;
  titulo: string | null;
  colorEncabezado: string | null;
  colorPagina: string | null;
  imagen: PartesDeImagen | null;
  logoVisible: boolean;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Los valores que `resolverEstiloPortal` lee con el portal nuevo. Las claves que el portal nuevo MODELA salen SOLO de él (vacío = el valor por defecto del catálogo, nunca lo que diga el Json): el encabezado (`portal_header_bg`), el fondo de la página (`portal_fondo_color`), la línea superior
 * (`portal_etiqueta`), el título (`portal_titulo`) y la imagen del mapa (`portal_bg_image_url`, solo en la variante B: en la A el portal es una grilla). El resto de las claves del Json (el nombre público, los colores y tamaños de las tarjetas, la marca, el pie…) NO se pierde mientras el
 * portal nuevo no las modela: siguen saliendo del Json. El logo es el de la empresa (`empresa_logo_url`): el portal nuevo solo dice si se muestra; si no, sale vacío.
 */
export function valoresDelPortalDual(valoresJson: unknown, nuevo: EstiloDelPortalNuevo): Record<string, unknown> {
  const valores: Record<string, unknown> = esObjeto(valoresJson) ? { ...valoresJson } : {};
  const fijar = (clave: string, valor: string | null) => {
    if (valor === null) delete valores[clave];
    else valores[clave] = valor;
  };
  fijar("portal_header_bg", nuevo.colorEncabezado);
  fijar("portal_fondo_color", nuevo.colorPagina);
  fijar("portal_etiqueta", nuevo.lineaSuperior);
  fijar("portal_titulo", nuevo.titulo);
  fijar("portal_bg_image_url", nuevo.variante === "B" && nuevo.imagen !== null ? urlDeImagenExterna(nuevo.imagen) : null);
  if (!nuevo.logoVisible) delete valores.empresa_logo_url;
  return valores;
}

/** Lo que se sabe del registro público de una sucursal (`SucursalPublica` y `Sucursal`): sin él una tarjeta o una zona no tiene a dónde llevar. */
export interface SucursalDelPortal {
  slug: string;
  /** `SucursalPublica.etiqueta` (vacía = el nombre de la sucursal). */
  etiqueta: string | null;
  subtitulo: string | null;
  /** `SucursalPublica.orden`. */
  orden: number;
  nombreDeLaSucursal: string;
  publicada: boolean;
  activa: boolean;
}

export interface TarjetaLeida {
  sucursalId: string;
  orden: number;
  visible: boolean;
  nombre: string | null;
  telefono?: string | null;
}

/** Una zona en porcentaje de la imagen (esquina superior izquierda y tamaño). */
export interface ZonaLeida {
  sucursalId: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  visible: boolean;
}

const redondear = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Las tarjetas que el portal público dibuja. Variante A: las tarjetas VISIBLES (orden de la tarjeta y después nombre); variante B: las zonas VISIBLES sobre la imagen (orden del registro público y después nombre). Lo cargado en la OTRA variante no se lee (cambiar de variante no lo toca ni lo
 * muestra). Solo sucursales con registro público `publicada` y `activa` (sin eso no hay a dónde llevar, y una sucursal inactiva no se muestra): el resto no aparece, como hoy. Ninguna otra sucursal de la empresa aparece: solo las que tienen tarjeta o zona visible.
 * La zona se guarda por su esquina; el portal dibuja el CENTRO (`posicion`, como `SucursalPublica.posX/posY/posW/posH`).
 */
export function entradasDelPortalNuevo(args: { variante: VarianteDePortal; tarjetas: readonly TarjetaLeida[]; zonas: readonly ZonaLeida[]; sucursales: ReadonlyMap<string, SucursalDelPortal>; conTelefono?: boolean }): EntradaPortalCarta[] {
  const { sucursales } = args;
  const mostrable = (id: string) => {
    const s = sucursales.get(id);
    return s !== undefined && s.publicada && s.activa ? s : null;
  };
  const resultado: { orden: number; entrada: EntradaPortalCarta }[] = [];
  if (args.variante === "A") {
    for (const t of args.tarjetas) {
      const s = mostrable(t.sucursalId);
      if (!t.visible || s === null) continue;
      resultado.push({ orden: t.orden, entrada: { slug: s.slug, etiqueta: t.nombre ?? s.etiqueta ?? s.nombreDeLaSucursal, subtitulo: s.subtitulo, posicion: null, ...(args.conTelefono && t.telefono ? { telefono: t.telefono } : {}) } });
    }
  } else {
    for (const z of args.zonas) {
      const s = mostrable(z.sucursalId);
      if (!z.visible || s === null) continue;
      resultado.push({
        orden: s.orden,
        entrada: { slug: s.slug, etiqueta: s.etiqueta ?? s.nombreDeLaSucursal, subtitulo: s.subtitulo, posicion: { x: redondear(z.x + z.ancho / 2), y: redondear(z.y + z.alto / 2), w: z.ancho, h: z.alto } },
      });
    }
  }
  return resultado.sort((a, b) => a.orden - b.orden || a.entrada.etiqueta.localeCompare(b.entrada.etiqueta, "es")).map((r) => r.entrada);
}
