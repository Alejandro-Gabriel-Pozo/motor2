import { estiloDelPortalSimple, entradasDelPortalNuevo, esVarianteDePortal, sonPartesDeImagenValidas, valoresDelPortalDual, type SucursalDelPortal, LIBRO_ESTILO_MAQUETA, conDefaultsDeLaMaqueta, esSlugPublicoValido, estiloCartaPorDefecto, posicionCompleta, resolverEstiloCarta, resolverEstiloPortal, type CartaV1, type EntradaPortalCarta, type EstiloCarta, type EstiloPortal } from "@/core/carta/public";
import type { EmpresaCarta } from "@/server/lecturas/carta/empresa";
import { resolverMenuCarta } from "@/server/lecturas/carta/menu";
import type { Db } from "@/lib/db-tipos";
import { portalSimpleVisible } from "@/lib/portal-simple-visible";

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

// ---------------------------------------------------------------------------------------------------------------------------
// LECTURA DUAL del portal de la empresa (PR-A; docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md §8)
// ---------------------------------------------------------------------------------------------------------------------------
// Si la empresa tiene su fila de `PortalDeEmpresa`, el portal sale de las tablas nuevas; si no, de `resolverPortalCarta` y `resolverConfigPortal` EXACTAMENTE como hasta hoy (esas dos funciones NO se tocan: el golden de caracterización de las lecturas —`lecturas-tramo-a`— cuenta las
// consultas que hacen, y la sin-fila sigue siendo la misma lectura de siempre). El despacho vive en estas dos funciones, que es lo único que llama `server/carta-publica/sin-sesion.ts`. `portalNuevoDeLaEmpresa` es la consulta que decide (una por llamada).

/**
 * Las tarjetas del portal NUEVO (`PortalDeEmpresa`): variante A = tarjetas visibles, variante B = zonas visibles; solo de sucursales con registro público `publicada` y `activo` (el slug sale de `SucursalPublica`). Lo cargado en la otra variante no se lee. La regla de qué se muestra y
 * cómo se ordena es pura (`entradasDelPortalNuevo`, `core/carta/portal-de-empresa-lectura.ts`); acá solo se lee, con el `empresaId` explícito además del RLS.
 */
async function resolverPortalNuevo(empresa: EmpresaCarta, db: Db, portal: { id: string; variante: "A" | "B" }): Promise<EntradaPortalCarta[]> {
  const [tarjetas, zonas, publicas] = await Promise.all([
    portal.variante === "A" ? db.portalTarjeta.findMany({ where: { empresaId: empresa.id, portalId: portal.id, visible: true }, select: { sucursalId: true, orden: true, visible: true, nombre: true } }) : Promise.resolve([]),
    portal.variante === "B" ? db.portalZona.findMany({ where: { empresaId: empresa.id, portalId: portal.id, visible: true }, select: { sucursalId: true, x: true, y: true, ancho: true, alto: true, visible: true } }) : Promise.resolve([]),
    db.sucursalPublica.findMany({
      where: { empresaId: empresa.id, publicada: true, sucursal: { activo: true } },
      select: { sucursalId: true, slug: true, etiqueta: true, subtituloPortal: true, orden: true, sucursal: { select: { nombre: true } } },
    }),
  ]);
  const sucursales = new Map<string, SucursalDelPortal>(
    publicas.map((p) => [p.sucursalId, { slug: p.slug, etiqueta: p.etiqueta, subtitulo: p.subtituloPortal, orden: p.orden, nombreDeLaSucursal: p.sucursal.nombre, publicada: true, activa: true }]),
  );
  return entradasDelPortalNuevo({
    variante: portal.variante,
    tarjetas,
    zonas: zonas.map((z) => ({ sucursalId: z.sucursalId, x: z.x.toNumber(), y: z.y.toNumber(), ancho: z.ancho.toNumber(), alto: z.alto.toNumber(), visible: z.visible })),
    sucursales,
  });
}

