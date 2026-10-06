/**
 * Las rutas de la consola (ADR-025). La instalación va en la RUTA y no en una cookie: dos instalaciones pueden tener una empresa con el mismo id (`empresa_principal`), y con una
 * cookie una pestaña desactualizada operaría sobre la instalación equivocada. Toda página, `href`, `redirect` y `revalidatePath` pasa por acá.
 */
const seg = encodeURIComponent;

export const rutaDeInstalacion = (instalacion: string) => `/instalaciones/${seg(instalacion)}`;

export const rutaDeEmpresas = (instalacion: string, filtro?: string) => `${rutaDeInstalacion(instalacion)}/empresas${filtro && filtro !== "todas" ? `?filtro=${seg(filtro)}` : ""}`;

export const rutaDeAlta = (instalacion: string) => `${rutaDeInstalacion(instalacion)}/empresas/nueva`;

export const rutaDeEmpresa = (instalacion: string, empresaId: string, sufijo = "") => `${rutaDeInstalacion(instalacion)}/empresas/${seg(empresaId)}${sufijo ? `/${sufijo}` : ""}`;
