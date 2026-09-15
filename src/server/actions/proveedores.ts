"use server";

import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { crearConCodigoAutogenerado, esErrorDeUnicidad } from "@/core/catalogo/generar-codigo";
import { conPermiso } from "./con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "./tipos";

export async function listarProveedores(soloActivos = false) {
  return prisma.proveedor.findMany({
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
  return conPermiso<ResultadoConId>("alta_producto", async () => {
    const nombre = texto(datos.nombre);
    if (!nombre) return error("El nombre no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombre, "El nombre");
    if (invalido) return error(invalido);

    const dup = await prisma.proveedor.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } } });
    if (dup) return error(`Ya existe un proveedor llamado "${nombre}".`);

    try {
      const proveedor = await crearConCodigoAutogenerado("PRV", undefined, (codigo) =>
        prisma.proveedor.create({
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
  return conPermiso("proveedores", async () => {
    await prisma.proveedor.update({ where: { id: proveedorId }, data: { activo } });
    return ok(`Proveedor ${activo ? "activado" : "desactivado"}.`);
  });
}
