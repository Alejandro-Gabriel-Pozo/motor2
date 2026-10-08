import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
const EXCEPCIONES = createRequire(__filename)("../../.dependency-cruiser-excepciones.cjs") as { ACCIONES_CON_CASO_DE_USO: { ruta: string }[] };

const RAIZ = join(__dirname, "../..");

interface Accion {
  nombre: string;
  llamadas: string[];
}

/** Las funciones async exportadas del archivo y los nombres que llama cada una (identificadores y propiedades invocadas). */
function accionesDe(codigo: string): Accion[] {
  const fuente = ts.createSourceFile("acciones.ts", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const acciones: Accion[] = [];
  for (const nodo of fuente.statements) {
    if (!ts.isFunctionDeclaration(nodo) || !nodo.name || !nodo.body) continue;
    if (!nodo.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const llamadas: string[] = [];
    const visitar = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        if (ts.isIdentifier(n.expression)) llamadas.push(n.expression.text);
        else if (ts.isPropertyAccessExpression(n.expression)) llamadas.push(n.expression.name.text);
      }
      ts.forEachChild(n, visitar);
    };
    visitar(nodo.body);
    acciones.push({ nombre: nodo.name.text, llamadas });
  }
  return acciones;
}

const llamaAUnCasoDeUso = (a: Accion) => a.llamadas.some((l) => /CasoDeUso$/.test(l));
const llamaAUnGuard = (a: Accion) => a.llamadas.some((l) => /^guardComando[A-Z]/.test(l));

