import type { Contrato } from "../tipos";

/**
 * Fábrica de los contratos de las PRIMITIVAS de `src/ui/primitivas` (Fase 6, paso 6.6). Cada primitiva (`Boton`, `Campo`, `Selector`, `AreaDeTexto`) tiene UNA fuente (su archivo en `src/ui/primitivas`,
 * con la marca `// @contrato <id>` junto al ancla exportado) y muchos consumidores. El contrato vigila dos cosas:
 *  1. quien dibuja la etiqueta JSX de la primitiva (`<Boton …>`) la IMPORTA de la fuente (`uso-sin-declarar` si no: un componente local con el mismo nombre, o uno que llega por un camino que
 *     el contrato no ve, es otra pieza con el mismo nombre y escapa de la primitiva);
 *  2. nadie redefine la primitiva fuera de `src/ui` (`definicion-duplicada`: una `function Boton` en una pantalla es una copia que se desvía).
 * El alcance es lo que dibuja pantallas (`src/app`, `src/components`) y las pruebas de la propia capa (`test/ui`: su prueba es el primer consumidor). `src/ui` queda afuera: la capa se
 * usa a sí misma (un `CampoFecha` arma un `Campo`) y la vigilan `ui-sin-negocio.test.ts` y los cercos de tokens. Las excepciones, los casos legítimos y la deuda son del contrato concreto,
 * no de la fábrica: arrancan vacíos y lo que el motor reporte sobre el código existente se escribe en el contrato que lo reporta.
 *
 * `test/ui` va PRIMERO en las raíces a propósito: los operadores de la matriz meten el archivo nuevo de un uso crudo en la primera raíz, y una prueba (tipo `pruebas`) no declara contratos en las
 * áreas, así que el uso de ejemplo no suma un hallazgo de área ajeno a la mutación.
 *
 * Cada primitiva tiene su propio archivo `contratos/<id>.ts` (la convención del motor: `dondeSeDefine` y el registro de aprobaciones apuntan a `contratos/<id>.ts`) que llama a esta fábrica con sus
 * datos; acá solo vive lo que las cuatro comparten.
 *
 * El detector de uso mira el CÓDIGO (sin comentarios ni interior de strings ni texto JSX), así que `<Boton>` dentro de un texto o un comentario no es un uso. `\b` evita que
 * `<BotonEliminar` cuente como `<Boton`.
 */
export function contratoDePrimitiva(p: { id: string; archivo: string; ancla: string; etiquetaJsx: string; nombresPropios: readonly string[]; porQue: string }): Contrato {
  return {
    id: p.id,
    porQue: p.porQue,
    fuente: { archivo: p.archivo, ancla: p.ancla },
    alcance: { raices: ["test/ui", "src/app", "src/components"], extensiones: [".ts", ".tsx"] },
    senales: [{ adaptador: "ts", tipo: "codigo", patron: new RegExp(`<${p.etiquetaJsx}\\b`, "g"), que: `dibuja <${p.etiquetaJsx}>` }],
    declaracion: { tipo: "importar-ancla" },
    definicion: [{ adaptador: "ts", tipo: "declara", nombre: new RegExp(`^(?:${p.nombresPropios.join("|")})$`), que: "redefine la primitiva fuera de src/ui" }],
    consumidores: "descubiertos",
    casosLegitimos: [],
    excepciones: [],
    deuda: [],
  };
}
