import { prisma } from "@/lib/db";
import { dbDeEmpresa } from "@/core/auth/base";
import { resolverEmpresaCarta, type EmpresaCarta } from "./empresa-carta";
import { resolverCartaPublica, resolverPortalCarta } from "./publica-consulta";

/**
 * Resolución de la carta para los consumidores SIN sesión (páginas `(carta-publica)`): no hay `ContextoUsuario` de donde sacar
 * `db`, así que la empresa/sucursal pública se resuelve acá, el único lugar de `core/carta` que elige el cliente de base de datos.
 */
/** `Empresa` no tiene RLS: se puede leer antes de saber a qué empresa pertenece el pedido. */
export const empresaCartaPublica = (slug: string) => resolverEmpresaCarta(slug, prisma);
/** Con empresa conocida (páginas `(carta-publica)`), bajo el contexto de ESA empresa: RLS sostiene el aislamiento aunque un filtro falle. */
export const portalCartaPublico = (empresa: EmpresaCarta) => resolverPortalCarta(empresa, dbDeEmpresa(empresa.id));
export const cartaPublica = (empresa: EmpresaCarta, slug: string) => resolverCartaPublica(empresa, slug, dbDeEmpresa(empresa.id));