/** Acciones que llaman a un caso de uso SIN guard de comando, cada una con el motivo. */
const SIN_GUARD: Record<string, string> = {
  "src/server/actions/auth/invitacion.ts#aceptarMiInvitacion":
    "Aceptar la invitación del primer gerente (B3-5): el token NO viene del formulario sino de la cookie httpOnly que puso abrirInvitacion (que ya validó su forma), y lo vuelve a validar el caso de uso contra la base (invitacionConSuBase: forma, hash, PENDIENTE). El CUIT lo valida el caso de uso con validarCuit, porque su rechazo es parte del orden de chequeos que fija la huella de aceptación (después del email y del estado de la empresa).",
  "src/server/actions/auth/invitacion.ts#aceptarMiInvitacionDeUsuario":
    "Aceptar una invitación de usuario (B3-7): la acción no recibe ningún dato del formulario; el token sale de la cookie httpOnly que puso abrirInvitacion y lo valida el caso de uso contra la base (invitacionConSuBase: forma, hash, PENDIENTE, tipo usuario).",
  "src/server/actions/permisos/roles.ts#renombrarRol":
    "Renombrar un rol (Hito 3, I.2): recibe un id y un nombre, y la regla del nombre depende de la CLAVE del rol (los nombres de fábrica solo los lleva el rol con esa clave), que el caso de uso lee dentro de la transacción serializable; además «No se encontró ese rol» va antes que cualquier rechazo del nombre. Un guard previo cambiaría ese orden de mensajes. El nombre lo normaliza y lo juzga el caso de uso (normalizarNombreDeRol + mensajeSiNombreDeRolNoPermitido), igual que antes.",
  "src/server/actions/permisos/roles.ts#actualizarActivoRol":
    "Activar o desactivar un rol (Hito 3, I.2): solo recibe un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso, «No se encontró ese rol»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/auth/sucursales.ts#actualizarActivoSucursal":
    "Activar o desactivar una sucursal (Hito 3, I.4): solo recibe un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso dentro de la transacción de gobierno, «No se encontró esa sucursal»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/auth/usuarios.ts#actualizarActivoMembresia":
    "Activar o desactivar a un usuario en la sucursal activa (Hito 3, I.5b): solo recibe un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso dentro de la transacción de gobierno, «No se encontró esa membresía»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/auth/usuarios.ts#actualizarActivoUsuarioEnEmpresa":
    "Apagar o reactivar la cuenta de una persona en la empresa (Hito 3, I.5c): solo recibe un id de usuario y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso dentro de la transacción de gobierno, «No se encontró ese usuario»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/auth/usuarios.ts#transferirGerencia":
    "Traspasar la gerencia (Hito 3, I.5d): recibe un id y el email tipeado como confirmación, que nunca se validaron en la acción: el caso de uso resuelve al destino dentro de la transacción de gobierno («Ese usuario no pertenece a esta empresa») y RECIÉN AHÍ compara el email (recortado, en minúsculas) con el suyo. Un guard previo sobre el email adelantaría su rechazo a ese mensaje.",
  "src/server/actions/auth/usuarios.ts#revocarInvitacion":
    "Revocar una invitación (Hito 3, I.5g): solo recibe un id, que nunca se validó en la acción (lo resuelve el caso de uso dentro de la transacción de gobierno, «No se encontró esa invitación pendiente»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/auth/usuarios.ts#reenviarInvitacionPendiente":
    "Reenviar una invitación (Hito 3, I.5h): solo recibe un id, que nunca se validó en la acción (lo resuelve el caso de uso dentro de la transacción de gobierno, «No se encontró esa invitación pendiente»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/auth/usuarios.ts#invitarAVincular":
    "Invitar a vincular (Hito 3, I.5i): solo recibe un id de membresía, que nunca se validó en la acción (lo resuelve el caso de uso dentro de la transacción de gobierno, «No se encontró esa membresía»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/auth/usuarios.ts#actualizarNotasMembresia":
    "Editar las notas de una membresía (Hito 3, I.5a): recibe un id y un texto libre que nunca se validó en la acción; el texto lo normaliza el caso de uso (`texto(notas) || null`) DESPUÉS de resolver la membresía y el techo, como antes. Un guard previo adelantaría esa normalización a «No se encontró esa membresía».",
  "src/server/actions/carta/promos.ts#guardarPrecioLocalPromoCarta":
    "Precio de una promo en la sucursal (Hito 4, H4C-2): la acción leía la promo ANTES de validar el precio (una promo inexistente gana sobre un precio inválido, y el piso depende de los cupos que se leen), así que la validación vive en el caso de uso, en el mismo orden. Un guard previo adelantaría el rechazo del precio a «No se encontró la promo».",
  "src/server/actions/carta/promos.ts#actualizarActivaPromoCarta":
    "Apagado general de una promo (Hito 4, H4C-3): solo recibe un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso, «No se encontró la promo.»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/carta/promos.ts#actualizarActivaPromoCartaEnSucursal":
    "Prender o apagar una promo en la sucursal (Hito 4, H4C-3): solo recibe un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso, «No se encontró la promo.»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/carta/promos.ts#guardarCuposPromoCarta":
    "Cupos de una promo (Hito 4, H4C-3): la acción leía la promo ANTES de validar los cupos (una promo inexistente gana sobre un cupo inválido) y el piso depende de los precios que se leen, así que la validación vive en el caso de uso, en el mismo orden. Un guard previo adelantaría el rechazo de un cupo a «No se encontró la promo.».",
  "src/server/actions/catalogo/rendimiento-local.ts#volverAlRendimientoCentral":
    "Volver al valor central (Hito 4, H4C-5): solo recibe el id de la línea, que nunca se validó en la acción (lo resuelve el caso de uso dentro de la transacción serializable, «No se encontró esa línea de receta.»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/catalogo/categorias-producto.ts#actualizarActivaCategoriaProducto":
    "Activar o desactivar una categoría (Hito 4, H4C-7): solo recibe un id y un booleano, que nunca se validaron en la acción (un id que no existe hace lanzar a Prisma, como antes); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/catalogo/unidades.ts#actualizarActivaUnidad":
    "Activar o desactivar una unidad (Hito 4, H4C-8): solo recibe un id y un booleano, que nunca se validaron en la acción (un id que no existe hace lanzar a Prisma, como antes); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/catalogo/insumos.ts#actualizarActivoInsumo":
    "Activar o desactivar un insumo (Hito 4, H4C-9): solo recibe un id y un booleano, que nunca se validaron en la acción (un id que no existe hace lanzar a Prisma, como antes); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/catalogo/insumos.ts#actualizarGrupoDeInsumo":
    "Cambiar el grupo de un insumo (Hito 4, H4C-9): solo recibe dos ids (el grupo puede ser null), que nunca se validaron en la acción (un id que no existe hace lanzar a Prisma, como antes); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/catalogo/productos.ts#asignarInsumoAProducto":
    "Asignar el insumo a una MP (Hito 4, H4C-11): solo recibe dos ids, que nunca se validaron en la acción (los resuelve el caso de uso: «No se encontró el producto.», que sea MP y el choque de unidades); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/catalogo/productos.ts#agregarPresentacionAlternativa":
    "Presentación de compra alternativa (Hito 4, H4C-11): la acción leía el producto ANTES de validar el factor (sus decimales son los de la unidad de STOCK del producto, y un producto inexistente gana sobre un factor inválido), así que la validación vive en el caso de uso, en el mismo orden.",
  "src/server/actions/catalogo/productos.ts#actualizarActivaPresentacion":
    "Activar o desactivar una presentación (Hito 4, H4C-11): solo recibe un id y un booleano, que nunca se validaron en la acción (un id roto hace lanzar a Prisma: hallazgo conocido, migrado tal cual); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/catalogo/productos.ts#actualizarDisponibilidadProducto":
    "Disponibilidad en la sucursal (Hito 4, H4C-11): solo recibe un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso, «No se encontró el producto.»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/catalogo/productos.ts#darDeAltaProducto":
    "Alta completa de un producto (Hito 4, H4C-12): la validación de los datos (validarDatosDeProducto, server/lecturas/catalogo/datos-de-producto.ts) lee la unidad de stock a mitad de camino (sus decimales validan el factor y el paso de venta) y un nombre repetido después; un guard previo solo podría adelantar una parte y cambiaría el orden de los mensajes.",
  "src/server/actions/catalogo/productos.ts#actualizarProducto":
    "Edición de un producto (Hito 4, H4C-13): la acción leía el producto ANTES de validar (un producto inexistente y el tipo distinto ganan sobre un dato inválido) y la validación (validarDatosDeProducto) lee la unidad de stock a mitad de camino; un guard previo cambiaría el orden de los mensajes.",
  "src/server/actions/catalogo/insumos.ts#actualizarActivoGrupo":
    "Activar o desactivar un grupo de insumos (Hito 4, H4C-9): solo recibe un id y un booleano, que nunca se validaron en la acción (un id que no existe hace lanzar a Prisma, como antes); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/catalogo/proveedores.ts#actualizarActivaProveedor":
    "Activar o desactivar un proveedor (Hito 4, H4C-14): solo recibe un id y un booleano, que nunca se validaron en la acción (un id que no existe hace lanzar a Prisma, como antes); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/catalogo/proveedores.ts#actualizarProveedor":
    "Corregir los datos de contacto de un proveedor (Hito 4, H4C-14): la acción leía el proveedor ANTES de validar (un proveedor inexistente gana sobre un dato inválido), así que la validación (validarContactoDeProveedor) vive en el caso de uso, en el mismo orden.",
  "src/server/actions/clientes/cliente.ts#actualizarCliente":
    "Corregir nombre y % de un cliente (Hito 4, H4C-15): la acción leía el cliente ANTES de validar (un cliente inexistente gana sobre un dato inválido), así que la validación (nombreDeCliente y validarPorcentajeDescuento) vive en el caso de uso, en el mismo orden.",
  "src/server/actions/clientes/cliente.ts#actualizarActivoCliente":
    "Activar o desactivar un cliente (Hito 4, H4C-15): solo recibe un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso, «No se encontró ese cliente.»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/movimientos/motivos.ts#actualizarActivoMotivoMerma":
    "Activar o desactivar un motivo de merma (Hito 4, H4C-17): solo recibe un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso, «No se encontró el motivo.»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
  "src/server/actions/movimientos/motivos.ts#actualizarActivoDestinoConsumo":
    "Activar o desactivar un destino de consumo (Hito 4, H4C-17): solo recibe un id y un booleano, que nunca se validaron en la acción (el id lo resuelve el caso de uso, «No se encontró el destino.»); un guard nuevo cambiaría el comportamiento, que esta migración no toca.",
};

