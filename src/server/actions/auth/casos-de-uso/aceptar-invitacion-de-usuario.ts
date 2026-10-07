import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TIPO_INVITACION_USUARIO } from "@/core/auth/invitacion";
import { MENSAJE_ENLACE_NO_VALIDO, type ResultadoDeAceptacion } from "@/core/features/empresa/aceptar-invitacion";
import { esTokenConFormaValida } from "@/core/features/empresa/invitacion";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { actorDesdeLaBase, mensajeSiNoPuedeDarRolA, mensajeSiReactivaAdminSinSerGerente, objetivoEnSucursal, reactivaAUnAdmin } from "@/core/permisos/gestion-de-usuarios";
import { conInvariantesDeGobierno, InvarianteViolada } from "@/core/permisos/invariantes";
import { SELECCION_DE_ROL_PARA_JERARQUIA } from "@/core/permisos/jerarquia";
import { hashDeToken } from "@/core/seguridad/tokens";
import { marcarInvitacionAceptada } from "@/server/persistencia/invitaciones/marcar-invitacion-aceptada";
import { activarCuentaEnEmpresa, asignarMembresiaPorInvitacion } from "@/server/persistencia/permisos/membresias";
import { invitacionConSuBase } from "@/server/sesion/invitacion";

/**
 * Caso de uso «aceptar una invitación de USUARIO» (E8, ADR-024; Hito 3, B3-7 de `docs/plan-hito-3-pureza.md`). Antes eran dos piezas: la orquestación
 * `aceptarInvitacionDeUsuarioDelToken` (`core/auth/invitacion.ts`, luego `server/sesion/invitacion.ts`) y el cuerpo `aceptarInvitacionDeUsuario`
 * (`core/features/empresa/aceptar-invitacion-de-usuario.ts`, P3: leía y escribía la base; este archivo es ese, mudado con `git mv`). Se mudaron TAL CUAL (mismas consultas,
 * mismo orden de chequeos, mismos mensajes: lo fija `test/auth/caracterizacion/huella-de-aceptacion.test.ts`, incluido el rol de quien otorgó desactivado, O.34). La Server Action
 * `aceptarMiInvitacionDeUsuario` (`server/actions/auth/invitacion.ts`) quedó como adaptador.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Sin permiso de quien acepta (`permiso=SIN_PERMISO`, en `CASOS_SIN_PERMISO`): todavía no tiene membresía; la
 * autoridad es el token del enlace más el email de su cuenta de Google. Lo que SÍ se exige es el permiso de QUIEN OTORGÓ cada sucursal: las membresías NO existen hasta acá, así
 * que al aceptar se REVALIDA, por cada sucursal que da la invitación, lo que valía cuando se invitó: que la sucursal y el rol sigan activos, que quien la otorgó siga activo
 * (cuenta, empresa y sucursal) y con `gestion_usuarios` en ESA sucursal, y que su techo de privilegio alcance al rol (dar «admin» es de un administrador o del gerente) y a quien
 * se incorpora. Todo o nada: si una sucursal falla, no se crea nada y la invitación sigue pendiente (se reenvía, volviéndola a firmar).
 *
 * El permiso `gestion_usuarios` de quien otorgó pasa por el guard (módulos y capacidades): lo recibe POR PARÁMETRO (`requierePermiso`) y la única llamada de producción le pasa
 * el del gate (`test/arquitectura/invitacion-recibe-el-guard.test.ts`); se lo consulta con la base de la empresa de la invitación, fuera de la transacción (leerlo dentro es el
 * contrato C2 de O.35, no de B3). La base sale de `invitacionConSuBase`; la hora entra por `ahora` (la fija la acción): el caso de uso no lee el reloj.
 *
 * @contract Crea (o reactiva) la cuenta en la empresa y una membresía por sucursal de la invitación, una sola vez por enlace, solo si quien otorgó cada sucursal todavía puede hacerlo.
 * @idempotency Por estado: el update condicional de la invitación (`estado = PENDIENTE` y no vencida) arbitra el reintento y la carrera; el segundo uso devuelve «Este enlace ya no sirve».
 * @transaction conTransaccionSerializable bajo la empresa de la invitación (invitacionConSuBase), con conInvariantesDeGobierno alrededor de las altas.
 * @sideEffects registrarCambioAuditado (UsuarioEmpresa.activo con el primer otorgante como actor; UsuarioSucursal.rol y .activo con el otorgante de cada sucursal). Sin efectos externos.
 * @ficha permiso=SIN_PERMISO transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function aceptarInvitacionDeUsuarioCasoDeUso(
  entrada: { token: string; usuario: { id: string; email: string }; ahora: Date },
  requierePermiso: ExigirGestionDeUsuarios,
): Promise<ResultadoDeAceptacion> {
  const { ahora } = entrada;
  const invitacion = await invitacionConSuBase(entrada.token, ahora);
  if (!invitacion || invitacion.vista.estado !== "PENDIENTE" || invitacion.vista.tipo !== TIPO_INVITACION_USUARIO) return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  const dbEmpresa = invitacion.db;
  const puedeOtorgar = async (otorganteId: string, sucursalId: string) => (await requierePermiso(otorganteId, sucursalId, "gestion_usuarios", dbEmpresa)).ok;
  try {
    return await conTransaccionSerializable(invitacion.transaccion, (tx) => aceptarEnLaTransaccion(tx, { token: entrada.token, usuario: entrada.usuario, ahora, puedeOtorgar }));
  } catch (e) {
    if (e instanceof InvarianteViolada) return { ok: false, mensaje: e.mensaje };
    throw e;
  }
}

/**
 * El guard del permiso «gestionar usuarios» (módulos, capacidades y rol de quien otorgó), tal como lo da `requierePermiso` del gate. Lo recibe quien llama (la Server Action) y no
 * se importa acá. El `db` se tipa con `PrismaClient` (lo que devuelve `dbDeEmpresa`) y no con `ReturnType<typeof dbDeEmpresa>`: así nombrar el tipo no obliga a importar
 * `core/auth/base` (`base-solo-desde-lista` cuenta también los `import type`).
 */
