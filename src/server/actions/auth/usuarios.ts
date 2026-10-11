"use server";

import { sucursalesDondeElUsuarioPuedeVer } from "@/server/acceso/gate";
import { conPermiso, conPermisoDeEmpresa, permisoYAlcanceEnSucursal } from "../con-permiso";
import { enviarInvitacionYAnotar, type InvitacionPorEnviar } from "./casos-de-uso/enviar-invitacion-y-anotar";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";
import { azarDelProceso } from "@/lib/azar";
import { aResultadoAccion } from "@/core/resultado-caso";
import { actualizarNotasMembresiaCasoDeUso } from "./casos-de-uso/actualizar-notas-membresia";
import { actualizarActivoMembresiaCasoDeUso } from "./casos-de-uso/actualizar-activo-membresia";
import { actualizarActivoUsuarioEnEmpresaCasoDeUso } from "./casos-de-uso/actualizar-activo-usuario-en-empresa";
import { transferirGerenciaCasoDeUso } from "./casos-de-uso/transferir-gerencia";
import { agregarOActualizarUsuarioCasoDeUso } from "./casos-de-uso/agregar-o-actualizar-usuario";
import { guardComandoAgregarOActualizarUsuario } from "@/core/features/permisos/usuario.guard";
import { revocarInvitacionCasoDeUso } from "./casos-de-uso/revocar-invitacion";
import { reenviarInvitacionPendienteCasoDeUso } from "./casos-de-uso/reenviar-invitacion";
import { invitarAVincularCasoDeUso } from "./casos-de-uso/invitar-a-vincular";

/**
 * Techo de privilegio y salvaguardas de esta pantalla (Bloque G, G2): las acciones no miran roles ni comparan nombres. Desde el Hito 3 (Fase I, I.5) cada mutación
 * es un adaptador de su caso de uso (`./casos-de-uso/`), que lee el estado y escribe dentro de `conGobierno` (transacción serializable con reintento) y pregunta a
 * `core/permisos/gestion-de-usuarios` (el techo: nadie toca a quien está por encima, el rol admin lo da un admin o el gerente, reactivar a un admin es del gerente) y
 * a `core/permisos/invariantes` (la empresa conserva un admin efectivo, el gerente una sucursal activa y su condición de admin). Adentro no va ningún efecto
 * externo: el bloque puede reintentarse. Por eso el mail de una invitación lo manda la acción, DESPUÉS de que el caso de uso confirmó.
 */

/** Cómo está la cuenta de Google de una membresía: vinculada, o sin vincular con el estado de su invitación de vinculación. */
export type EstadoDeCuentaGoogle = "vinculada" | "sin-invitacion" | "pendiente" | "vencida" | "sin-enviar";

export async function listarUsuariosDeSucursal(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "gestion_usuarios");
  const filas = await ctx.db.usuarioSucursal.findMany({
    where: { sucursalId },
    // Solo lo que dibuja la tabla: la fila completa de User (id de cuenta, foto, verificación, estado global) viajaba al navegador.
    select: { id: true, activo: true, usuario: { select: { email: true, accounts: { where: { provider: "google" }, select: { id: true }, take: 1 } } }, rol: { select: { nombre: true } } },
    orderBy: { creadoEn: "asc" },
  });
  const sinGoogle = filas.filter((f) => f.usuario.accounts.length === 0).map((f) => f.usuario.email);
  const vinculaciones = sinGoogle.length
    ? await ctx.db.invitacion.findMany({ where: { empresaId: ctx.empresaId, rolEmpresa: "vinculacion", estado: "PENDIENTE", email: { in: sinGoogle } }, select: { id: true, email: true, venceEn: true, enviadaEn: true } })
    : [];
  // Lectura, no mutación: no corre en `conPermiso` y no tiene `ctx.ahora`. La hora se lee acá, en el borde (solo decide si una invitación se MUESTRA vencida); no se
  // recibe por parámetro porque esta función es un endpoint ("use server") y el cliente elegiría la hora. Se resuelve cuando la lectura pase a `server/consultas` (H8/Fase II).
  const ahora = new Date();
  return filas.map((f) => {
    const { accounts, ...usuario } = f.usuario;
    const inv = vinculaciones.find((v) => v.email === usuario.email);
    const google: EstadoDeCuentaGoogle = accounts.length > 0 ? "vinculada" : !inv ? "sin-invitacion" : inv.venceEn.getTime() <= ahora.getTime() ? "vencida" : inv.enviadaEn ? "pendiente" : "sin-enviar";
    return { id: f.id, activo: f.activo, usuario, rol: f.rol, google, invitacionId: inv?.id ?? null };
  });
}

