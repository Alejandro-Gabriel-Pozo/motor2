import "server-only";
import { prisma } from "@/lib/db";
import { dbDeEmpresa, verificarRolDeEjecucionDelProceso } from "@/core/auth/base";
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

/** `Empresa` no tiene RLS: se puede leer antes de saber a qué empresa pertenece el pedido. */
export const empresaCartaPublica = (slug: string) => conRolVerificado(() => resolverEmpresaCarta(slug, prisma));
/** Con empresa conocida (páginas `(carta-publica)`), bajo el contexto de ESA empresa: RLS sostiene el aislamiento aunque un filtro falle. */
export const portalCartaPublico = (empresa: EmpresaCarta) => conRolVerificado(() => resolverPortalCarta(empresa, dbDeEmpresa(empresa.id)));
export const configPortalPublica = (empresa: EmpresaCarta) => conRolVerificado(() => resolverConfigPortal(empresa, dbDeEmpresa(empresa.id)));
/** `ahora` obligatorio (O.22-c): lo fija la página pública, en el borde; este módulo no lee el reloj (lo vigila `SIN_RELOJ_FUERA_DE_CONSULTAS`). */
export const cartaPublica = (empresa: EmpresaCarta, slug: string, ahora: Date) => conRolVerificado(() => resolverCartaPublica(empresa, slug, dbDeEmpresa(empresa.id), ahora));
