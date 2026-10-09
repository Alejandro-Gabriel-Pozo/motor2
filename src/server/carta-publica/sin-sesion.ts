import "server-only";
import { prisma } from "@/lib/db";
import { dbDeEmpresa, verificarRolDeEjecucionDelProceso } from "@/core/auth/base";
import { unstable_cache } from "next/cache";
import { etiquetaDeCacheDeCartasPublicas, proyectarCartaPublica, resolverEstiloPortal, type CartaPublicaV1, type EstiloCarta } from "@/core/carta/public";
import { modulosEfectivosDeEmpresa } from "@/server/acceso/modulos-de-empresa";
import type { Db } from "@/lib/db-tipos";
import { resolverEmpresaCarta, type EmpresaCarta } from "@/server/lecturas/carta/empresa";
import { resolverCartaPublica, resolverConfigPortal, resolverPortalCarta } from "@/server/lecturas/carta/publica";

/**
 * Resolución de la carta para los consumidores SIN sesión (páginas `(carta-publica)`): no hay `ContextoUsuario` de donde sacar
 * `db`, así que la empresa/sucursal pública se resuelve acá, el único lugar de `core/carta` que elige el cliente de base de datos.
 *
 * Toda función exportada pasa por `conRolVerificado`: el camino con sesión (`obtenerContextoUsuario`) se niega a operar si el rol de la base
 * salta el RLS con más de una empresa, y este camino —el más expuesto— no puede ser el único que no lo chequea. Lo exige
 * `test/arquitectura/publica-sin-sesion-verifica-el-rol.test.ts`.
 */
async function conRolVerificado<T>(consulta: () => Promise<T>): Promise<T> {
  await verificarRolDeEjecucionDelProceso();
  return consulta();
}

/**
 * Lo CONTRATADO que la carta pública publica (S-23 / D2 del dueño, tanda T9 del endurecimiento de seguridad): «la carta pública no se publica con el módulo
 * apagado». Esta entrada no pasa por el gate de ninguna acción (no hay sesión), así que el registro de módulos de la empresa se pregunta ACÁ, que es el último
 * punto donde se decide, y las tres funciones de abajo lo respetan (la página, el portal y el subdominio entran todos por ellas):
 *  - `carta`: sin ella no se publica nada —ni la carta de una sucursal, ni el portal, ni la apariencia del portal—, con el mismo `null`/vacío que una empresa sin nada publicado;
 *  - `promociones`: sin ella la carta se sirve sin promos.
 * La pregunta es al único lector del registro (`server/acceso/modulos-de-empresa.ts`, que el gate y el menú comparten): acá no se vuelve a calcular la clausura. Fallo
 * cerrado: una empresa sin filas en el registro no tiene Carta.
 */
async function modulosQueLaCartaPublica(empresa: EmpresaCarta, db: Db): Promise<{ carta: boolean; promociones: boolean }> {
  const efectivos = await modulosEfectivosDeEmpresa(empresa.id, db);
  return { carta: efectivos.has("carta"), promociones: efectivos.has("promociones") };
}

/** Los mismos 300 s que `export const revalidate` de `app/(carta-publica)/carta-publica/[empresa]/[sucursal]/page.tsx` (Next toma el MENOR de los dos: uno más corto acortaría el ISR de la página). */
const SEGUNDOS_DE_CACHE_DE_LA_CARTA = 300;

/** Lo que la carta de una sucursal entrega al anónimo: la carta SIN ids internos y su estilo. */
interface CartaPublicaEntregada {
  carta: CartaPublicaV1;
  estilo: EstiloCarta;
}

/** `Empresa` no tiene RLS: se puede leer antes de saber a qué empresa pertenece el pedido. */
export const empresaCartaPublica = (slug: string) => conRolVerificado(() => resolverEmpresaCarta(slug, prisma));
/** Con empresa conocida (páginas `(carta-publica)`), bajo el contexto de ESA empresa: RLS sostiene el aislamiento aunque un filtro falle. Sin el módulo Carta, vacío. */
export const portalCartaPublico = (empresa: EmpresaCarta) =>
  conRolVerificado(async () => {
    const db = dbDeEmpresa(empresa.id);
    if (!(await modulosQueLaCartaPublica(empresa, db)).carta) return [];
    return resolverPortalCarta(empresa, db);
  });
/** La apariencia del portal. Sin el módulo Carta, la de fábrica: lo que la empresa cargó no sale. */
export const configPortalPublica = (empresa: EmpresaCarta) =>
  conRolVerificado(async () => {
    const db = dbDeEmpresa(empresa.id);
    if (!(await modulosQueLaCartaPublica(empresa, db)).carta) return resolverEstiloPortal(undefined);
    return resolverConfigPortal(empresa, db);
  });
/**
 * `ahora` obligatorio (O.22-c): lo fija la página pública, en el borde; este módulo no lee el reloj (lo vigila `SIN_RELOJ_FUERA_DE_CONSULTAS`).
 * Sin el módulo Carta es `null` (404, igual que una sucursal que no existe); sin Promociones, la carta sale sin promos.
 */
export const cartaPublica = (empresa: EmpresaCarta, slug: string, ahora: Date) =>
  conRolVerificado(async (): Promise<CartaPublicaEntregada | null> => {
    const db = dbDeEmpresa(empresa.id);
    const modulos = await modulosQueLaCartaPublica(empresa, db);
    if (!modulos.carta) return null;
    // S-26: la carta lleva la etiqueta de caché DE SU EMPRESA. Next engancha esa etiqueta a la página que la usó (el ISR de `[sucursal]/page.tsx`), así que
    // `revalidarCartasPublicas(empresaSlug)` invalida las cartas de esa empresa y de ninguna otra. `revalidate` igual al de la página: no la acorta ni la alarga.
    const resuelta = await unstable_cache(() => resolverCartaPublica(empresa, slug, db, ahora, modulos.promociones), ["carta-publica", empresa.id, slug, modulos.promociones ? "con-promos" : "sin-promos"], {
      tags: [etiquetaDeCacheDeCartasPublicas(empresa.slug)],
      revalidate: SEGUNDOS_DE_CACHE_DE_LA_CARTA,
    })();
    // S-25: la carta armada lleva los ids internos que usan el POS y el admin; al anónimo sale la proyección sin ellos (campo por campo, `core/carta/carta-publica.ts`).
    return resuelta ? { carta: proyectarCartaPublica(resuelta.carta), estilo: resuelta.estilo } : null;
  });
