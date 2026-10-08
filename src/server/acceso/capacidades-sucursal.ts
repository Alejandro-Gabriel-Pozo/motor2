import type { Prisma, PrismaClient } from "@prisma/client";
import { esCapacidadSiempreHabilitada, resolverCapacidad } from "@/core/permisos/capacidades-sucursal";

type Db = PrismaClient | Prisma.TransactionClient;

// EL LECTOR de `CapacidadSucursal` (Hito 5, pieza 5.2, bloque 2, paso 3b de docs/plan-hito-5-pureza.md; 4A-5 de docs/plan-fase-4-pureza.md). Salió de `core/permisos/capacidades-sucursal.ts`, que se queda
// con las dos reglas PURAS (`esCapacidadSiempreHabilitada`, `resolverCapacidad`): acá solo se lee la base y se le pasan los hechos a esa decisión. Mudanza pura: mismos nombres, firmas y cuerpos.
//
// SIN `import "server-only"`, A PROPÓSITO (a diferencia del resto de `server/acceso/`): la carta pública llega hasta acá (`lecturas/carta/menu` → `precioLocalActivoEn` → `sucursalTieneCapacidad`) y a la carta
// la cargan los fixtures de Playwright (`test/e2e/fixtures/carta-menu.ts`, `test/e2e/carta-portal-admin.spec.ts`) y un script con `tsx` (`scripts/auditoria-benchmark-reportes.ts`), donde el paquete
// `server-only` tira porque no corren con la condición `react-server`. Es la excepción declarada de `server-acceso-lista-cerrada.test.ts` (`SIN_SERVER_ONLY`, verificada en las dos direcciones) y, igual
// que `modulos-de-empresa.ts`, la excepción permanente de la regla 3 de `acceso-solo-por-el-guard.test.ts`. La carta lo alcanza: está en `ALCANCE_CARTA_PUBLICA` (`.dependency-cruiser.cjs`, lista cerrada).

/**
 * Equivalente directo de sucursalTieneCapacidad_ (Sucursales.js:616-628).
 * Gate de RED (aplica a cualquier usuario/rol de esa sucursal), previo al
 * de rol — la Central puede deshabilitar una acción entera para una
 * sucursal completa.
 *
 * Antes eran hasta 2 round-trips secuenciales (fila específica, y solo si
 * no existía, la fila default) — acá es 1 sola consulta que trae ambas
 * candidatas de una (a lo sumo 2 filas) y elige en JS. Esta función se
 * llama en cada `requierePermiso`/`requierePermisoVer`, o sea en casi
 * toda página — con Neon, cada round-trip menos importa.
 */
export async function sucursalTieneCapacidad(
  sucursalId: string,
  accionClave: string,
  db: Db
): Promise<boolean> {
  // Auto-protección (Sucursales.js:618): la matriz de capacidades nunca
  // puede autobloquearse, si no la Central podría quedar sin forma de
  // volver a habilitar algo que deshabilitó por error. Mismo criterio se
  // extiende a gestion_usuarios/gestion_permisos (ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE,
  // acciones.ts): esta capa se evalúa ANTES que el permiso de rol
  // (ver gate.ts), así que sin esto un admin podía lograr acá exactamente
  // lo que esa otra protección ya existe para evitar — dejar a todo el
  // mundo, en todas las sucursales, sin forma de entrar a Usuarios/Permisos.
  if (esCapacidadSiempreHabilitada(accionClave)) return true;

  const candidatas = await db.capacidadSucursal.findMany({
    where: { accionClave, OR: [{ sucursalId }, filaPorDefectoDeLaEmpresaDe(sucursalId)] },
  });

  return resolverCapacidad(candidatas, sucursalId);
}

// O.47 (reserva M3 de la auditoría del Hito 5; docs/pureza-integracion.md): la fila «por defecto» (`sucursalId: null`) es UNA POR EMPRESA (índice único parcial `(empresaId, accionClave)`). Sin este filtro la
// rama `sucursalId: null` traía la fila por defecto de TODAS las empresas, y con un cliente que se saltea el RLS (rol dueño, solo con `MOTOR2_ROL_ESTRICTO=0` fuera de producción) la de otra empresa apagaba
// o encendía la capacidad en esta. Se limita a la empresa de la sucursal pedida con un filtro de relación DENTRO del mismo `where`: la MISMA consulta (una sola, mismas filas con una sola empresa o con RLS),
// así que no cambia el conteo de consultas del gate ni de la matriz de acceso. Es todo lo que cambió en este archivo (frontera de la carta pública: `ALCANCE_CARTA_PUBLICA` no se toca).
function filaPorDefectoDeLaEmpresaDe(sucursalId: string): Prisma.CapacidadSucursalWhereInput {
  return { sucursalId: null, empresa: { sucursalRel: { some: { id: sucursalId } } } };
}

/**
 * Qué acciones (de una lista) tiene habilitadas una sucursal, con UNA consulta en vez de una por acción — para armar el menú.
 * Misma regla que `sucursalTieneCapacidad` (que la comparte vía `resolverCapacidad`).
 */
export async function capacidadesDeSucursal(
  sucursalId: string,
  claves: readonly string[],
  db: Db
): Promise<Set<string>> {
  const candidatas = await db.capacidadSucursal.findMany({
    where: { accionClave: { in: [...claves] }, OR: [{ sucursalId }, filaPorDefectoDeLaEmpresaDe(sucursalId)] },
  });
  const habilitadas = new Set<string>();
  for (const clave of claves) {
    if (esCapacidadSiempreHabilitada(clave) || resolverCapacidad(candidatas.filter((c) => c.accionClave === clave), sucursalId)) habilitadas.add(clave);
  }
  return habilitadas;
}
