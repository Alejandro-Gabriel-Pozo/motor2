import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { listarProveedoresParaSelector } from "@/server/actions/catalogo/proveedores";
import { leerNivelDelControlDeExceso, listarOrdenesParaMostrar } from "@/server/consultas/movimientos/ordenes-de-compra";
import { NIVEL_POR_DEFECTO_DEL_CONTROL } from "@/core/compras/public";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { PanelOrdenesDeCompra } from "./panel-ordenes-de-compra";

/**
 * Compras, orden de compra (etapa OC): la pantalla de las órdenes. Gateada por `orden_de_compra_ver` (módulo `ordenes_de_compra`, apagado por defecto: sin él la página dice que no hay acceso). Quien la ve (gerente, administrador y, de solo lectura, el operador)
 * lista las órdenes de la sucursal activa y las de toda la empresa; crear, pedir, anular y cerrar solo se ofrecen a quien tiene `orden_de_compra_gestionar` (se vuelve a exigir en el servidor) y el control de exceso a quien tiene `compras_configurar`.
 * El precio de cada línea (dinero) solo lo ve quien gestiona.
 */
export default async function OrdenesDeCompraPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "orden_de_compra_ver", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const [gestionar, configurar] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "orden_de_compra_gestionar", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "compras_configurar", ctx.db),
  ]);
  const [ordenes, proveedores, nivel] = await Promise.all([
    listarOrdenesParaMostrar(ctx.db, gestionar.editar),
    gestionar.editar ? listarProveedoresParaSelector(true) : Promise.resolve([]),
    configurar.editar ? leerNivelDelControlDeExceso(ctx.db) : Promise.resolve(null),
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Órdenes de compra</h1>
      <PanelOrdenesDeCompra
        ordenes={ordenes}
        puedeGestionar={gestionar.editar}
        puedeConfigurar={configurar.editar}
        nivelDelControl={nivel ?? NIVEL_POR_DEFECTO_DEL_CONTROL}
        proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
        sucursalActiva={{ id: ctx.sucursalId, nombre: ctx.sucursalNombre }}
        hoy={diaDeCalendario(new Date(), ZONA_ARGENTINA)}
      />
    </div>
  );
}
