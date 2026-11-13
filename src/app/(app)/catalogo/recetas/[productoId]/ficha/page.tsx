import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { obtenerRecetaVigente } from "@/server/actions/catalogo/recetas";
import { obtenerProductoPorId } from "@/server/consultas/catalogo/productos";
import { obtenerEstadoDeRecetaPropia } from "@/server/consultas/catalogo/receta-propia";
import { armarFichaDeCocina } from "@/core/catalogo/public";
import { FichaDeCocinaVista } from "@/components/catalogo/ficha-de-cocina/ficha-de-cocina-vista";
import { BotonImprimirFicha } from "@/components/catalogo/ficha-de-cocina/boton-imprimir";

/**
 * Ficha de cocina (`docs/diseno-ficha-de-cocina-2026-11-08.md`): la receta que rige en la sucursal activa (la propia si está habilitada; si no, la central), de SOLO LECTURA y pensada
 * para papel. Mismo «Ver» que la pantalla de la receta (`guardar_receta`) y mismo comportamiento ante un producto que no es de la empresa («No se encontró ese producto»: la base del
 * contexto no lo ve). Lectura pura: no escribe nada, así que no hay concurrencia ni idempotencia que resolver.
 */
export default async function FichaDeCocinaPage({ params }: { params: Promise<{ productoId: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "guardar_receta", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { productoId } = await params;
  const [producto, central, estadoPropia] = await Promise.all([
    obtenerProductoPorId(productoId, ctx.db),
    obtenerRecetaVigente(productoId),
    obtenerEstadoDeRecetaPropia(productoId, ctx.sucursalId, ctx.db),
  ]);

  if (!producto) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-error">No se encontró ese producto.</p>
        <Link href="/catalogo/recetas" className="text-sm underline">
          ← Volver a Recetas
        </Link>
      </div>
    );
  }

  // La que rige en la sucursal: la propia habilitada (con versiones) o, si no, la central (ADR-009; mismo criterio que `cargarRecetaVigente` con el alcance de la sucursal).
  const origen = estadoPropia.habilitada && estadoPropia.propia ? "PROPIA" : "CENTRAL";
  const receta = origen === "PROPIA" ? estadoPropia.propia : central;
  const volver = `/catalogo/recetas/${producto.id}`;

  if (!receta) {
    return (
      <div className="flex flex-col gap-2">
        <p>&quot;{producto.nombre}&quot; todavía no tiene receta: la ficha de cocina está pendiente de completar.</p>
        <Link href={volver} className="inline-flex min-h-11 items-center text-sm underline">
          ← Volver a la receta
        </Link>
      </div>
    );
  }

  const ficha = armarFichaDeCocina({ productoNombre: producto.nombre, sucursalNombre: ctx.sucursalNombre, origen, receta, ahora: new Date() });

  return (
    <div className="flex flex-col gap-4">
      <div data-ficha-solo-pantalla="true" className="flex flex-wrap items-center gap-3">
        <Link href={volver} className="inline-flex min-h-11 items-center text-sm underline">
          ← Volver a la receta
        </Link>
        <BotonImprimirFicha />
      </div>
      <FichaDeCocinaVista ficha={ficha} />
    </div>
  );
}
