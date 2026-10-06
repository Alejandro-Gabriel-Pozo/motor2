/**
 * Lo que la PLATAFORMA decide para una empresa (add-on, ADR-008 y ADR-010). Acá viven el tipo, los perfiles y el mensaje (puros); la LECTURA es
 * `politicaDeEmpresa` en `server/acceso/politica-de-empresa.ts`, el único lugar que lee esos valores.
 *  - `permisosEditables`: si la empresa puede editar y otorgar permisos (`PermisoRol`) y crear/activar/desactivar roles; las acciones lo
 *    consultan a través de `conEdicionDePermisos`.
 *  - `dosPaneles`: si el menú lateral se parte en los paneles Empresa y Sucursal (ADR-010) para quien ve pantallas de empresa. En `false`
 *    el menú es uno solo, como antes de los paneles: es la marcha atrás y lo que tiene la versión «lite» de un cliente chico.
 *
 * Los valores viven en `Empresa.permisosEditables` y `Empresa.dosPaneles` (por defecto `true`: una empresa nueva es «completa»). Solo los
 * cambia la plataforma —por el script `npm run politica-empresa`—, nunca la propia empresa: ninguna pantalla ni acción de `src/` los escribe
 * (guardián `politica-de-empresa-solo-plataforma.test.ts`).
 */
export interface PoliticaDeEmpresa {
  permisosEditables: boolean;
  dosPaneles: boolean;
}

/**
 * Atajos de la plataforma: un «perfil de política» no se guarda, es solo un nombre para fijar las dos perillas de una vez. Lo que queda
 * guardado en la empresa son las perillas, así que se puede ajustar una sola sin inventar un perfil nuevo. No es un plan en el sentido de
 * ADR-013 (un dato que agrupa módulos): por eso no se llama «plan».
 */
export const PERFILES_DE_POLITICA = {
  completo: { permisosEditables: true, dosPaneles: true },
  lite: { permisosEditables: false, dosPaneles: false },
} as const satisfies Record<string, PoliticaDeEmpresa>;

export type NombreDePerfilDePolitica = keyof typeof PERFILES_DE_POLITICA;

export const MENSAJE_PERMISOS_DE_PLATAFORMA = "Los permisos de tu empresa los administra la plataforma; no se pueden editar desde acá.";
