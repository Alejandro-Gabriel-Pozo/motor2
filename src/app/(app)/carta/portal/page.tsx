import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { cargarAdminPortal, cargarPortalEmpresaAdmin, entradasVistaPreviaPortal, type SucursalPortalAdmin } from "@/core/carta/admin-consulta";
import { CLAVES_PORTAL_V1 } from "@/core/carta/portal";
import { urlCartaPublica } from "@/core/carta/host";
import { guardarPortalEmpresa } from "@/server/actions/carta/portal-empresa";
import { agregarSucursalAlPortal, guardarSucursalPublica, moverSucursalEnMapa, quitarSucursalDelPortal } from "@/server/actions/carta/registro-publico";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { FormConResultado } from "@/components/form-con-resultado";
import { EditorPortal } from "@/components/carta/editor-portal";

/**
 * Portal de sucursales (docs/plan-registro-tenants-2026-09-24.md, M7): el registro que arma el portal de la carta pública
 * (ADR-006: módulo interno; antes lo leía restaurant-menu-design por HTTP) — slug (/carta/<slug>), etiqueta, dominio, subtítulo,
 * posición en el mapa, orden, si está publicada, y de dónde sale el menú.
 *
 * Todas las sucursales (el mapa es entre sucursales, no depende de la activa). Sin fila → "Agregar al portal"; con fila → su
 * formulario. Mismo estilo que /carta: las mutaciones pasan por las Server Actions de
 * src/server/actions/carta/registro-publico.ts (conPermiso("carta")) y el refresco lo piden los closures de acá. Los closures
 * capturan solo el id de la sucursal (texto): lo que captura un closure "use server" viaja al cliente.
 */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

const valoresDelFormulario = (fd: FormData) => Object.fromEntries(CLAVES_PORTAL_V1.map((d) => [d.clave, String(fd.get(d.clave) ?? "")]));

const CLASE_INPUT = "rounded border px-2 py-1";
const CLASE_BOTON = "rounded bg-neutral-900 px-3 py-1.5 text-sm text-white";

export default async function PortalSucursalesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [sucursales, apariencia] = await Promise.all([cargarAdminPortal(ctx.db), cargarPortalEmpresaAdmin(ctx.db)]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Portal de sucursales</h1>
        <p className="text-sm text-neutral-500">
          Qué sucursales muestra la carta pública en su portal y con qué dirección (/carta/&lt;slug&gt;). «Quitar del portal» la saca del portal. Solo sale en el portal si está publicada y la sucursal está
          activa. La carta toma los cambios en hasta 5 minutos.
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
          <a href={urlCartaPublica(process.env.CARTA_DOMINIO_BASE, ctx.empresaSlug)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
            Ver el portal de motor2 →
          </a>
        </div>
      </div>

      <section aria-labelledby="titulo-apariencia-portal" className="flex flex-col gap-2">
        <h2 id="titulo-apariencia-portal" className="text-lg font-medium">
          Apariencia del portal
        </h2>
        <p className="text-sm text-neutral-500">
          Título, colores, logo, imagen del mapa y tamaños de las tarjetas. Con imagen del mapa y al menos una sucursal con posición (más abajo), el portal
          muestra las tarjetas sobre la imagen; sin eso, es una lista. Vacío = el default. El portal toma los cambios al recargarlo.
        </p>
        <EditorPortal
          valoresIniciales={apariencia.valores}
          version={apariencia.actualizadoEn?.toISOString() ?? "sin-apariencia"}
          empresaNombre={ctx.empresaNombre}
          sucursales={entradasVistaPreviaPortal(sucursales)}
          urlsPorSlug={Object.fromEntries(sucursales.flatMap((s) => (s.publica ? [[s.publica.slug, urlCartaPublica(process.env.CARTA_DOMINIO_BASE, ctx.empresaSlug, s.publica.slug)]] : [])))}
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
          <SucursalEnPortal key={s.id} sucursal={s} empresaSlug={ctx.empresaSlug} />
        ))}
        {!sucursales.length && <li className="text-sm text-neutral-500">No hay sucursales.</li>}
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

