import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { signOut } from "@/lib/auth";

const SECCIONES = [
  { href: "/catalogo/productos", label: "Productos" },
  { href: "/catalogo/proveedores", label: "Proveedores" },
  { href: "/catalogo/recetas", label: "Recetas" },
  { href: "/catalogo/insumos-grupos", label: "Insumos / Grupos" },
  { href: "/catalogo/categorias", label: "Categorías" },
  { href: "/catalogo/unidades", label: "Unidades" },
  { href: "/movimientos/compra", label: "Movimientos →" },
  { href: "/administracion/usuarios", label: "← Administración" },
];

export default async function CatalogoLayout({ children }: { children: React.ReactNode }) {
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
