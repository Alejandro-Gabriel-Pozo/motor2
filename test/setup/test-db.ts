import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../../src/lib/db";
import { baseDelContexto } from "../../src/core/auth/base";
import { crearMembresia } from "./membresia";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { MOTIVOS_MERMA_SEMILLA, DESTINOS_CONSUMO_SEMILLA } from "../../src/core/movimientos/motivos-semilla";

export { prisma };

/**
 * Cliente del DUEÑO de las tablas (`DIRECT_URL`, el mismo rol que migra), para lo que el rol de ejecución no puede hacer a propósito
 * (TRUNCATE, DDL, saltar el RLS). `prisma` (arriba) es el runtime real: `DATABASE_URL`, rol `motor2_app` (ADR-007, A0). No se conecta
 * hasta la primera consulta.
 */
export const prismaAdmin = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? "" }) });

/** La base explícita (`db` + `transaccion`) que el contexto le da al negocio en producción — los tests la pasan igual, como argumento. */
export const baseDeTest = baseDelContexto();

/** Id de la empresa por defecto que crea la migración multiempresa_estructura (ADR-007, A2) y que `limpiarBaseDeTest` conserva. */
export const EMPRESA_POR_DEFECTO_ID = "empresa_principal";

/** Borra todo (orden respetando FKs) — se llama en beforeEach de cada test file. */
export async function limpiarBaseDeTest() {
  // Carta antes que nada: sus tablas referencian Producto y Sucursal (RESTRICT), que se borran más abajo.
  // Las opciones de un ítem agrupado primero: referencian al ítem agrupado (RESTRICT) y a Producto.
  // OJO: PromoCartaCupo, PromoCarta y SeccionCarta NO se borran acá (Task #16, docs/plan-promo-combo-2026-09-26.md, M2) —
  // desde que `PromoCuenta` existe, PromoCarta depende TRANSITIVAMENTE de que la cuenta del POS ya esté vacía (ver más abajo,
  // junto a `promoCuenta.deleteMany()`), así que las tres se movieron a ese bloque.
  await prisma.opcionItemAgrupadoCarta.deleteMany();
  await prisma.itemAgrupadoCarta.deleteMany();
  await prisma.temaCartaSucursal.deleteMany();
  await prisma.sucursalPublica.deleteMany();
  await prisma.contenidoCartaProducto.deleteMany();
  // GeneroCarta (docs/plan-genero-carta-2026-09-26.md): DESPUÉS de ItemAgrupadoCarta y ContenidoCartaProducto, que lo referencian
  // (ON DELETE SET NULL, por ser `generoCartaId` opcional — el orden no es estrictamente necesario, pero mantiene el mismo
  // criterio "quien referencia se borra antes" del resto de esta función).
  await prisma.generoCarta.deleteMany();

  // POS antes que nada: CuentaItem referencia Cuenta, Producto, User, Operacion y PromoCuenta; Cuenta referencia Mesa y User;
  // Mesa referencia Sucursal. Las filas espejo (anulaciones) primero: referencian a su ítem original con ON DELETE RESTRICT.
  // EjemplarBoleta referencia Cuenta, Sucursal y User (RESTRICT): antes que la cuenta. Los ejemplares de corrección (B, C…) primero:
  // referencian a su ejemplar A con ON DELETE RESTRICT.
  await prisma.ejemplarBoleta.deleteMany({ where: { corrigeAId: { not: null } } });
  await prisma.ejemplarBoleta.deleteMany();
  await prisma.cuentaItem.deleteMany({ where: { anulaAItemId: { not: null } } });
  await prisma.cuentaItem.deleteMany();
  // Cuenta/Mesa se borran MÁS ABAJO (después de Operacion): PromoCuenta (Task #16) referencia Cuenta con RESTRICT, y tanto
  // CuentaItem (ya vacío acá) como Operacion (recién se vacía abajo) referencian PromoCuenta con RESTRICT — así que
  // PromoCuenta no se puede borrar hasta después de operacion.deleteMany(), y Cuenta no se puede borrar hasta después de
  // PromoCuenta.

  // Movimientos primero: Operacion/ConteoFisico referencian User/Sucursal/
  // Proveedor, que se borran más abajo — y MovimientoStock referencia a
  // los tres (Operacion/ConteoFisico incluidos).
  await prisma.movimientoStock.deleteMany();
  await prisma.conteoFisico.deleteMany();
  await prisma.operacion.deleteMany();
  // PromoCuenta (Task #16, docs/plan-promo-combo-2026-09-26.md): DESPUÉS de CuentaItem (arriba) y Operacion (recién), que la
  // referencian con RESTRICT. A su vez PromoCarta/PromoCartaCupo (que PromoCuenta referencia RESTRICT) y SeccionCarta (que
  // PromoCarta/PromoCartaCupo referencian RESTRICT) tienen que esperar a que ESTA se vacíe — por eso viven acá y no arriba
  // con el resto de la carta. Cuenta/Mesa van DESPUÉS de todo esto (PromoCuenta la referencia RESTRICT).
  await prisma.promoCuenta.deleteMany();
  await prisma.promoCartaCupo.deleteMany();
  await prisma.promoCarta.deleteMany();
  await prisma.seccionCarta.deleteMany();
  await prisma.cuenta.deleteMany();
  await prisma.mesa.deleteMany();
  // DESPUÉS de operacion.deleteMany() — Operacion.motivoId/destinoId referencian estas dos con ON DELETE RESTRICT
  // (plan "motivos de Consumo/Merma como catálogo administrable", 2026-09-23, P3).
  await prisma.motivoMerma.deleteMany();
  await prisma.destinoConsumo.deleteMany();
  // Cuenta.clienteId y Operacion.clienteId ya se liberaron arriba (cuenta/operacion.deleteMany()).
  await prisma.cliente.deleteMany();
  await prisma.pagoConsignante.deleteMany();
  // Antes de RecetaIngrediente (RendimientoLocalIngrediente.recetaIngredienteId es ON DELETE CASCADE, pero el
  // orden explícito documenta la dependencia igual que el resto de este bloque — sembrarBase() borra sucursal más abajo).
  await prisma.rendimientoLocalIngrediente.deleteMany();
  await prisma.precioLocalProducto.deleteMany();
  await prisma.stockMinimoProducto.deleteMany();
  await prisma.seccionHabitualProducto.deleteMany();
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
  await prisma.usuarioEmpresa.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.rol.deleteMany();
  await prisma.accion.deleteMany();
  await prisma.sucursal.deleteMany();

  await prisma.sustitutoRecetaIngrediente.deleteMany();
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

  // Plataforma (ADR-007, A2): `empresaId` tiene default `app_empresa_actual()` (la ÚNICA empresa ACTIVE), así que la base de test
  // tiene que terminar con exactamente la empresa por defecto de la migración, en pie y ACTIVE, sea lo que sea que un test haya tocado.
  await prisma.empresa.deleteMany({ where: { id: { not: EMPRESA_POR_DEFECTO_ID } } });
  await prisma.empresa.upsert({
    where: { id: EMPRESA_POR_DEFECTO_ID },
    update: { estado: "ACTIVE" },
    create: { id: EMPRESA_POR_DEFECTO_ID, nombre: "Empresa principal", slug: "principal", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" },
  });
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
  await crearMembresia({ usuarioId: usuario.id, sucursalId: params.sucursalId, rolId: params.rolId, activo: params.activo });
  return usuario;
}

/** Fixtures mínimas de Movimientos: una Sección ("Depósito") en la sucursal dada. */
export async function sembrarSeccion(sucursalId: string, nombre = "Depósito") {
  return prisma.seccion.create({ data: { sucursalId, nombre } });
}

/**
 * Siembra el catálogo Motivo de Merma / Destino de Consumo (motivos-semilla.ts) — necesario para cualquier test que
 * registre una Merma/Consumo con un motivoId/destinoId real: `limpiarBaseDeTest()` vacía las dos tablas en cada test
 * (plan "motivos de Consumo/Merma como catálogo administrable", 2026-09-23, P3/P5), así que no alcanza con lo que
 * dejó la migración. Devuelve nombre→id para que cada test resuelva el id que necesite sin acoplarse al orden de
 * inserción (a diferencia del enum viejo, acá no hay una clave fija tipo "VENCIDO" — el nombre ES la clave estable).
 */
export async function sembrarMotivosYDestinos() {
  const motivos = await Promise.all(
    MOTIVOS_MERMA_SEMILLA.map((m) => prisma.motivoMerma.create({ data: { nombre: m.nombre, descripcion: m.descripcion ?? null } }))
  );
  const destinos = await Promise.all(
    DESTINOS_CONSUMO_SEMILLA.map((d) => prisma.destinoConsumo.create({ data: { nombre: d.nombre, descripcion: d.descripcion ?? null } }))
  );
  return {
    motivos: new Map(motivos.map((m) => [m.nombre, m.id])),
    destinos: new Map(destinos.map((d) => [d.nombre, d.id])),
  };
}
