import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { diasAtrasDeUrl } from "@/core/reportes/public";
import { generarReporteDevoluciones } from "@/server/consultas/reportes/devoluciones";
import { requierePermisoVer } from "@/server/acceso/gate";
import { TablaDevolucionesClientes, TablaDevolucionesProveedor } from "./tabla-devoluciones";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { Campo } from "@/ui/primitivas/campo";

export default async function DevolucionesPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"dias">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_devoluciones", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const dias = diasAtrasDeUrl(sp.dias, 30);
  // La hora se fija acá, en el borde (D.3a): el reporte la recibe por parámetro.
  const ahora = new Date();
  const rep = await generarReporteDevoluciones(ctx.sucursalId, dias, ctx.db, ahora, ctx.empresaZonaHoraria);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Devoluciones</h1>
        <form className="flex items-end gap-3 text-sm">
          <div className="w-24">
            <Campo etiqueta="Días atrás" type="number" name="dias" min={1} defaultValue={dias} />
          </div>
          <BotonDeServidor type="submit">Actualizar</BotonDeServidor>
        </form>
        <p className="mt-2 text-sm text-tinta-tenue">
          Desde {diaDeCalendario(rep.desde, ctx.empresaZonaHoraria)} — devuelto por clientes: ${rep.totalCliente.toLocaleString("es-AR")}, a proveedores: $
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
        {!rep.proveedores.length && <p className="text-sm text-tinta-tenue">Sin devoluciones a proveedores en el período.</p>}
      </div>
    </div>
  );
}