/**
 * Las invitaciones de USUARIO pendientes que incluyen la sucursal activa: quién, qué sucursales y roles, quién invitó, cuándo vence y si el mail salió. Los accesos son solo los de
 * las sucursales donde quien mira tiene `gestion_usuarios` (S-16, O.65); los de las demás vuelven como una cuenta (`enOtrasSucursales`).
 */
export async function listarInvitacionesPendientes(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "gestion_usuarios");
  const filas = await ctx.db.invitacion.findMany({
    where: { empresaId: ctx.empresaId, rolEmpresa: "usuario", estado: "PENDIENTE", sucursales: { some: { sucursalId } } },
    select: {
      id: true, email: true, venceEn: true, enviadaEn: true, invitadoPor: { select: { email: true } },
      sucursales: { orderBy: { creadaEn: "asc" }, select: { sucursalId: true, sucursal: { select: { nombre: true } }, rol: { select: { nombre: true } } } },
    },
    orderBy: { creadaEn: "asc" },
  });
  // S-16 (O.65): una invitación puede dar acceso a varias sucursales y la RLS separa empresas, no sucursales: de cada fila se muestran SOLO los accesos de las sucursales donde quien
  // mira puede ver `gestion_usuarios` (la activa ya pasó el gate de arriba); el resto se cuenta, sin nombre de sucursal ni de rol.
  const visibles = await sucursalesDondeElUsuarioPuedeVer(ctx.usuarioId, [...new Set(filas.flatMap((f) => f.sucursales.map((s) => s.sucursalId)))], "gestion_usuarios", ctx.db);
  const ahora = new Date(); // lectura en el borde, como en `listarUsuariosDeSucursal`
  return filas.map((f) => {
    const propias = f.sucursales.filter((s) => visibles.has(s.sucursalId));
    return {
      id: f.id,
      email: f.email,
      invitadoPor: f.invitadoPor?.email ?? null,
      venceEn: f.venceEn.toISOString(),
      vencida: f.venceEn.getTime() <= ahora.getTime(),
      enviada: f.enviadaEn !== null,
      accesos: propias.map((s) => ({ sucursal: s.sucursal.nombre, rol: s.rol.nombre })),
      /** Cuántos accesos más tiene la invitación en sucursales que quien mira no administra: solo el número. */
      enOtrasSucursales: f.sucursales.length - propias.length,
    };
  });
}

/**
 * Equivalente de guardarUsuarioDesdePanel (Core.js:1142-1180): agrega o actualiza la membresía de un email en una sucursal.
 *
 * E8 (ADR-024): ya NO se crea el `User` ni la membresía de alguien que no es miembro de la empresa. A esa persona se le manda una INVITACIÓN (mail con enlace de un solo uso): sus
 * membresías nacen cuando la acepta con su cuenta de Google, revalidando entonces el permiso y el techo de quien la invitó. A quien YA es miembro de la empresa se le suma la
 * sucursal o se le cambia el rol directo, como siempre; si todavía no vinculó su cuenta de Google, se le manda además la invitación de vinculación. El mail sale DESPUÉS del
 * commit (ADR-018); si no sale, la invitación queda hecha y figura sin enviar.
 *
 * Desde el Hito 3 (Fase I, I.5j) es un adaptador, en el mismo orden que antes: `conPermiso("gestion_usuarios")` → formato
 * (`guardComandoAgregarOActualizarUsuario`: el email, DENTRO del envoltorio) → el permiso EXTRA sobre la sucursal pedida si no es la activa (`permisoYAlcanceEnSucursal`:
 * pide `gestion_usuarios` ALLÍ y, solo si lo aprueba, ensancha el alcance a ella; M.3-A5) → caso de uso (`casos-de-uso/agregar-o-actualizar-usuario.ts`: la transacción de gobierno entera) → si dejó una invitación por mandar,
 * el mail (`enviarInvitacionYAnotar`) recién ahora, con la transacción confirmada → `aResultadoAccion` (o el aviso de que el mail no salió).
 */
