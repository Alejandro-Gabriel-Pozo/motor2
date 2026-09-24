import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { ACCIONES } from "../../src/core/permisos/acciones";

export { prisma };

/** Borra todo (orden respetando FKs) — se llama en beforeEach de cada test file. */
export async function limpiarBaseDeTest() {
  // Carta antes que nada: sus 6 tablas referencian Producto, CategoriaProducto y Sucursal (RESTRICT), que se borran más abajo.
  await prisma.temaCartaSucursal.deleteMany();
  await prisma.sucursalPublica.deleteMany();
  await prisma.promoCarta.deleteMany();
  await prisma.contenidoCartaProducto.deleteMany();
  await prisma.categoriaSeccionCarta.deleteMany();
  await prisma.seccionCarta.deleteMany();

  // POS antes que nada: CuentaItem referencia Cuenta y Producto; Cuenta referencia Mesa y User; Mesa referencia Sucursal.
  await prisma.cuentaItem.deleteMany();
  await prisma.cuenta.deleteMany();
  await prisma.mesa.deleteMany();

  // Movimientos primero: Operacion/ConteoFisico referencian User/Sucursal/
  // Proveedor, que se borran más abajo — y MovimientoStock referencia a
  // los tres (Operacion/ConteoFisico incluidos).
  await prisma.movimientoStock.deleteMany();
  await prisma.conteoFisico.deleteMany();
  await prisma.operacion.deleteMany();
  await prisma.pagoConsignante.deleteMany();
  await prisma.precioLocalProducto.deleteMany();
  await prisma.stockMinimoProducto.deleteMany();
  await prisma.frecuenciaConteoProducto.deleteMany();
  await prisma.disponibilidadProducto.deleteMany();
  await prisma.promocionProducto.deleteMany();
  await prisma.traspasoSucursal.deleteMany();
  await prisma.seccion.deleteMany();

  await prisma.usuarioSucursal.deleteMany();
  await prisma.permisoRol.deleteMany();
  await prisma.capacidadSucursal.deleteMany();
  await prisma.registroAuditoria.deleteMany();
  await prisma.indicePrecio.deleteMany();
  await prisma.cotizacionDolar.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.rol.deleteMany();
  await prisma.accion.deleteMany();
  await prisma.sucursal.deleteMany();

  await prisma.recetaIngrediente.deleteMany();
  await prisma.recetaVersion.deleteMany();
  await prisma.presentacion.deleteMany();
  await prisma.proveedorPorProducto.deleteMany();
  await prisma.producto.deleteMany();
  await prisma.insumo.deleteMany();
  await prisma.grupo.deleteMany();
  await prisma.categoriaProducto.deleteMany();
  await prisma.unidad.deleteMany();
  await prisma.proveedor.deleteMany();
}

/**
 * Crea un producto Y su fila `DisponibilidadProducto` (disponible: true) en `sucursalId` — atajo para fixtures que siembran el
 * catálogo directo con `prisma.producto.create` (docs/plan-disponibilidad-por-sucursal-2026-09-23.md: fila ausente = no
 * disponible, así que un producto sembrado a mano sin esto queda invisible en selectores/reportes por sucursal). El alta real
 * de la app (`darDeAltaProducto`) hace esto mismo a través del server action.
 */
export async function sembrarProductoDisponible(data: Prisma.ProductoUncheckedCreateInput, sucursalId: string) {
  const producto = await prisma.producto.create({ data });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  return producto;
}

/** Fixtures mínimas de Catálogo: unidades kg/g, una categoría y un insumo. */
export async function sembrarCatalogoBase() {
  const [kg, g] = await Promise.all([
    prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } }),
    prisma.unidad.create({ data: { nombre: "g", magnitud: "PESO", decimales: 0 } }),
  ]);
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: "Almacén" } });
  const insumo = await prisma.insumo.create({ data: { nombre: "Harina" } });
  return { kg, g, categoria, insumo };
}

/**
 * Siembra el mínimo común de todos los tests de permisos: roles
 * admin/operador, el catálogo de Acciones completo (con la matriz
 * rol×acción tal como la seedea prisma/seed.ts), y una Sucursal.
 */
export async function sembrarBase() {
  const [admin, operador] = await Promise.all([
    prisma.rol.create({ data: { nombre: "admin" } }),
    prisma.rol.create({ data: { nombre: "operador" } }),
  ]);
  const rolesPorNombre = { admin, operador } as const;

  for (const accion of ACCIONES) {
    await prisma.accion.create({ data: { clave: accion.clave, descripcion: accion.descripcion } });
    for (const nombreRol of ["admin", "operador"] as const) {
      const puedeEditar = (accion.rolesEditarSemilla as readonly string[]).includes(nombreRol);
      await prisma.permisoRol.create({
        data: {
          rolId: rolesPorNombre[nombreRol].id,
          accionClave: accion.clave,
          puedeEditar,
          puedeVer: puedeEditar,
        },
      });
    }
  }

  const sucursal = await prisma.sucursal.create({ data: { nombre: "Central" } });

  return { admin, operador, sucursal };
}

export async function crearUsuarioConMembresia(params: {
  email: string;
  sucursalId: string;
  rolId: string;
  activo?: boolean;
}) {
  const usuario = await prisma.user.create({ data: { email: params.email } });
  await prisma.usuarioSucursal.create({
    data: {
      usuarioId: usuario.id,
      sucursalId: params.sucursalId,
      rolId: params.rolId,
      activo: params.activo ?? true,
    },
  });
  return usuario;
}

/** Fixtures mínimas de Movimientos: una Sección ("Depósito") en la sucursal dada. */
export async function sembrarSeccion(sucursalId: string, nombre = "Depósito") {
  return prisma.seccion.create({ data: { sucursalId, nombre } });
}
