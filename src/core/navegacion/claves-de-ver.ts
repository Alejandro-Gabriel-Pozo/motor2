import type { AccionClave } from "@/core/permisos/acciones";

/** La clave de «Ver» que protege una pantalla del menú (`accion`), o la lista de la que alcanza con una (`algunaDe`, no vacía): una u otra, nunca las dos. La comparten los `ui-config` de cada módulo. */
export type ClavesDeVer = { accion: AccionClave; algunaDe?: never } | { algunaDe: readonly [AccionClave, ...AccionClave[]]; accion?: never };
