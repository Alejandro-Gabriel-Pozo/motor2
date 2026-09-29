import type { Prisma, PrismaClient } from "@prisma/client";
import type { CartaV1 } from "./armar-menu";
import type { EmpresaCarta } from "./empresa-carta";
import { estiloCartaPorDefecto, resolverEstiloCarta, type EstiloCarta } from "./estilo";
import { resolverMenuCarta } from "./menu-consulta";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`), Fase 2: capa de LECTURA de la carta pública nueva
 * (`app/(carta-publica)/`) — separada de `estilo.ts`/`armar-menu.ts` (puros) por el mismo motivo que el resto de `core/carta/`:
 * nunca mezclar Prisma con funciones puras. Reemplaza lo que hacían juntos `GET /api/carta/tenants` (registro) y
 * `GET /api/carta/[sucursal]` + `GET /api/carta/[sucursal]/tema` (carta + tema) para el consumo INTERNO — esos tres
 * endpoints HTTP siguen existiendo mientras `restaurant-menu-design` esté en producción (ver Fase 8 del plan).
 */

export interface EntradaPortalCarta {
  slug: string;
  etiqueta: string;
  subtitulo: string | null;
}

/**
 * El portal: solo las sucursales `publicada && sucursal.activo` (a diferencia de `resolverRegistroTenants`, que emite
 * TODAS con `activo: false` — esa lista completa existía para que la carta externa reconciliara contra su sheet, D4/D7 de
 * `docs/plan-registro-tenants-2026-09-24.md`; sin sheet externa que reconciliar, no hace falta emitir lo que no se muestra).
 * Orden: `orden` y después `etiqueta` (`localeCompare("es")`), mismo criterio que `armarRegistroTenants`.
 *
 * `empresa` es contrato (ADR-007, N3): hoy la base no tiene `empresaId` y la consulta no lo usa; desde A2/A3 filtra por ella.
 */
export async function resolverPortalCarta(empresa: EmpresaCarta, db: Db): Promise<EntradaPortalCarta[]> {
  const filas = await db.sucursalPublica.findMany({
    where: { publicada: true, sucursal: { activo: true } },
    select: { slug: true, etiqueta: true, subtituloPortal: true, orden: true, sucursal: { select: { nombre: true } } },
  });
  return filas
    .map((f) => ({ slug: f.slug, etiqueta: f.etiqueta ?? f.sucursal.nombre, subtitulo: f.subtituloPortal, orden: f.orden }))
    .sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta, "es"))
    .map(({ slug, etiqueta, subtitulo }) => ({ slug, etiqueta, subtitulo }));
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
 * `empresa`: igual que en `resolverPortalCarta`, contrato hasta que la base tenga `empresaId`.
 */
export async function resolverCartaPublica(empresa: EmpresaCarta, slug: string, db: Db, ahora: Date = new Date()): Promise<CartaPublicaResuelta | null> {
  const publica = await db.sucursalPublica.findUnique({
    where: { slug },
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
