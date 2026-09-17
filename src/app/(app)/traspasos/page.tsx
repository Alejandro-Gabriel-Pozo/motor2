import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { obtenerBandejaTransferencias } from "@/server/actions/traspasos/traspasos";
import { Bandeja, type FilaBandeja } from "./bandeja";

const LABEL_ESTADO: Record<string, string> = {
  SOLICITADA: "Solicitada",
  ENVIADA: "Enviada",
  ACEPTADA: "Aceptada",
  RECHAZADA_ORIGEN: "Rechazada por origen",
  RECHAZADA_DESTINO: "Rechazada por destino",
  CERRADA: "Cerrada (reingresada)",
  CANCELADA: "Cancelada por quien la pidió",
};

export default async function TraspasosPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proceso_transferencia_sucursal");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { cursor } = await searchParams;
  const [bandeja, secciones] = await Promise.all([
    obtenerBandejaTransferencias(ctx.sucursalId, cursor),
    listarSeccionesActivas(ctx.sucursalId),
  ]);

  const aFila = (t: Awaited<ReturnType<typeof obtenerBandejaTransferencias>>["historial"][number]): FilaBandeja => {
    const soyOrigen = t.origenSucursalId === ctx.sucursalId;
    return {
      id: t.id,
      productoNombre: t.producto.nombre,
      productoCodigo: t.producto.codigo,
      cantidad: Number(t.cantidad),
      unidadNombre: t.producto.unidadStock.nombre,
      otraSucursalNombre: soyOrigen ? t.destinoSucursal.nombre : t.origenSucursal.nombre,
      fecha: t.creadoEn.toISOString().slice(0, 10),
      detalle: t.detalle,
      estado: LABEL_ESTADO[t.estado] ?? t.estado,
      // Solo mi propia solicitud PULL (destino, SOLICITADA) se puede cancelar —
      // un envío PUSH propio (origen, ENVIADA) ya movió stock, no es cancelable así.
      esMiSolicitudCancelable: !soyOrigen && t.estado === "SOLICITADA",
      motivoRechazoOrigen: t.motivoRechazoOrigen,
      motivoRechazoDestino: t.motivoRechazoDestino,
      seccionOrigenNombre: t.seccionOrigen?.nombre ?? null,
      seccionDestinoNombre: t.seccionDestino?.nombre ?? null,
      creadoPorEmail: t.creadoPor.email,
    };
  };

  return (
    <div>
      <div className="mb-4">
        <h1 className="mb-1 text-xl font-semibold">Traspasos entre sucursales</h1>
        <p className="text-sm text-neutral-500">
          El stock no se teletransporta: cada paso queda registrado y auditado. Ver &quot;Solicitar&quot;/&quot;Enviar directo&quot; en el nav
          para empezar uno nuevo.
        </p>
      </div>
      <Bandeja
        paraAprobar={bandeja.paraAprobar.map(aFila)}
        paraAceptar={bandeja.paraAceptar.map(aFila)}
        paraReingreso={bandeja.paraReingreso.map(aFila)}
        esperando={bandeja.esperando.map(aFila)}
        historial={bandeja.historial.map(aFila)}
        nextCursorHistorial={bandeja.nextCursorHistorial}
        secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
      />
    </div>
  );
}
