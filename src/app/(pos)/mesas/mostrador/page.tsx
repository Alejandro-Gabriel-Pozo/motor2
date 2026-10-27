import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { obtenerDetalleDelMostrador } from "@/server/consultas/pos/detalle-de-mesa";
import { PantallaDelPuesto } from "../[mesaId]/pantalla-del-puesto";
import { HabilitarMostrador } from "./habilitar-mostrador";

/**
 * El mostrador del salón (ADR-039, M1): el puesto de venta que atiende en el momento, con ticket, cliente y descuentos como una mesa. Ruta ESTÁTICA (`/mesas/mostrador`): gana frente a la
 * dinámica `/mesas/[mesaId]` (un `mesaId` nunca es la palabra «mostrador»: son `cuid`). Server Component: después de la guarda de Ver de `pos_mesas` y del cupo de lecturas, lee el puesto de la
 * sucursal activa con su cuenta abierta (`obtenerDetalleDelMostrador`) y dibuja la pantalla del puesto (la de la mesa, variante mostrador). Sin puesto habilitado: «Habilitá el mostrador», con el
 * botón solo para quien puede dar de alta mesas (`pos_alta_mesa`, Editar). `/mesas/<id del puesto>` redirige acá.
 */
export default async function MostradorPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "pos_mesas", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  // El reloj se lee UNA vez, acá en el borde: el detalle (tiempos de la cuenta) y los tickets recientes usan la misma hora.
  const ahora = new Date();
  const detalle = await obtenerDetalleDelMostrador(ctx.sucursalId, ctx.db, ahora);
  // Con el puesto habilitado, es la MISMA pantalla que la de una mesa (variante mostrador): abrir cuenta, pedido, enviar, cliente, cerrar y ticket.
  if (detalle) return <PantallaDelPuesto ctx={ctx} detalle={detalle} ahora={ahora} variante="mostrador" />;

  const altaMesa = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "pos_alta_mesa", ctx.db);
  return (
    <div>
      <Link href="/mesas" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-tinta-suave hover:text-tinta max-md:mb-1 md:min-h-0">
        <span aria-hidden>←</span> Volver al mapa
      </Link>
      <header className="mb-6">
        <h1 className="mb-1.5 text-2xl font-extrabold leading-none tracking-tight md:text-3xl">Mostrador</h1>
        <p className="text-sm text-tinta-suave">{ctx.sucursalNombre}</p>
      </header>
      <div data-mostrador-sin-habilitar className="rounded-[14px] border border-dashed border-borde bg-superficie px-6 py-8">
        <p className="mb-1 font-semibold">Habilitá el mostrador de esta sucursal.</p>
        <p className="mb-4 text-sm text-tinta-suave">{altaMesa.editar ? "Es un paso de una sola vez: después se atiende como una mesa, con ticket y cliente." : "Pedile a un administrador que lo habilite."}</p>
        <HabilitarMostrador puede={altaMesa.editar} />
      </div>
    </div>
  );
}
