import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/core/permisos/gate";
import { calcularAlertasStock } from "@/core/stock/public-servidor";

export default async function AlertasStockPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_stock", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const alertas = await calcularAlertasStock(ctx.sucursalId, ctx.db);
  const criticos = alertas.filter((a) => a.estado === "CRITICO").length;
  const bajos = alertas.filter((a) => a.estado === "BAJO").length;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Alertas de stock</h1>
      <p className="mb-4 text-sm text-neutral-500">
        {alertas.length ? `${criticos} crítico(s), ${bajos} bajo(s).` : "Sin alertas — todo por encima de su Stock Mínimo configurado."}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Producto</th>
            <th>Sección</th>
            <th>Saldo actual</th>
            <th>Mínimo</th>
            <th>Diferencia</th>
            <th>Estado</th>
            <th>Último movimiento</th>
          </tr>
        </thead>
        <tbody>
          {alertas.map((a) => (
            <tr key={`${a.productoId}-${a.seccionId}`} className="border-b">
              <td className="py-2">{a.productoCodigo} — {a.productoNombre}</td>
              <td>{a.seccionNombre}</td>
              <td>{a.saldoActual}</td>
              <td>{a.stockMinimo}</td>
              <td>{a.diferencia}</td>
              <td className={a.estado === "CRITICO" ? "text-red-600 font-medium" : "text-amber-700 dark:text-amber-600"}>{a.estado}</td>
              <td className="text-neutral-500">{a.ultimaFecha ? a.ultimaFecha.toISOString().slice(0, 10) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
