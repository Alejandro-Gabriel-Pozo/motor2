import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { cargarAdminPortal, type SucursalPortalAdmin } from "@/core/carta/admin-consulta";
import { agregarSucursalAlPortal, guardarSucursalPublica, quitarSucursalDelPortal } from "@/server/actions/carta/registro-publico";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { FormConResultado } from "@/components/form-con-resultado";

/**
 * Portal de sucursales (docs/plan-registro-tenants-2026-09-24.md, M7): el registro que restaurant-menu-design lee por
 * GET /api/carta/tenants en lugar de la tab "tenant" de su sheet maestra — slug (/carta/<slug>), etiqueta, dominio, subtítulo,
 * posición en el mapa, orden, si está publicada, de dónde sale el menú y los datos de la sheet mientras dure la transición.
 *
 * Todas las sucursales (el mapa es entre sucursales, no depende de la activa). Sin fila → "Agregar al portal"; con fila → su
 * formulario. Mismo estilo que /catalogo/carta: las mutaciones pasan por las Server Actions de
 * src/server/actions/carta/registro-publico.ts (conPermiso("carta")) y el refresco lo piden los closures de acá. Los closures
 * capturan solo el id de la sucursal (texto): lo que captura un closure "use server" viaja al cliente.
 */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

const CLASE_INPUT = "rounded border px-2 py-1";
const CLASE_BOTON = "rounded bg-neutral-900 px-3 py-1.5 text-sm text-white";

/** Base pública de la carta (CARTA_PORTAL_URL), sin barra final, o null si no está configurada — sin ella no se muestra ningún link "Ver en vivo". */
function urlBasePortal(): string | null {
  const base = process.env.CARTA_PORTAL_URL?.trim().replace(/\/+$/, "");
  return base || null;
}

export default async function PortalSucursalesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sucursales = await cargarAdminPortal();
  const basePortal = urlBasePortal();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Portal de sucursales</h1>
        <p className="text-sm text-neutral-500">
          Qué sucursales muestra la carta pública en su portal y con qué dirección (/carta/&lt;slug&gt;). Una sucursal cargada acá reemplaza a la fila con
          el mismo slug de la sheet maestra de la carta; «Quitar del portal» vuelve a esa fila. Solo sale en el portal si está publicada y la sucursal está
          activa. La carta toma los cambios en hasta 5 minutos.
        </p>
        {basePortal && (
          <a href={basePortal} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-blue-600 underline">
            Ver el portal en vivo →
          </a>
        )}
      </div>

      <ul className="flex flex-col gap-3">
        {sucursales.map((s) => (
          <SucursalEnPortal key={s.id} sucursal={s} basePortal={basePortal} />
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

function SucursalEnPortal({ sucursal: s, basePortal }: { sucursal: SucursalPortalAdmin; basePortal: string | null }) {
  const sucursalId = s.id;
  const p = s.publica;
  return (
    <li className="rounded border p-3" data-sucursal-portal={s.nombre}>
      <p className="text-sm">
        <span className="font-medium">{s.nombre}</span>
        {!s.activo && <span className="text-neutral-500"> (inactiva)</span>} · {estadoEnPortal(s)}
        {basePortal && p && seVeEnVivo(s) && (
          <>
            {" · "}
            <a href={`${basePortal}/carta/${p.slug}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              Ver en vivo →
            </a>
          </>
        )}
      </p>
      {p && (
        // Solo lectura (docs/plan-tema-carta-2026-09-24.md, M6): de dónde saca la carta los colores y textos de esta sucursal.
        <p className="text-sm text-neutral-500">
          Tema: {s.temaDesdeMotor2 ? "motor2 (aplicado en Tema de la carta)" : "sheet (tab Config)"}
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
                  dominio: campo(fd, "dominio"),
                  subtituloPortal: campo(fd, "subtituloPortal"),
                  posX: campo(fd, "posX"),
                  posY: campo(fd, "posY"),
                  posW: campo(fd, "posW"),
                  posH: campo(fd, "posH"),
                  orden: campo(fd, "orden"),
                  publicada: fd.get("publicada") === "on",
                  menuDesdeMotor2: fd.get("menuDesdeMotor2") === "on",
                  sheetId: campo(fd, "sheetId"),
                  sheetMenuNombre: campo(fd, "sheetMenuNombre"),
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
              Dominio propio (opcional)
              <input name="dominio" defaultValue={p.dominio ?? ""} placeholder="carta.mirestaurante.com" className={CLASE_INPUT} />
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
            <label className="flex items-center gap-2 text-sm">
              <input name="menuDesdeMotor2" type="checkbox" defaultChecked={p.menuDesdeMotor2} /> El menú sale de motor2 (Carta pública)
            </label>

            <fieldset className="grid grid-cols-1 gap-2 rounded border p-2 sm:col-span-2 sm:grid-cols-2">
              <legend className="px-1 text-sm">Mientras la carta use Google Sheets</legend>
              <label className="flex flex-col gap-1 text-sm">
                Id de la sheet (o su URL; hace falta para publicar)
                <input name="sheetId" defaultValue={p.sheetId ?? ""} placeholder="1AbC…" className={CLASE_INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Tab del menú en la sheet (si el menú no sale de motor2)
                <input name="sheetMenuNombre" defaultValue={p.sheetMenuNombre} placeholder="Menu" maxLength={100} className={CLASE_INPUT} />
              </label>
            </fieldset>

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
            <p className="text-sm text-neutral-500">Quitarla borra estos datos: la carta vuelve a usar la fila de la sheet maestra con ese slug, si la tiene.</p>
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
