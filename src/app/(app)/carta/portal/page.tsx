import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { FilaDeCarta } from "@/components/fila-de-carta";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { AvisoSoloLectura } from "@/components/carta/datos-solo-lectura";
import { CLAVES_PORTAL_V1, PESTANAS_DE_APARIENCIA, urlCartaPublicaConEmpresaUnica, type SucursalPortalAdmin } from "@/core/carta/public";
import { cargarAdminPortal, cargarPortalEmpresaAdmin } from "@/server/consultas/carta/admin";
import { entradasVistaPreviaPortal } from "@/core/carta/public";
import { guardarPortalEmpresa } from "@/server/actions/carta/portal-empresa";
import { agregarSucursalAlPortal, guardarSucursalPublica, moverSucursalEnMapa, quitarSucursalDelPortal } from "@/server/actions/carta/registro-publico";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { EditorPortal } from "@/components/carta/editor-portal";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";

/**
 * Portal de sucursales (docs/plan-registro-tenants-2026-09-24.md, M7): el registro que arma el portal de la carta pública
 * (ADR-006: módulo interno; antes lo leía restaurant-menu-design por HTTP) — slug (/carta/<slug>), etiqueta, dominio, subtítulo,
 * posición en el mapa, orden, si está publicada, y de dónde sale el menú.
 *
 * Todas las sucursales (el mapa es entre sucursales, no depende de la activa). Sin fila → "Agregar al portal"; con fila → su
 * formulario. Mismo estilo que /carta: las mutaciones pasan por las Server Actions de
 * src/server/actions/carta/registro-publico.ts (conPermisoDeEmpresa("carta_portal")) y el refresco lo piden los closures de acá. Los closures
 * capturan solo el id de la sucursal (texto): lo que captura un closure "use server" viaja al cliente.
 */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

const valoresDelFormulario = (fd: FormData) => Object.fromEntries(CLAVES_PORTAL_V1.map((d) => [d.clave, String(fd.get(d.clave) ?? "")]));

/** El enlace a la carta pública (otro sitio, en otra pestaña): el aspecto de `Enlace` (`ui/primitivas/enlace.tsx`), que no se usa acá porque el destino es una URL absoluta y no una pantalla de la aplicación. */
const CLASE_ENLACE_EXTERNO = "text-tinta-suave underline hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco";

