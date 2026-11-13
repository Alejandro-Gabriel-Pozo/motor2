import type { ContextoUsuario } from "@/server/sesion/contexto";
import { signOut } from "@/lib/auth";
import { GRUPOS_NAV, accionesDeNavegacion, filtrarMenuPorPermiso, hrefsDelMenu, rutasDeUnaEntradaVisibles } from "@/core/navegacion/estructura";
import { accionesDelMenuQueElUsuarioPuedeVer } from "@/server/acceso/gate";
import { situacionDelRegistroDeModulos } from "@/server/acceso/modulos-de-empresa";
import { politicaDeEmpresa } from "@/server/acceso/politica-de-empresa";
import { Suspense } from "react";
import { after } from "next/server";
import { actualizarDolarSiHaceFalta } from "@/server/actions/reportes/sincronizaciones";
import { cotizacionVencida } from "@/core/reportes/public";
import { obtenerUltimaCotizacionSinRomper } from "@/server/consultas/reportes/cotizacion-dolar";
import { reportarErrorUnaVez } from "@/lib/reportar-error";
import { Aviso } from "@/ui/primitivas/aviso";
import { ContenedorDePagina } from "@/ui/componentes/estructura/contenedor-de-pagina";
import { BotonDeServidor } from "./boton-de-servidor";
import { CotizacionEncabezado } from "./en-dolares";
import { AccionesVisiblesProvider } from "./enlace-interno";
import { MenuCelular } from "./menu-celular";
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
 *
 * ESTRUCTURA DE PANTALLA (docs/diseno-estructura-de-pantalla-1366x768-2026-11-09.md, E-A; números en `src/ui/componentes/estructura/reglas.ts`): desde `md` (768 px) el shell ocupa la
 * ventana (`h-dvh`, sin fijar píxeles) y solo se desplaza `<main>`: el encabezado y el menú quedan fijos y las acciones de cada pantalla no quedan a páginas del título. Debajo de
 * `md` se desplaza el documento, como siempre. `<main>` es `relative`: lo que va en `position: absolute` (el texto solo-lector `sr-only`) queda contenido en el área que se desplaza y no agranda el documento. Al imprimir vuelve a la altura automática (si no, solo se imprimiría lo visible). El contenido va en `ContenedorDePagina` (ancho máximo
 * de 1280 px, relleno 16/24).
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
  // El reloj lo lee este borde (O.22-b, Hito 4): `actualizarDolarSiHaceFalta` ya no tiene hora por defecto. La de la sincronización se toma cuando corre el
  // `after`, como antes (no la de armar la pantalla).
  if (cotizacionVencida(cotizacion, new Date())) after(() => actualizarDolarSiHaceFalta(ctx.db, new Date()));
  // Una empresa sin ningún módulo vendible disponible solo tiene Administración: se le dice por qué (si no, el menú vacío parece una falla). Si ni
  // siquiera tiene filas en el registro se avisa además a Sentry, una vez por empresa y arranque: puede ser un registro que se perdió.
  const registro = await situacionDelRegistroDeModulos(ctx.empresaId, ctx.db);
  if (registro === "SIN_REGISTRO") {
    after(() =>
      reportarErrorUnaVez(`registro-de-modulos-vacio:${ctx.empresaId}`, new Error(`La empresa ${ctx.empresaId} no tiene ninguna fila en el registro de módulos`), "modulos")
    );
  }

  return (
    <div className="flex flex-1 md:h-dvh md:flex-none md:overflow-hidden print:h-auto print:overflow-visible">
      <Suspense fallback={null}>
        <RecordarPantallaDeGestion sucursalId={ctx.sucursalId} />
      </Suspense>
      <SidebarColapsable grupos={grupos} hrefsDelMenu={hrefsDelMenu()} dosPaneles={politica.dosPaneles} sucursalNombre={ctx.sucursalNombre} />
      {/* min-w-0: un ítem flex tiene `min-width: auto` (el ancho mínimo de su contenido) y, sin esto, una tabla ancha, aunque esté dentro de su propio
          `overflow-x-auto`, ensancha esta columna y con ella la PÁGINA entera (la matriz de permisos con varios roles llegaba a 1700 px). Con min-w-0 la
          columna se queda del ancho que sobra junto al menú y el scroll es el de la tabla. */}
      <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
        {/* Celular (defecto 4 del ensayo del 2026-11-13): el menú ☰ y el dólar arriba; quién sos (correo que se achica con «…», sucursal y rol) en su propio renglón y «Salir» al final,
            sin «·» sueltos: el separador es parte del texto que sigue. Desde `md:` todo en una línea, como siempre. */}
        <header className="flex flex-shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-borde bg-superficie px-4 py-2 text-sm text-tinta-suave md:justify-end md:px-6 md:py-3">
          <MenuCelular grupos={grupos} hrefsDelMenu={hrefsDelMenu()} rutasDeUnaEntrada={rutasDeUnaEntradaVisibles(puedeVer)} />
          <CotizacionEncabezado cotizacion={cotizacion} />
          <div className="flex min-w-0 basis-full items-center justify-between gap-3 md:basis-auto md:justify-end md:gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-y-1 md:flex-none md:flex-row md:flex-wrap md:items-center md:gap-x-2">
              {ctx.empresas.length > 1 && <SelectorEmpresa empresas={ctx.empresas} actual={ctx.empresaId} />}
              <span className="min-w-0 truncate" title={ctx.email}>
                {ctx.email}
              </span>
              <span className="flex items-center gap-1">
                {ctx.membresias.length > 1 ? <SelectorSucursal membresias={ctx.membresias} actual={ctx.sucursalId} /> : <span>{ctx.sucursalNombre}</span>}
                <span>· {ctx.rolNombre}</span>
              </span>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                Salir
              </BotonDeServidor>
            </form>
          </div>
        </header>
        {registro !== "CON_MODULOS" && (
          <div className="flex-shrink-0 px-4 pt-4 md:px-6 md:pt-6">
            <Aviso variante="advertencia" forma="caja">
              Esta empresa todavía no tiene ningún módulo activo, por eso solo está disponible Administración. Pedile a quien administra la plataforma que active
              los módulos contratados.
            </Aviso>
          </div>
        )}
        <main data-panel className="relative flex-1 md:min-h-0 md:overflow-y-auto print:overflow-visible">
          <ContenedorDePagina>
            <AccionesVisiblesProvider acciones={[...puedeVer]}>{children}</AccionesVisiblesProvider>
          </ContenedorDePagina>
        </main>
      </div>
    </div>
  );
}
