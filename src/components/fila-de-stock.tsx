import type { AccionClave } from "@/core/permisos/acciones";
import { pestanaActualDeStock, type PantallaDeStock } from "@/core/stock/public";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { pestanasVisiblesDeStock } from "@/server/acceso/menu";
import { PestanasDeRuta } from "@/ui/componentes/navegacion/pestanas-de-ruta";

/**
 * La fila de pestañas de una entrada de Stock (DEC-27): «Existencias» (Consolidado · Por familia · Alertas) o «Configuración» (Parámetros por insumo · Depósitos · Motivos de merma · Destinos de consumo).
 * Componente de SERVIDOR, como `FilaDeMovimientos`: el filtro por permiso se hace acá (`pestanasVisiblesDeStock`) y al navegador solo llegan las pestañas que se ofrecen; cada pantalla igual se protege con su
 * propia clave. `ruta` es la de la pantalla abierta (en un editor de parámetros se marca «Parámetros por insumo»). `visibles` es lo que la página ya calculó con su guarda, si lo tiene.
 */
export async function FilaDeStock({
  ctx,
  etiqueta,
  pestanas,
  ruta,
  visibles,
}: {
  ctx: ContextoUsuario;
  etiqueta: string;
  pestanas: readonly PantallaDeStock[];
  ruta: string;
  visibles?: ReadonlySet<AccionClave>;
}) {
  const ofrecidas = await pestanasVisiblesDeStock(ctx, pestanas, visibles);
  if (ofrecidas.length === 0) return null;
  const actual = pestanaActualDeStock(ofrecidas, ruta);
  // «Envuelta» (como la fila de Movimientos): en 375 px las cuatro pestañas de Configuración pasan a otro renglón y se leen completas, en vez de quedar cortadas de costado.
  return <PestanasDeRuta etiqueta={etiqueta} disposicion="envuelta" pestanas={ofrecidas.map((p) => ({ href: p.href, texto: p.texto, actual: p.href === actual }))} />;
}
