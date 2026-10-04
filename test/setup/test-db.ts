import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma as prismaSinEmpresa } from "../../src/lib/db";
import { baseDeEmpresa } from "../../src/core/auth/base";
import { clienteConEmpresaDePrueba, EMPRESA_DE_PRUEBA_ID } from "./empresa-de-prueba";
import { crearMembresia } from "./membresia";
import { prismaAdmin } from "./cliente-duenio";
import { activarTodosLosModulos } from "./modulos";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { MOTIVOS_MERMA_SEMILLA, DESTINOS_CONSUMO_SEMILLA } from "../../src/core/movimientos/motivos-semilla";

/**
 * El cliente de las pruebas (`motor2_app`) con la empresa de prueba fijada en la conexión (ADR-022): lo que los tests escriben y leen cae en ella sin depender de
 * «la única empresa activa». Para probar lo que pasa SIN contexto de empresa (login, RLS, lecturas previas) está `prismaSinEmpresa`.
 */
export const prisma = clienteConEmpresaDePrueba(process.env.DATABASE_URL ?? "");

/** El cliente del proceso, sin empresa: el que usa `src/` en producción. Solo para tests que prueban explícitamente la ausencia de contexto. */
export { prismaSinEmpresa };

export { prismaAdmin };

export { prismaDuenioSinEmpresa } from "./cliente-duenio";

/**
 * Vacía las operaciones y sus movimientos de un golpe. Los tests de volumen siembran decenas de miles de filas: borrarlas con el
 * `deleteMany` de `limpiarBaseDeTest` (con el chequeo de FK fila por fila) puede pasar los 10 s del hook y arrastra a los tests siguientes.
 */
export async function vaciarOperacionesPorVolumen() {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "MovimientoStock", "CuentaItem", "Operacion"');
}

/**
 * Se llama justo después de una carga masiva por SQL, antes de consultar. Las estadísticas de `MovimientoStock`/`Operacion` quedan de la
 * carga anterior (autovacuum no llega a analizar entre un test y otro); con el filtro de RLS (`"empresaId" = (SELECT app_empresa_actual())`)
 * el planificador cree que hay ~1 fila, arma un nested loop y una consulta de decenas de miles de filas no termina nunca (ADR-007, A6).
 * En producción las estadísticas son las reales; acá se las reproduce con un ANALYZE del dueño.
 */
export async function analizarDespuesDeCargaMasiva() {
  await prismaAdmin.$executeRawUnsafe('ANALYZE "Operacion"');
  await prismaAdmin.$executeRawUnsafe('ANALYZE "MovimientoStock"');
}

/** La base explícita (`db` + `transaccion`) que el contexto le da al negocio en producción — los tests la pasan igual, como argumento. */
export const baseDeTest = baseDeEmpresa(EMPRESA_DE_PRUEBA_ID);

/** Id de la empresa por defecto que crea la migración multiempresa_estructura (ADR-007, A2) y que `limpiarBaseDeTest` conserva. */
export const EMPRESA_POR_DEFECTO_ID = EMPRESA_DE_PRUEBA_ID;

/**
 * Borra todo (orden respetando FKs) — se llama en beforeEach de cada test file. Va con `prismaAdmin` (el dueño salta el RLS, ADR-007 A6): con el
 * rol de ejecución solo vería la empresa por defecto y las filas de una segunda empresa sobrevivirían a la limpieza.
 */
