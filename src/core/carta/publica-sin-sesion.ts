import { prisma } from "@/lib/db";
import type { EmpresaCarta } from "./empresa-carta";
import { resolverMenuCarta } from "./menu-consulta";
import { resolverCartaPublica, resolverPortalCarta } from "./publica-consulta";
import { resolverRegistroTenants } from "./registro-consulta";
import { resolverTemaCarta } from "./tema-consulta";

/**
 * Resolución de la carta para los consumidores SIN sesión (rutas `/api/carta/*` y páginas `(carta-publica)`): no hay
 * `ContextoUsuario` de donde sacar `db`, así que la empresa/sucursal pública se resuelve acá, el único lugar de `core/carta`
 * que elige el cliente de base de datos.
 */
export const menuCartaPublico = (sucursalId: string) => resolverMenuCarta(sucursalId, prisma);
export const temaCartaPublico = (sucursalId: string) => resolverTemaCarta(sucursalId, prisma);
export const registroTenantsPublico = () => resolverRegistroTenants(prisma);
export const portalCartaPublico = (empresa: EmpresaCarta) => resolverPortalCarta(empresa, prisma);
export const cartaPublica = (empresa: EmpresaCarta, slug: string) => resolverCartaPublica(empresa, slug, prisma);
