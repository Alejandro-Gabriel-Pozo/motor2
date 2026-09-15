import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { signOut } from "@/lib/auth";

const SECCIONES = [
  { href: "/reportes", label: "Resumen" },
  { href: "/reportes/periodo", label: "Período" },
  { href: "/reportes/categorias", label: "Por categoría" },
  { href: "/reportes/costos", label: "Costos y márgenes" },
  { href: "/reportes/valuacion", label: "Valuación de inventario" },
  { href: "/reportes/promociones", label: "Promociones" },
  { href: "/reportes/perdidas", label: "Pérdidas" },
  { href: "/reportes/devoluciones", label: "Devoluciones" },
  { href: "/reportes/vencimientos", label: "Vencimientos" },
  { href: "/reportes/diferencias", label: "Diferencias de ajuste" },
  { href: "/reportes/sin-receta", label: "Ventas sin receta" },
  { href: "/reportes/insumos-sin-receta", label: "Insumos sin receta" },
  { href: "/reportes/consignacion", label: "Consignación" },
  { href: "/reportes/salud", label: "Salud por producto" },
  { href: "/reportes/huecos-catalogo", label: "Huecos de catálogo" },
  { href: "/reportes/conteos", label: "Conteos físicos" },
  { href: "/reportes/historial", label: "Historial de un producto" },
  { href: "/reportes/trazabilidad", label: "Trazabilidad por ID" },
  { href: "/stock/consolidado", label: "← Stock" },
  { href: "/traspasos", label: "Traspasos →" },
];

export default async function ReportesLayout({ children }: { children: React.ReactNode }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) redirect("/login");

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-6">
          <span className="font-semibold">Motor2</span>
          <nav className="flex flex-wrap gap-4 text-sm">
            {SECCIONES.map((s) => (
              <Link key={s.href} href={s.href} className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm text-neutral-500">
          <span>
            {ctx.email} · {ctx.sucursalNombre} · {ctx.rolNombre}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button type="submit" className="underline">
              Salir
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
