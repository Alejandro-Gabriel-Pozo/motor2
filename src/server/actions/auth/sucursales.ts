"use server";

import { guardComandoCrearSucursal, guardComandoRenombrarSucursal } from "@/core/features/sucursales/sucursal.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { revalidarCartasPublicas } from "../carta/revalidar";
import { error, type ResultadoAccion } from "../tipos";
import { requerirVerAlguna } from "../con-sesion";
import { crearSucursalConAdminCasoDeUso } from "./casos-de-uso/crear-sucursal-con-admin";
import { actualizarActivoSucursalCasoDeUso } from "./casos-de-uso/actualizar-activo-sucursal";
import { renombrarSucursalCasoDeUso } from "./casos-de-uso/renombrar-sucursal";

/**
 * Todas las sucursales de la empresa (activas o no). H8 (decisión D-3 del dueño): exige el «Ver» de alguna de sus dos pantallas, Usuarios
 * (`gestion_usuarios`, en la sucursal activa) o Sucursales (`alta_sucursal`, de empresa); el operador deja de ver la lista. El alta de producto,
 * que solo necesitaba cuántas son, las cuenta con `contarSucursales` (server/consultas).
 */
export async function listarSucursales() {
  const ctx = await requerirVerAlguna(["gestion_usuarios", "alta_sucursal"]);
  // S-15 (plan de endurecimiento, T7): solo lo que las dos pantallas dibujan (GT-25: toda lectura `listar*` declara su `select`; más campos: se AGREGAN acá).
  return ctx.db.sucursal.findMany({ select: { id: true, nombre: true, activo: true }, orderBy: { nombre: "asc" } });
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
 *
 * Desde el Hito 3 (Fase I, I.4) es un adaptador: `conPermisoDeEmpresa("activar_sucursal")` → caso de uso (`casos-de-uso/actualizar-activo-sucursal.ts`:
 * la sucursal del que actúa, el gerente sin sucursal activa y las invariantes de gobierno, en la transacción de gobierno) → revalidación de la carta
 * pública si salió bien → `aResultadoAccion`. Sin guard: solo recibe un id y un booleano (`SIN_GUARD`).
 */
export async function actualizarActivoSucursal(sucursalId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("activar_sucursal", async (ctx) => {
    const resultado = await actualizarActivoSucursalCasoDeUso(ctx, { sucursalId, activo });
    if (resultado.ok) revalidarCartasPublicas(); // la carta pública de una sucursal desactivada tiene que dejar de verse al instante, no a los 5 minutos
    // A propósito SIN `refrescarVistaSiHaceFalta()`: su único llamador (`ActivarDesactivarFila`) ya hace `router.refresh()` en el cliente, y
    // otras pantallas que reusen ese componente heredan lo mismo (ver la regla en refrescar.ts).
    return aResultadoAccion(resultado);
  });
}

/**
 * Renombrar una sucursal existente — antes solo se podía elegir el nombre una vez, al crearla. Desde el Hito 3 (Fase I, I.4) es un adaptador:
 * `conPermisoDeEmpresa("renombrar_sucursal")` → formato (`guardComandoRenombrarSucursal`, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/renombrar-sucursal.ts`) → revalidación de la carta pública y refresco de la vista si salió bien → `aResultadoAccion`.
 */
export async function renombrarSucursal(sucursalId: string, nombreNuevo: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("renombrar_sucursal", async (ctx) => {
    const comando = guardComandoRenombrarSucursal(nombreNuevo);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await renombrarSucursalCasoDeUso(ctx, { sucursalId, nombre: comando.valor.nombre });
    if (resultado.ok) {
      revalidarCartasPublicas();
      refrescarVistaSiHaceFalta(); // ver crearSucursalConAdmin
    }
    return aResultadoAccion(resultado);
  });
}
