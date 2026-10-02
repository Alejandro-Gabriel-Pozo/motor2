import { ArrowLeftRight, BookOpen, Boxes, ChartColumn, CircleQuestionMark, Eye, History, Package, Pencil, Power, ShieldCheck, Trash2, Truck, UtensilsCrossed, type LucideIcon } from "lucide-react";

/**
 * Único archivo que importa `lucide-react` (lo comprueba test/arquitectura/iconos-accesibles.test.ts). Todo ícono es decorativo: va
 * junto a un texto visible o, si es la única marca de un control, ese control lleva `aria-label`; por eso el envoltorio lo oculta
 * siempre a los lectores de pantalla.
 */
function Icono({ icono: Componente, className = "h-4 w-4 shrink-0" }: { icono: LucideIcon; className?: string }) {
  return <Componente aria-hidden="true" focusable="false" className={className} />;
}

/** Un ícono por módulo del menú (id de `GRUPOS_NAV`); el guardián exige que no falte ninguno. */
const ICONO_DE_MODULO: Record<string, LucideIcon> = {
  administracion: ShieldCheck,
  catalogo: Package,
  carta: BookOpen,
  movimientos: ArrowLeftRight,
  stock: Boxes,
  reportes: ChartColumn,
  traspasos: Truck,
  pos: UtensilsCrossed,
};

export function IconoDeModulo({ id, className }: { id: string; className?: string }) {
  const icono = ICONO_DE_MODULO[id];
  return icono ? <Icono icono={icono} className={className} /> : null;
}

/** Un ícono por acción de tabla; va siempre junto al texto de la acción («Editar», «Quitar»…), que sigue siendo su nombre accesible. */
const ICONO_DE_ACCION: Record<"editar" | "eliminar" | "activar" | "ver" | "historial", LucideIcon> = {
  editar: Pencil,
  eliminar: Trash2,
  activar: Power,
  ver: Eye,
  historial: History,
};

export function IconoDeAccion({ id }: { id: keyof typeof ICONO_DE_ACCION }) {
  return <Icono icono={ICONO_DE_ACCION[id]} className="h-3.5 w-3.5 shrink-0" />;
}

export function IconoAyuda() {
  return <Icono icono={CircleQuestionMark} className="h-3.5 w-3.5" />;
}
