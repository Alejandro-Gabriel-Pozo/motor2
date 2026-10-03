"use server";

import { texto } from "@/core/texto";
import { requierePermiso } from "@/core/permisos/gate";
import { transferirGerenciaDeEmpresa } from "@/core/permisos/gerencia";
import { conInvariantesDeGobierno } from "@/core/permisos/invariantes";
import {
  actorEnLaEmpresa,
  actorEnSucursal,
  mensajeSiNoPuedeAsignarRol,
  mensajeSiNoPuedeGestionar,
  mensajeSiReactivaAdminSinSerGerente,
  mensajeSiSeApagaAlGerente,
  objetivoEnLaEmpresa,
  objetivoEnSucursal,
  reactivaAUnAdmin,
} from "@/core/permisos/gestion-de-usuarios";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermiso, conPermisoDeEmpresa } from "../con-permiso";
import { conGobierno } from "../con-gobierno";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";

/**
 * Techo de privilegio y salvaguardas de esta pantalla (Bloque G, G2): las acciones no miran roles ni comparan nombres. Leen el estado y escriben
 * dentro de `conGobierno` (transacción serializable con reintento) y preguntan a `core/permisos/gestion-de-usuarios` (el techo: nadie toca a quien
 * está por encima, el rol admin lo da un admin o el gerente, reactivar a un admin es del gerente) y a `core/permisos/invariantes` (la empresa
 * conserva un admin efectivo, el gerente una sucursal activa y su condición de admin). Adentro no va ningún efecto externo: el bloque puede reintentarse.
 */

export async function listarUsuariosDeSucursal(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "gestion_usuarios");
  return ctx.db.usuarioSucursal.findMany({
    where: { sucursalId },
    // Solo lo que dibuja la tabla: la fila completa de User (id de cuenta, foto, verificación, estado global) viajaba al navegador.
    select: { id: true, activo: true, usuario: { select: { email: true } }, rol: { select: { nombre: true } } },
    orderBy: { creadoEn: "asc" },
  });
}

/**
 * Equivalente de guardarUsuarioDesdePanel (Core.js:1142-1180): agrega o
 * actualiza la membresía de un email en una sucursal. Si el email no
 * corresponde a ningún User todavía (no inició sesión nunca), se crea el
 * registro igual — queda vinculado automáticamente la primera vez que esa
 * persona haga login con Google (ver allowDangerousEmailAccountLinking en
 * src/lib/auth.ts). El User se crea recién cuando todo lo demás se validó
 * y en la misma transacción que la membresía: un rechazo no deja nada creado.
 */
