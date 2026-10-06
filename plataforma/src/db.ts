import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { instalacionesConfiguradas, type Instalacion } from "./entorno";
import { crearRegistroDeClientes, type RegistroDeClientes } from "./registro-de-clientes";

/**
 * Las conexiones de la consola, todas con el rol `motor2_plataforma` (privilegio mínimo) y sin respaldo en `DATABASE_URL` (ver `entorno.ts`). UNA consola administra varias instalaciones
 * (ADR-025), cada una con su base:
 *  - `dbDeIdentidad()`: la base de la instalación PRINCIPAL, donde viven los administradores, las sesiones y los códigos de ingreso. Es lo único que usan el ingreso y la sesión.
 *  - `dbDeInstalacion(instalacion)`: la base de la instalación que se está operando (empresas, invitaciones, módulos y su auditoría). Recibe una instalación YA resuelta contra la lista
 *    configurada, nunca un texto.
 * Cada cliente se crea al primer uso, no al importar, y se guarda en `globalThis` para sobrevivir a la recarga en caliente de desarrollo. Pocas conexiones y con tiempo límite: una base que
 * no responde no debe colgar un pedido, y una instalación caída no afecta a las demás.
 */
const CONEXIONES_POR_CLIENTE = 3;
const ESPERA_MAXIMA_DE_CONEXION_MS = 10_000;

const global = globalThis as unknown as { registroDePrismaPlataforma?: RegistroDeClientes<PrismaClient> };

function crearCliente(connectionString: string): PrismaClient {
  const opciones = { connectionString, max: CONEXIONES_POR_CLIENTE, connectionTimeoutMillis: ESPERA_MAXIMA_DE_CONEXION_MS };
  const adapter = /\bneon\.tech\b/.test(connectionString) ? new PrismaNeon(opciones) : new PrismaPg(opciones);
  return new PrismaClient({ adapter });
}

function registro(): RegistroDeClientes<PrismaClient> {
  global.registroDePrismaPlataforma ??= crearRegistroDeClientes(crearCliente);
  return global.registroDePrismaPlataforma;
}

/** La base de identidad: siempre la de la instalación principal. */
export function dbDeIdentidad(): PrismaClient {
  const principal = instalacionesConfiguradas()[0];
  return registro().obtener(principal.id, principal.databaseUrl);
}

/** La base de la instalación operada. La principal comparte el cliente con la identidad (no se abren dos pools contra la misma base). */
export function dbDeInstalacion(instalacion: Instalacion): PrismaClient {
  return registro().obtener(instalacion.id, instalacion.databaseUrl);
}
