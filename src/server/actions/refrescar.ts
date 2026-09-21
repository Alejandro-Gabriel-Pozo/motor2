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
 *
 * QUIÉN LO PIDE (regla de todo el proyecto): el refresco lo pide quien sabe
 * que hubo una mutación y que nadie va a navegar.
 *  - Si el llamador es un COMPONENTE CLIENTE propio (tiene `useRouter`):
 *    `if (r.ok) router.refresh()` en el cliente (ya lo hacen ~21 sitios).
 *  - Si el llamador es un closure `"use server"` dentro de una PÁGINA DE
 *    SERVIDOR (`FormConResultado` o un `<form action>` crudo): la página no
 *    tiene dónde refrescar, así que lo pide la ACCIÓN, con esta función,
 *    justo antes del `ok(...)`. Funciona aunque se llame anidado dentro del
 *    closure (es AsyncLocalStorage: no hace falta subirlo a la página).
 *  - EXCEPCIÓN al punto anterior: si la acción la llaman TAMBIÉN flujos de cliente
 *    dentro de un formulario a medio llenar (`QuickCrear`, `AsistenteHermanar`:
 *    `crearCategoriaProducto`, `crearInsumo`), el pedido va en el CLOSURE de la
 *    página y no en la acción — así el alta rápida no re-renderiza la ruta.
 *  - Si la acción o el closure REDIRIGE, no hace falta nada.
 * NO va centralizado en `conPermiso`: rerenderizaría la ruta en vano en los
 * ~21 flujos que ya refrescan desde el cliente y en todo flujo que redirige,
 * y cambiaría en silencio los modales dentro de un `<form>` (QuickCrear,
 * AsistenteHermanar) que no tienen spec. Ser explícito es lo que permite
 * auditarlo con un grep.
 *
 * EXCEPCIÓN CONOCIDA: `actualizarActivoSucursal` NO lo llama — su único
 * llamador (`ActivarDesactivarFila`) ya hace `router.refresh()` en el cliente.
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
