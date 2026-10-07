"use server";

import { texto, validarTextoCatalogo } from "@/core/texto";
import { productosUniversales, type FilaDisponibilidadEnSucursal } from "@/core/catalogo/public";
import { conPermisoDeEmpresa } from "../con-permiso";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { gerentesQueQuedaranSinSucursalActiva } from "@/core/permisos/gerencia";
import { actorEnLaEmpresa, buscarRolAdmin, mensajeSiReactivaAdminSinSerGerente, reactivaAUnAdmin } from "@/core/permisos/gestion-de-usuarios";
import { conInvariantesDeGobierno } from "@/core/permisos/invariantes";
import { conGobierno } from "../con-gobierno";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { revalidarCartasPublicas } from "../carta/revalidar";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerAlguna } from "../con-sesion";

/**
 * Todas las sucursales de la empresa (activas o no). H8 (decisión D-3 del dueño): exige el «Ver» de alguna de sus dos pantallas, Usuarios
 * (`gestion_usuarios`, en la sucursal activa) o Sucursales (`alta_sucursal`, de empresa); el operador deja de ver la lista. El alta de producto,
 * que solo necesitaba cuántas son, las cuenta con `contarSucursales` (server/consultas).
 */
export async function listarSucursales() {
  const ctx = await requerirVerAlguna(["gestion_usuarios", "alta_sucursal"]);
  return ctx.db.sucursal.findMany({ orderBy: { nombre: "asc" } });
}

/**
 * Acción nueva (no existía en Apps Script — ver plan, "Bootstrap de admin
 * sin hueco de seguridad", punto 2): reemplaza el paso manual de hoy
 * (crear-contenedor.js) por una acción real del sistema, exclusiva de un
 * admin ya existente, que crea la sucursal Y asigna su primer admin en la
 * MISMA transacción — nunca queda una sucursal sin ningún admin (mismo
 * principio que ya protege usuarios.ts/roles.ts).
 */
