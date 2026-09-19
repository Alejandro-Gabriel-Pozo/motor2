import type { ContextoUsuario } from "@/core/auth/contexto";
import { signOut } from "@/lib/auth";
import { GRUPOS_NAV, accionesDelMenu, filtrarMenuPorPermiso } from "@/core/navegacion/estructura";
import { accionesQueElUsuarioPuedeVer } from "@/core/permisos/gate";
import { SidebarColapsable } from "./sidebar-colapsable";
import { SelectorSucursal } from "./selector-sucursal";

/**
 * Shell persistente de toda la app autenticada — reemplaza las 6 copias
 * del mismo header (una por `layout.tsx` de sección, cada una con su
 * propio array de links y sus links "← / →" a mano para saltar a la
 * sección vecina). Ahora es un solo sidebar con TODOS los grupos siempre
 * visibles, más un encabezado angosto con quién sos y "Salir". El sidebar
 * es colapsable (SidebarColapsable) — antes no tenía ningún mecanismo de
 * achicarse, ni en desktop ni en mobile.
 */
export async function AppShell({ ctx, children }: { ctx: ContextoUsuario; children: React.ReactNode }) {
  // El menú solo muestra los reportes que el rol puede ver (la página igual se protege por su cuenta: esto evita enlaces a «no tenés permiso»).
  const puedeVer = await accionesQueElUsuarioPuedeVer(ctx.usuarioId, ctx.sucursalId, accionesDelMenu());
  const grupos = filtrarMenuPorPermiso(GRUPOS_NAV, puedeVer);

  return (
    <div className="flex flex-1">
      <SidebarColapsable grupos={grupos} />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end gap-4 border-b border-neutral-200 px-6 py-3 text-sm text-neutral-500 dark:border-neutral-800">
          <span className="flex items-center gap-1">
            {ctx.email} ·{" "}
            {ctx.membresias.length > 1 ? (
              <SelectorSucursal membresias={ctx.membresias} actual={ctx.sucursalId} />
            ) : (
              ctx.sucursalNombre
            )}{" "}
            · {ctx.rolNombre}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button type="submit" className="underline">
              Salir
            </button>
          </form>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
