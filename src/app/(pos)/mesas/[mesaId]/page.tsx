import Link from "next/link";
import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { obtenerDetalleDeMesa } from "@/server/consultas/pos/detalle-de-mesa";
import { obtenerPuestoMostrador } from "@/server/consultas/pos/mesas";
import { PantallaDelPuesto } from "./pantalla-del-puesto";

/**
 * Pantalla de una mesa del salón (módulo POS, pendiente «tomar pedido», docs/plan-tomar-pedido-2026-09-25.md paso 8). A ella llevan
 * «Tomar pedido», «Continuar pedido», «Ver pedidos» y «Facturar» del mapa. Server Component: lee el detalle directo del núcleo
 * (`obtenerDetalleDeMesa`, aislado por sucursal) después de la guarda de Ver de `pos_mesas`, sin Server Action de lectura.
 *
 * Cada acción tiene su permiso (el servidor lo vuelve a verificar igual): `pos_tomar_pedido` abre la cuenta, agrega/quita/envía y
 * libera la mesa; `pos_anular_item` anula lo que ya salió a cocina; `pos_cerrar_cuenta` cierra la cuenta y registra la venta. Sin el
 * permiso, el botón queda deshabilitado con un `title` que lo explica. Un rol con solo Ver de `pos_mesas` ve la mesa de solo lectura.
 *
 * Impresión (docs/plan-imprimir-comanda-y-ticket-2026-09-25.md): la comanda de cada envío se arma ACÁ, en el servidor y sin precios
 * (`armarComandas`), y va al proveedor de impresión, que envuelve las dos ramas (mesa libre y cuenta abierta) y «Cuentas cerradas» al
 * pie (las últimas tickets de la mesa, `obtenerTicketsRecientes`): así el ticket se imprime aunque el cierre deje la mesa libre.
 *
 * Ruta dinámica: no va en RUTAS_SIN_PARAMETROS ni en el menú. `params` es una Promise en esta versión de Next
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md).
 */
export default async function MesaPage({ params }: { params: Promise<{ mesaId: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "pos_mesas", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { mesaId } = await params;
  // El reloj se lee UNA vez, acá en el borde (O.22-a, Hito 4): el detalle (tiempos de la cuenta) y los tickets recientes usan la misma hora.
  const ahora = new Date();
  const detalle = await obtenerDetalleDeMesa(ctx.sucursalId, mesaId, ctx.db, ahora);
  if (!detalle) {
    // ADR-039: el puesto mostrador no es una mesa; su pantalla es `/mesas/mostrador` (un enlace viejo o un id pegado a mano llega ahí).
    if ((await obtenerPuestoMostrador(ctx.sucursalId, ctx.db))?.id === mesaId) redirect("/mesas/mostrador");
    return (
      <div className="space-y-3">
        <p className="font-semibold">No se encontró esa mesa en esta sucursal.</p>
        <Link href="/mesas" className="text-sm text-tinta-suave underline hover:text-tinta">
          Volver al mapa
        </Link>
      </div>
    );
  }

  return <PantallaDelPuesto ctx={ctx} detalle={detalle} ahora={ahora} variante="mesa" />;
}