export async function crearSucursalConAdmin(input: {
  nombre: string;
  emailPrimerAdmin: string;
}): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("alta_sucursal", async (ctx) => {
    const nombre = texto(input.nombre);
    if (!nombre) return error("El nombre de la sucursal no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombre, "El nombre de la sucursal");
    if (invalido) return error(invalido);

    const email = texto(input.emailPrimerAdmin).toLowerCase();
    if (!email) return error("El email del primer admin de la sucursal es obligatorio.");

    const existente = await ctx.db.sucursal.findFirst({ where: { empresaId: ctx.empresaId, nombre } });
    if (existente) return error(`Ya existe una sucursal "${nombre}".`);

    // Decisión 4 del dueño (2026-09-23, docs/plan-disponibilidad-por-sucursal-2026-09-23.md §10): la sucursal nueva arranca
    // SOLO con los productos que ya son "universales" — disponibles en TODAS las sucursales activas de hoy, sin excepción.
    // Nunca con los que son mayoría pero no unanimidad: un producto sucursal-específico no se contagia solo por ser común.
    // Se resuelve ANTES de la transacción (lectura pura, no hace falta el aislamiento) y con `sucursalIdsActivas` vacío
    // (la primerísima sucursal del sistema) `productosUniversales` da siempre `[]` — arranca en cero, no en "todos".
    const sucursalIdsActivas = (await ctx.db.sucursal.findMany({ where: { empresaId: ctx.empresaId, activo: true }, select: { id: true } })).map((s) => s.id);
    const filasDisponibilidad = sucursalIdsActivas.length
      ? await ctx.db.disponibilidadProducto.findMany({ where: { sucursalId: { in: sucursalIdsActivas } }, select: { productoId: true, sucursalId: true, disponible: true } })
      : [];
    const disponibilidadPorProducto = new Map<string, FilaDisponibilidadEnSucursal[]>();
    for (const f of filasDisponibilidad) {
      const lista = disponibilidadPorProducto.get(f.productoId) ?? [];
      lista.push(f);
      disponibilidadPorProducto.set(f.productoId, lista);
    }
    const universales = productosUniversales(disponibilidadPorProducto, sucursalIdsActivas);

    const resultado = await conGobierno(ctx, (tx) => conInvariantesDeGobierno(tx, ctx.empresaId, async () => {
      const rolAdmin = await buscarRolAdmin(tx, ctx.empresaId);
      if (!rolAdmin || !rolAdmin.activo) {
        return error("No se encontró el rol de administrador de la empresa (¿corriste el seed?) — no se puede asignar el primer admin.");
      }

      // Nombrar primer admin a alguien cuya cuenta en la empresa está apagada la reactivaría: si fue admin, eso es solo del gerente (mismo criterio que `usuarios.ts`).
      const usuarioPrevio = await tx.user.findUnique({ where: { email }, select: { id: true } });
      const pertenenciaPrevia = usuarioPrevio
        ? await tx.usuarioEmpresa.findUnique({ where: { usuarioId_empresaId: { usuarioId: usuarioPrevio.id, empresaId: ctx.empresaId } }, select: { activo: true } })
        : null;
      // E8 (ADR-024): la sucursal nace con un admin que YA es parte de la empresa. A alguien nuevo no se lo da de alta acá (no hay User ni membresía hasta que acepte una invitación):
      // primero se lo invita desde Usuarios. Así tampoco existe nunca una sucursal sin administrador.
      if (!usuarioPrevio || !pertenenciaPrevia) {
        return error(`"${email}" todavía no forma parte de la empresa. Creá la sucursal con vos o con un administrador que ya esté en la empresa y después invitá a "${email}" desde Usuarios.`);
      }
      const reactivaAdmin = await reactivaAUnAdmin(tx, ctx.empresaId, usuarioPrevio.id, { cuentaDeEmpresa: pertenenciaPrevia });
      const rechazoReactivar = mensajeSiReactivaAdminSinSerGerente(actorEnLaEmpresa(ctx), reactivaAdmin);
      if (rechazoReactivar) return error(rechazoReactivar);

      const sucursal = await tx.sucursal.create({ data: { nombre, empresaId: ctx.empresaId } });
      await tx.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: usuarioPrevio.id, empresaId: ctx.empresaId } }, data: { activo: true } });
      const membresia = await tx.usuarioSucursal.create({
        data: {
          usuarioId: usuarioPrevio.id,
          sucursalId: sucursal.id,
          empresaId: ctx.empresaId,
          rolId: rolAdmin.id,
          notas: "Alta automática al crear la sucursal.",
        },
      });
      await registrarCambioAuditado(tx, {
        entidad: "Sucursal", entidadId: sucursal.id, campo: "activo", descripcion: `Sucursal "${nombre}": alta`,
        valorAnterior: null, valorNuevo: true, actorId: ctx.usuarioId, sucursalId: null,
      });
      await registrarCambioAuditado(tx, {
        entidad: "UsuarioEmpresa", entidadId: usuarioPrevio.id, campo: "activo", descripcion: `Cuenta de "${email}" en la empresa`,
        valorAnterior: pertenenciaPrevia.activo, valorNuevo: true, actorId: ctx.usuarioId, sucursalId: null,
      });
      await registrarCambioAuditado(tx, {
        entidad: "UsuarioSucursal", entidadId: membresia.id, campo: "rol", descripcion: `Usuario "${email}" en la sucursal "${nombre}": rol`,
        valorAnterior: null, valorNuevo: rolAdmin.nombre, actorId: ctx.usuarioId, sucursalId: sucursal.id,
      });
      if (universales.length) {
        await tx.disponibilidadProducto.createMany({ data: universales.map((productoId) => ({ sucursalId: sucursal.id, empresaId: ctx.empresaId, productoId, disponible: true })) });
      }
      return ok("");
    }));
    if (!resultado.ok) return resultado;

    // Se llama desde un closure "use server" de la página, sin redirigir: sin esto la tabla no cambia en un navegador real (ver refrescar.ts).
    refrescarVistaSiHaceFalta();
    return ok(`Sucursal "${nombre}" creada, con "${email}" como primer admin.`);
  });
}

/**
 * Antes no existía ninguna forma de desactivar una sucursal (solo alta) —
 * hallazgo de la auditoría de motor2, con impacto real: Sucursal.activo ya
 * se usa como filtro (ej. el listado de sucursales destino en traspasos) pero
 * no había ningún botón para ponerlo en false.
 */
