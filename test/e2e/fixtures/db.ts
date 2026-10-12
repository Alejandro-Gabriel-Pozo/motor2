import "dotenv/config";
import { prisma as prismaSinEmpresa } from "../../../src/lib/db";
import { clienteConEmpresaDePrueba } from "../../setup/empresa-de-prueba";
import { resolverUrlPruebasE2E } from "./base-e2e";

/**
 * El cliente con el que los specs de Playwright SIEMBRAN datos: como en Vitest (ADR-022), abre la conexión con la empresa de prueba fijada, así que lo que un spec siembra cae en ella sin
 * depender de «la única empresa activa». Siembra con el ROL DE PRUEBAS `motor2_app_pruebas` (`MOTOR2_E2E_PRUEBAS_DATABASE_URL`, M.3-A8: mismos privilegios que `motor2_app`, fuera de sus
 * políticas por sucursal de la Fase B); sin la variable cae a la de la app (`DATABASE_URL`, que `playwright.config.ts` fija a `motor2_app`), como antes, y la config avisa. El SERVIDOR de la app
 * usa su propio cliente, sin empresa (`src/lib/db`), con la semántica de producción y SIEMPRE como `motor2_app`. `prismaSinEmpresa` es el del proceso, para lo que prueba explícitamente la ausencia de contexto.
 */
export const prisma = clienteConEmpresaDePrueba(resolverUrlPruebasE2E(process.env)?.url ?? process.env.DATABASE_URL ?? "");
export { prismaSinEmpresa };
