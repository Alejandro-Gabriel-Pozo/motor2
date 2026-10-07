"use server";

import { texto, validarTextoCatalogo } from "@/core/texto";
import { guardComandoCrearSucursal } from "@/core/features/sucursales/sucursal.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { gerentesQueQuedaranSinSucursalActiva } from "@/core/permisos/gerencia";
import { conInvariantesDeGobierno } from "@/core/permisos/invariantes";
import { conGobierno } from "../con-gobierno";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { revalidarCartasPublicas } from "../carta/revalidar";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerAlguna } from "../con-sesion";
import { crearSucursalConAdminCasoDeUso } from "./casos-de-uso/crear-sucursal-con-admin";

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
 *
 * Desde el Hito 3 (Fase I, I.4 de `docs/plan-hito-3-pureza.md`) es un adaptador: `conPermisoDeEmpresa("alta_sucursal")` → formato
 * (`guardComandoCrearSucursal`, DENTRO del envoltorio) → caso de uso (`casos-de-uso/crear-sucursal-con-admin.ts`: nombre libre, disponibilidad
 * inicial, transacción de gobierno con las invariantes, persistencia y auditoría) → refresco de la vista → `aResultadoAccion`.
 */
export async function crearSucursalConAdmin(input: {
  nombre: string;
  emailPrimerAdmin: string;
}): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("alta_sucursal", async (ctx) => {
    const comando = guardComandoCrearSucursal(input);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await crearSucursalConAdminCasoDeUso(ctx, comando.valor);
    // Se llama desde un closure "use server" de la página, sin redirigir: sin esto la tabla no cambia en un navegador real (ver refrescar.ts).
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
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
