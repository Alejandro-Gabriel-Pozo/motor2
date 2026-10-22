import type { ReactNode } from "react";
import { rutaDelPaso, type PasoDeLaPortada, type PasoDelEspacio } from "@/core/catalogo/public";
import { PestanasDeRuta, type PestanaDeRuta } from "@/ui/componentes/navegacion/pestanas-de-ruta";
import { Enlace } from "@/ui/primitivas/enlace";
import { Insignia } from "@/ui/primitivas/insignia";

/**
 * El MARCO del espacio del producto (Fase 6, 6.12; DEC-12): lo que comparten la portada del producto y sus pasos. Arriba, el volver a la lista, el nombre del producto (el `h1` de la pantalla), cómo se
 * vende y si está disponible en la sucursal activa; debajo, la tira de pasos (`PestanasDeRuta`: cada pestaña es OTRA pantalla) con «Resumen» y los pasos que le corresponden al tipo de producto, y después
 * el contenido de la pantalla. Es un componente de SERVIDOR que se usa desde cada página (no un `layout.tsx`): cada página conserva su propia guarda de permiso, que es la barrera.
 *
 * Los pasos ya vienen resueltos (`cargarMarcoDelEspacio`): un paso que el usuario no puede abrir llega con `href: null` y se dibuja como texto, SIN enlace; un paso de un módulo apagado no llega. Un paso con
 * algo pendiente lleva la insignia «Pendiente» (el texto lo dice y el tono lo refuerza); el detalle de qué falta lo cuenta la portada.
 */
export interface ProductoDelMarco {
  id: string;
  nombre: string;
  codigo: string;
  tipo: "PV" | "MP";
  /** Solo un producto de venta se vende «Directo» o «Por opción»; una materia prima no lleva la insignia. */
  modoDeVenta: "DIRECTO" | "BASE_CONFIGURABLE";
  disponibleAca: boolean;
  sucursalNombre: string;
}

export interface PropsDelMarco {
  producto: ProductoDelMarco;
  pasos: readonly PasoDeLaPortada[];
  /** La pantalla donde está el usuario: la portada (`Resumen`) o uno de los pasos. */
  actual: PasoDelEspacio | "portada";
  children: ReactNode;
}

function pestanaDelPaso(paso: PasoDeLaPortada, actual: PropsDelMarco["actual"]): PestanaDeRuta {
  return {
    href: paso.href,
    texto: paso.titulo,
    actual: paso.paso === actual,
    ...(paso.estado.tipo === "pendiente" ? { insignia: { tono: "aviso" as const, texto: "Pendiente" } } : {}),
  };
}

export function MarcoDelEspacio({ producto, pasos, actual, children }: PropsDelMarco) {
  const pestanas: PestanaDeRuta[] = [{ href: rutaDelPaso(producto.id, "portada"), texto: "Resumen", actual: actual === "portada" }, ...pasos.map((p) => pestanaDelPaso(p, actual))];
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm">
          <Enlace href="/catalogo/productos">← Productos</Enlace>
        </p>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{producto.nombre}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-tinta-suave">
            <span>
              {producto.codigo} · {producto.tipo === "MP" ? "Materia prima (MP)" : "Producto de venta (PV)"}
            </span>
            {producto.tipo === "PV" && <Insignia tono="neutro">{producto.modoDeVenta === "BASE_CONFIGURABLE" ? "Por opción" : "Directo"}</Insignia>}
            <Insignia tono={producto.disponibleAca ? "ok" : "aviso"}>{producto.disponibleAca ? `Disponible en «${producto.sucursalNombre}»` : `No disponible en «${producto.sucursalNombre}»`}</Insignia>
          </p>
        </div>
        <PestanasDeRuta etiqueta="Pasos del producto" pestanas={pestanas} />
      </header>
      {children}
    </div>
  );
}
