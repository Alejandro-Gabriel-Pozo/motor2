"use client";

import { Boton, type PropsDeBoton } from "@/ui/primitivas/boton";

/**
 * `Boton` para un componente de SERVIDOR (el menú de la cabecera, el selector de rango de los reportes…).
 *
 * La primitiva `Boton` (`ui/primitivas/boton.tsx`) no lleva `"use client"` y siempre le pone un `onClick` al `<button>` (el que ignora el clic mientras `cargando`): dentro de un componente de
 * servidor, Next corta con «Event handlers cannot be passed to Client Component props» (500). Este archivo es el límite de cliente: el servidor le pasa solo datos (variante, tamaño, hijos, atributos
 * serializables: `type="submit"` dentro de un `<form action>`) y el `<button>` se dibuja y se hidrata acá. No agrega nada: mismas props, mismas variantes y mismo aspecto que `Boton`; quien ya es de
 * cliente usa `Boton` directo. Se toca la primitiva solo con una decisión propia de ella: un `"use client"` en su archivo también impediría llamar a `claseDeBoton` desde el servidor.
 */
export function BotonDeServidor(props: PropsDeBoton) {
  return <Boton {...props} />;
}
