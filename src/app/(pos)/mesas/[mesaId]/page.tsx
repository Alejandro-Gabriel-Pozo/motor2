import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/core/permisos/gate";
import { obtenerDetalleDeMesa, type ItemDeCuenta, type ItemEnEnvio } from "@/core/pos/cuenta";
import { armarComandas } from "@/core/pos/comanda";
import { obtenerBoletasRecientes } from "@/core/pos/boleta";
import { cargarSelectorCartaPos } from "@/core/pos/selector-carta-consulta";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { listarClientes } from "@/server/actions/clientes/cliente";
import { AvisoMesaProvider } from "./aviso-mesa";
import { ImpresionProvider, ReimprimirEnvio } from "./imprimir";
import { CuentasCerradas } from "./cuentas-cerradas";
import { AbrirCuenta } from "./abrir-cuenta";
import { ComensalesCuenta } from "./comensales-cuenta";
import { ClienteCuenta } from "./cliente-cuenta";
import { AgregarItems } from "./agregar-items";
import { SinEnviar } from "./sin-enviar";
import { AnularItem } from "./anular-item";
import { CerrarCuenta } from "./cerrar-cuenta";
import { LiberarMesa } from "./liberar-mesa";
import { formatearCantidad, formatearMonto, nombreDeMesa } from "@/core/pos/formato";

/**
 * Pantalla de una mesa del salón (módulo POS, pendiente «tomar pedido», docs/plan-tomar-pedido-2026-09-25.md paso 8). A ella llevan
 * «Tomar pedido», «Continuar pedido», «Ver pedidos» y «Facturar» del mapa. Server Component: lee el detalle directo del núcleo
 * (`obtenerDetalleDeMesa`, aislado por sucursal) después de la guarda de Ver de `pos_mesas`, sin Server Action de lectura.
 *
 * Cada acción tiene su permiso (el servidor lo vuelve a verificar igual): `pos_tomar_pedido` abre la cuenta, agrega/quita/envía y
 * libera la mesa; `pos_anular_item` anula lo que ya salió a cocina; `pos_cerrar_cuenta` cierra la cuenta y registra la venta. Sin el
 * permiso, el botón queda deshabilitado con un `title` que lo explica. Un rol con solo Ver de `pos_mesas` ve la mesa de solo lectura.
 *
 * Impresión (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md): la comanda de cada envío se arma ACÁ, en el servidor y sin precios
 * (`armarComandas`), y va al proveedor de impresión, que envuelve las dos ramas (mesa libre y cuenta abierta) y «Cuentas cerradas» al
 * pie (las últimas boletas de la mesa, `obtenerBoletasRecientes`): así la boleta se imprime aunque el cierre deje la mesa libre.
 *
 * Ruta dinámica: no va en RUTAS_SIN_PARAMETROS ni en el menú. `params` es una Promise en esta versión de Next
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md).
 */
