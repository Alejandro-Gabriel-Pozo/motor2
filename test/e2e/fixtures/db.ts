import "dotenv/config";
import { prisma as prismaSinEmpresa } from "../../../src/lib/db";
import { clienteConEmpresaDePrueba } from "../../setup/empresa-de-prueba";

/**
 * El cliente de los specs de Playwright (`motor2_app` sobre la base E2E): como en Vitest (ADR-022), abre la conexión con la empresa de prueba fijada, así que lo que un spec
 * siembra cae en ella sin depender de «la única empresa activa». El SERVIDOR de la app usa su propio cliente, sin empresa (`src/lib/db`), con la semántica de producción.
 * `prismaSinEmpresa` es el del proceso, para lo que prueba explícitamente la ausencia de contexto.
 */
export const prisma = clienteConEmpresaDePrueba(process.env.DATABASE_URL ?? "");
export { prismaSinEmpresa };
