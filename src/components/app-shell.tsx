import type { ContextoUsuario } from "@/core/auth/contexto";
import { signOut } from "@/lib/auth";
import { GRUPOS_NAV, accionesDeNavegacion, filtrarMenuPorPermiso, hrefsDelMenu } from "@/core/navegacion/estructura";
import { accionesDelMenuQueElUsuarioPuedeVer } from "@/server/acceso/gate";
import { situacionDelRegistroDeModulos } from "@/server/acceso/modulos-de-empresa";
import { politicaDeEmpresa } from "@/server/acceso/politica-de-empresa";
import { Suspense } from "react";
import { after } from "next/server";
import { actualizarDolarSiHaceFalta, cotizacionVencida, obtenerUltimaCotizacionSinRomper } from "@/core/reportes/public-servidor";
import { reportarErrorUnaVez } from "@/lib/reportar-error";
import { CotizacionEncabezado } from "./en-dolares";
import { AccionesVisiblesProvider } from "./enlace-interno";
import { SidebarColapsable } from "./sidebar-colapsable";
import { RecordarPantallaDeGestion } from "./recordar-pantalla-de-gestion";
import { SelectorEmpresa } from "./selector-empresa";
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
  // El menú solo muestra las pantallas que el rol puede ver (la página igual se protege por su cuenta: esto evita enlaces a «no tenés
  // permiso»). Lo mismo vale para los enlaces entre pantallas (`EnlaceInterno`), que reciben este conjunto por contexto.
  const puedeVer = await accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, accionesDeNavegacion(), ctx.db);
  const grupos = filtrarMenuPorPermiso(GRUPOS_NAV, puedeVer);
  const politica = await politicaDeEmpresa(ctx.empresaId, ctx.db);
  // El dólar del encabezado es informativo: si no se puede leer (tabla sin migrar, base lenta), la pantalla sigue igual.
  const cotizacion = await obtenerUltimaCotizacionSinRomper(ctx.db);
  // Si falta la cotización de hoy (el cron diario puede no haber corrido), la aplicación se pone al día sola DESPUÉS de responder.
  if (cotizacionVencida(cotizacion)) after(() => actualizarDolarSiHaceFalta(ctx.db));
  // Una empresa sin ningún módulo vendible disponible solo tiene Administración: se le dice por qué (si no, el menú vacío parece una falla). Si ni
  // siquiera tiene filas en el registro se avisa además a Sentry, una vez por empresa y arranque: puede ser un registro que se perdió.
  const registro = await situacionDelRegistroDeModulos(ctx.empresaId, ctx.db);
  if (registro === "SIN_REGISTRO") {
    after(() =>
      reportarErrorUnaVez(`registro-de-modulos-vacio:${ctx.empresaId}`, new Error(`La empresa ${ctx.empresaId} no tiene ninguna fila en el registro de módulos`), "modulos")
    );
  }

  return (
    <div className="flex flex-1">
      <Suspense fallback={null}>
        <RecordarPantallaDeGestion sucursalId={ctx.sucursalId} />
      </Suspense>
      <SidebarColapsable grupos={grupos} hrefsDelMenu={hrefsDelMenu()} dosPaneles={politica.dosPaneles} sucursalNombre={ctx.sucursalNombre} />
      {/* min-w-0: un ítem flex tiene `min-width: auto` (el ancho mínimo de su contenido) y, sin esto, una tabla ancha, aunque esté dentro de su propio
          `overflow-x-auto`, ensancha esta columna y con ella la PÁGINA entera (la matriz de permisos con varios roles llegaba a 1700 px). Con min-w-0 la
          columna se queda del ancho que sobra junto al menú y el scroll es el de la tabla. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-b border-neutral-200 px-6 py-3 text-sm text-neutral-500 dark:border-neutral-800">
          <CotizacionEncabezado cotizacion={cotizacion} />
          <span className="flex items-center gap-1">
            {ctx.empresas.length > 1 && (
              <>
                <SelectorEmpresa empresas={ctx.empresas} actual={ctx.empresaId} /> ·{" "}
              </>
            )}
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
        {registro !== "CON_MODULOS" && (
          <p role="status" className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            Esta empresa todavía no tiene ningún módulo activo, por eso solo está disponible Administración. Pedile a quien administra la plataforma que active
            los módulos contratados.
          </p>
        )}
        <main className="flex-1 p-6">
          <AccionesVisiblesProvider acciones={[...puedeVer]}>{children}</AccionesVisiblesProvider>
        </main>
      </div>
    </div>
  );
}