type ExigirGestionDeUsuarios = (otorganteId: string, sucursalId: string, accion: "gestion_usuarios", db: PrismaClient) => Promise<{ ok: boolean }>;

interface EntradaDeAceptacionDeUsuario {
  token: string;
  usuario: { id: string; email: string };
  ahora: Date;
  puedeOtorgar: (otorganteId: string, sucursalId: string) => Promise<boolean>;
}

const PEDIR_REENVIO = "Pedile a quien te invitó que te reenvíe la invitación.";

/** El cuerpo, dentro de la transacción (antes `aceptarInvitacionDeUsuario` de `core/features/empresa/aceptar-invitacion-de-usuario.ts`). */
async function aceptarEnLaTransaccion(tx: Prisma.TransactionClient, entrada: EntradaDeAceptacionDeUsuario): Promise<ResultadoDeAceptacion> {
  const { token, usuario, ahora } = entrada;
  if (!esTokenConFormaValida(token)) return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  const hashToken = hashDeToken(token);

  const invitacion = await tx.invitacion.findFirst({
    where: { hashToken, rolEmpresa: "usuario", estado: "PENDIENTE" },
    include: { sucursales: { include: { sucursal: { select: { id: true, nombre: true, activo: true } }, rol: { select: SELECCION_DE_ROL_PARA_JERARQUIA } } } },
  });
  if (!invitacion || invitacion.venceEn.getTime() <= ahora.getTime()) return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  if (invitacion.email !== usuario.email.trim().toLowerCase()) return { ok: false, mensaje: `Esta invitación es para ${invitacion.email}. Entrá con esa cuenta de Google.` };
  const empresa = await tx.empresa.findUnique({ where: { id: invitacion.empresaId }, select: { id: true, nombre: true, estado: true } });
  if (!empresa || empresa.estado !== "ACTIVE") return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  if (invitacion.sucursales.length === 0) return { ok: false, mensaje: `Esta invitación no da acceso a ninguna sucursal. ${PEDIR_REENVIO}` };

  const cuentaPrevia = await tx.usuarioEmpresa.findUnique({ where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: empresa.id } }, select: { activo: true } });

  // Revalidación, sucursal por sucursal.
  for (const fila of invitacion.sucursales) {
    const donde = `«${fila.sucursal.nombre}»`;
    if (!fila.sucursal.activo || !fila.rol.activo) return { ok: false, mensaje: `La sucursal ${donde} o su rol ya no están disponibles. ${PEDIR_REENVIO}` };

    const otorgante = await tx.user.findUnique({ where: { id: fila.invitadoPorId }, select: { id: true, activoGlobal: true } });
    const cuentaDelOtorgante = await tx.usuarioEmpresa.findUnique({ where: { usuarioId_empresaId: { usuarioId: fila.invitadoPorId, empresaId: empresa.id } }, select: { activo: true } });
    if (!otorgante?.activoGlobal || !cuentaDelOtorgante?.activo) return { ok: false, mensaje: `Quien te dio acceso a ${donde} ya no puede hacerlo. ${PEDIR_REENVIO}` };
    if (!(await entrada.puedeOtorgar(fila.invitadoPorId, fila.sucursalId))) return { ok: false, mensaje: `Quien te dio acceso a ${donde} ya no tiene permiso para hacerlo. ${PEDIR_REENVIO}` };

    const actor = await actorDesdeLaBase(tx, empresa.id, fila.invitadoPorId, fila.sucursalId);
    const membresiaPrevia = await tx.usuarioSucursal.findUnique({
      where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId: fila.sucursalId } },
      include: { rol: { select: SELECCION_DE_ROL_PARA_JERARQUIA } },
    });
    const objetivo = await objetivoEnSucursal(tx, empresa.id, usuario.id, membresiaPrevia?.rol ?? null);
    const rechazo = mensajeSiNoPuedeDarRolA(actor, fila.rol, objetivo);
    if (rechazo) return { ok: false, mensaje: `No se puede dar acceso a ${donde}: ${rechazo} ${PEDIR_REENVIO}` };
    const reactivaAdmin = await reactivaAUnAdmin(tx, empresa.id, usuario.id, { membresia: membresiaPrevia, cuentaDeEmpresa: cuentaPrevia });
    const rechazoReactivar = mensajeSiReactivaAdminSinSerGerente(actor, reactivaAdmin);
    if (rechazoReactivar) return { ok: false, mensaje: `No se puede dar acceso a ${donde}: ${rechazoReactivar} ${PEDIR_REENVIO}` };
  }

  // Las escrituras, en la persistencia (B3-8) y en el mismo orden: marcar la invitación, la cuenta en la empresa y su auditoría, y por cada sucursal la membresía y sus dos auditorías.
  if (!(await marcarInvitacionAceptada(tx, { invitacionId: invitacion.id, hashToken, aceptadaPorId: usuario.id, ahora }))) return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };

  await conInvariantesDeGobierno(tx, empresa.id, async () => {
    await activarCuentaEnEmpresa(tx, { usuarioId: usuario.id, empresaId: empresa.id });
    const primerOtorgante = invitacion.sucursales[0].invitadoPorId;
    await registrarCambioAuditado(tx, {
      entidad: "UsuarioEmpresa", entidadId: usuario.id, campo: "activo", descripcion: `Cuenta de "${usuario.email}" en la empresa: acepta la invitación`,
      valorAnterior: cuentaPrevia ? cuentaPrevia.activo : null, valorNuevo: true, actorId: primerOtorgante, sucursalId: null,
    });
    for (const fila of invitacion.sucursales) {
      const previa = await tx.usuarioSucursal.findUnique({ where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId: fila.sucursalId } }, include: { rol: true } });
      const membresia = await asignarMembresiaPorInvitacion(tx, { usuarioId: usuario.id, sucursalId: fila.sucursalId, empresaId: empresa.id, rolId: fila.rolId, notas: fila.notas });
      const descripcion = `Usuario "${usuario.email}" en la sucursal "${fila.sucursal.nombre}"`;
      const comun = { entidad: "UsuarioSucursal", entidadId: membresia.id, actorId: fila.invitadoPorId, sucursalId: fila.sucursalId } as const;
      await registrarCambioAuditado(tx, { ...comun, campo: "rol", descripcion: `${descripcion}: rol (alta por invitación)`, valorAnterior: previa?.rol.nombre ?? null, valorNuevo: fila.rol.nombre });
      await registrarCambioAuditado(tx, { ...comun, campo: "activo", descripcion: `${descripcion}: activo`, valorAnterior: previa ? previa.activo : null, valorNuevo: true });
    }
  });

  return { ok: true, empresaId: empresa.id, nombreEmpresa: empresa.nombre };
}
