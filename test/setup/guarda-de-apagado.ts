import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { HAY_ROL_DE_PLATAFORMA } from "./cliente-plataforma-real";
import { EMPRESA_DE_PRUEBA_ID, opcionesDeConexionConEmpresa } from "./empresa-de-prueba";
import { datosDeFactura, datosDeRenglon, sembrarAjeno, sembrarEscenarioDeFactura, type EscenarioDeFactura } from "./factura-proveedor";
import { encenderRecepcionDeCompras } from "./modulos";
import { prisma, prismaAdmin } from "./test-db";

/**
 * Apoyo de las pruebas de la guarda de apagado de la recepción separada (`docs/diseno-compras-guarda-de-apagado-2026-11-17.md`, migración 20261117170000): un mundo con dos empresas (la de pruebas, con dos sucursales, y la testigo), partes de compra
 * en cada estado, y conexiones `pg` crudas como el rol que apaga (`motor2_plataforma` si la base de test lo tiene, si no el dueño) y como `motor2_app` (el que carga las compras).
 */
export const MODULO = "recepcion_de_compras";
export const SLUG_DE_LA_EMPRESA_DE_PRUEBA = "principal";

export interface Mundo {
  e: EscenarioDeFactura;
  ajeno: Awaited<ReturnType<typeof sembrarAjeno>>;
}

/** La base ya limpia (la limpia quien llama con `limpiarBaseDeTest`): el escenario de factura (la recepción separada encendida en la empresa de pruebas y en la testigo) y la auditoría de plataforma vacía. */
export async function sembrarMundo(): Promise<Mundo> {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  const e = await sembrarEscenarioDeFactura();
  const ajeno = await sembrarAjeno(e.usuarioId);
  return { e, ajeno };
}

export type EstadoDeLasPartes = "CERO" | "UNA_SIN_ANULAR" | "SOLO_ANULADAS" | "SOLO_RECIBIDAS";
export type DondeEstan = "OTRA_SUCURSAL_DE_LA_EMPRESA" | "OTRA_EMPRESA";

let numeroDeFactura = 0;

/** Una factura con su parte en el estado pedido, en la empresa de pruebas (sucursal Norte) o en la testigo. Con el módulo ACTIVO en esa empresa (la base no deja nacer una pendiente sin él). */
export async function sembrarPartes(m: Mundo, estado: EstadoDeLasPartes, donde: DondeEstan, cuantas = 1): Promise<void> {
  if (estado === "CERO") return;
  const enLaTestigo = donde === "OTRA_EMPRESA";
  const db = enLaTestigo ? m.ajeno.testigo : prisma;
  const proveedorId = enLaTestigo ? m.ajeno.proveedor.id : m.e.proveedorId;
  const sucursalId = enLaTestigo ? m.ajeno.sucursal.id : m.e.sucursalB;
  for (let i = 0; i < cuantas; i++) {
    const nro = `0001-${String(++numeroDeFactura).padStart(8, "0")}`;
    const anulada = estado === "SOLO_ANULADAS" ? { anuladaEn: new Date("2026-09-03T15:00:00.000Z"), anuladaPorId: m.e.usuarioId } : {};
    const factura = await db.facturaProveedor.create({ data: datosDeFactura(m.e, { proveedorId, nroFactura: nro, nroFacturaNormalizado: nro, ...anulada }) as never });
    await db.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: factura.id, productoId: enLaTestigo ? m.ajeno.producto.id : m.e.productoId }) as never });
    const recibida = estado === "SOLO_RECIBIDAS" ? { estadoRecepcion: "RECIBIDA", recibidaEn: new Date("2026-09-02T15:00:00.000Z"), recibidaPorId: m.e.usuarioId } : {};
    await db.facturaProveedorSucursal.create({ data: { facturaProveedorId: factura.id, sucursalId, porcentajeDeclaradoBp: 10000, ...recibida } as never });
  }
}

/** Deja la recepción separada de la empresa en el estado pedido SIN pasar por la guarda (como dueño, apagando el disparador dentro de una transacción): arma el estado «apagado con pendientes» que dejó el sistema antes de la guarda. */
export async function fijarModuloSaltandoLaGuarda(empresaId: string, estado: "ACTIVO" | "INACTIVO"): Promise<void> {
  await encenderRecepcionDeCompras(empresaId);
  const c = await conexionDelDuenio();
  try {
    await c.query("BEGIN");
    await c.query('ALTER TABLE "ModuloEmpresa" DISABLE TRIGGER "ModuloEmpresa_recepcion_pendientes_chk"');
    await c.query('UPDATE "ModuloEmpresa" SET "estado" = $1::"EstadoModulo" WHERE "empresaId" = $2 AND "modulo" = $3', [estado, empresaId, MODULO]);
    await c.query('ALTER TABLE "ModuloEmpresa" ENABLE TRIGGER "ModuloEmpresa_recepcion_pendientes_chk"');
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await c.end();
  }
}