export async function actualizarActivoSucursal(sucursalId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("activar_sucursal", async (ctx) => {
    const resultado = await conGobierno(ctx, async (tx) => {
      const sucursal = await tx.sucursal.findUnique({ where: { id: sucursalId } });
      if (!sucursal) return error("No se encontró esa sucursal.");

      // `obtenerContextoUsuario` solo cuenta las membresías de sucursales activas: quien desactiva la suya (y no tiene otra)
      // queda sin contexto en toda la aplicación y ya no puede volver a activarla, solo desde la base de datos.
      if (!activo && sucursalId === ctx.sucursalId) {
        return error(
          `No podés desactivar la sucursal en la que estás ahora ("${sucursal.nombre}"): te quedarías sin acceso a la aplicación. Hacelo desde otra sucursal, o pedile a otro admin.`
        );
      }

      // El gerente también necesita contexto: apagar la última sucursal activa donde tiene membresía lo deja sin acceso y la empresa sin quien la gestione.
      if (!activo && sucursal.activo) {
        const gerentes = await gerentesQueQuedaranSinSucursalActiva(tx, ctx.empresaId, sucursalId);
        if (gerentes.length) {
          return error(`No se puede desactivar "${sucursal.nombre}": el gerente de la empresa (${gerentes.join(", ")}) se quedaría sin ninguna sucursal activa. Asignale antes otra sucursal activa.`);
        }
      }

      // D9: apagar una sucursal también puede dejar a la empresa sin admin efectivo (a) o sin sucursal al gerente (b): se mide antes y después.
      await conInvariantesDeGobierno(tx, ctx.empresaId, async () => {
        await tx.sucursal.update({ where: { id: sucursalId }, data: { activo } });
        await registrarCambioAuditado(tx, {
          entidad: "Sucursal", entidadId: sucursalId, campo: "activo", descripcion: `Sucursal "${sucursal.nombre}": activa`,
          valorAnterior: sucursal.activo, valorNuevo: activo, actorId: ctx.usuarioId, sucursalId: null,
        });
      });
      return ok(`Sucursal "${sucursal.nombre}" ${activo ? "activada" : "desactivada"}.`);
    });
    if (!resultado.ok) return resultado;
    revalidarCartasPublicas(); // la carta pública de una sucursal desactivada tiene que dejar de verse al instante, no a los 5 minutos
    // A propósito SIN `refrescarVistaSiHaceFalta()`: su único llamador (`ActivarDesactivarFila`) ya hace `router.refresh()` en el cliente, y
    // otras pantallas que reusen ese componente heredan lo mismo (ver la regla en refrescar.ts).
    return resultado;
  });
}

/** Renombrar una sucursal existente — antes solo se podía elegir el nombre una vez, al crearla. */
export async function renombrarSucursal(sucursalId: string, nombreNuevo: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("renombrar_sucursal", async (ctx) => {
    const nombre = texto(nombreNuevo);
    if (!nombre) return error("El nombre no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombre, "El nombre de la sucursal");
    if (invalido) return error(invalido);

    const sucursal = await ctx.db.sucursal.findUnique({ where: { id: sucursalId } });
    if (!sucursal) return error("No se encontró esa sucursal.");

    const existente = await ctx.db.sucursal.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" }, id: { not: sucursalId } } });
    if (existente) return error(`Ya existe una sucursal "${existente.nombre}".`);

    await ctx.transaccion(async (tx) => {
      await tx.sucursal.update({ where: { id: sucursalId }, data: { nombre } });
      await registrarCambioAuditado(tx, {
        entidad: "Sucursal", entidadId: sucursalId, campo: "nombre", descripcion: `Sucursal "${sucursal.nombre}": nombre`,
        valorAnterior: sucursal.nombre, valorNuevo: nombre, actorId: ctx.usuarioId, sucursalId: null,
      });
    });
    revalidarCartasPublicas();
    refrescarVistaSiHaceFalta(); // ver crearSucursalConAdmin
    return ok(`Sucursal renombrada a "${nombre}".`);
  });
}