export async function agregarOActualizarUsuario(input: {
  email: string;
  sucursalId: string;
  rolId: string;
  notas?: string;
}): Promise<ResultadoAccion> {
  return conPermiso("gestion_usuarios", async (ctx) => {
    const comando = guardComandoAgregarOActualizarUsuario(input);
    if (!comando.ok) return error(comando.mensaje);

    // `conPermiso` solo validó la sucursal ACTIVA: el alta apunta a la que eligió el formulario (viene del cliente), y ahí el
    // rol de quien la hace puede no tener `gestion_usuarios` (o no tener ni membresía). M.3-A5: `permisoYAlcanceEnSucursal` pide la clave EN esa sucursal y, solo si
    // la aprueba, devuelve el contexto con la lectura y la escritura ensanchadas a ELLA (la membresía y su auditoría se escriben allí); el caso de uso corre con ese.
    let alta = ctx;
    if (comando.valor.sucursalId !== ctx.sucursalId) {
      const gate = await permisoYAlcanceEnSucursal(ctx, comando.valor.sucursalId, "gestion_usuarios");
      if (!gate.ok) return error(gate.mensaje);
      alta = gate.ctx;
    }

    const resultado = await agregarOActualizarUsuarioCasoDeUso(alta, comando.valor, azarDelProceso);
    if (!resultado.ok) return aResultadoAccion(resultado);

    // El mail, DESPUÉS del commit (ADR-018): la transacción del caso de uso pudo reintentarse; un mail no se retira. Sale con la hora del pedido.
    const envio = resultado.datos.porEnviar;
    if (!envio) return aResultadoAccion(resultado);
    const salio = await enviarInvitacionYAnotar(ctx.db, { ...envio, empresaId: ctx.empresaId, emailDeQuienInvita: ctx.email, ahora: ctx.ahora });
    return salio.enviado ? aResultadoAccion(resultado) : ok(`${resultado.mensaje} El mail NO salió: reenviá la invitación desde «Invitaciones pendientes» o desde la fila del usuario.`);
  });
}

/**
 * Equivalente de actualizarActivoUsuario (Core.js:1181-1211). Desde el Hito 3 (Fase I, I.5b) es un adaptador: `conPermiso("activar_usuario_sucursal")` →
 * caso de uso (`casos-de-uso/actualizar-activo-membresia.ts`: la membresía de la sucursal activa, el techo, el gerente para reactivar a un admin y las
 * invariantes de gobierno, en la transacción de gobierno) → `aResultadoAccion`. Sin guard: solo recibe un id y un booleano (`SIN_GUARD`).
 */
export async function actualizarActivoMembresia(membresiaId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("activar_usuario_sucursal", async (ctx) => aResultadoAccion(await actualizarActivoMembresiaCasoDeUso(ctx, { membresiaId, activo })));
}

/**
 * El campo "notas" de la membresía existía en el modelo (se llenaba solo
 * por flujos automáticos de bootstrap) pero no se podía ver ni editar
 * desde la UI — hallazgo de la auditoría de motor2. Editar las notas de un
 * admin o del gerente tiene el mismo techo que tocarlos (G2, D6).
 *
 * Desde el Hito 3 (Fase I, I.5a) es un adaptador: `conPermiso("notas_usuario_sucursal")` → caso de uso (`casos-de-uso/actualizar-notas-membresia.ts`:
 * la membresía de la sucursal activa, el techo de gestión y, en una transacción, la escritura con su auditoría —decisión B4 del dueño—) → `aResultadoAccion`. Sin guard: recibe un id y un texto libre que nunca se
 * validó en la acción (`SIN_GUARD`).
 */
export async function actualizarNotasMembresia(membresiaId: string, notas: string): Promise<ResultadoAccion> {
  return conPermiso("notas_usuario_sucursal", async (ctx) => aResultadoAccion(await actualizarNotasMembresiaCasoDeUso(ctx, { membresiaId, notas })));
}

/**
 * Kill-switch de la cuenta EN ESTA EMPRESA (`UsuarioEmpresa.activo`) — a diferencia de actualizarActivoMembresia (una fila
 * UsuarioSucursal, una sucursal a la vez), corta el acceso a TODAS las sucursales de la empresa de una sola vez. La misma
 * persona puede seguir activa en otra empresa: `User.activoGlobal` (cuenta de toda la plataforma) no se toca desde acá, lo
 * decide la plataforma. El corte lo hace `obtenerContextoUsuario`, que solo arma contexto con la pertenencia activa.
 *
 * Es una acción de contexto empresa (`apagar_cuenta_empresa`): no depende de en qué sucursal esté parado quien la pide. Por eso quien actúa
 * se mide por ser admin en CUALQUIER sucursal de la empresa (o gerente), y a quien se toca, igual.
 *
 * Desde el Hito 3 (Fase I, I.5c) es un adaptador: `conPermisoDeEmpresa("apagar_cuenta_empresa")` → caso de uso
 * (`casos-de-uso/actualizar-activo-usuario-en-empresa.ts`: la pertenencia, el techo, el gerente que no se apaga, el gerente para reactivar a un admin y las
 * invariantes de gobierno, en la transacción de gobierno) → `aResultadoAccion`. Sin guard: solo recibe un id y un booleano (`SIN_GUARD`).
 */
export async function actualizarActivoUsuarioEnEmpresa(usuarioId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("apagar_cuenta_empresa", async (ctx) => aResultadoAccion(await actualizarActivoUsuarioEnEmpresaCasoDeUso(ctx, { usuarioId, activo })));
}

