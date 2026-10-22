import { BotonDeServidor } from "@/components/boton-de-servidor";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { generarReporteConsignacion } from "@/server/consultas/reportes/consignacion";
import { TablaDebidoConsignante, TablaStockSinVenderConsignacion } from "./tabla-consignacion";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { esDiaISOReal, finDelDia, inicioDelDia } from "@/core/tiempo/zona-horaria";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";
import { Enlace } from "@/ui/primitivas/enlace";

export default async function ConsignacionPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"desde" | "hasta">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "pagar_consignante", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  // Ver ≠ pagar (Fase 2b, D3): con «Ver» de `pagar_consignante` se ve el reporte; el botón «Registrar pago» solo lo recibe quien tiene «Editar». Es cortesía de la
  // pantalla: la acción (`registrarPagoConsignante`) vuelve a exigir «Editar» en el servidor.
  const { editar: puedePagar } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "pagar_consignante", ctx.db);

  const crudos = unicosDeUrl(await searchParams);
  // Un día de la URL que no existe («2026-02-30») o no es «AAAA-MM-DD» se ignora (sin filtro), no se corre al día siguiente.
  const desde = esDiaISOReal(crudos.desde) ? crudos.desde : undefined;
  const hasta = esDiaISOReal(crudos.hasta) ? crudos.hasta : undefined;
  // Sin filtro por defecto: "Debido por consignante" es un saldo acumulado
  // desde siempre, no una ventana — filtrar por período acá sería mostrar
  // solo el movimiento de ese lapso, no cuánto se le debe HOY. El filtro es
  // opcional, para reconciliar un período puntual con el consignante.
  // Cada extremo es un día "de solo día" (`AAAA-MM-DD`): se expande al inicio / fin de ESE día en la zona de la empresa (P1), así lo cargado el último día entra.
  const periodo =
    desde || hasta
      ? {
          desde: desde ? inicioDelDia(desde, ctx.empresaZonaHoraria) : undefined,
          hasta: hasta ? finDelDia(hasta, ctx.empresaZonaHoraria) : undefined,
        }
      : undefined;

  const rep = await generarReporteConsignacion(ctx.sucursalId, ctx.db, periodo);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Consignación</h1>
        <p className="text-sm text-tinta-tenue">Cuánto se le debe a cada consignante, y cuánto stock en consignación queda sin vender.</p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Debido por consignante</h2>
        <form className="mb-2 flex flex-wrap items-end gap-3 text-sm">
          <CampoFecha etiqueta="Desde" name="desde" defaultValue={desde ?? ""} />
          <CampoFecha etiqueta="Hasta" name="hasta" defaultValue={hasta ?? ""} />
          <BotonDeServidor type="submit">Filtrar</BotonDeServidor>
          {periodo && <Enlace href="/reportes/consignacion">Ver saldo acumulado (sin filtro)</Enlace>}
        </form>
        <p className="mb-2 text-xs text-tinta-tenue">
          {periodo
            ? "Movimiento del período elegido, no el saldo acumulado — para lo que se le debe HOY a cada consignante, sacá el filtro."
            : "Saldo acumulado desde siempre (liquidado − pagado)."}
        </p>
        <TablaDebidoConsignante filas={rep.debidoPorConsignante} puedePagar={puedePagar} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Stock en consignación sin vender</h2>
        <TablaStockSinVenderConsignacion filas={rep.stockSinVender} />
      </div>
    </div>
  );
}
