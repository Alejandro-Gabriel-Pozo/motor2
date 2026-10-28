import type { AccionClave } from "@/core/permisos/acciones";
import type { PantallaDeCatalogo } from "@/core/catalogo/public";
import { puedeVerItem } from "@/core/navegacion/estructura";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { accionesDelMenuQueElUsuarioPuedeVer } from "@/server/acceso/gate";
import { PestanasDeRuta } from "@/ui/componentes/navegacion/pestanas-de-ruta";

/**
 * La fila de pestañas de una entrada de Catálogo (DEC-13): «Productos» (Productos · Precio local · Recetas) o «Maestros» (Insumos · Categorías · Unidades · Margen objetivo). Componente de SERVIDOR, como
 * `FilaDeStock`: el filtro por permiso se hace acá, con el mismo cálculo del menú (cada clave en su contexto: Precio local en la sucursal activa, el resto en la empresa), y al navegador solo llegan las
 * pestañas que se ofrecen; cada pantalla igual se protege con su propia clave. `ruta` es la de la pantalla abierta (la pestaña que se marca). `visibles` es lo que la página ya calculó con su guarda, si
 * lo tiene. Si la única pestaña visible es la pantalla abierta no se dibuja nada: no lleva a ningún otro lado.
 */
export async function FilaDeCatalogo({
  ctx,
  etiqueta,
  pestanas,
  ruta,
  visibles,
}: {
  ctx: ContextoUsuario;
  etiqueta: string;
  pestanas: readonly PantallaDeCatalogo[];
  ruta: string;
  visibles?: ReadonlySet<AccionClave>;
}) {
  const claves = [...new Set(pestanas.flatMap((p) => (p.algunaDe ? [...p.algunaDe] : [p.accion])))];
  const puedeVer = visibles ?? (await accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, claves, ctx.db));
  const ofrecidas = pestanas.filter((p) => puedeVerItem(p, puedeVer));
  if (ofrecidas.length === 0 || (ofrecidas.length === 1 && ofrecidas[0].href === ruta)) return null;
  // «Envuelta» (como las filas de Movimientos y Stock): en 375 px las cuatro pestañas de Maestros pasan a otro renglón y se leen completas, en vez de quedar cortadas de costado.
  return <PestanasDeRuta etiqueta={etiqueta} disposicion="envuelta" pestanas={ofrecidas.map((p) => ({ href: p.href, texto: p.texto, actual: p.href === ruta }))} />;
}