export default async function MesaPage({ params }: { params: Promise<{ mesaId: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "pos_mesas");
  if (!gate.ok) return <p className="text-red-700">{gate.mensaje}</p>;

  const { mesaId } = await params;
  const detalle = await obtenerDetalleDeMesa(ctx.sucursalId, mesaId);
  if (!detalle) {
    return (
      <div className="space-y-3">
        <p className="font-semibold">No se encontró esa mesa en esta sucursal.</p>
        <Link href="/mesas" className="text-[13px] text-[var(--ink-soft)] underline hover:text-[var(--ink)]">
          Volver al mapa
        </Link>
      </div>
    );
  }

  const [tomarPedido, asignarCliente, anularItem, cerrarCuenta, verReportesDinero, secciones, boletas] = await Promise.all([
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "pos_tomar_pedido"),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "pos_asignar_cliente"),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "pos_anular_item"),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "pos_cerrar_cuenta"),
    // El shell del POS no filtra `EnlaceInterno` (no hay AccionesVisiblesProvider acá): el link a «Boletas emitidas» se
    // condiciona a mano, del lado del servidor (Task #17).
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero"),
    listarSeccionesActivas(ctx.sucursalId),
    obtenerBoletasRecientes(ctx.sucursalId, detalle.mesa.id),
  ]);
  const { mesa, cuenta } = detalle;
  // «Agregar al pedido» por sección de CARTA (docs/plan-selector-carta-pos-2026-09-25.md): solo con cuenta abierta y si quien mira
  // puede tomar pedido. Se lee acá, después de la guarda de Ver de `pos_mesas` (el mozo no tiene el permiso `carta`), sin Server
  // Action nueva. Aparte del `Promise.all` de arriba a propósito (no confundir con `secciones`, que son las de STOCK).
  const selectorCarta = cuenta && tomarPedido.editar ? await cargarSelectorCartaPos(ctx.sucursalId) : null;
  // Cliente con descuento (Task #14): la lista de clientes ACTIVOS solo se trae si hay algo que asignar — mismo criterio que
  // `selectorCarta`. `descuentoPorcentaje` se convierte a `number` acá (server): un `Decimal` de Prisma no se puede pasar tal cual
  // a un Client Component (`ClienteCuenta`).
  const clientesActivos = cuenta && asignarCliente.editar ? (await listarClientes(true)).map((c) => ({ id: c.id, nombre: c.nombre, descuentoPorcentaje: Number(c.descuentoPorcentaje) })) : [];
  const titulo = nombreDeMesa(mesa.numero);
  const comandas = cuenta ? armarComandas(cuenta.envios, cuenta.mesero) : [];

  return (
    <div>
      <Link href="/mesas" className="mb-4 inline-flex items-center gap-1 text-[13px] text-[var(--ink-soft)] hover:text-[var(--ink)]">
        <span aria-hidden>←</span> Volver al mapa
      </Link>

      {/* AvisoMesaProvider envuelve DESDE ACÁ (no solo el contenido de abajo): ComensalesCuenta, en el encabezado, también necesita
          publicar su aviso (`useAvisar`) — "vive ARRIBA de todo", ver su docstring. */}
      <AvisoMesaProvider>
        <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="mb-1.5 text-[26px] font-extrabold leading-none tracking-tight md:text-[28px]">{titulo}</h1>
            <p className="text-[13.5px] text-[var(--ink-soft)]">
              {cuenta ? `Atiende ${cuenta.mesero} · abierta ${cuenta.tiempoAbierta}` : "Libre · sin cuenta abierta"}
            </p>
            {cuenta && (
              <div className="mt-1 flex flex-col gap-1">
                <ComensalesCuenta cuentaId={cuenta.id} comensales={cuenta.comensales} puede={tomarPedido.editar} />
                <ClienteCuenta
                  cuentaId={cuenta.id}
                  clienteId={cuenta.clienteId}
                  clienteNombre={cuenta.cliente}
                  descuentoPorcentaje={cuenta.descuentoPorcentaje}
                  clientes={clientesActivos}
                  puede={asignarCliente.editar}
                />
              </div>
            )}
          </div>
          {cuenta && (
            <div className="text-left md:text-right">
              <div className="text-[11px] font-medium text-[var(--ink-faint)]">Total</div>
              <div data-total-cuenta className="text-2xl font-extrabold tabular-nums">
                {formatearMonto(cuenta.total)}
              </div>
            </div>
          )}
        </header>

        <ImpresionProvider mesa={titulo} sucursal={ctx.sucursalNombre} comandas={comandas} boletas={boletas}>
          {!cuenta ? (
            <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-white px-6 py-8">
              <p className="mb-4 font-semibold">La mesa está libre.</p>
              <AbrirCuenta mesaId={mesa.id} puede={tomarPedido.editar} />
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <section aria-labelledby="agregar-titulo" className="rounded-[14px] border border-[var(--border)] bg-white p-4">
                <h2 id="agregar-titulo" className="mb-3 text-[15px] font-bold">
                  Agregar al pedido
                </h2>
                <AgregarItems cuentaId={cuenta.id} puede={tomarPedido.editar} selectorCarta={selectorCarta} />
              </section>

              <SinEnviar
                cuentaId={cuenta.id}
                items={cuenta.sinEnviar.map((i) => ({ id: i.id, productoNombre: i.productoNombre, cantidad: i.cantidad, precioUnitario: i.precioUnitario }))}
                puede={tomarPedido.editar}
              />

              {cuenta.envios.map((envio) => (
                <section key={envio.numero} aria-labelledby={`envio-${envio.numero}`} data-envio={envio.numero} className="rounded-[14px] border border-[var(--border)] bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 id={`envio-${envio.numero}`} className="text-[15px] font-bold">
                      Envío {envio.numero} · en cocina
                    </h2>
                    <ReimprimirEnvio numero={envio.numero} puede={tomarPedido.editar} />
                  </div>
                  <ul className="divide-y divide-[var(--border)]">
                    {envio.items.map((item) => (
                      <ItemEnviado key={item.id} item={item} puedeAnular={anularItem.editar} />
                    ))}
                  </ul>
                </section>
              ))}

              <div className="flex flex-wrap items-start gap-4 border-t border-[var(--border)] pt-5">
                <CerrarCuenta
                  cuentaId={cuenta.id}
                  titulo={titulo}
                  total={cuenta.total}
                  sinEnviar={cuenta.sinEnviar.length}
                  haySecciones={secciones.length > 0}
                  puede={cerrarCuenta.editar}
                />
                {cuenta.itemsTotales === 0 && <LiberarMesa cuentaId={cuenta.id} puede={tomarPedido.editar} />}
              </div>
            </div>
          )}
          <CuentasCerradas boletas={boletas} puede={cerrarCuenta.editar} />
          {verReportesDinero.ver && (
            <p className="mt-3 text-[13px]">
              <Link href={`/reportes/boletas?mesaId=${mesa.id}`} className="text-[var(--ink-soft)] underline hover:text-[var(--ink)]">
                Ver todas las boletas de esta mesa →
              </Link>
            </p>
          )}
        </ImpresionProvider>
      </AvisoMesaProvider>
    </div>
  );
}

