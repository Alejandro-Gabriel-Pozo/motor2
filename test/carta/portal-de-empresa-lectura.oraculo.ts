/**
 * ORÁCULO de la lectura pública del portal de la empresa (PR-A del portal; `docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md` §10, nivel 10, regla de combinaciones del 2026-10-28). Escrito APARTE del código: cada regla dice, en palabras y con el resultado a la vista, si la sucursal APARECE
 * en el portal que ve el comensal según las dimensiones que cambian lo que ve. No importa nada de `src/`: si la regla de `portal-de-empresa-lectura.ts` o de `publica.ts` cambia, la tabla no cambia sola.
 *
 * DIMENSIONES que cambian lo que ve el comensal (cada una con TODOS sus valores):
 *  - MÓDULO `carta` de la empresa: contratado / no.
 *  - PORTAL NUEVO (la fila de `PortalDeEmpresa`): no existe (se lee `SucursalPublica` y el Json como siempre) / existe en variante A (tarjetas) / existe en variante B (imagen con zonas).
 *  - TARJETA de la sucursal: visible con nombre propio / visible sin nombre (usa el de la carta) / oculta / sin fila.
 *  - ZONA de la sucursal: visible / oculta / sin fila.
 *  - SUCURSAL: publicada y activa / no publicada / inactiva / sin registro público.
 * No cambian lo que ve (declaradas en `DIMENSIONES_DE_LAS_TABLAS`, abajo): lo demás de las tres tablas.
 */

export type Modulo = "con_carta" | "sin_carta";
export type Portal = "sin_portal" | "variante_A" | "variante_B";
export type Tarjeta = "visible_con_nombre" | "visible_sin_nombre" | "oculta" | "sin_fila";
export type Zona = "visible" | "oculta" | "sin_fila";
export type Sucursal = "publicada_y_activa" | "no_publicada" | "inactiva" | "sin_registro";

export interface Caso {
  modulo: Modulo;
  portal: Portal;
  tarjeta: Tarjeta;
  zona: Zona;
  sucursal: Sucursal;
}

const MODULOS: readonly Modulo[] = ["con_carta", "sin_carta"];
const PORTALES: readonly Portal[] = ["sin_portal", "variante_A", "variante_B"];
const TARJETAS: readonly Tarjeta[] = ["visible_con_nombre", "visible_sin_nombre", "oculta", "sin_fila"];
const ZONAS: readonly Zona[] = ["visible", "oculta", "sin_fila"];
const SUCURSALES: readonly Sucursal[] = ["publicada_y_activa", "no_publicada", "inactiva", "sin_registro"];

/** Lo que el comensal ve de una sucursal que aparece: el nombre de la tarjeta y su lugar (`null` = en la grilla, sin posición sobre el mapa). */
export interface Aparicion {
  etiqueta: string;
  posicion: { x: number; y: number; w: number; h: number } | null;
}

export const NOMBRE_DE_LA_TARJETA = "Nombre de la tarjeta";
export const NOMBRE_DE_LA_CARTA = "Centro";
/** La zona sembrada: esquina (10, 20) y tamaño 30 × 40 → el portal dibuja el CENTRO (25, 40). */
export const ZONA_SEMBRADA = { x: 10, y: 20, ancho: 30, alto: 40 };
export const CENTRO_DE_LA_ZONA = { x: 25, y: 40, w: 30, h: 40 };

export interface Regla {
  id: string;
  /** La regla, en palabras. */
  regla: string;
  aplica: (c: Caso) => boolean;
  /** `null` = la sucursal NO aparece. */
  resultado: (c: Caso) => Aparicion | null;
}

const publicadaYActiva = (c: Caso) => c.sucursal === "publicada_y_activa";

/** Las reglas, en orden: gana la PRIMERA que aplica. */
export const REGLAS: readonly Regla[] = [
  { id: "R1", regla: "Sin el módulo Carta no aparece nada (ni portal nuevo ni portal de siempre).", aplica: (c) => c.modulo === "sin_carta", resultado: () => null },
  { id: "R2", regla: "Una sucursal que no está publicada, o está inactiva, o no tiene registro público, no aparece NUNCA (no hay a dónde llevar), tenga la tarjeta o la zona que tenga.", aplica: (c) => !publicadaYActiva(c), resultado: () => null },
  {
    id: "R3",
    regla: "Sin portal nuevo se lee el registro público de siempre: la sucursal publicada y activa aparece con el nombre de su carta y sin posición (la tarjeta y la zona no existen).",
    aplica: (c) => c.portal === "sin_portal",
    resultado: () => ({ etiqueta: NOMBRE_DE_LA_CARTA, posicion: null }),
  },
  {
    id: "R4",
    regla: "Variante A: aparece solo con una tarjeta VISIBLE, con el nombre de la tarjeta (o el de la carta si no tiene) y sin posición. Lo cargado como zona no cuenta.",
    aplica: (c) => c.portal === "variante_A",
    resultado: (c) => (c.tarjeta === "visible_con_nombre" ? { etiqueta: NOMBRE_DE_LA_TARJETA, posicion: null } : c.tarjeta === "visible_sin_nombre" ? { etiqueta: NOMBRE_DE_LA_CARTA, posicion: null } : null),
  },
  {
    id: "R5",
    regla: "Variante B: aparece solo con una zona VISIBLE, con el nombre de la carta y su posición sobre el mapa (el centro de la zona). Lo cargado como tarjeta no cuenta.",
    aplica: (c) => c.portal === "variante_B",
    resultado: (c) => (c.zona === "visible" ? { etiqueta: NOMBRE_DE_LA_CARTA, posicion: CENTRO_DE_LA_ZONA } : null),
  },
];

