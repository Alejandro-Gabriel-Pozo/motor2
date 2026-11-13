import type { ReactNode } from "react";
import { rutaDelPaso, type PasoDeLaPortada, type PasoDelEspacio } from "@/core/catalogo/public";
import { PestanasDeRuta, type PestanaDeRuta } from "@/ui/componentes/navegacion/pestanas-de-ruta";
import { Enlace } from "@/ui/primitivas/enlace";
import { Insignia } from "@/ui/primitivas/insignia";
import { esBaseConfigurable, type ModoDeVenta } from "@/core/opciones/public";
import type { TipoProducto } from "@/core/datos/enumerados-del-esquema";

/**
 * El MARCO del espacio del producto (Fase 6, 6.12; DEC-12): lo que comparten la portada del producto y sus pasos. Arriba, el volver a la lista, el nombre del producto (el `h1` de la pantalla), cómo se
 * vende y si está disponible en la sucursal activa; debajo, la tira de pasos (`PestanasDeRuta`: cada pestaña es OTRA pantalla) con las pestañas Datos, Precios y Opciones (y, debajo, los enlaces a Receta y En la carta), y después
 * el contenido de la pantalla. Es un componente de SERVIDOR que se usa desde cada página (no un `layout.tsx`): cada página conserva su propia guarda de permiso, que es la barrera.
 *
 * Los pasos ya vienen resueltos (`cargarMarcoDelEspacio`): un paso que el usuario no puede abrir llega con `href: null` y se dibuja como texto, SIN enlace; un paso de un módulo apagado no llega. Un paso con
 * algo pendiente lleva la insignia «Pendiente» (el texto lo dice y el tono lo refuerza); el detalle de qué falta lo cuenta la portada.
 */
export interface ProductoDelMarco {
  id: string;
  nombre: string;
  codigo: string;
  tipo: TipoProducto;
  /** Solo un producto de venta se vende «Directo» o «Por opción»; una materia prima no lleva la insignia. */
  modoDeVenta: ModoDeVenta;
  disponibleAca: boolean;
  sucursalNombre: string;
  /**
   * Si el usuario puede ver la FICHA del producto (`producto_ver_catalogo`). Por defecto sí: casi todas las pantallas del espacio lo exigen. El paso «En la carta» pide solo `carta_ver`: quien lo abre sin ver
   * el catálogo no recibe el código, el tipo ni cómo se vende (lo que es del catálogo), ni un «Resumen» ni un «← Productos» que llevan a una pantalla que no puede abrir.
   */
  fichaVisible?: boolean;
}

export interface PropsDelMarco {
  producto: ProductoDelMarco;
  pasos: readonly PasoDeLaPortada[];
  /** La pantalla donde está el usuario: la portada (`Resumen`) o uno de los pasos. */
  actual: PasoDelEspacio | "portada";
  /**
   * Cuánto ancho ocupa el contenido: `angosto` (por defecto, una columna de 768 px: lo de siempre) o `ancho` (todo el ancho del contenedor de página, para las pantallas que reparten sus
   * secciones en `RejillaDeSecciones`). Estructura de pantalla, etapa E-A: las pantallas se pasan a `ancho` de a una.
   */
  ancho?: "angosto" | "ancho";
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

/** Los pasos que son PESTAÑA de la ficha (como la de Pedernal): Datos, Precios y Opciones. «Receta» y «En la carta» son enlaces chicos debajo (provisorio, pregunta 6 del dueño sin decidir). */
const PASOS_QUE_SON_PESTANA: readonly PasoDelEspacio[] = ["precios", "opciones"];

export function MarcoDelEspacio({ producto, pasos, actual, ancho = "angosto", children }: PropsDelMarco) {
  const fichaVisible = producto.fichaVisible ?? true;
  // La pestaña «Datos» abre la ficha (la portada) y queda marcada también en su formulario de edición (`datos`). Los pasos que no son pestaña (receta, en la carta) van como enlaces debajo.
  const pestanas: PestanaDeRuta[] = [
    { href: fichaVisible ? rutaDelPaso(producto.id, "portada") : null, texto: "Datos", actual: actual === "portada" || actual === "datos" },
    ...pasos.filter((p) => PASOS_QUE_SON_PESTANA.includes(p.paso)).map((p) => pestanaDelPaso(p, actual)),
  ];
  const enlaces = pasos.filter((p) => p.paso === "receta" || p.paso === "en-la-carta");
  return (
    <div className={`flex flex-col gap-6${ancho === "angosto" ? " max-w-3xl" : ""}`}>
      <header className="flex flex-col gap-3">
        {fichaVisible && (
          <p className="text-sm">
            <Enlace href="/catalogo/productos">← Productos</Enlace>
          </p>
        )}
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{producto.nombre}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-tinta-suave">
            {fichaVisible && (
              <span>
                {producto.codigo} · {producto.tipo === "MP" ? "Materia prima (MP)" : "Producto de venta (PV)"}
              </span>
            )}
            {fichaVisible && producto.tipo === "PV" && <Insignia tono="neutro">{esBaseConfigurable(producto.modoDeVenta) ? "Por opción" : "Directo"}</Insignia>}
            <Insignia tono={producto.disponibleAca ? "ok" : "aviso"}>{producto.disponibleAca ? `Disponible en «${producto.sucursalNombre}»` : `No disponible en «${producto.sucursalNombre}»`}</Insignia>
          </p>
        </div>
        <nav aria-label="Pasos del producto" className="flex flex-col gap-1">
        <PestanasDeRuta etiqueta="Pestañas del producto" pestanas={pestanas} />
        {enlaces.length > 0 && (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {enlaces.map((p) => (
              <li key={p.paso}>
                {p.href !== null ? (
                  <Enlace href={p.href} aria-current={p.paso === actual ? "page" : undefined} className="inline-flex min-h-11 items-center gap-2">
                    {p.titulo}
                    {p.estado.tipo === "pendiente" && <Insignia tono="aviso">Pendiente</Insignia>}
                  </Enlace>
                ) : (
                  <span className="text-tinta-tenue">{p.titulo}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        </nav>
      </header>
      {children}
    </div>
  );
}
