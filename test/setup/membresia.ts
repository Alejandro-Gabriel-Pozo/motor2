import "dotenv/config";
import { prisma } from "../../src/lib/db";

interface DatosMembresia {
  usuarioId: string;
  sucursalId: string;
  rolId: string;
  activo?: boolean;
}

/**
 * Alta de membresía como la hace la aplicación (ADR-007, A4): la pertenencia a la empresa de la sucursal (`UsuarioEmpresa`) y la
 * de la sucursal (`UsuarioSucursal`) van juntas — sin la primera `obtenerContextoUsuario` no devuelve contexto. Todo test o
 * fixture que necesite "un usuario en una sucursal" pasa por acá en vez de crear `UsuarioSucursal` a mano.
 */
export async function crearMembresia(datos: DatosMembresia) {
  const { empresaId } = await prisma.sucursal.findUniqueOrThrow({ where: { id: datos.sucursalId }, select: { empresaId: true } });
  await prisma.usuarioEmpresa.upsert({
    where: { usuarioId_empresaId: { usuarioId: datos.usuarioId, empresaId } },
    update: {},
    create: { usuarioId: datos.usuarioId, empresaId },
  });
  return prisma.usuarioSucursal.create({ data: { ...datos, empresaId, activo: datos.activo ?? true } });
}

export async function crearMembresias(lista: DatosMembresia[]) {
  for (const datos of lista) await crearMembresia(datos);
}
