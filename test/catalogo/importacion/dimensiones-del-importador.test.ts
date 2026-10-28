import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  CLAVES_DE_CORRECCION_DE_NOMBRE,
  CLAVES_DE_CORRECCION_DE_PRECIO_UNICO,
  CLAVES_DE_LA_REGLA,
  CLAVES_DEL_ARCHIVO_DE_CORRECCIONES,
} from "../../../src/core/features/catalogo/importacion/correcciones";
import { DIMENSIONES_DEL_IMPORTADOR } from "../../../src/core/features/catalogo/importacion/dimensiones";
import { ENCABEZADOS, HOJAS_QUE_NO_SE_LEEN } from "../../../src/core/features/catalogo/importacion/normalizar";

/**
 * GUARDIÁN `DIMENSIONES_DEL_IMPORTADOR` (regla del dueño «Combinaciones», 2026-10-28; ADENDA A.8 del diseño del importador): toda columna que el normalizador acepta, todo campo que el
 * importador escribe y toda clave del archivo de correcciones está DECLARADA en `src/core/features/catalogo/importacion/dimensiones.ts`, con si afecta y por qué; en las dos direcciones
 * (una declaración que ya no se usa también falla). Así una dimensión nueva (una columna, un campo, una clave) no entra sin que alguien decida si cambia dinero, permisos, visibilidad o stock.
 *
 * Lo que se escribe se lee por AST de los TIPOS que lo fijan (no de un texto suelto): `ProductoAEscribir` y `DisponibilidadAEscribir` (`planificar-productos.ts`) y la fila de auditoría
 * (`FilaDeAuditoria`, `core/permisos/auditoria.ts`).
 */
const RAIZ = join(__dirname, "../../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

/** Los nombres de las propiedades de una interfaz (`interface X { a: …; b?: … }`) de una fuente; `null` si la interfaz no está. */
export function propiedadesDeInterfaz(fuente: string, interfaz: string): string[] | null {
  const archivo = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  for (const s of archivo.statements)
    if (ts.isInterfaceDeclaration(s) && s.name.text === interfaz)
      return s.members.flatMap((m) => (ts.isPropertySignature(m) && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? [m.name.text] : []));
  return null;
}

/** Modelo → de dónde sale lo que se escribe (archivo e interfaz). */
const FUENTES_DE_LO_QUE_SE_ESCRIBE: Record<string, { archivo: string; interfaz: string }[]> = {
  Producto: [{ archivo: "src/core/features/catalogo/importacion/planificar-productos.ts", interfaz: "ProductoAEscribir" }],
  DisponibilidadProducto: [{ archivo: "src/core/features/catalogo/importacion/planificar-productos.ts", interfaz: "DisponibilidadAEscribir" }],
  RegistroAuditoria: [{ archivo: "src/core/permisos/auditoria.ts", interfaz: "FilaDeAuditoria" }],
};

const ordenadas = (xs: Iterable<string>) => [...xs].sort();

describe("guardián DIMENSIONES_DEL_IMPORTADOR", () => {
  it("cada hoja y cada columna que el normalizador acepta está declarada (con si afecta y su motivo), y nada declarado sobra", () => {
    const hojas = DIMENSIONES_DEL_IMPORTADOR.hojas as Record<string, Record<string, { afecta: string; motivo: string }>>;
    expect(ordenadas(Object.keys(hojas)), "hojas leídas").toEqual(ordenadas(Object.keys(ENCABEZADOS)));
    for (const [hoja, columnas] of Object.entries(ENCABEZADOS)) {
      expect(ordenadas(Object.keys(hojas[hoja])), `columnas de «${hoja}»`).toEqual(ordenadas(columnas));
      for (const [columna, d] of Object.entries(hojas[hoja])) {
        expect(["SI", "CONTROL", "AVISO", "NO"], `${hoja} › ${columna}`).toContain(d.afecta);
        expect(d.motivo.trim().length, `${hoja} › ${columna} sin motivo`).toBeGreaterThan(5);
      }
    }
    expect(ordenadas(Object.keys(DIMENSIONES_DEL_IMPORTADOR.hojasQueNoSeLeen)), "hojas que no se leen").toEqual(ordenadas(HOJAS_QUE_NO_SE_LEEN));
  });

  it("cada campo que el importador escribe está declarado por modelo, en las dos direcciones", () => {
    expect(ordenadas(Object.keys(DIMENSIONES_DEL_IMPORTADOR.escribe)), "modelos declarados y modelos con fuente").toEqual(ordenadas(Object.keys(FUENTES_DE_LO_QUE_SE_ESCRIBE)));
    for (const [modelo, fuentes] of Object.entries(FUENTES_DE_LO_QUE_SE_ESCRIBE)) {
      const declarados = ordenadas(Object.keys(DIMENSIONES_DEL_IMPORTADOR.escribe[modelo]));
      for (const { archivo, interfaz } of fuentes) {
        const reales = propiedadesDeInterfaz(leer(archivo), interfaz);
        expect(reales, `${archivo}: no se encontró la interfaz ${interfaz}`).not.toBeNull();
        expect(ordenadas(reales!), `${modelo}: lo que escribe ${interfaz} y lo declarado`).toEqual(declarados);
      }
      for (const [campo, motivo] of Object.entries(DIMENSIONES_DEL_IMPORTADOR.escribe[modelo])) expect(motivo.trim().length, `${modelo}.${campo} sin motivo`).toBeGreaterThan(3);
    }
  });

  it("cada clave del archivo de correcciones está declarada, en las dos direcciones", () => {
    const c = DIMENSIONES_DEL_IMPORTADOR.correcciones;
    expect(ordenadas(Object.keys(c.archivo))).toEqual(ordenadas(CLAVES_DEL_ARCHIVO_DE_CORRECCIONES));
    expect(ordenadas(Object.keys(c.regla))).toEqual(ordenadas(CLAVES_DE_LA_REGLA));
    expect(ordenadas(Object.keys(c.precioUnico))).toEqual(ordenadas(CLAVES_DE_CORRECCION_DE_PRECIO_UNICO));
    expect(ordenadas(Object.keys(c.nombre))).toEqual(ordenadas(CLAVES_DE_CORRECCION_DE_NOMBRE));
  });

  it("el detector ve una propiedad nueva de la interfaz (un campo escrito sin declarar)", () => {
    const fuente = "export interface ProductoAEscribir { codigo: string; nombre: string; }";
    expect(propiedadesDeInterfaz(fuente, "ProductoAEscribir")).toEqual(["codigo", "nombre"]);
    expect(propiedadesDeInterfaz(fuente.replace("nombre: string;", "nombre: string; alicuotaIvaVenta?: string;"), "ProductoAEscribir")).toEqual(["codigo", "nombre", "alicuotaIvaVenta"]);
    expect(propiedadesDeInterfaz(fuente, "Otra")).toBeNull();
  });
});