function SucursalEnPortal({ sucursal: s, empresaSlug }: { sucursal: SucursalPortalAdmin; empresaSlug: string }) {
  const sucursalId = s.id;
  const p = s.publica;
  return (
    <li className="rounded border p-3" data-sucursal-portal={s.nombre}>
      <p className="text-sm">
        <span className="font-medium">{s.nombre}</span>
        {!s.activo && <span className="text-neutral-500"> (inactiva)</span>} · {estadoEnPortal(s)}
        {p && seVeEnVivo(s) && (
          <>
            {" · "}
            <a href={urlCartaPublica(process.env.CARTA_DOMINIO_BASE, empresaSlug, p.slug)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              Ver la carta de motor2 →
            </a>
          </>
        )}
      </p>
      {p && (
        // Solo lectura (docs/plan-tema-carta-2026-09-24.md, M6): de dónde saca la carta los colores y textos de esta sucursal.
        <p className="text-sm text-neutral-500">
          Tema: {s.temaDesdeMotor2 ? "aplicado (Tema de la carta)" : "estilo por defecto"}
        </p>
      )}

      {!p ? (
        <FormConResultado
          accion={async () => {
            "use server";
            return refrescarSiOk(await agregarSucursalAlPortal(sucursalId));
          }}
          className="mt-2"
        >
          <button type="submit" className={CLASE_BOTON}>
            Agregar «{s.nombre}» al portal
          </button>
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
            <label className="flex flex-col gap-1 text-sm">
              Slug (dirección /carta/&lt;slug&gt;)
              <input name="slug" required defaultValue={p.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={60} className={CLASE_INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Etiqueta (opcional, si no se usa el nombre)
              <input name="etiqueta" defaultValue={p.etiqueta ?? ""} placeholder={s.nombre} maxLength={80} className={CLASE_INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Orden en el portal
              <input name="orden" type="number" step={1} defaultValue={p.orden} className={CLASE_INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Subtítulo en el portal (público, opcional)
              <input name="subtituloPortal" defaultValue={p.subtituloPortal ?? ""} placeholder="Frente al lago" maxLength={200} className={CLASE_INPUT} />
            </label>

            <fieldset className="flex flex-wrap gap-3 rounded border p-2 sm:col-span-2">
              <legend className="px-1 text-sm">Posición en el mapa del portal (% del mapa, 0 a 100; x, y y ancho juntos)</legend>
              <CampoPosicion nombre="posX" etiqueta="x (centro)" valor={p.posX} />
              <CampoPosicion nombre="posY" etiqueta="y (centro)" valor={p.posY} />
              <CampoPosicion nombre="posW" etiqueta="Ancho" valor={p.posW} />
              <CampoPosicion nombre="posH" etiqueta="Alto (opcional)" valor={p.posH} />
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <input name="publicada" type="checkbox" defaultChecked={p.publicada} /> Publicada en el portal
            </label>

            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Guardar «{s.nombre}»
              </button>
            </div>
          </FormConResultado>

          <FormConResultado
            accion={async () => {
              "use server";
              return refrescarSiOk(await quitarSucursalDelPortal(sucursalId));
            }}
            className="mt-3 border-t pt-3"
          >
            <p className="text-sm text-neutral-500">Quitarla borra estos datos: la sucursal deja de aparecer en el portal.</p>
            <button type="submit" className="text-sm underline">
              Quitar «{s.nombre}» del portal
            </button>
          </FormConResultado>
        </details>
      )}
    </li>
  );
}

function CampoPosicion({ nombre, etiqueta, valor }: { nombre: string; etiqueta: string; valor: number | null }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {etiqueta}
      <input name={nombre} type="number" min={0} max={100} step="0.01" defaultValue={valor ?? ""} className={`${CLASE_INPUT} w-24`} />
    </label>
  );
}