/**
 * Traspasa la gerencia de la empresa a otro usuario (el gerente actual deja de serlo). Solo la pide el gerente actual: `traspasar_gerencia`
 * es una acción de piso gerente, que no pasa por la matriz de permisos (la autoridad de empresa no se delega). Se confirma tipeando el email
 * del destino. La baja del actual y el alta del nuevo van en una sola transacción, y queda en la auditoría de la empresa.
 *
 * Desde el Hito 3 (Fase I, I.5d) es un adaptador: `conPermisoDeEmpresa("traspasar_gerencia")` → caso de uso (`casos-de-uso/transferir-gerencia.ts`: destino,
 * email confirmado, invariantes de gobierno, el traspaso —paso compartido `transferir-gerencia-en-tx.ts`— y su auditoría) → `aResultadoAccion`. Sin guard:
 * recibe un id y el email tipeado, que el caso de uso compara dentro de la transacción después de resolver al destino (`SIN_GUARD`).
 */
export async function transferirGerencia(usuarioDestinoId: string, emailConfirmado: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("traspasar_gerencia", async (ctx) => aResultadoAccion(await transferirGerenciaCasoDeUso(ctx, { usuarioDestinoId, emailConfirmado })));
}

// ---- Invitaciones de usuario y de vinculación (E8, ADR-024) ----

/** Manda el mail pendiente (si hay) después del commit y devuelve el mensaje final: si no salió, lo dice. */
async function enviarYResponder(
  ctx: Parameters<Parameters<typeof conPermiso>[1]>[0],
  resultado: ResultadoAccion,
  envio: InvitacionPorEnviar | null,
  ahora: Date,
): Promise<ResultadoAccion> {
  if (!resultado.ok || !envio) return resultado;
  const salio = await enviarInvitacionYAnotar(ctx.db, { ...envio, empresaId: ctx.empresaId, emailDeQuienInvita: ctx.email, ahora });
  return salio.enviado ? resultado : ok(`${resultado.mensaje} El mail NO salió: probá de nuevo con «Reenviar».`);
}

/**
 * Reenviar: rota el token (el enlace anterior deja de servir), renueva los 7 días y vuelve a firmar la invitación a nombre de quien reenvía. Desde el Hito 3 (Fase I,
 * I.5h) es un adaptador: `conPermiso("gestion_usuarios")` → caso de uso (`casos-de-uso/reenviar-invitacion.ts`: invitación gestionable, freno de un minuto y rotación
 * con su auditoría, en la transacción de gobierno) → el mail recién con la transacción confirmada → `aResultadoAccion` (o el aviso de que no salió). Sin guard: solo
 * recibe un id (`SIN_GUARD`).
 */
export async function reenviarInvitacionPendiente(invitacionId: string): Promise<ResultadoAccion> {
  return conPermiso("gestion_usuarios", async (ctx) => {
    const resultado = await reenviarInvitacionPendienteCasoDeUso(ctx, { invitacionId }, azarDelProceso);
    if (!resultado.ok) return aResultadoAccion(resultado);
    return enviarYResponder(ctx, aResultadoAccion(resultado), resultado.datos.porEnviar, ctx.ahora);
  });
}

/**
 * Revocar: el enlace deja de servir. Para volver a invitar a esa persona se vuelve a agregar. Desde el Hito 3 (Fase I, I.5g) es un adaptador:
 * `conPermiso("gestion_usuarios")` → caso de uso (`casos-de-uso/revocar-invitacion.ts`: la invitación gestionable desde la sucursal activa y la revocación con su
 * auditoría, en la transacción de gobierno) → `aResultadoAccion`. Sin guard: solo recibe un id (`SIN_GUARD`).
 */
export async function revocarInvitacion(invitacionId: string): Promise<ResultadoAccion> {
  return conPermiso("gestion_usuarios", async (ctx) => aResultadoAccion(await revocarInvitacionCasoDeUso(ctx, { invitacionId })));
}

/**
 * «Invitar a vincular»: a un miembro que todavía no entró con Google (un precargado) se le manda la invitación para que vincule su cuenta. Desde el Hito 3 (Fase I, I.5i)
 * es un adaptador: `conPermiso("gestion_usuarios")` → caso de uso (`casos-de-uso/invitar-a-vincular.ts`: membresía, techo, freno de un minuto e invitación con su
 * auditoría, en la transacción de gobierno) → el mail recién con la transacción confirmada → `aResultadoAccion` (o el aviso de que no salió). Sin guard: solo recibe un id
 * (`SIN_GUARD`).
 */
export async function invitarAVincular(membresiaId: string): Promise<ResultadoAccion> {
  return conPermiso("gestion_usuarios", async (ctx) => {
    const resultado = await invitarAVincularCasoDeUso(ctx, { membresiaId }, azarDelProceso);
    if (!resultado.ok) return aResultadoAccion(resultado);
    return enviarYResponder(ctx, aResultadoAccion(resultado), resultado.datos.porEnviar, ctx.ahora);
  });
}
