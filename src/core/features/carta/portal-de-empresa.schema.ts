import type { ResultadoCaso } from "@/core/resultado-caso";
import type { PartesDeImagen } from "@/core/carta/public";
import type { DatosDelPortal, TarjetaDePortal, ZonaDePortal } from "@/core/carta/public";

/**
 * Tipos de la feature «portal de la empresa» (diseño `docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md` §7; Pedernal `guardarPortalDeLaEmpresa`): los comandos y resultados del caso de uso
 * `src/server/actions/carta/casos-de-uso/guardar-portal-de-empresa.ts`, que viene de la Server Action `guardarPortalDeEmpresa` (`src/server/actions/carta/portal-empresa.ts`). El portal es de la EMPRESA (la que sale del
 * contexto del servidor): nunca viaja en el comando. Mismo criterio que `orden-de-renglones.schema.ts`.
 */

/** Tope de tarjetas y de zonas en UN pedido: protección contra un pedido desmedido (no es una regla de negocio; una empresa no llega a tener tantas sucursales). */
export const MAXIMO_DE_TARJETAS_Y_ZONAS = 200;

/** Una zona tal como llega del pedido: sin `id` (las nuevas reciben el suyo en el servidor; una zona ya cargada se identifica por su sucursal). */
export type ZonaPedida = Omit<ZonaDePortal, "id">;

/**
 * Lo que dice el formulario, ya validado por el guard. `imagen`: `undefined` = conservar la que tiene (así cambiar de variante no pierde la imagen de la B), `null` = quitarla. Las tarjetas y las zonas que llegan se agregan o cambian por su sucursal;
 * lo que NO llega queda como está y nunca se borra (se oculta con `visible: false`). `versionEsperada` es la del portal que vio la pantalla (`undefined` = la pantalla no vio ninguno: es un alta).
 */
export interface PedidoDeGuardarPortalDeEmpresa {
  datos: DatosDelPortal;
  imagen: PartesDeImagen | null | undefined;
  tarjetas: TarjetaDePortal[];
  zonas: ZonaPedida[];
  versionEsperada: number | undefined;
}

/**
 * El comando del caso de uso: el pedido más lo que arma la Server Action en el servidor. `portalId` es el id (uuid) con el que se crearía el portal y `codigoNuevo` la llave del QR (128 bits de azar): solo se usan al crear; un reintento
 * del mismo alta no puede crear dos (la base tiene un único por empresa). Cada zona trae su `id` (uuid, generado en el servidor) para el caso de que sea nueva.
 */
export interface ComandoGuardarPortalDeEmpresa extends Omit<PedidoDeGuardarPortalDeEmpresa, "zonas"> {
  zonas: ZonaDePortal[];
  portalId: string;
  codigoNuevo: string;
}

/**
 *  - `DATO_INVALIDO`: el código o el id que armó el servidor no tienen la forma de la base (red de seguridad; no debería ocurrir);
 *  - `SUCURSAL_NO_ENCONTRADA`: una tarjeta o una zona apunta a una sucursal que no es de la empresa (o no existe: misma respuesta);
 *  - `VERSION_DESACTUALIZADA`: otra persona cambió el portal (o lo creó con otro contenido) mientras se miraba la pantalla: no se cambió nada;
 *  - `PORTAL_NO_VISTO`: el portal ya existe y el pedido no trae la versión que vio la pantalla.
 * `yaEstaba` es `true` si el portal ya tenía exactamente esos datos (no se escribió ni se auditó). `codigo` es la llave del QR del portal (la de siempre si ya existía).
 */
export type ResultadoGuardarPortalDeEmpresa = ResultadoCaso<{ portalId: string; codigo: string; version: number; yaEstaba: boolean }, "DATO_INVALIDO" | "SUCURSAL_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA" | "PORTAL_NO_VISTO">;