export async function agregarOActualizarUsuario(input: {
  email: string;
  sucursalId: string;
  rolId: string;
  notas?: string;
}): Promise<ResultadoAccion> {
  return conPermiso("gestion_usuarios", async (ctx) => {
    const email = texto(input.email).toLowerCase();
    if (!email) return error("El email es obligatorio.");

    // `conPermiso` solo validó la sucursal ACTIVA: el alta apunta a la que eligió el formulario (viene del cliente), y ahí el
    // rol de quien la hace puede no tener `gestion_usuarios` (o no tener ni membresía).
    if (input.sucursalId !== ctx.sucursalId) {
      const gate = await requierePermiso(ctx.usuarioId, input.sucursalId, "gestion_usuarios", ctx.db);
      if (!gate.ok) return error(gate.mensaje);
    }

    return conGobierno(ctx, async (tx) => {
      const rol = await tx.rol.findFirst({ where: { id: input.rolId, empresaId: ctx.empresaId } });
      if (!rol || !rol.activo) return error("Rol inválido o inactivo.");

      const sucursal = await tx.sucursal.findFirst({ where: { id: input.sucursalId, empresaId: ctx.empresaId }, select: { id: true, nombre: true } });
      if (!sucursal) return error("Sucursal inválida.");

      const usuarioPrevio = await tx.user.findUnique({ where: { email }, select: { id: true } });
      const existente = usuarioPrevio
        ? await tx.usuarioSucursal.findUnique({ where: { usuarioId_sucursalId: { usuarioId: usuarioPrevio.id, sucursalId: input.sucursalId } }, include: { rol: true } })
        : null;
      const pertenenciaPrevia = usuarioPrevio
        ? await tx.usuarioEmpresa.findUnique({ where: { usuarioId_empresaId: { usuarioId: usuarioPrevio.id, empresaId: ctx.empresaId } }, select: { activo: true } })
        : null;

      const actor = actorEnSucursal(ctx, input.sucursalId);
      const objetivo = await objetivoEnSucursal(tx, ctx.empresaId, usuarioPrevio?.id ?? null, existente?.rol ?? null);
      const rechazo = mensajeSiNoPuedeAsignarRol(actor, rol) ?? mensajeSiNoPuedeGestionar(actor, objetivo);
      if (rechazo) return error(rechazo);

      // Reactivar a un administrador (su membresía en esta sucursal, o su cuenta en la empresa) es solo del gerente: si no, quien tiene
      // `gestion_usuarios` desharía por esta vía lo que el gerente apagó con `apagar_cuenta_empresa`.
      const reactivaAdmin = usuarioPrevio ? await reactivaAUnAdmin(tx, ctx.empresaId, usuarioPrevio.id, { membresia: existente, cuentaDeEmpresa: pertenenciaPrevia }) : false;
      const rechazoReactivar = mensajeSiReactivaAdminSinSerGerente(actor, reactivaAdmin);
      if (rechazoReactivar) return error(rechazoReactivar);

      return conInvariantesDeGobierno(tx, ctx.empresaId, async () => {
        const usuario = await tx.user.upsert({ where: { email }, update: {}, create: { email } });
        // Las dos pertenencias van juntas: sin la de empresa el usuario no tendría contexto (core/auth/contexto.ts). Con su auditoría, en la misma transacción.
        await tx.usuarioEmpresa.upsert({
          where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: ctx.empresaId } },
          update: { activo: true },
          create: { usuarioId: usuario.id, empresaId: ctx.empresaId },
        });
        const membresia = await tx.usuarioSucursal.upsert({
          where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId: input.sucursalId } },
          update: { rolId: rol.id, ...(input.notas !== undefined && { notas: input.notas }), activo: true },
          create: { usuarioId: usuario.id, sucursalId: input.sucursalId, empresaId: ctx.empresaId, rolId: rol.id, ...(input.notas !== undefined && { notas: input.notas }) },
        });
        await registrarCambioAuditado(tx, {
          entidad: "UsuarioEmpresa", entidadId: usuario.id, campo: "activo", descripcion: `Cuenta de "${email}" en la empresa`,
          valorAnterior: pertenenciaPrevia ? pertenenciaPrevia.activo : null, valorNuevo: true, actorId: ctx.usuarioId, sucursalId: null,
        });
        const descripcion = `Usuario "${email}" en la sucursal "${sucursal.nombre}"`;
        const comun = { entidad: "UsuarioSucursal", entidadId: membresia.id, actorId: ctx.usuarioId, sucursalId: input.sucursalId } as const;
        await registrarCambioAuditado(tx, { ...comun, campo: "rol", descripcion: `${descripcion}: rol`, valorAnterior: existente?.rol.nombre ?? null, valorNuevo: rol.nombre });
        await registrarCambioAuditado(tx, { ...comun, campo: "activo", descripcion: `${descripcion}: activo`, valorAnterior: existente ? existente.activo : null, valorNuevo: true });
        return ok(`Usuario "${email}" guardado en la sucursal.`);
      });
    });
  });
}