export async function limpiarBaseDeTest() {
  // Carta antes que nada: sus tablas referencian Producto y Sucursal (RESTRICT), que se borran más abajo.
  // Las opciones de un ítem agrupado primero: referencian al ítem agrupado (RESTRICT) y a Producto.
  // OJO: PromoCartaCupo, PromoCarta y SeccionCarta NO se borran acá (Task #16, docs/plan-promo-combo-2026-09-26.md, M2) —
  // desde que `PromoCuenta` existe, PromoCarta depende TRANSITIVAMENTE de que la cuenta del POS ya esté vacía (ver más abajo,
  // junto a `promoCuenta.deleteMany()`), así que las tres se movieron a ese bloque.
  await prismaAdmin.opcionItemAgrupadoCarta.deleteMany();
  await prismaAdmin.itemAgrupadoCarta.deleteMany();
  await prismaAdmin.temaCartaSucursal.deleteMany();
  await prismaAdmin.portalCartaEmpresa.deleteMany();
  await prismaAdmin.sucursalPublica.deleteMany();
  await prismaAdmin.descuentoProductoSucursal.deleteMany();
  await prismaAdmin.margenObjetivo.deleteMany();
  await prismaAdmin.contenidoCartaProducto.deleteMany();
  // GeneroCarta (docs/plan-genero-carta-2026-09-26.md): DESPUÉS de ItemAgrupadoCarta y ContenidoCartaProducto, que lo referencian
  // (ON DELETE SET NULL, por ser `generoCartaId` opcional — el orden no es estrictamente necesario, pero mantiene el mismo
  // criterio "quien referencia se borra antes" del resto de esta función).
  await prismaAdmin.generoCarta.deleteMany();

  // POS antes que nada: CuentaItem referencia Cuenta, Producto, User, Operacion y PromoCuenta; Cuenta referencia Mesa y User;
  // Mesa referencia Sucursal. Las filas espejo (anulaciones) primero: referencian a su ítem original con ON DELETE RESTRICT.
  // EjemplarTicket referencia Cuenta, Sucursal y User (RESTRICT): antes que la cuenta. Los ejemplares de corrección (B, C…) primero:
  // referencian a su ejemplar A con ON DELETE RESTRICT.
  await prismaAdmin.ejemplarTicket.deleteMany({ where: { corrigeAId: { not: null } } });
  await prismaAdmin.ejemplarTicket.deleteMany();
  await prismaAdmin.cuentaItem.deleteMany({ where: { anulaAItemId: { not: null } } });
  await prismaAdmin.cuentaItem.deleteMany();
  // Cuenta/Mesa se borran MÁS ABAJO (después de Operacion): PromoCuenta (Task #16) referencia Cuenta con RESTRICT, y tanto
  // CuentaItem (ya vacío acá) como Operacion (recién se vacía abajo) referencian PromoCuenta con RESTRICT — así que
  // PromoCuenta no se puede borrar hasta después de operacion.deleteMany(), y Cuenta no se puede borrar hasta después de
  // PromoCuenta.

  // Movimientos primero: Operacion/ConteoFisico referencian User/Sucursal/
  // Proveedor, que se borran más abajo — y MovimientoStock referencia a
  // los tres (Operacion/ConteoFisico incluidos).
  await prismaAdmin.movimientoStock.deleteMany();
  await prismaAdmin.conteoFisico.deleteMany();
  await prismaAdmin.operacion.deleteMany();
  // PromoCuenta (Task #16, docs/plan-promo-combo-2026-09-26.md): DESPUÉS de CuentaItem (arriba) y Operacion (recién), que la
  // referencian con RESTRICT. A su vez PromoCarta/PromoCartaCupo (que PromoCuenta referencia RESTRICT) y SeccionCarta (que
  // PromoCarta/PromoCartaCupo referencian RESTRICT) tienen que esperar a que ESTA se vacíe — por eso viven acá y no arriba
  // con el resto de la carta. Cuenta/Mesa van DESPUÉS de todo esto (PromoCuenta la referencia RESTRICT).
  await prismaAdmin.promoCuenta.deleteMany();
  await prismaAdmin.promoCartaCupo.deleteMany();
  await prismaAdmin.promoCartaSucursal.deleteMany();
  await prismaAdmin.promoCarta.deleteMany();
  await prismaAdmin.seccionCarta.deleteMany();
  await prismaAdmin.cuenta.deleteMany();
  await prismaAdmin.mesa.deleteMany();
  // DESPUÉS de operacion.deleteMany() — Operacion.motivoId/destinoId referencian estas dos con ON DELETE RESTRICT
  // (plan "motivos de Consumo/Merma como catálogo administrable", 2026-09-23, P3).
  await prismaAdmin.motivoMerma.deleteMany();
  await prismaAdmin.destinoConsumo.deleteMany();
  // Cuenta.clienteId y Operacion.clienteId ya se liberaron arriba (cuenta/operacion.deleteMany()).
  await prismaAdmin.cliente.deleteMany();
  await prismaAdmin.pagoConsignante.deleteMany();
  // Antes de RecetaIngrediente (RendimientoLocalIngrediente.recetaIngredienteId es ON DELETE CASCADE, pero el
  // orden explícito documenta la dependencia igual que el resto de este bloque — sembrarBase() borra sucursal más abajo).
  await prismaAdmin.rendimientoLocalIngrediente.deleteMany();
  await prismaAdmin.precioLocalProducto.deleteMany();
  await prismaAdmin.stockMinimoProducto.deleteMany();
  await prismaAdmin.seccionHabitualProducto.deleteMany();
  await prismaAdmin.frecuenciaConteoProducto.deleteMany();
  await prismaAdmin.disponibilidadProducto.deleteMany();
  await prismaAdmin.traspasoSucursal.deleteMany();
  await prismaAdmin.seccion.deleteMany();

  await prismaAdmin.usuarioSucursal.deleteMany();
  await prismaAdmin.permisoRol.deleteMany();
  await prismaAdmin.capacidadSucursal.deleteMany();
  await prismaAdmin.registroAuditoria.deleteMany();
  await prismaAdmin.indicePrecio.deleteMany();
  await prismaAdmin.cotizacionDolar.deleteMany();
  await prismaAdmin.usuarioEmpresa.deleteMany();
  await prismaAdmin.session.deleteMany();
  await prismaAdmin.account.deleteMany();
  // Invitacion (E5) apunta a User y a Empresa con ON DELETE RESTRICT: sus filas se borran antes que las de ellos.
  await prismaAdmin.invitacion.deleteMany();
  await prismaAdmin.user.deleteMany();
  await prismaAdmin.rol.deleteMany();
  await prismaAdmin.accion.deleteMany();
  // RecetaVersion.sucursalId / RecetaSucursal.sucursalId referencian a la sucursal: las recetas se borran antes que ella.
  await prismaAdmin.recetaSucursal.deleteMany();
  await prismaAdmin.sustitutoRecetaIngrediente.deleteMany();
  await prismaAdmin.recetaIngrediente.deleteMany();
  await prismaAdmin.recetaVersion.deleteMany();
  await prismaAdmin.sucursal.deleteMany();

  await prismaAdmin.presentacion.deleteMany();
  await prismaAdmin.proveedorPorProducto.deleteMany();
  await prismaAdmin.producto.deleteMany();
  await prismaAdmin.insumo.deleteMany();
  await prismaAdmin.grupo.deleteMany();
  await prismaAdmin.categoriaProducto.deleteMany();
  await prismaAdmin.unidad.deleteMany();
  await prismaAdmin.proveedor.deleteMany();

  // Plataforma (ADR-007, A2): `empresaId` tiene default `app_empresa_actual()` (la ÚNICA empresa ACTIVE), así que la base de test
  // tiene que terminar con exactamente la empresa por defecto de la migración, en pie y ACTIVE, sea lo que sea que un test haya tocado.
  // El registro de módulos (P4) apunta a la empresa con ON DELETE RESTRICT: las filas de las empresas que se van se borran antes. Las de la empresa por defecto quedan.
  await prismaAdmin.moduloEmpresa.deleteMany({ where: { empresaId: { not: EMPRESA_POR_DEFECTO_ID } } });
  await prismaAdmin.empresa.deleteMany({ where: { id: { not: EMPRESA_POR_DEFECTO_ID } } });
  await prismaAdmin.empresa.upsert({
    where: { id: EMPRESA_POR_DEFECTO_ID },
    update: { estado: "ACTIVE", permisosEditables: true, dosPaneles: true },
    create: { id: EMPRESA_POR_DEFECTO_ID, nombre: "Empresa principal", slug: "principal", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" },
  });
  // El registro de módulos de la empresa por defecto termina como lo deja la migración: los 9 vendibles ACTIVO (un test pudo apagar o borrar alguno).
  await activarTodosLosModulos(EMPRESA_POR_DEFECTO_ID);
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

/**
 * Replica en `destinoId` la carta PROPIA (contenido, géneros e ítems agrupados con sus opciones) de `origenId` (ADR-009, C3): la carta es de cada
 * sucursal, así que un test que quiere que DOS sucursales vean la misma estructura tiene que dársela a las dos. Mismo mapeo que la acción
 * `copiarCartaDeSucursal`, sin permisos ni auditoría.
 */
export async function replicarCartaDeSucursal(origenId: string, destinoId: string) {
  const generoNuevo = new Map<string, string>();
  for (const g of await prisma.generoCarta.findMany({ where: { sucursalId: origenId } })) {
    const n = await prisma.generoCarta.create({ data: { sucursalId: destinoId, nombre: g.nombre, orden: g.orden, activo: g.activo } });
    generoNuevo.set(g.id, n.id);
  }
  const genero = (id: string | null) => (id ? (generoNuevo.get(id) ?? null) : null);
  for (const it of await prisma.itemAgrupadoCarta.findMany({ where: { sucursalId: origenId }, include: { opciones: true } })) {
    const n = await prisma.itemAgrupadoCarta.create({
      data: { sucursalId: destinoId, nombre: it.nombre, seccionCartaId: it.seccionCartaId, descripcion: it.descripcion, tags: it.tags, especial: it.especial, orden: it.orden, activo: it.activo, generoCartaId: genero(it.generoCartaId) },
    });
    for (const o of it.opciones) await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: destinoId, itemAgrupadoCartaId: n.id, productoId: o.productoId, orden: o.orden } });
  }
  for (const c of await prisma.contenidoCartaProducto.findMany({ where: { sucursalId: origenId } })) {
    await prisma.contenidoCartaProducto.create({
      data: { sucursalId: destinoId, productoId: c.productoId, visibleEnCarta: c.visibleEnCarta, seccionCartaId: c.seccionCartaId, descripcion: c.descripcion, tags: c.tags, especial: c.especial, orden: c.orden, generoCartaId: genero(c.generoCartaId) },
    });
  }
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
    prisma.rol.create({ data: { nombre: "admin", clave: "admin" } }),
    prisma.rol.create({ data: { nombre: "operador", clave: "operador" } }),
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
