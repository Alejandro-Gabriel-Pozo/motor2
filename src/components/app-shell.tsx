import type { ContextoUsuario } from "@/core/auth/contexto";
import { signOut } from "@/lib/auth";
import { GRUPOS_NAV } from "@/core/navegacion/estructura";
import { SidebarNav } from "./sidebar-nav";
import { SelectorSucursal } from "./selector-sucursal";

/**
 * Shell persistente de toda la app autenticada — reemplaza las 6 copias
 * del mismo header (una por `layout.tsx` de sección, cada una con su
 * propio array de links y sus links "← / →" a mano para saltar a la
 * sección vecina). Ahora es un solo sidebar con TODOS los grupos siempre
 * visibles, más un encabezado angosto con quién sos y "Salir".
 */
export function AppShell({ ctx, children }: { ctx: ContextoUsuario; children: React.ReactNode }) {
  return (
    <div className="flex flex-1">
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
        <div className="border-b border-neutral-200 px-4 py-3 font-semibold dark:border-neutral-800">Motor2</div>
        <SidebarNav grupos={GRUPOS_NAV} />
      </aside>
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
