"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { GrupoNav } from "@/core/navegacion/estructura";

function grupoActivo(grupo: GrupoNav, pathname: string): boolean {
  return grupo.items.some((i) => (i.href === "/reportes" ? pathname === "/reportes" : pathname === i.href || pathname.startsWith(`${i.href}/`)));
}

export function SidebarNav({ grupos }: { grupos: GrupoNav[] }) {
  const pathname = usePathname();
  const [expandido, setExpandido] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(grupos.map((g) => [g.id, grupoActivo(g, pathname)]))
  );

  // Al navegar a un grupo distinto, ese grupo se abre solo — sin tocar el
  // estado (abierto/cerrado) que el usuario ya haya elegido para los demás.
  // Ajustado durante el render (no en un efecto) al detectar que
  // `pathname` cambió desde el render anterior — mismo criterio que
  // CampoNumero/SelectorProducto.
  const [pathnamePrevio, setPathnamePrevio] = useState(pathname);
  if (pathname !== pathnamePrevio) {
    setPathnamePrevio(pathname);
    const activo = grupos.find((g) => grupoActivo(g, pathname));
    if (activo) setExpandido((prev) => (prev[activo.id] ? prev : { ...prev, [activo.id]: true }));
  }

  return (
    <nav className="flex flex-col gap-0.5 overflow-y-auto px-2 py-3 text-sm">
      {grupos.map((grupo) => {
        const abierto = expandido[grupo.id] ?? false;
        return (
          <div key={grupo.id}>
            <button
              type="button"
              onClick={() => setExpandido((prev) => ({ ...prev, [grupo.id]: !abierto }))}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {grupo.label}
              <span className="text-xs text-neutral-500 dark:text-neutral-400">{abierto ? "▾" : "▸"}</span>
            </button>
            {abierto && (
              <div className="ml-2 flex flex-col gap-0.5 border-l border-neutral-200 pl-2 dark:border-neutral-800">
                {grupo.items.map((item) => {
                  const activo = item.href === "/reportes" ? pathname === "/reportes" : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`rounded px-2 py-1 ${
                        activo
                          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
