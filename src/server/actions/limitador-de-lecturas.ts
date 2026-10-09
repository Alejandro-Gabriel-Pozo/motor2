import { crearLimitadorDeTasa } from "@/core/permisos/limitador-tasa";

/**
 * Cupo de las LECTURAS por usuario (S-28, T11 del endurecimiento). El limitador de mutaciones (`limitador-de-mutaciones.ts`, 300 por minuto, lo cuenta `conPermiso`) no alcanza a las
 * lecturas: una Server Action de lectura (`requerirVer*`, `con-sesion.ts`) y los reportes se podían pedir sin freno, y un usuario autenticado de UNA empresa que las repetía en bucle
 * (un script con su sesión, o un bug del cliente) le gastaba la base a TODAS: la base de Neon es compartida. Dos cupos, cada uno en la memoria de la instancia y por usuario:
 *  - las lecturas en general (`lecturaSinCupo`, que cuenta `requerirSesion`, el primer paso de todo `requerirVer*`): 600 por minuto, tan alto como el de las mutaciones
 *    a propósito (una pantalla con varias grillas dispara decenas de lecturas al abrirse);
 *  - los reportes PESADOS (`reportePesadoSinCupo`, que cuentan sus páginas): 30 por minuto y por reporte. Son los tres que recorren más historia —el resumen consolidado (todas las
 *    sucursales), el rendimiento de recetas y el reporte por período—; abrirlos o cambiar su rango 30 veces en un minuto es de un script, no de una persona (y los e2e, que
 *    comparten un usuario y un servidor, quedan por debajo: 30 y no 20 por eso).
 *
 * BEST EFFORT y declarado, como el de las mutaciones: cada instancia serverless cuenta por su cuenta y el conteo se pierde en un arranque en frío. No reemplaza un límite distribuido ni
 * el firewall de Vercel (E.6 del plan de endurecimiento); corta el caso barato y real: un bucle de un solo usuario contra una instancia. Los números son defaults a confirmar por el
 * dueño (decisión B17 del carril B), revertibles cambiando estas constantes. La instancia vive acá y no en `core` (que no tiene estado de módulo).
 */
export const MAXIMO_DE_LECTURAS_POR_MINUTO = 600;
export const MAXIMO_DE_REPORTES_PESADOS_POR_MINUTO = 30;
const VENTANA_MS = 60_000;

/** Los reportes que más historia recorren: cada uno con su propio cupo. Una lista cerrada: un reporte pesado nuevo entra acá y en su página (`lecturas-con-cupo.test.ts`). */
export const REPORTES_PESADOS = ["resumen-consolidado", "rendimiento-recetas", "periodo"] as const;
export type ReportePesado = (typeof REPORTES_PESADOS)[number];

export const MENSAJE_DEMASIADAS_LECTURAS = "Demasiadas consultas seguidas — esperá un minuto e intentá de nuevo.";

const limitadorDeLecturas = crearLimitadorDeTasa(MAXIMO_DE_LECTURAS_POR_MINUTO, VENTANA_MS);
const limitadorDeReportesPesados = crearLimitadorDeTasa(MAXIMO_DE_REPORTES_PESADOS_POR_MINUTO, VENTANA_MS);

/** ¿Este usuario ya gastó sus lecturas del minuto? Cuenta la que se está atendiendo. `ahora` en milisegundos: el limitador no lee el reloj. */
export function lecturaSinCupo(usuarioId: string, ahora: number): boolean {
  return limitadorDeLecturas.excedeLimite(usuarioId, ahora);
}

/**
 * M-19: ¿este usuario YA está pasado del cupo? Solo mira, no cuenta. Lo usa `requerirSesion` ANTES de resolver el contexto (que lee la base: pertenencias, sucursales, rol) para que quien ya
 * se pasó no siga gastando esas lecturas en cada pedido; el pedido que sí cuenta sigue siendo el de `lecturaSinCupo`, DESPUÉS de resolver al usuario (la regla de `lecturas-con-cupo.test.ts`).
 */
export function lecturaYaSinCupo(usuarioId: string, ahora: number): boolean {
  return limitadorDeLecturas.yaExcedida(usuarioId, ahora);
}

/** ¿Este usuario ya gastó los pedidos del minuto de ESTE reporte pesado? Cuenta el que se está atendiendo; cada reporte lleva su cuenta. */
export function reportePesadoSinCupo(usuarioId: string, reporte: ReportePesado, ahora: number): boolean {
  return limitadorDeReportesPesados.excedeLimite(`${reporte}:${usuarioId}`, ahora);
}
