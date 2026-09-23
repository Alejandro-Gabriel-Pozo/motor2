"use server";

import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { productosUniversales, type FilaDisponibilidadEnSucursal } from "@/core/catalogo/disponibilidad-producto";
import { conPermiso } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirSesion } from "../con-sesion";

export async function listarSucursales() {
  await requerirSesion();
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

    // Decisión 4 del dueño (2026-09-23, docs/plan-disponibilidad-por-sucursal-2026-09-23.md §10): la sucursal nueva arranca
    // SOLO con los productos que ya son "universales" — disponibles en TODAS las sucursales activas de hoy, sin excepción.
    // Nunca con los que son mayoría pero no unanimidad: un producto sucursal-específico no se contagia solo por ser común.
    // Se resuelve ANTES de la transacción (lectura pura, no hace falta el aislamiento) y con `sucursalIdsActivas` vacío
    // (la primerísima sucursal del sistema) `productosUniversales` da siempre `[]` — arranca en cero, no en "todos".
    const sucursalIdsActivas = (await prisma.sucursal.findMany({ where: { activo: true }, select: { id: true } })).map((s) => s.id);
    const filasDisponibilidad = sucursalIdsActivas.length
      ? await prisma.disponibilidadProducto.findMany({ where: { sucursalId: { in: sucursalIdsActivas } }, select: { productoId: true, sucursalId: true, disponible: true } })
      : [];
    const disponibilidadPorProducto = new Map<string, FilaDisponibilidadEnSucursal[]>();
    for (const f of filasDisponibilidad) {
      const lista = disponibilidadPorProducto.get(f.productoId) ?? [];
      lista.push(f);
      disponibilidadPorProducto.set(f.productoId, lista);
    }
    const universales = productosUniversales(disponibilidadPorProducto, sucursalIdsActivas);

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
      if (universales.length) {
        await tx.disponibilidadProducto.createMany({ data: universales.map((productoId) => ({ sucursalId: sucursal.id, productoId, disponible: true })) });
      }
    }, { maxWait: 5_000, timeout: 15_000 });

    // Se llama desde un closure "use server" de la página, sin redirigir: sin esto la tabla no cambia en un navegador real (ver refrescar.ts).
    refrescarVistaSiHaceFalta();
    return ok(`Sucursal "${nombre}" creada, con "${email}" como primer admin.`);
  });
}

/**
 * Antes no existía ninguna forma de desactivar una sucursal (solo alta) —
 * hallazgo de la auditoría de motor2, con impacto real: Sucursal.activo ya
 * se usa como filtro (ej. listarSucursalesDisponibles en traspasos) pero
 * no había ningún botón para ponerlo en false.
 */
export async function actualizarActivoSucursal(sucursalId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("alta_sucursal", async (ctx) => {
    const sucursal = await prisma.sucursal.findUnique({ where: { id: sucursalId } });
    if (!sucursal) return error("No se encontró esa sucursal.");

    // `obtenerContextoUsuario` solo cuenta las membresías de sucursales activas: quien desactiva la suya (y no tiene otra)
    // queda sin contexto en toda la aplicación y ya no puede volver a activarla, solo desde la base de datos.
    if (!activo && sucursalId === ctx.sucursalId) {
      return error(
        `No podés desactivar la sucursal en la que estás ahora ("${sucursal.nombre}"): te quedarías sin acceso a la aplicación. Hacelo desde otra sucursal, o pedile a otro admin.`
      );
    }

    await prisma.sucursal.update({ where: { id: sucursalId }, data: { activo } });
    // A propósito SIN `refrescarVistaSiHaceFalta()`: su único llamador (`ActivarDesactivarFila`) ya hace `router.refresh()` en el cliente, y
    // otras pantallas que reusen ese componente heredan lo mismo (ver la regla en refrescar.ts).
    return ok(`Sucursal "${sucursal.nombre}" ${activo ? "activada" : "desactivada"}.`);
  });
}

/** Renombrar una sucursal existente — antes solo se podía elegir el nombre una vez, al crearla. */
export async function renombrarSucursal(sucursalId: string, nombreNuevo: string): Promise<ResultadoAccion> {
  return conPermiso("alta_sucursal", async () => {
    const nombre = texto(nombreNuevo);
    if (!nombre) return error("El nombre no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombre, "El nombre de la sucursal");
    if (invalido) return error(invalido);

    const sucursal = await prisma.sucursal.findUnique({ where: { id: sucursalId } });
    if (!sucursal) return error("No se encontró esa sucursal.");

    const existente = await prisma.sucursal.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" }, id: { not: sucursalId } } });
    if (existente) return error(`Ya existe una sucursal "${existente.nombre}".`);

    await prisma.sucursal.update({ where: { id: sucursalId }, data: { nombre } });
    refrescarVistaSiHaceFalta(); // ver crearSucursalConAdmin
    return ok(`Sucursal renombrada a "${nombre}".`);
  });
}