describe("toda Server Action migrada a caso de uso valida el formato con un guardComando* antes de llamarlo", () => {
  it("el detector ve las acciones y las llamadas (sanidad: no pasa en vacío)", () => {
    const [a] = accionesDe(`export async function hacer(x: unknown) { const c = guardComandoHacer(x); return aResultadoAccion(await hacerCasoDeUso(ctx, c.valor)); }`);
    expect(a.nombre).toBe("hacer");
    expect(llamaAUnCasoDeUso(a) && llamaAUnGuard(a)).toBe(true);
    const [sinGuard] = accionesDe(`export async function directa(x: unknown) { return aResultadoAccion(await directaCasoDeUso(ctx, x)); }`);
    expect(llamaAUnCasoDeUso(sinGuard) && !llamaAUnGuard(sinGuard)).toBe(true);
    expect(accionesDe(`async function interna() { return interCasoDeUso(); }`)).toEqual([]);
  });

  it("cada acción de ACCIONES_CON_CASO_DE_USO que llama a un caso de uso llama también a un guardComando*", () => {
    const sinGuard: string[] = [];
    let conCasoDeUso = 0;
    for (const { ruta } of EXCEPCIONES.ACCIONES_CON_CASO_DE_USO) {
      for (const accion of accionesDe(readFileSync(join(RAIZ, ruta), "utf8"))) {
        if (!llamaAUnCasoDeUso(accion)) continue;
        conCasoDeUso++;
        if (!llamaAUnGuard(accion) && !(`${ruta}#${accion.nombre}` in SIN_GUARD)) sinGuard.push(`${ruta}#${accion.nombre}`);
      }
    }
    expect(conCasoDeUso).toBeGreaterThan(10);
    expect(sinGuard, "una acción llama a su caso de uso sin validar el formato: agregá guardComando<Accion> en core/features/<feature>/ o inventariala en SIN_GUARD con motivo").toEqual([]);
  });

  it("SIN_GUARD no tiene entradas viejas ni sin motivo", () => {
    for (const [clave, motivo] of Object.entries(SIN_GUARD)) {
      const [ruta, nombre] = clave.split("#");
      const accion = accionesDe(readFileSync(join(RAIZ, ruta), "utf8")).find((a) => a.nombre === nombre);
      expect(accion && llamaAUnCasoDeUso(accion) && !llamaAUnGuard(accion), `${clave} ya no existe o ya tiene guard`).toBe(true);
      expect(motivo.trim().length, `${clave} sin motivo`).toBeGreaterThan(10);
    }
  });
});
