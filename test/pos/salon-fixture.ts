import { prisma, sembrarBase, sembrarProductoDisponible, sembrarSeccion, crearUsuarioConMembresia } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import type { AccionClave } from "../../src/core/permisos/acciones";

/**
 * Escenario común de los tests de «tomar pedido» (test/pos/*-action.test.ts, cuenta-concurrencia.test.ts): la base de permisos,
 * una sucursal «Central» con la sección «Salón», dos PV sin receta (Milanesa, Flan), un PV con receta (Pizza: 0,25 kg de la MP
 * Muzzarella) y la mesa 4. Cada test file declara su propio `vi.mock("../../src/core/auth/session", …)` (Vitest lo hoistea por
 * archivo) antes de usar `entrarComo`.
 */
export async function sembrarSalon() {
  const base = await sembrarBase();
  const sucursalId = base.sucursal.id;
  const [unidad, kg] = await Promise.all([
    prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } }),
    prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } }),
  ]);
  const insumo = await prisma.insumo.create({ data: { nombre: "Queso" } });
  const milanesa = await sembrarProductoDisponible({ codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: unidad.id, precioVenta: 9000 }, sucursalId);
  const flan = await sembrarProductoDisponible({ codigo: "PV_FLAN", nombre: "Flan", tipo: "PV", unidadStockId: unidad.id, precioVenta: 3000 }, sucursalId);
  const muzzarella = await sembrarProductoDisponible({ codigo: "MP_MUZZA", nombre: "Muzzarella", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id }, sucursalId);
  const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: unidad.id, precioVenta: 12000 }, sucursalId);
  await prisma.recetaVersion.create({ data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: muzzarella.id, cantidad: 0.25, unidadId: kg.id, mermaPorcentaje: 0 }] } } });
  const seccion = await sembrarSeccion(sucursalId, "Salón");
  const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 4 } });
  return { ...base, sucursalId, unidad, kg, milanesa, flan, muzzarella, pizza, seccion, admin, mesa };
}

/** Un rol propio (el «mozo» se arma así, desde la matriz) con las filas de permiso dadas, y un usuario suyo en la sucursal. */
export async function crearUsuarioConRol(sucursalId: string, nombre: string, permisos: { clave: AccionClave; ver: boolean; editar: boolean }[]) {
  const rol = await prisma.rol.create({ data: { nombre } });
  for (const p of permisos) await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: p.clave, puedeVer: p.ver, puedeEditar: p.editar } });
  return crearUsuarioConMembresia({ email: `${nombre}@test.com`, sucursalId, rolId: rol.id });
}

/** El «mozo» del plan: ve el mapa (`pos_mesas` Ver) y toma pedidos (`pos_tomar_pedido` Editar); no anula ni cobra. */
export function crearMozo(sucursalId: string, nombre = "mozo") {
  return crearUsuarioConRol(sucursalId, nombre, [
    { clave: "pos_mesas", ver: true, editar: false },
    { clave: "pos_tomar_pedido", ver: true, editar: true },
  ]);
}

export function entrarComo(usuario: { id: string; email: string }) {
  return mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });
}

/** Una cuenta abierta en la mesa dada con ítems sembrados directo (sin pasar por las acciones). */
export async function sembrarCuenta(mesaId: string, abiertaPorId: string, items: { productoId: string; cantidad: number; precioUnitario: number; numeroEnvio?: number | null }[] = []) {
  const cuenta = await prisma.cuenta.create({ data: { mesaId, abiertaPorId } });
  const creados = [];
  // Uno por uno, a propósito: el arreglo devuelto respeta el orden pedido (un create anidado no lo garantiza).
  for (const i of items) creados.push(await prisma.cuentaItem.create({ data: { ...i, cuentaId: cuenta.id, numeroEnvio: i.numeroEnvio ?? null, creadoPorId: abiertaPorId } }));
  return { ...cuenta, items: creados };
}
