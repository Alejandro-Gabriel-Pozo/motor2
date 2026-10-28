import "server-only";
import { prisma } from "@/lib/db";
import { esRolAdmin, SELECCION_DE_ROL_PARA_JERARQUIA } from "@/core/permisos/jerarquia";
import { baseDeEmpresa, dbDeEmpresa, dbDeUsuario, verificarRolDeEjecucionDelProceso } from "./base";
import type { ContextoUsuario } from "./contexto";

/**
 * El CONTEXTO DE ACTOR SIN SESIÓN para el comando de un solo uso `scripts/importar-catalogo.ts` (docs/diseno-importador-de-catalogo-2026-10-28.md §8, «punto delicado»; E1.6). El
 * ingeniero corre el comando con `--actor <email>` de la dueña y `--empresa <slug o id>`: no hay cookie ni sesión de Auth.js, así que el contexto se arma acá con las MISMAS reglas que
 * `obtenerSituacionDeAcceso` (`contexto.ts`), y nada más:
 *  - el proceso corre con el rol de la app (`verificarRolDeEjecucionDelProceso`: `motor2_app`, ADR-022; las políticas de RLS se aplican);
 *  - el usuario existe por su correo (sin distinguir mayúsculas), la empresa existe por su slug o su id y está ACTIVA, y él tiene `UsuarioEmpresa` ACTIVO en ella;
 *  - sus membresías son las ACTIVAS de sucursales ACTIVAS de esa empresa (al menos una), leídas bajo el contexto de la empresa;
 *  - el alcance arranca en la sucursal de la primera membresía (lectura y escritura SOLO ahí, como cualquier pedido): ensancharlo es del caso de uso, sucursal por sucursal y después del gate.
 * NO da ningún permiso: es quién actúa; el gate de cada clave lo corre el caso de uso. Falla cerrado (lanza) ante cualquier cosa que no cierre.
 *
 * Superficie de seguridad: la importa SOLO `scripts/importar-catalogo.ts` (y su prueba); lo vigila `test/arquitectura/contexto-de-comando-solo-desde-el-importador.test.ts`.
 */
export async function contextoDeActorParaComando(pedido: { empresa: string; email: string }): Promise<ContextoUsuario> {
  await verificarRolDeEjecucionDelProceso();
  const email = pedido.email.trim().toLowerCase();
  const usuario = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, email: true } });
  if (!usuario) throw new Error(`No existe un usuario con el correo ${email}.`);
  const empresa = await prisma.empresa.findFirst({
    where: { OR: [{ id: pedido.empresa }, { slug: pedido.empresa }] },
    select: { id: true, slug: true, nombre: true, zonaHoraria: true, estado: true },
  });
  if (!empresa) throw new Error(`No existe la empresa «${pedido.empresa}».`);
  if (empresa.estado !== "ACTIVE") throw new Error(`La empresa «${empresa.nombre}» no está activa (${empresa.estado}).`);
  const pertenencia = await dbDeUsuario(usuario.id).usuarioEmpresa.findFirst({ where: { usuarioId: usuario.id, empresaId: empresa.id, activo: true }, select: { rolEmpresa: true } });
  if (!pertenencia) throw new Error(`${usuario.email} no pertenece (activo) a la empresa «${empresa.nombre}».`);
  const membresias = await dbDeEmpresa(empresa.id).usuarioSucursal.findMany({
    where: { usuarioId: usuario.id, activo: true, sucursal: { activo: true, empresaId: empresa.id } },
    select: { sucursalId: true, sucursal: { select: { nombre: true } }, rol: { select: SELECCION_DE_ROL_PARA_JERARQUIA } },
    orderBy: { creadoEn: "asc" },
  });
  if (membresias.length === 0) throw new Error(`${usuario.email} no tiene ninguna sucursal activa en «${empresa.nombre}».`);
  const activa = membresias[0];
  return {
    usuarioId: usuario.id,
    email: usuario.email,
    empresaId: empresa.id,
    empresaSlug: empresa.slug,
    empresaNombre: empresa.nombre,
    empresaZonaHoraria: empresa.zonaHoraria,
    rolEmpresa: pertenencia.rolEmpresa,
    empresas: [{ empresaId: empresa.id, empresaSlug: empresa.slug, empresaNombre: empresa.nombre, rolEmpresa: pertenencia.rolEmpresa }],
    sucursalId: activa.sucursalId,
    sucursalNombre: activa.sucursal.nombre,
    rolNombre: activa.rol.nombre,
    esAdminEnSucursal: esRolAdmin(activa.rol),
    membresias: membresias.map((m) => ({ sucursalId: m.sucursalId, sucursalNombre: m.sucursal.nombre, rolNombre: m.rol.nombre, esAdmin: esRolAdmin(m.rol) })),
    ...baseDeEmpresa(empresa.id, { lectura: [activa.sucursalId], escritura: [activa.sucursalId] }),
  };
}