export default async function PortalSucursalesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_portal", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  // DEC-33 (ver ≠ escribir): con «Ver» y sin «Editar» de `carta_portal`, el editor sale deshabilitado y cada sucursal como texto, sin agregar, editar ni quitar; las acciones igual lo exigen.
  const [sucursales, apariencia, nivel] = await Promise.all([cargarAdminPortal(ctx.db), cargarPortalEmpresaAdmin(ctx.db), obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_portal", ctx.db)]);
  const puedeEditar = nivel.editar;

  return (
    <div className="flex flex-col gap-6">
      <FilaDeCarta ctx={ctx} etiqueta="Apariencia y publicación" pestanas={PESTANAS_DE_APARIENCIA} ruta="/carta/portal" />
      <div>
        <h1 className="mb-1 text-xl font-semibold">Portal de sucursales</h1>
        <p className="text-sm text-tinta-tenue">
          Qué sucursales muestra la carta pública en su portal y con qué dirección (/carta/&lt;slug&gt;). «Quitar del portal» la apaga, no la borra: la dirección queda reservada para esa sucursal. Solo sale en el portal si está publicada y la sucursal está
          activa. La carta toma los cambios en hasta 5 minutos.
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
          <a href={urlCartaPublicaConEmpresaUnica(process.env.CARTA_DOMINIO_BASE, process.env.CARTA_EMPRESA_UNICA_COMPILADO, ctx.empresaSlug)} target="_blank" rel="noopener noreferrer" className={CLASE_ENLACE_EXTERNO}>
            Ver el portal de motor2 →
          </a>
        </div>
        {!puedeEditar && <AvisoSoloLectura />}
      </div>

      <section aria-labelledby="titulo-apariencia-portal" className="flex flex-col gap-2">
        <h2 id="titulo-apariencia-portal" className="text-lg font-medium">
          Apariencia del portal
        </h2>
        <p className="text-sm text-tinta-tenue">
          Título, colores, logo, imagen del mapa y tamaños de las tarjetas. Con imagen del mapa y al menos una sucursal con posición (más abajo), el portal
          muestra las tarjetas sobre la imagen; sin eso, es una lista. Vacío = el default. El portal toma los cambios al recargarlo.
        </p>
        <EditorPortal
          valoresIniciales={apariencia.valores}
          version={apariencia.actualizadoEn?.toISOString() ?? "sin-apariencia"}
          empresaNombre={ctx.empresaNombre}
          sucursales={entradasVistaPreviaPortal(sucursales)}
          soloLectura={!puedeEditar}
          urlsPorSlug={Object.fromEntries(sucursales.flatMap((s) => (s.publica ? [[s.publica.slug, urlCartaPublicaConEmpresaUnica(process.env.CARTA_DOMINIO_BASE, process.env.CARTA_EMPRESA_UNICA_COMPILADO, ctx.empresaSlug, s.publica.slug)]] : [])))}
          accion={async (fd: FormData) => {
            "use server";
            return refrescarSiOk(await guardarPortalEmpresa(valoresDelFormulario(fd)));
          }}
          mover={async (id: string, x: number, y: number) => {
            "use server";
            return refrescarSiOk(await moverSucursalEnMapa(id, x, y));
          }}
        />
      </section>

      <ul className="flex flex-col gap-3">
        {sucursales.map((s) => (
          <SucursalEnPortal key={s.id} sucursal={s} empresaSlug={ctx.empresaSlug} puedeEditar={puedeEditar} />
        ))}
        {!sucursales.length && <li className="text-sm text-tinta-tenue">No hay sucursales.</li>}
      </ul>
    </div>
  );
}

function estadoEnPortal(s: SucursalPortalAdmin): string {
  if (!s.publica) return "no está en el portal";
  if (!s.publica.publicada) return `/carta/${s.publica.slug} · sin publicar`;
  return `/carta/${s.publica.slug} · ${s.activo ? "publicada" : "publicada, pero la sucursal está inactiva: no se muestra"}`;
}

/** Se ve en vivo solo publicada y con la sucursal activa — igual criterio que la carta real (D7: activo = publicada && Sucursal.activo). */
function seVeEnVivo(s: SucursalPortalAdmin): boolean {
  return Boolean(s.publica?.publicada) && s.activo;
}

function SucursalEnPortal({ sucursal: s, empresaSlug, puedeEditar }: { sucursal: SucursalPortalAdmin; empresaSlug: string; puedeEditar: boolean }) {
  const sucursalId = s.id;
  const p = s.publica;
  return (
    <li className="rounded border p-3" data-sucursal-portal={s.nombre}>
      <p className="text-sm">
        <span className="font-medium">{s.nombre}</span>
        {!s.activo && <span className="text-tinta-tenue"> (inactiva)</span>} · {estadoEnPortal(s)}
        {p && seVeEnVivo(s) && (
          <>
            {" · "}
            <a href={urlCartaPublicaConEmpresaUnica(process.env.CARTA_DOMINIO_BASE, process.env.CARTA_EMPRESA_UNICA_COMPILADO, empresaSlug, p.slug)} target="_blank" rel="noopener noreferrer" className={CLASE_ENLACE_EXTERNO}>
              Ver la carta de motor2 →
            </a>
          </>
        )}
      </p>
      {p && (
        // Solo lectura (docs/plan-tema-carta-2026-09-24.md, M6): de dónde saca la carta los colores y textos de esta sucursal.
        <p className="text-sm text-tinta-tenue">
          Tema: {s.temaDesdeMotor2 ? "aplicado (Tema de la carta)" : "estilo por defecto"}
        </p>
      )}

      {!puedeEditar ? null : !p ? (
        <FormConResultado
          accion={async () => {
            "use server";
            return refrescarSiOk(await agregarSucursalAlPortal(sucursalId));
          }}
          className="mt-2"
        >
          <BotonDeServidor type="submit" tamano="compacto">
            Agregar «{s.nombre}» al portal
          </BotonDeServidor>
        </FormConResultado>
      ) : (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm">Editar «{s.nombre}» en el portal</summary>
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(
                await guardarSucursalPublica(sucursalId, {
                  slug: campo(fd, "slug"),
                  etiqueta: campo(fd, "etiqueta"),
                  subtituloPortal: campo(fd, "subtituloPortal"),
                  posX: campo(fd, "posX"),
                  posY: campo(fd, "posY"),
                  posW: campo(fd, "posW"),
                  posH: campo(fd, "posH"),
                  orden: campo(fd, "orden"),
                  publicada: fd.get("publicada") === "on",
                })
              );
            }}
            className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <Campo etiqueta="Slug (dirección /carta/<slug>)" name="slug" required defaultValue={p.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={60} />
            <Campo etiqueta="Etiqueta (opcional, si no se usa el nombre)" name="etiqueta" defaultValue={p.etiqueta ?? ""} placeholder={s.nombre} maxLength={80} />
            <Campo etiqueta="Orden en el portal" name="orden" type="number" step={1} defaultValue={p.orden} />
            <div className="sm:col-span-2">
              <Campo etiqueta="Subtítulo en el portal (público, opcional)" name="subtituloPortal" defaultValue={p.subtituloPortal ?? ""} placeholder="Frente al lago" maxLength={200} />
            </div>

            <fieldset className="flex flex-wrap gap-3 rounded border p-2 sm:col-span-2">
              <legend className="px-1 text-sm">Posición en el mapa del portal (% del mapa, 0 a 100; x, y y ancho juntos)</legend>
              <CampoPosicion nombre="posX" etiqueta="x (centro)" valor={p.posX} />
              <CampoPosicion nombre="posY" etiqueta="y (centro)" valor={p.posY} />
              <CampoPosicion nombre="posW" etiqueta="Ancho" valor={p.posW} />
              <CampoPosicion nombre="posH" etiqueta="Alto (opcional)" valor={p.posH} />
            </fieldset>

            <Casilla etiqueta="Publicada en el portal" name="publicada" defaultChecked={p.publicada} />

            <div className="sm:col-span-2">
              <BotonDeServidor type="submit" tamano="compacto">
                Guardar «{s.nombre}»
              </BotonDeServidor>
            </div>
          </FormConResultado>

          <FormConResultado
            accion={async () => {
              "use server";
              return refrescarSiOk(await quitarSucursalDelPortal(sucursalId));
            }}
            className="mt-3 border-t pt-3"
          >
            <p className="text-sm text-tinta-tenue">Quitarla la saca del portal y de su dirección pública, pero conserva estos datos: el slug queda reservado para esta sucursal. Para volver a mostrarla, marcá «Publicada en el portal» y guardá.</p>
            <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
              Quitar «{s.nombre}» del portal
            </BotonDeServidor>
          </FormConResultado>
        </details>
      )}
    </li>
  );
}

function CampoPosicion({ nombre, etiqueta, valor }: { nombre: string; etiqueta: string; valor: number | null }) {
  return <Campo etiqueta={etiqueta} name={nombre} type="number" min={0} max={100} step="0.01" defaultValue={valor ?? ""} className="max-w-24" />;
}