/** El resultado esperado de un caso: el de la primera regla que aplica. */
export function esperado(c: Caso): { regla: string; aparicion: Aparicion | null } {
  const r = REGLAS.find((x) => x.aplica(c));
  if (!r) throw new Error(`ninguna regla del oráculo aplica a ${JSON.stringify(c)}`);
  return { regla: r.id, aparicion: r.resultado(c) };
}

/** Todos los casos que tienen sentido: sin portal nuevo no hay tarjeta ni zona (cuelgan del portal). */
export function todosLosCasos(): Caso[] {
  const casos: Caso[] = [];
  for (const modulo of MODULOS) {
    for (const portal of PORTALES) {
      for (const sucursal of SUCURSALES) {
        for (const tarjeta of portal === "sin_portal" ? (["sin_fila"] as const) : TARJETAS) {
          for (const zona of portal === "sin_portal" ? (["sin_fila"] as const) : ZONAS) casos.push({ modulo, portal, tarjeta, zona, sucursal });
        }
      }
    }
  }
  return casos;
}

/**
 * Cada columna de las tres tablas, declarada: ¿cambia lo que ve el comensal en el LISTADO del portal («afecta») o no? Un guardián (`portal-de-empresa-lectura.test.ts`) falla si aparece una columna nueva en el esquema sin declarar acá: hay que decidir, y dejar escrito, si cambia el oráculo.
 * `afecta`: la dimensión del oráculo que la usa; `no afecta`: el motivo.
 */
export const DIMENSIONES_DE_LAS_TABLAS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  PortalDeEmpresa: {
    id: "no afecta: identidad (la tarjeta y la zona cuelgan de él)",
    empresaId: "no afecta: el aislamiento lo da la RLS; la empresa sale del contexto",
    empresa: "no afecta: relación",
    codigo: "no afecta: la llave del QR no cambia qué se lista (la ruta por código es del Frente 6)",
    variante: "afecta: PORTAL (variante A = tarjetas, variante B = zonas)",
    lineaSuperior: "no afecta el listado: es el texto de la línea superior (estilo; lo cubre la prueba del estilo)",
    titulo: "no afecta el listado: es el título (estilo; lo cubre la prueba del estilo)",
    colorEncabezado: "no afecta el listado: color (estilo)",
    colorPagina: "no afecta el listado: color (estilo)",
    colorDetras: "no afecta el listado: todavía no se dibuja (pantalla del Frente 6)",
    logoVisible: "no afecta el listado: logo (estilo)",
    imagenProveedor: "no afecta el listado: imagen de fondo (estilo)",
    imagenCuenta: "no afecta el listado: imagen de fondo (estilo)",
    imagenIdPublico: "no afecta el listado: imagen de fondo (estilo)",
    imagenVersion: "no afecta el listado: imagen de fondo (estilo)",
    imagenExtension: "no afecta el listado: imagen de fondo (estilo)",
    creadoPorId: "no afecta: auditoría",
    version: "no afecta: control optimista",
    creadoEn: "no afecta: auditoría",
    actualizadoEn: "no afecta: auditoría",
    tarjetas: "no afecta: relación",
    zonas: "no afecta: relación",
  },
  PortalTarjeta: {
    empresaId: "no afecta: el aislamiento lo da la RLS",
    empresa: "no afecta: relación",
    portalId: "no afecta: pertenencia al portal de la empresa",
    portal: "no afecta: relación",
    sucursalId: "afecta: SUCURSAL (a qué sucursal lleva)",
    sucursal: "no afecta: relación",
    orden: "no afecta QUÉ se ve, solo en qué orden (lo cubre la prueba del orden)",
    visible: "afecta: TARJETA (visible / oculta)",
    nombre: "afecta: TARJETA (con nombre propio / sin nombre)",
    telefono: "no afecta el listado: la pantalla del Frente 6 lo dibuja (la entrada del portal todavía no lo lleva)",
    fotoProveedor: "no afecta el listado: foto (Frente 6)",
    fotoCuenta: "no afecta el listado: foto (Frente 6)",
    fotoIdPublico: "no afecta el listado: foto (Frente 6)",
    fotoVersion: "no afecta el listado: foto (Frente 6)",
    fotoExtension: "no afecta el listado: foto (Frente 6)",
    version: "no afecta: control optimista",
    creadoEn: "no afecta: auditoría",
    actualizadoEn: "no afecta: auditoría",
  },
  PortalZona: {
    id: "no afecta: identidad",
    empresaId: "no afecta: el aislamiento lo da la RLS",
    empresa: "no afecta: relación",
    portalId: "no afecta: pertenencia al portal de la empresa",
    portal: "no afecta: relación",
    sucursalId: "afecta: SUCURSAL (a qué sucursal lleva)",
    sucursal: "no afecta: relación",
    x: "afecta: ZONA (el lugar sobre el mapa: la posición del centro)",
    y: "afecta: ZONA (el lugar sobre el mapa: la posición del centro)",
    ancho: "afecta: ZONA (el tamaño del recuadro)",
    alto: "afecta: ZONA (el tamaño del recuadro)",
    visible: "afecta: ZONA (visible / oculta)",
    version: "no afecta: control optimista",
    creadoEn: "no afecta: auditoría",
    actualizadoEn: "no afecta: auditoría",
  },
};