/** Equivalente de actualizarActivoUsuario (Core.js:1181-1211). */
export async function actualizarActivoMembresia(membresiaId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("activar_usuario_sucursal", async (ctx) =>
    conGobierno(ctx, async (tx) => {
      const membresia = await tx.usuarioSucursal.findUnique({ where: { id: membresiaId }, include: { rol: true } });
      if (!membresia || membresia.sucursalId !== ctx.sucursalId) return error("No se encontró esa membresía.");

      const actor = actorEnSucursal(ctx, ctx.sucursalId);
      const objetivo = await objetivoEnSucursal(tx, ctx.empresaId, membresia.usuarioId, membresia.rol);
      const rechazo = mensajeSiNoPuedeGestionar(actor, objetivo);
      if (rechazo) return error(rechazo);
      if (activo) {
        const reactivaAdmin = await reactivaAUnAdmin(tx, ctx.empresaId, membresia.usuarioId, { membresia });
        const rechazoReactivar = mensajeSiReactivaAdminSinSerGerente(actor, reactivaAdmin);
        if (rechazoReactivar) return error(rechazoReactivar);
      }

      // Que la empresa conserve un admin efectivo y que el gerente conserve una sucursal activa lo hacen cumplir las invariantes.
      return conInvariantesDeGobierno(tx, ctx.empresaId, async () => {
        await tx.usuarioSucursal.update({ where: { id: membresiaId }, data: { activo } });
        const usuario = await tx.user.findUniqueOrThrow({ where: { id: membresia.usuarioId }, select: { email: true } });
        await registrarCambioAuditado(tx, {
          entidad: "UsuarioSucursal", entidadId: membresiaId, campo: "activo", descripcion: `Usuario "${usuario.email}" en la sucursal "${ctx.sucursalNombre}": activo`,
          valorAnterior: membresia.activo, valorNuevo: activo, actorId: ctx.usuarioId, sucursalId: membresia.sucursalId,
        });
        return ok(`Usuario ${activo ? "activado" : "desactivado"}.`);
      });
    }),
  );
}

/**
 * El campo "notas" de la membresía existía en el modelo (se llenaba solo
 * por flujos automáticos de bootstrap) pero no se podía ver ni editar
 * desde la UI — hallazgo de la auditoría de motor2. Editar las notas de un
 * admin o del gerente tiene el mismo techo que tocarlos (G2, D6).
 */
export async function actualizarNotasMembresia(membresiaId: string, notas: string): Promise<ResultadoAccion> {
  return conPermiso("notas_usuario_sucursal", async (ctx) => {
    const membresia = await ctx.db.usuarioSucursal.findUnique({ where: { id: membresiaId }, include: { rol: true } });
    if (!membresia || membresia.sucursalId !== ctx.sucursalId) return error("No se encontró esa membresía.");

    const objetivo = await objetivoEnSucursal(ctx.db, ctx.empresaId, membresia.usuarioId, membresia.rol);
    const rechazo = mensajeSiNoPuedeGestionar(actorEnSucursal(ctx, ctx.sucursalId), objetivo);
    if (rechazo) return error(rechazo);

    await ctx.db.usuarioSucursal.update({ where: { id: membresiaId }, data: { notas: texto(notas) || null } });
    return ok("Notas actualizadas.");
  });
}

/**
 * Kill-switch de la cuenta EN ESTA EMPRESA (`UsuarioEmpresa.activo`) — a diferencia de actualizarActivoMembresia (una fila
 * UsuarioSucursal, una sucursal a la vez), corta el acceso a TODAS las sucursales de la empresa de una sola vez. La misma
 * persona puede seguir activa en otra empresa: `User.activoGlobal` (cuenta de toda la plataforma) no se toca desde acá, lo
 * decide la plataforma. El corte lo hace `obtenerContextoUsuario`, que solo arma contexto con la pertenencia activa.
 *
 * Es una acción de contexto empresa (`apagar_cuenta_empresa`): no depende de en qué sucursal esté parado quien la pide. Por eso quien actúa
 * se mide por ser admin en CUALQUIER sucursal de la empresa (o gerente), y a quien se toca, igual.
 */
