import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeAlguna } from "@/server/acceso/gate";
import { FilaDeMovimientos } from "@/components/fila-de-movimientos";

export default async function RegistrarMovimientoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  // Entrada de varias pantallas: alcanza con poder VER alguna. Las claves son las de PROCESOS_DEL_SELECTOR (un test lo comprueba) y las mismas del ítem del menú.
  const gate = await requierePermisoVerDeAlguna(
    ctx.usuarioId,
    ctx.sucursalId,
    ["proceso_produccion", "proceso_consumo", "proceso_ajuste", "proceso_transferencia", "proceso_devolucion_consignacion", "proceso_devolucion_cliente", "proceso_devolucion_proveedor", "stock_reclasificar"],
    ctx.db,
  );
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Registrar movimiento</h1>
        <p className="text-sm text-tinta-tenue">Cargá lo que pasó con el stock: una producción, un consumo, un ajuste, un traslado, una devolución o una reclasificación.</p>
      </div>
      <FilaDeMovimientos ctx={ctx} actual={null} visibles={gate.visibles} />
      <p className="text-sm text-tinta-suave">Elegí arriba qué movimiento querés registrar.</p>
    </div>
  );
}
