import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { diasAtrasDeUrl } from "@/core/reportes/dias-atras";
import { requierePermisoVer } from "@/core/permisos/gate";
import { generarReporteDevoluciones } from "@/core/reportes/devoluciones";
import { TablaDevolucionesClientes, TablaDevolucionesProveedor } from "./tabla-devoluciones";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

export default async function DevolucionesPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"dias">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_devoluciones", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const dias = diasAtrasDeUrl(sp.dias, 30);
  const rep = await generarReporteDevoluciones(ctx.sucursalId, dias, ctx.db);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Devoluciones</h1>
        <form className="flex items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Días atrás
            <input type="number" name="dias" min={1} defaultValue={dias} className="w-24 rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Actualizar
          </button>
        </form>
        <p className="mt-2 text-sm text-neutral-500">
          Desde {rep.desde.toISOString().slice(0, 10)} — devuelto por clientes: ${rep.totalCliente.toLocaleString("es-AR")}, a proveedores: $
          {rep.totalProveedor.toLocaleString("es-AR")}.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Devoluciones de clientes (revendibles)</h2>
        <TablaDevolucionesClientes filas={rep.clientes} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Devoluciones a proveedores</h2>
        {rep.proveedores.map((p) => (
          <div key={p.proveedor} className="mb-3">
            <p className="text-sm font-medium">
              {p.proveedor} — ${p.valor.toLocaleString("es-AR")}
            </p>
            <TablaDevolucionesProveedor filas={p.productos} nombreExport={`devoluciones-${p.proveedor}`} />
          </div>
        ))}
        {!rep.proveedores.length && <p className="text-sm text-neutral-500">Sin devoluciones a proveedores en el período.</p>}
      </div>
    </div>
  );
}
