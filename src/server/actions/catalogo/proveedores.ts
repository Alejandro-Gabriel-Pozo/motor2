"use server";

import { texto, validarTextoCatalogo } from "@/core/texto";
import { crearConCodigoAutogenerado, esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirSesion } from "../con-sesion";
import { refrescarVistaSiHaceFalta } from "../refrescar";

export async function listarProveedores(soloActivos = false) {
  const ctx = await requerirSesion();
  return ctx.db.proveedor.findMany({
    where: soloActivos ? { activo: true } : undefined,
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

/**
 * Equivalente de altaProveedor (Catalogo.js:3757-3775). Gatea con
 * 'alta_producto', no con un permiso propio — se preserva la decisión
 * histórica documentada: es lo que ya usaba el flujo de Compra, no
 * restringe nada nuevo.
 */
export async function altaProveedor(datos: DatosProveedor): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("alta_producto", async (ctx) => {
    const nombre = texto(datos.nombre);
    if (!nombre) return error("El nombre no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombre, "El nombre");
    if (invalido) return error(invalido);

    const dup = await ctx.db.proveedor.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } } });
    if (dup) return error(`Ya existe un proveedor llamado "${nombre}".`);

    try {
      const proveedor = await crearConCodigoAutogenerado("PRV", undefined, (codigo) =>
        ctx.db.proveedor.create({
          data: {
            codigo,
            nombre,
            contacto: datos.contacto,
            telefono: datos.telefono,
            email: datos.email,
            cuit: datos.cuit,
            condicionesPago: datos.condicionesPago,
            notas: datos.notas,
          },
        })
      );
      return okConId(`Proveedor "${proveedor.nombre}" creado.`, proveedor.id, proveedor.nombre);
    } catch (e) {
      if (esErrorDeUnicidad(e)) return error("Colisión generando el código del proveedor — reintentá.");
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

    await ctx.db.proveedor.update({
      where: { id: proveedorId },
      data: {
        contacto: texto(datos.contacto ?? "") || null,
        telefono: texto(datos.telefono ?? "") || null,
        email: texto(datos.email ?? "") || null,
        cuit: texto(datos.cuit ?? "") || null,
        condicionesPago: texto(datos.condicionesPago ?? "") || null,
        notas: texto(datos.notas ?? "") || null,
      },
    });
    return ok(`Proveedor "${proveedor.nombre}" actualizado.`);
  });
}
