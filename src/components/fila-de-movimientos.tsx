import type { AccionClave } from "@/core/permisos/acciones";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { procesosVisiblesDelSelector } from "@/server/acceso/menu";
import { PestanasDeRuta } from "@/ui/componentes/navegacion/pestanas-de-ruta";

/**
 * La fila «Qué movimiento registrar» (Fase 7, decisión Q1 del dueño): una pestaña-enlace por cada proceso del selector que el rol puede VER, con la del proceso abierto marcada (`aria-current`). Componente de
 * SERVIDOR: el filtro por permiso se hace acá (`procesosVisiblesDelSelector`) y al navegador solo llegan las pestañas que se ofrecen; cada pantalla igual se protege con su propia clave. `actual` es la ruta de la
 * pantalla abierta (`/movimientos/ajuste`; `null` en `/movimientos`, donde no hay ninguna elegida). `visibles` es lo que la página ya calculó con su guarda, si lo tiene (evita repetir la lectura).
 */
export async function FilaDeMovimientos({ ctx, actual, visibles }: { ctx: ContextoUsuario; actual: string | null; visibles?: ReadonlySet<AccionClave> }) {
  const procesos = await procesosVisiblesDelSelector(ctx, visibles);
  if (procesos.length === 0) return null;
  return <PestanasDeRuta etiqueta="Qué movimiento registrar" pestanas={procesos.map((p) => ({ href: p.href, texto: p.etiquetaCorta, actual: p.href === actual }))} />;
}
