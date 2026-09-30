import { prisma } from "@/lib/db";
import { dbDeEmpresa } from "@/core/auth/base";
import { resolverEmpresaCarta, type EmpresaCarta } from "./empresa-carta";
import { resolverMenuCarta } from "./menu-consulta";
import { resolverCartaPublica, resolverPortalCarta } from "./publica-consulta";
import { resolverRegistroTenants } from "./registro-consulta";
import { resolverTemaCarta } from "./tema-consulta";

/**
 * Resolución de la carta para los consumidores SIN sesión (rutas `/api/carta/*` y páginas `(carta-publica)`): no hay
 * `ContextoUsuario` de donde sacar `db`, así que la empresa/sucursal pública se resuelve acá, el único lugar de `core/carta`
 * que elige el cliente de base de datos.
 */
/** `Empresa` no tiene RLS: se puede leer antes de saber a qué empresa pertenece el pedido. */
export const empresaCartaPublica = (slug: string) => resolverEmpresaCarta(slug, prisma);
/** Rutas heredadas `/api/carta/*` (ADR-007, D9): no traen empresa, así que leen con el `prisma` sin contexto, que bajo RLS es la única empresa ACTIVE; con dos o más no ven nada (404). */
export const menuCartaPublico = (sucursalId: string) => resolverMenuCarta(sucursalId, prisma);
export const temaCartaPublico = (sucursalId: string) => resolverTemaCarta(sucursalId, prisma);
export const registroTenantsPublico = () => resolverRegistroTenants(prisma);
/** Con empresa conocida (páginas `(carta-publica)`), bajo el contexto de ESA empresa: RLS sostiene el aislamiento aunque un filtro falle. */
export const portalCartaPublico = (empresa: EmpresaCarta) => resolverPortalCarta(empresa, dbDeEmpresa(empresa.id));
export const cartaPublica = (empresa: EmpresaCarta, slug: string) => resolverCartaPublica(empresa, slug, dbDeEmpresa(empresa.id));
