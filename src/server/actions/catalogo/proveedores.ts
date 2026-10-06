"use server";

import { texto, validarTextoCatalogo } from "@/core/texto";
import {
  LARGO_MAXIMO_CONTACTO,
  LARGO_MAXIMO_DETALLE,
  LARGO_MAXIMO_NOTAS,
  LARGO_MAXIMO_TELEFONO,
  validarEmailOpcional,
  validarTextoLibre,
} from "@/core/datos/limites";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { validarCuit } from "@/core/fiscal/public";
import { crearConCodigoAutogenerado, esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirSesion } from "../con-sesion";
import { refrescarVistaSiHaceFalta } from "../refrescar";

const MENSAJE_CUIT_DUPLICADO = (nombre: string) =>
  `Ya existe un proveedor con ese CUIT («${nombre}»). Dos proveedores de una misma empresa no pueden compartir CUIT: revisá que esté bien cargado.`;

/** El nombre del OTRO proveedor de la empresa que ya tiene ese CUIT (el RLS acota a la empresa activa), o `null`. */
async function proveedorConCuit(db: ContextoUsuario["db"], cuit: string | null, excluirId?: string) {
  if (!cuit) return null;
  return (await db.proveedor.findFirst({ where: { cuit, ...(excluirId ? { id: { not: excluirId } } : {}) }, select: { nombre: true } }))?.nombre ?? null;
}

export async function listarProveedores(soloActivos = false) {
  const ctx = await requerirSesion();
  return ctx.db.proveedor.findMany({
    where: soloActivos ? { activo: true } : {},
    orderBy: { nombre: "asc" },
  });
}

export interface DatosProveedor {
  nombre: string;
  contacto?: string;
  telefono?: string;
  email?: string;
  cuit?: string;
  condicionesPago?: string;
  notas?: string;
}

type CamposDeContacto = Omit<DatosProveedor, "nombre">;

/** Largo máximo de cada texto libre y formato del email (S-22). Recortados; vacío → `null`. */
function validarCamposDeContacto(datos: CamposDeContacto): { ok: true; valores: Record<keyof CamposDeContacto, string | null> } | { ok: false; mensaje: string } {
  const campos = {
    contacto: validarTextoLibre(datos.contacto, "El contacto", LARGO_MAXIMO_CONTACTO),
    telefono: validarTextoLibre(datos.telefono, "El teléfono", LARGO_MAXIMO_TELEFONO),
    email: validarEmailOpcional(datos.email),
    cuit: validarCuit(datos.cuit),
    condicionesPago: validarTextoLibre(datos.condicionesPago, "Las condiciones de pago", LARGO_MAXIMO_DETALLE),
    notas: validarTextoLibre(datos.notas, "Las notas", LARGO_MAXIMO_NOTAS),
  };
  for (const r of Object.values(campos)) if (!r.ok) return { ok: false, mensaje: r.mensaje };
  const valores = Object.fromEntries(Object.entries(campos).map(([k, r]) => [k, r.ok ? r.valor : null])) as Record<keyof CamposDeContacto, string | null>;
  return { ok: true, valores };
}

/**
 * Equivalente de altaProveedor (Catalogo.js:3757-3775). Gatea con
 * 'alta_producto', no con un permiso propio — se preserva la decisión
 * histórica documentada: es lo que ya usaba el flujo de Compra, no
 * restringe nada nuevo.
 */
export async function altaProveedor(datos: DatosProveedor): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("proveedor_alta", async (ctx) => {
    const nombre = texto(datos.nombre);
    if (!nombre) return error("El nombre no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombre, "El nombre");
    if (invalido) return error(invalido);
    const campos = validarCamposDeContacto(datos);
    if (!campos.ok) return error(campos.mensaje);

    const dup = await ctx.db.proveedor.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } } });
    if (dup) return error(`Ya existe un proveedor llamado "${nombre}".`);
    const conMismoCuit = await proveedorConCuit(ctx.db, campos.valores.cuit);
    if (conMismoCuit) return error(MENSAJE_CUIT_DUPLICADO(conMismoCuit));

    try {
      const proveedor = await crearConCodigoAutogenerado("PRV", undefined, (codigo) =>
        ctx.db.proveedor.create({
          data: {
            codigo,
            nombre,
            ...campos.valores,
          },
        })
      );
      return okConId(`Proveedor "${proveedor.nombre}" creado.`, proveedor.id, proveedor.nombre);
    } catch (e) {
      // Carrera: dos altas con el mismo CUIT a la vez pasan el chequeo de arriba y las frena el índice único (empresaId, cuit).
      if (esErrorDeUnicidad(e)) {
        const carrera = await proveedorConCuit(ctx.db, campos.valores.cuit);
        return error(carrera ? MENSAJE_CUIT_DUPLICADO(carrera) : "Colisión generando el código del proveedor — reintentá.");
      }
      throw e;
    }
  });
}

export async function actualizarActivaProveedor(proveedorId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("proveedores", async (ctx) => {
    await ctx.db.proveedor.update({ where: { id: proveedorId }, data: { activo } });
    // Se llama desde la lista sin redirigir después — sin esto la columna
    // "Activo" no cambiaría en un navegador real hasta recargar a mano
    // (ver src/server/actions/refrescar.ts).
    refrescarVistaSiHaceFalta();
    return ok(`Proveedor ${activo ? "activado" : "desactivado"}.`);
  });
}

/**
 * Antes solo existía alta (altaProveedor) y Activar/Desactivar — no había
 * forma de corregir contacto/teléfono/email/CUIT/condiciones de pago de un
 * proveedor ya creado. El nombre no se edita acá a propósito (mismo
 * criterio de identidad que Insumo/Producto): para eso está
 * renombrarOFusionarInsumo-style, fuera del alcance de este hallazgo.
 */
export async function actualizarProveedor(proveedorId: string, datos: Omit<DatosProveedor, "nombre">): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("proveedores", async (ctx) => {
    const proveedor = await ctx.db.proveedor.findUnique({ where: { id: proveedorId } });
    if (!proveedor) return error("No se encontró ese proveedor.");
    const campos = validarCamposDeContacto(datos);
    if (!campos.ok) return error(campos.mensaje);

    const conMismoCuit = await proveedorConCuit(ctx.db, campos.valores.cuit, proveedorId);
    if (conMismoCuit) return error(MENSAJE_CUIT_DUPLICADO(conMismoCuit));

    try {
      await ctx.db.proveedor.update({ where: { id: proveedorId }, data: campos.valores });
    } catch (e) {
      if (!esErrorDeUnicidad(e)) throw e;
      const carrera = await proveedorConCuit(ctx.db, campos.valores.cuit, proveedorId);
      return error(carrera ? MENSAJE_CUIT_DUPLICADO(carrera) : "No se pudo guardar: el dato choca con otro proveedor.");
    }
    return ok(`Proveedor "${proveedor.nombre}" actualizado.`);
  });
}
