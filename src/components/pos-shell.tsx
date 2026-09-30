import Link from "next/link";
import { IndicadorDeEnlace } from "@/components/indicador-de-enlace";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { pantallaDeInicio } from "@/core/navegacion/inicio";
import { signOut } from "@/lib/auth";
import { SelectorSucursal } from "./selector-sucursal";

/** Pantalla del módulo POS, dentro de la que un enlace «Administración» no tiene sentido: es la de inicio de quien solo tiene salón. */
const RUTA_MAPA_DE_MESAS = "/mesas";

/**
 * Shell del salón (módulo POS, route group `(pos)`) — hermano de `AppShell`, no una variante: la pantalla del mozo no lleva el
 * menú lateral de la administración, ni la cotización del dólar (ni su `after()`), ni el `AccionesVisiblesProvider` (acá no hay
 * `EnlaceInterno`). Solo un encabezado angosto con la sucursal (o el selector si hay más de una), quién sos y «Salir», y un
 * enlace de vuelta a la administración para quien la tiene (quien solo ve el salón entra directo a /mesas: para esa persona
 * la «pantalla de inicio» ES esta, y el enlace no aparece).
 *
 * `pos-shell` aplica los tokens de color del salón (src/app/globals.css): fondo papel, tinta oscura y `color-scheme: light`, fijos
 * aunque el sistema esté en modo oscuro. Van acá y no en `:root` para no ensuciar el namespace de toda la administración.
 */
export async function PosShell({ ctx, children }: { ctx: ContextoUsuario; children: React.ReactNode }) {
  const inicio = await pantallaDeInicio(ctx);

  return (
    <div className="pos-shell flex flex-1 flex-col">
      <header className="border-b border-[var(--border)] bg-white">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm text-[var(--ink-soft)] md:px-8">
          <span className="flex items-center gap-2 font-semibold text-[var(--ink)]">
            Salón ·{" "}
            {ctx.membresias.length > 1 ? <SelectorSucursal membresias={ctx.membresias} actual={ctx.sucursalId} /> : ctx.sucursalNombre}
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {inicio !== RUTA_MAPA_DE_MESAS && (
              <Link href={inicio} className="underline hover:text-[var(--ink)]">
                Administración
                <IndicadorDeEnlace />
              </Link>
            )}
            <span>
              {ctx.email} · {ctx.rolNombre}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button type="submit" className="underline hover:text-[var(--ink)]">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-5 py-8 md:px-8 md:py-10">{children}</main>
    </div>
  );
}