export async function actualizarActivoUsuarioEnEmpresa(usuarioId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("apagar_cuenta_empresa", async (ctx) =>
    conGobierno(ctx, async (tx) => {
      // `User` no tiene RLS (y `UsuarioEmpresa` tiene RLS recién desde la migración rls_usuario_empresa): el `empresaId` de la clave sigue siendo obligatorio.
      const pertenencia = await tx.usuarioEmpresa.findUnique({
        where: { usuarioId_empresaId: { usuarioId, empresaId: ctx.empresaId } },
        include: { usuario: true },
      });
      if (!pertenencia) return error("No se encontró ese usuario.");
      const usuario = pertenencia.usuario;

      const actor = actorEnLaEmpresa(ctx);
      const objetivo = await objetivoEnLaEmpresa(tx, ctx.empresaId, usuarioId);
      const rechazo = mensajeSiNoPuedeGestionar(actor, objetivo) ?? (activo ? null : mensajeSiSeApagaAlGerente(objetivo));
      if (rechazo) return error(rechazo);
      if (activo && !pertenencia.activo) {
        const rechazoReactivar = mensajeSiReactivaAdminSinSerGerente(actor, await reactivaAUnAdmin(tx, ctx.empresaId, usuarioId, { cuentaDeEmpresa: pertenencia }));
        if (rechazoReactivar) return error(rechazoReactivar);
      }

      return conInvariantesDeGobierno(tx, ctx.empresaId, async () => {
        await tx.usuarioEmpresa.update({ where: { id: pertenencia.id }, data: { activo } });
        await registrarCambioAuditado(tx, {
          entidad: "UsuarioEmpresa", entidadId: usuarioId, campo: "activo", descripcion: `Cuenta de "${usuario.email}" en la empresa`,
          valorAnterior: pertenencia.activo, valorNuevo: activo, actorId: ctx.usuarioId, sucursalId: null,
        });
        return ok(`Cuenta de "${usuario.email}" ${activo ? "reactivada" : "desactivada"} en la empresa.`);
      });
    }),
  );
}

/**
 * Traspasa la gerencia de la empresa a otro usuario (el gerente actual deja de serlo). Solo la pide el gerente actual: `traspasar_gerencia`
 * es una acción de piso gerente, que no pasa por la matriz de permisos (la autoridad de empresa no se delega). Se confirma tipeando el email
 * del destino. La baja del actual y el alta del nuevo van en una sola transacción, y queda en la auditoría de la empresa.
 */
export async function transferirGerencia(usuarioDestinoId: string, emailConfirmado: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("traspasar_gerencia", async (ctx) =>
    conGobierno(ctx, async (tx) => {
      // Se confirma tipeando el email de quien recibe la gerencia: el gerente que traspasa ya no puede deshacerlo solo.
      const destino = await tx.usuarioEmpresa.findUnique({
        where: { usuarioId_empresaId: { usuarioId: usuarioDestinoId, empresaId: ctx.empresaId } },
        select: { usuario: { select: { email: true } } },
      });
      if (!destino) return error("Ese usuario no pertenece a esta empresa.");
      if (emailConfirmado.trim().toLowerCase() !== destino.usuario.email.trim().toLowerCase()) {
        return error("El email no coincide con el de la persona elegida: no se traspasó la gerencia.");
      }
      return conInvariantesDeGobierno(tx, ctx.empresaId, async () => {
        const r = await transferirGerenciaDeEmpresa(tx, { empresaId: ctx.empresaId, usuarioDestinoId });
        if (!r.ok) return error(r.mensaje);
        await registrarCambioAuditado(tx, {
          entidad: "UsuarioEmpresa",
          entidadId: usuarioDestinoId,
          descripcion: "Gerente de la empresa",
          campo: "rolEmpresa",
          valorAnterior: ctx.email,
          valorNuevo: destino.usuario.email,
          actorId: ctx.usuarioId,
          sucursalId: null,
        });
        return ok(r.mensaje);
      });
    }),
  );
}
