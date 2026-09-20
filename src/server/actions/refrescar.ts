import { refresh } from "next/cache";

/**
 * Pide refrescar la ruta actual tras una mutación exitosa — sin esto, en
 * esta versión de Next un Server Action NO revalida solo: la página sigue
 * mostrando los datos viejos en un navegador real hasta que el usuario
 * recarga a mano (ver node_modules/next/dist/docs/01-app/02-guides/
 * server-actions.md, "An action that does none of the above ... the
 * current route is not re-rendered"). Detectado con un navegador real
 * (Playwright), no con Vitest, que llama estas funciones directo desde
 * Node sin el contexto real de un Server Action de Next — por eso esta
 * función traga específicamente el error E870 ("refresh can only be
 * called from within a Server Action") y deja pasar cualquier otro error
 * sin tocar. Es un no-op inofensivo si el llamador redirige después.
 */
export function refrescarVistaSiHaceFalta(): void {
  try {
    refresh();
  } catch (e) {
    const codigo = e instanceof Error ? (e as Error & { __NEXT_ERROR_CODE?: string }).__NEXT_ERROR_CODE : undefined;
    if (codigo === "E870") return;
    throw e;
  }
}