export const estadoDelModulo = async (empresaId: string): Promise<string | null> => (await prismaAdmin.moduloEmpresa.findUnique({ where: { empresaId_modulo: { empresaId, modulo: MODULO } } }))?.estado ?? null;
export const partesPendientesVivas = async (empresaId: string): Promise<number> => prismaAdmin.facturaProveedorSucursal.count({ where: { empresaId, estadoRecepcion: "PENDIENTE", facturaProveedor: { anuladaEn: null } } });

/** Conexión del dueño de las tablas (`DIRECT_URL`). */
export async function conexionDelDuenio(): Promise<Client> {
  const c = new Client({ connectionString: process.env.DIRECT_URL as string });
  await c.connect();
  return c;
}

/** Conexión del que APAGA: el rol real de la consola (`motor2_plataforma`) si hay `PLATAFORMA_DATABASE_URL` (en CI siempre), si no el dueño. */
export async function conexionDelQueApaga(): Promise<Client> {
  const c = new Client({ connectionString: HAY_ROL_DE_PLATAFORMA ? (process.env.PLATAFORMA_DATABASE_URL as string) : (process.env.DIRECT_URL as string) });
  await c.connect();
  return c;
}

/** Conexión de la app (`motor2_app`) con la empresa de pruebas y el alcance de sus dos sucursales fijados, como los fija `conAlcanceEnSucursal` en cada transacción. */
export async function conexionDeLaApp(e: EscenarioDeFactura, empresaId: string = EMPRESA_DE_PRUEBA_ID): Promise<Client> {
  const sucursales = [e.sucursalA, e.sucursalB];
  const c = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(empresaId, { lectura: sucursales, escritura: sucursales }) });
  await c.connect();
  return c;
}

/** La cabecera de una factura (por el cliente de fixtures, ya confirmada) lista para colgarle una parte con SQL crudo. */
export async function nuevaCabecera(m: Mundo, nro: string): Promise<string> {
  const f = await prisma.facturaProveedor.create({ data: datosDeFactura(m.e, { nroFactura: nro, nroFacturaNormalizado: nro }) as never });
  await prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: f.id, productoId: m.e.productoId }) as never });
  return f.id;
}

/** El INSERT de una parte de la sucursal Norte (SQL crudo, como el que escribe la app). Pendiente por defecto; recibida si se pide. */
export function insertarParte(c: Client, m: Mundo, facturaId: string, estado: "PENDIENTE" | "RECIBIDA" = "PENDIENTE") {
  return estado === "PENDIENTE"
    ? c.query('INSERT INTO "FacturaProveedorSucursal" ("id","facturaProveedorId","sucursalId","porcentajeDeclaradoBp") VALUES ($1,$2,$3,10000)', [randomUUID(), facturaId, m.e.sucursalB])
    : c.query(
        'INSERT INTO "FacturaProveedorSucursal" ("id","facturaProveedorId","sucursalId","porcentajeDeclaradoBp","estadoRecepcion","recibidaEn","recibidaPorId") VALUES ($1,$2,$3,10000,\'RECIBIDA\',\'2026-09-02T15:00:00Z\',$4)',
        [randomUUID(), facturaId, m.e.sucursalB, m.e.usuarioId],
      );
}

/** El UPDATE que apaga o enciende la recepción separada de la empresa, como lo escribiría psql. Devuelve `ok` o el error de Postgres (código, restricción y mensaje). */
export async function actualizarModulo(c: Client, empresaId: string, estado: "ACTIVO" | "INACTIVO"): Promise<{ ok: true } | { ok: false; codigo: string; restriccion: string; mensaje: string }> {
  try {
    await c.query('UPDATE "ModuloEmpresa" SET "estado" = $1::"EstadoModulo" WHERE "empresaId" = $2 AND "modulo" = $3', [estado, empresaId, MODULO]);
    return { ok: true };
  } catch (error) {
    const pg = error as { code?: string; constraint?: string; message?: string };
    return { ok: false, codigo: pg.code ?? "otro", restriccion: pg.constraint ?? "", mensaje: pg.message ?? "" };
  }
}
