import type { Prisma, PrismaClient } from "@prisma/client";
import type { CartaV1 } from "./armar-menu";
import type { EmpresaCarta } from "./empresa-carta";
import { posicionCompleta, resolverEstiloPortal, type EstiloPortal, type PosicionPortal } from "./portal";
import { estiloCartaPorDefecto, resolverEstiloCarta, type EstiloCarta } from "./estilo";
import { resolverMenuCarta } from "./menu-consulta";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`), Fase 2: capa de LECTURA de la carta pública nueva
 * (`app/(carta-publica)/`) — separada de `estilo.ts`/`armar-menu.ts` (puros) por el mismo motivo que el resto de `core/carta/`:
 * nunca mezclar Prisma con funciones puras. Reemplazó a los tres endpoints HTTP
 * `/api/carta/*` que consumía `restaurant-menu-design` (borrados en la Fase 8).
 */

const numeroOnull = (d: { toNumber(): number } | null): number | null => (d === null ? null : d.toNumber());

export interface EntradaPortalCarta {
  slug: string;
  etiqueta: string;
  subtitulo: string | null;
  /** Lugar de la tarjeta sobre el mapa del portal; `null` si `posX`/`posY`/`posW` no están los tres. */
  posicion: PosicionPortal | null;
}

/**
 * El portal: solo las sucursales `publicada && sucursal.activo` (el registro HTTP anterior emitía TODAS con `activo: false` para que la
 * carta externa las reconciliara, D4/D7 de `docs/plan-registro-tenants-2026-09-24.md`; sin carta externa, no hace falta emitir lo
 * que no se muestra). Orden: `orden` y después `etiqueta` (`localeCompare("es")`).
 *
 * Solo las sucursales de `empresa` (ADR-007, A3): el filtro es explícito además de lo que aportará RLS (A6).
 */
export async function resolverPortalCarta(empresa: EmpresaCarta, db: Db): Promise<EntradaPortalCarta[]> {
  const filas = await db.sucursalPublica.findMany({
    where: { empresaId: empresa.id, publicada: true, sucursal: { activo: true } },
    select: { slug: true, etiqueta: true, subtituloPortal: true, orden: true, posX: true, posY: true, posW: true, posH: true, sucursal: { select: { nombre: true } } },
  });
  return filas
    .map((f) => ({
      slug: f.slug,
      etiqueta: f.etiqueta ?? f.sucursal.nombre,
      subtitulo: f.subtituloPortal,
      posicion: posicionCompleta(numeroOnull(f.posX), numeroOnull(f.posY), numeroOnull(f.posW), numeroOnull(f.posH)),
      orden: f.orden,
    }))
    .sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta, "es"))
    .map(({ slug, etiqueta, subtitulo, posicion }) => ({ slug, etiqueta, subtitulo, posicion }));
}

/**
 * La apariencia del portal de la empresa (`PortalCartaEmpresa`, 1:1 con Empresa). Sin fila, o con un Json inservible: los defaults
 * del catálogo (grilla sin imagen). Filtra por `empresaId` explícito además del RLS, igual que el resto de esta capa.
 */
export async function resolverConfigPortal(empresa: EmpresaCarta, db: Db): Promise<EstiloPortal> {
  const fila = await db.portalCartaEmpresa.findFirst({ where: { empresaId: empresa.id }, select: { valores: true } });
  return resolverEstiloPortal(fila?.valores);
}

export interface CartaPublicaResuelta {
  carta: CartaV1;
  estilo: EstiloCarta;
}

/**
 * La carta de una sucursal por su slug público. `null` si no existe, no está publicada, o la sucursal está inactiva — el
 * caller (la página) responde 404 en los tres casos por igual, para no revelar cuál es (mismo criterio que hoy).
 *
 * El tema solo se usa si `aplicarEnCarta` (un borrador guardado pero no aplicado no debe verse en la carta pública, mismo
 * criterio que `docs/setup-sucursal.md` sección 3); sin eso, o sin fila de tema, el estilo es el default del catálogo.
 *
 * El slug es único POR empresa (`@@unique([empresaId, slug])`): dos empresas pueden tener una sucursal `central`.
 */
export async function resolverCartaPublica(empresa: EmpresaCarta, slug: string, db: Db, ahora: Date = new Date()): Promise<CartaPublicaResuelta | null> {
  const publica = await db.sucursalPublica.findUnique({
    where: { empresaId_slug: { empresaId: empresa.id, slug } },
    select: {
      publicada: true,
      sucursal: { select: { id: true, activo: true, temaCarta: { select: { valores: true, aplicarEnCarta: true } } } },
    },
  });
  if (!publica || !publica.publicada || !publica.sucursal.activo) return null;

  const carta = await resolverMenuCarta(publica.sucursal.id, db, ahora);
  if (!carta) return null;

  const tema = publica.sucursal.temaCarta;
  const estilo = tema?.aplicarEnCarta ? resolverEstiloCarta(tema.valores) : estiloCartaPorDefecto();

  return { carta, estilo };
}