/** Un ítem ya enviado: lo que queda (con lo pedido si hubo anulaciones), su importe vigente, «Anular» y sus anulaciones tachadas. */
function ItemEnviado({ item, puedeAnular }: { item: ItemEnEnvio<ItemDeCuenta>; puedeAnular: boolean }) {
  const anuladoEntero = item.restante <= 0;
  return (
    <li data-item-enviado={item.productoNombre} className="py-2 text-[14px]">
      <div className="flex items-center justify-between gap-3">
        <span className={anuladoEntero ? "text-[var(--ink-soft)] line-through" : undefined}>
          <span className="font-semibold tabular-nums">{formatearCantidad(anuladoEntero ? item.cantidad : item.restante)} ×</span> {item.productoNombre}
          {!anuladoEntero && item.anulaciones.length > 0 && <span className="text-[12.5px] text-[var(--ink-soft)]"> (pedido {formatearCantidad(item.cantidad)})</span>}
        </span>
        <span className="flex items-center gap-3">
          <span className="tabular-nums">{anuladoEntero ? "Anulado" : formatearMonto(item.restante * item.precioUnitario)}</span>
          {!anuladoEntero && <AnularItem item={{ id: item.id, productoNombre: item.productoNombre, restante: item.restante }} puede={puedeAnular} />}
        </span>
      </div>
      {item.anulaciones.length > 0 && (
        <ul aria-label={`Anulaciones de ${item.productoNombre}`} className="mt-1 space-y-0.5 pl-4 text-[12.5px] text-[var(--ink-soft)]">
          {item.anulaciones.map((a) => (
            <li key={a.id} data-anulacion className="line-through">
              {formatearCantidad(a.cantidad).replace("-", "−")} · {a.motivoAnulacion} · por {a.creadoPor ?? "—"}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
