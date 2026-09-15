import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { generarReporteHuecosCatalogo, obtenerProblemasUnidadMezclada } from "@/core/reportes/huecos-catalogo";

export default async function HuecosCatalogoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const rep = await generarReporteHuecosCatalogo(ctx.sucursalId);
  const gateUnidadMezclada = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "insumos_mezclados");
  const problemasUnidadMezclada = gateUnidadMezclada.ok ? await obtenerProblemasUnidadMezclada() : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Huecos de catálogo</h1>
        <p className="text-sm text-neutral-500">Tres tipos de &quot;producto incompleto&quot; que ningún otro reporte marca.</p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">PV activos que nunca se vendieron</h2>
        <ul className="list-disc pl-5 text-sm">
          {rep.pvSinVentaNunca.map((p) => (
            <li key={p.productoId}>{p.codigo} — {p.producto}</li>
          ))}
          {!rep.pvSinVentaNunca.length && <li className="list-none text-neutral-500">Todos los PV activos ya se vendieron alguna vez.</li>}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">MP con receta pero sin ningún proveedor cargado</h2>
        <ul className="list-disc pl-5 text-sm">
          {rep.insumosConRecetaSinProveedor.map((p) => (
            <li key={p.productoId}>{p.codigo} — {p.producto}</li>
          ))}
          {!rep.insumosConRecetaSinProveedor.length && <li className="list-none text-neutral-500">Todas las MP de receta tienen al menos un proveedor.</li>}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Insumos con unidad de stock mezclada</h2>
        {!gateUnidadMezclada.ok ? (
          <p className="text-sm text-red-600">{gateUnidadMezclada.mensaje}</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {problemasUnidadMezclada.map((p) => (
              <li key={p.insumoId}>
                {p.insumo}: {p.unidades.join(", ")} — {p.productos.map((prod) => `${prod.nombre} (${prod.unidad})`).join(", ")}
              </li>
            ))}
            {!problemasUnidadMezclada.length && <li className="list-none text-neutral-500">Sin insumos con unidad mezclada.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
