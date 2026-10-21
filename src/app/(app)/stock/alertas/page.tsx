import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { calcularAlertasStock } from "@/server/consultas/stock/alertas";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";

export default async function AlertasStockPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_stock", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const alertas = await calcularAlertasStock(ctx.sucursalId, ctx.db);
  const criticos = alertas.filter((a) => a.estado === "CRITICO").length;
  const bajos = alertas.filter((a) => a.estado === "BAJO").length;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Alertas de stock</h1>
      <p className="mb-4 text-sm text-tinta-tenue">
        {alertas.length ? `${criticos} crítico(s), ${bajos} bajo(s).` : "Sin alertas — todo por encima de su Stock Mínimo configurado."}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-tinta-tenue">
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
              <td className={a.estado === "CRITICO" ? "text-error font-medium" : "text-aviso-tinta"}>{a.estado}</td>
              <td className="text-tinta-tenue">{a.ultimaFecha ? diaDeCalendario(a.ultimaFecha, ctx.empresaZonaHoraria) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
