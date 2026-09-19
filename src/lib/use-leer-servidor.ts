"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Llama a una LECTURA de servidor desde un componente de cliente sin dejar la pantalla colgada si se rechaza.
 *
 * Las lecturas exigen sesión (src/server/actions/con-sesion.ts): si la sesión venció, o un admin desactivó al
 * usuario mientras tenía la pestaña abierta, o se cortó la conexión, la llamada se rechaza. Sin manejo, el
 * componente se quedaba en «Buscando…» para siempre (la línea que apaga el estado de carga nunca corría) o, dentro
 * de una transición, el error subía a la pantalla de error de la página.
 *
 * Si la lectura falla: corre `alFallar` (el componente muestra su aviso y apaga lo que estuviera cargando) y se pide un
 * `router.refresh()`, que vuelve a renderizar la página en el servidor: con la sesión vencida el layout redirige a
 * /login solo, sin que el usuario tenga que adivinar que hay que recargar; con solo un corte de red no cambia nada.
 *
 * Devuelve `undefined` si falló. Ninguna lectura devuelve `undefined` a propósito (devuelven `null` o listas), así que
 * `=== undefined` distingue el fallo de un resultado vacío.
 */
export function useLeerServidor() {
  const router = useRouter();
  return useCallback(
    async <T,>(lectura: () => Promise<T>, alFallar: () => void): Promise<T | undefined> => {
      try {
        return await lectura();
      } catch {
        alFallar();
        router.refresh();
        return undefined;
      }
    },
    [router]
  );
}