/** La fila del portal nuevo de la empresa (con lo que el estilo y el listado necesitan), o `null` si la empresa todavía no tiene (se lee lo de siempre). Con el `empresaId` explícito además del RLS. */
async function portalNuevoDeLaEmpresa(empresa: EmpresaCarta, db: Db) {
  const portal = await db.portalDeEmpresa.findFirst({
    where: { empresaId: empresa.id },
    select: { id: true, variante: true, lineaSuperior: true, titulo: true, colorEncabezado: true, colorPagina: true, colorDetras: true, logoVisible: true, imagenProveedor: true, imagenCuenta: true, imagenIdPublico: true, imagenVersion: true, imagenExtension: true },
  });
  return portal && esVarianteDePortal(portal.variante) ? { ...portal, variante: portal.variante } : null;
}

/** El portal que ve el comensal: el nuevo si la empresa lo tiene; si no, `resolverPortalCarta` (sin cambios). */
export async function resolverPortalCartaDual(empresa: EmpresaCarta, db: Db): Promise<EntradaPortalCarta[]> {
  const portal = await portalNuevoDeLaEmpresa(empresa, db);
  return portal ? resolverPortalNuevo(empresa, db, portal) : resolverPortalCarta(empresa, db);
}

/**
 * La apariencia del portal: con el portal nuevo, las claves que él modela salen de él y el resto, del Json (`valoresDelPortalDual`); sin él, `resolverConfigPortal` (sin cambios).
 */
export async function resolverConfigPortalDual(empresa: EmpresaCarta, db: Db): Promise<EstiloPortal> {
  const portal = await portalNuevoDeLaEmpresa(empresa, db);
  if (!portal) return resolverConfigPortal(empresa, db);
  const fila = await db.portalCartaEmpresa.findFirst({ where: { empresaId: empresa.id }, select: { valores: true } });
  const partes = { proveedor: portal.imagenProveedor, cuenta: portal.imagenCuenta, idPublico: portal.imagenIdPublico, version: portal.imagenVersion, extension: portal.imagenExtension };
  const imagen = sonPartesDeImagenValidas(partes) ? partes : null;
  // Pantalla simple de «Colores del portal» (interruptor `portalSimpleVisible`, nace apagado): con ella, los tres fondos con sus textos derivados y lo que la fila no cargó sigue saliendo del Json (crear la fila no cambia el portal). Apagada, la lectura de PR-A tal cual.
  if (portalSimpleVisible()) {
    return estiloDelPortalSimple(fila?.valores, {
      variante: portal.variante,
      lineaSuperior: portal.lineaSuperior,
      titulo: portal.titulo,
      colorEncabezado: portal.colorEncabezado,
      colorPagina: portal.colorPagina,
      colorDetras: portal.colorDetras,
      imagen,
      logoVisible: portal.logoVisible,
    });
  }
  return resolverEstiloPortal(
    valoresDelPortalDual(fila?.valores, {
      variante: portal.variante,
      lineaSuperior: portal.lineaSuperior,
      titulo: portal.titulo,
      colorEncabezado: portal.colorEncabezado,
      colorPagina: portal.colorPagina,
      imagen,
      logoVisible: portal.logoVisible,
    }),
  );
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
    // GO-2d: la carta pública muestra las opciones de venta (tamaños, variantes, guarniciones, adicionales).
    resolverMenuCarta(sucursalId, db, ahora, undefined, conPromos ? "publico" : "ninguna", true),
    db.sucursal.findUnique({ where: { id: sucursalId }, select: { temaCarta: { select: { valores: true, aplicarEnCarta: true } } } }),
  ]);
  if (!carta) return null;

  const tema = conTema?.temaCarta;
  // Estilo de la maqueta (`core/carta/libro-estilo-maqueta.ts`): lo que la sucursal no cargó en su Tema toma el por defecto de la maqueta; apagado, todo igual que antes.
  const estilo = LIBRO_ESTILO_MAQUETA
    ? resolverEstiloCarta(conDefaultsDeLaMaqueta(tema?.aplicarEnCarta ? tema.valores : {}))
    : tema?.aplicarEnCarta
      ? resolverEstiloCarta(tema.valores)
      : estiloCartaPorDefecto();

  return { carta, estilo };
}
