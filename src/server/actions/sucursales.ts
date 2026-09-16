"use server";

import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { conPermiso } from "./con-permiso";
import { error, ok, type ResultadoAccion } from "./tipos";

export async function listarSucursales() {
  return prisma.sucursal.findMany({ orderBy: { nombre: "asc" } });
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
  return conPermiso("alta_sucursal", async () => {
    const nombre = texto(input.nombre);
    if (!nombre) return error("El nombre de la sucursal no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombre, "El nombre de la sucursal");
    if (invalido) return error(invalido);

    const email = texto(input.emailPrimerAdmin).toLowerCase();
    if (!email) return error("El email del primer admin de la sucursal es obligatorio.");

    const existente = await prisma.sucursal.findUnique({ where: { nombre } });
    if (existente) return error(`Ya existe una sucursal "${nombre}".`);

    const rolAdmin = await prisma.rol.findUnique({ where: { nombre: "admin" } });
    if (!rolAdmin || !rolAdmin.activo) {
      return error('No se encontró el rol "admin" (¿corriste el seed?) — no se puede asignar el primer admin.');
    }

    await prisma.$transaction(async (tx) => {
      const sucursal = await tx.sucursal.create({ data: { nombre } });
      const usuario = await tx.user.upsert({
        where: { email },
        update: {},
        create: { email },
      });
      await tx.usuarioSucursal.create({
        data: {
          usuarioId: usuario.id,
          sucursalId: sucursal.id,
          rolId: rolAdmin.id,
          notas: "Alta automática al crear la sucursal.",
        },
      });
    }, { maxWait: 30_000, timeout: 300_000 });

    return ok(`Sucursal "${nombre}" creada, con "${email}" como primer admin.`);
  });
}
