import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerReportePromociones } from "@/core/reportes/promociones";
import { obtenerPromocionesHabilitadas, buscarProductoParaPromocion } from "@/server/actions/promociones";
import { PromocionForm } from "./promocion-form";

function primerDiaDelMes() {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
}

export default async function PromocionesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const [habilitado, candidatos] = await Promise.all([
    obtenerPromocionesHabilitadas(ctx.sucursalId),
    buscarProductoParaPromocion(ctx.sucursalId, ""),
  ]);
  const rep = habilitado ? await obtenerReportePromociones(ctx.sucursalId, primerDiaDelMes(), new Date()) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Promociones y Combos</h1>
        <p className="text-sm text-neutral-500">
          Feature opcional (apagada por defecto): separa la facturación en Promoción/Combo vs. a la carta, y calcula cuánto costarían sus insumos
          si se vendieran sueltos.
        </p>
      </div>

      <PromocionForm habilitado={habilitado} candidatos={candidatos} />

      {rep?.habilitado && (
        <div>
          <h2 className="mb-2 text-sm font-medium">
            Este mes: ${rep.totalFacturadoPromociones.toLocaleString("es-AR")} en promociones ({rep.porcentajePromociones}% del total)
          </h2>
          <p className="mb-2 text-xs text-neutral-500">{rep.aviso}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-1">Producto</th>
                <th>Cantidad</th>
                <th>Facturado</th>
                <th>Valor a la carta</th>
                <th>Descuento</th>
              </tr>
            </thead>
            <tbody>
              {rep.promociones.map((p, i) => (
                <tr key={i} className="border-b">
                  <td className="py-1">{p.producto}</td>
                  <td>{p.cantidad}</td>
                  <td>${p.importe.toLocaleString("es-AR")}</td>
                  <td>{p.valorALaCartaUnitario === null ? <span className="text-amber-600">incompleto</span> : `$${p.valorALaCartaUnitario.toLocaleString("es-AR")}`}</td>
                  <td>{p.descuentoPct === null ? "—" : `${p.descuentoPct}%`}</td>
                </tr>
              ))}
              {!rep.promociones.length && (
                <tr>
                  <td className="py-1 text-neutral-500" colSpan={5}>
                    Sin ventas de promociones este mes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
