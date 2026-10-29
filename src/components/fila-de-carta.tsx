import type { AccionClave } from "@/core/permisos/acciones";
import type { PestanaDeCarta } from "@/core/carta/public";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { pestanasVisiblesDeCarta } from "@/server/acceso/menu";
import { PestanasDeRuta } from "@/ui/componentes/navegacion/pestanas-de-ruta";

/**
 * La fila de pestañas de una entrada de Carta (DEC-24): «Carta» (Hoy · Secciones y géneros · Ítems agrupados), «Promociones» (con el menú del día cuando se prenda) o «Apariencia y publicación» (Tema ·
 * Portal). Componente de SERVIDOR, como `FilaDeStock`: el filtro por permiso se hace acá (`pestanasVisiblesDeCarta`) y al navegador solo llegan las pestañas que se ofrecen; cada pantalla igual se protege con
 * su propia clave. `ruta` es la de la pantalla abierta. Con una sola pestaña no se dibuja (no hay entre qué elegir). «Envuelta»: en 375 px pasan a otro renglón y se leen completas.
 */
export async function FilaDeCarta({
  ctx,
  etiqueta,
  pestanas,
  ruta,
  visibles,
}: {
  ctx: ContextoUsuario;
  etiqueta: string;
  pestanas: readonly PestanaDeCarta[];
  ruta: string;
  visibles?: ReadonlySet<AccionClave>;
}) {
  const ofrecidas = await pestanasVisiblesDeCarta(ctx, pestanas, ruta, visibles);
  if (ofrecidas.length < 2) return null;
  return <PestanasDeRuta etiqueta={etiqueta} disposicion="envuelta" pestanas={ofrecidas} />;
}
