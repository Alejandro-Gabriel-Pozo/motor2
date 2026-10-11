import { esSlugPublicoValido, estiloCartaPorDefecto, posicionCompleta, resolverEstiloCarta, resolverEstiloPortal, type CartaV1, type EntradaPortalCarta, type EstiloCarta, type EstiloPortal } from "@/core/carta/public";
import type { EmpresaCarta } from "@/server/lecturas/carta/empresa";
import { resolverMenuCarta } from "@/server/lecturas/carta/menu";
import type { Db } from "@/lib/db-tipos";

/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`), Fase 2: capa de LECTURA de la carta pública nueva
 * (`app/(carta-publica)/`) — separada de `estilo.ts`/`armar-menu.ts` (puros) por el mismo motivo que el resto de `core/carta/`:
 * nunca mezclar Prisma con funciones puras. Reemplazó a los tres endpoints HTTP
 * `/api/carta/*` que consumía `restaurant-menu-design` (borrados en la Fase 8).
 */

const numeroOnull = (d: { toNumber(): number } | null): number | null => (d === null ? null : d.toNumber());

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
 * Las DOS bases con las que se arma la carta de una sucursal sin sesión (M.3-A7, RLS por sucursal): no hay usuario que traiga un alcance, así que quien llama (`server/carta-publica/sin-sesion.ts`) las da:
 *  - `deLaEmpresa`: la base de la empresa SIN alcance por sucursal. Solo sirve para lo que no es de una sucursal: el registro público (`SucursalPublica`) y `Sucursal`, tablas de GOBIERNO que se leen
 *    ANTES de saber a qué sucursal se refiere el slug;
 *  - `deLaSucursal(sucursalId)`: la base de SOLO LECTURA en esa única sucursal. Se pide DESPUÉS de resolver el slug y con el id que resolvió: sin resolverlo no hay forma de leer una tabla por sucursal.
 */
interface BasesDeLaCartaPublica {
  deLaEmpresa: Db;
  deLaSucursal: (sucursalId: string) => Db;
}

/**
 * La carta de una sucursal por su slug público. `null` si no existe, no está publicada, o la sucursal está inactiva — el
 * caller (la página) responde 404 en los tres casos por igual, para no revelar cuál es (mismo criterio que hoy).
 *
 * Primero se resuelve el slug en `SucursalPublica` con la base de la empresa (sin alcance) y recién entonces se lee la carta de ESA sucursal —menú, precios locales, descuentos, promos y tema— con la base de
 * solo lectura que `bases.deLaSucursal` abre para ella: las políticas por sucursal de la Fase B no dejan ver otra, aunque una consulta olvide su filtro. Un slug que no resuelve (inexistente, de otra
 * empresa, sin publicar, de una sucursal inactiva, con caracteres que no son de un slug) devuelve `null` sin abrir esa base.
 *
 * El tema solo se usa si `aplicarEnCarta` (un borrador guardado pero no aplicado no debe verse en la carta pública, mismo
 * criterio que `docs/setup-sucursal.md` sección 3); sin eso, o sin fila de tema, el estilo es el default del catálogo.
 *
 * El slug es único POR empresa (`@@unique([empresaId, slug])`): dos empresas pueden tener una sucursal `central`.
 *
 * `ahora` (O.22-c de docs/pureza-integracion.md) es obligatorio: la fija la página pública y llega por `cartaPublica` (`server/carta-publica/sin-sesion.ts`);
 * solo alimenta el `generadoEn` de la carta.
 */
export async function resolverCartaPublica(
  empresa: EmpresaCarta,
  slug: string,
  bases: BasesDeLaCartaPublica,
  ahora: Date,
  /** S-23: sin el módulo Promociones la carta sale sin promos (ni se leen). Lo decide `server/carta-publica/sin-sesion.ts`, que es quien ve el registro de módulos. */
  conPromos = true
): Promise<CartaPublicaResuelta | null> {
  if (!esSlugPublicoValido(slug)) return null;
  const publica = await bases.deLaEmpresa.sucursalPublica.findUnique({
    where: { empresaId_slug: { empresaId: empresa.id, slug } },
    select: { publicada: true, sucursal: { select: { id: true, activo: true } } },
  });
  if (!publica || !publica.publicada || !publica.sucursal.activo) return null;

  // De acá en adelante, todo lo de la carta se lee con la base de ESA sucursal (y solo lectura).
  const sucursalId = publica.sucursal.id;
  const db = bases.deLaSucursal(sucursalId);
  const [carta, conTema] = await Promise.all([
    resolverMenuCarta(sucursalId, db, ahora, undefined, conPromos),
    db.sucursal.findUnique({ where: { id: sucursalId }, select: { temaCarta: { select: { valores: true, aplicarEnCarta: true } } } }),
  ]);
  if (!carta) return null;

  const tema = conTema?.temaCarta;
  const estilo = tema?.aplicarEnCarta ? resolverEstiloCarta(tema.valores) : estiloCartaPorDefecto();

  return { carta, estilo };
}
