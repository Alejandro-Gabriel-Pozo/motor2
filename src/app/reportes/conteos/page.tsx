import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerHistorialConteosFisicos } from "@/server/actions/conteo-fisico";

export default async function ConteosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const conteos = await obtenerHistorialConteosFisicos(ctx.sucursalId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Historial de conteos físicos</h1>
        <p className="text-sm text-neutral-500">Últimos 200 conteos registrados en esta sucursal.</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-1">Fecha</th>
            <th>Producto</th>
            <th>Sección</th>
            <th>Sistema</th>
            <th>Real</th>
            <th>Diferencia</th>
            <th>Acción</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {conteos.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="py-1">{c.fecha.toISOString().slice(0, 10)}</td>
              <td>{c.producto.codigo} — {c.producto.nombre}</td>
              <td>{c.seccion.nombre}</td>
              <td>{Number(c.saldoSistema)}</td>
              <td>{Number(c.conteoReal)}</td>
              <td className={Number(c.diferencia) !== 0 ? "font-medium" : ""}>{Number(c.diferencia)}</td>
              <td>{c.accion}</td>
              <td>{c.estado}</td>
            </tr>
          ))}
          {!conteos.length && (
            <tr>
              <td className="py-1 text-neutral-500" colSpan={8}>
                Sin conteos registrados todavía.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
