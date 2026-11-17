import type { ResultadoCaso } from "@/core/resultado-caso";
import type { PartesDeImagen } from "@/core/carta/public";

/**
 * Tipos de la feature «colores del portal» (pantalla simple de la pestaña Portal; decisión del dueño 2026-11-17): el comando del caso de uso `src/server/actions/carta/casos-de-uso/guardar-colores-del-portal.ts`, que viene de la Server Action
 * `guardarColoresDelPortal` (`src/server/actions/carta/portal-colores.ts`). La empresa sale del contexto del servidor, nunca del pedido. La pantalla manda SOLO lo que muestra: tres fondos, línea superior, título, logo (se muestra o no) e imagen; las tarjetas, las zonas, la
 * variante y el código del QR no viajan y no se tocan (mezcla).
 */

/** Lo que dice el formulario, ya validado por el guard. `null` en un color o en un texto = «sin él» (el valor de siempre del portal). `imagen`: `undefined` = conservar la que tiene, `null` = quitarla. `versionEsperada`: la que vio la pantalla (`undefined` = no vio ningún portal: alta). */
export interface PedidoDeGuardarColoresDelPortal {
  colorEncabezado: string | null;
  colorPagina: string | null;
  colorDetras: string | null;
  lineaSuperior: string | null;
  titulo: string | null;
  logoVisible: boolean;
  imagen: PartesDeImagen | null | undefined;
  versionEsperada: number | undefined;
}

/** El pedido más lo que arma la Server Action en el servidor: el id y el código (128 bits de azar) con los que se crearía el portal si todavía no existe. */
export interface ComandoGuardarColoresDelPortal extends PedidoDeGuardarColoresDelPortal {
  portalId: string;
  codigoNuevo: string;
}

/**
 *  - `DATO_INVALIDO`: el código o el id que armó el servidor no tienen la forma de la base (red de seguridad);
 *  - `PORTAL_NO_SE_PUEDE_CREAR_IGUAL`: la empresa ya tiene cargado un portal que la pantalla simple todavía no puede mantener igual (un mapa, un texto o un color con otra forma): no se crea nada, se dice el motivo;
 *  - `VERSION_DESACTUALIZADA`: otra persona cambió el portal mientras se miraba la pantalla: no se cambió nada;
 *  - `PORTAL_NO_VISTO`: el portal ya existe y el pedido no trae la versión que vio la pantalla.
 * `yaEstaba` es `true` si el portal ya estaba así (no se escribió ni se auditó).
 */
export type ResultadoGuardarColoresDelPortal = ResultadoCaso<{ portalId: string; version: number; yaEstaba: boolean }, "DATO_INVALIDO" | "PORTAL_NO_SE_PUEDE_CREAR_IGUAL" | "VERSION_DESACTUALIZADA" | "PORTAL_NO_VISTO">;
