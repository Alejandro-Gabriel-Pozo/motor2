import { describe, expect, it } from "vitest";
import { contarCoincidencias, medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «tablas a mano» (docs/diseno-estilo-de-planilla-2026-11-09.md): las tablas de datos del sistema son `TablaDeDatos` (`src/ui/componentes/datos/tabla-de-datos.tsx`: estilo de planilla, tarjetas
 * en celular, columna de acciones). Cuenta los `<table` escritos a mano en `src` fuera de esa pieza: la línea de base es esa lista y solo baja. Una pantalla nueva con `<table>` a mano falla (lo nuevo
 * no entra); una que migra a `TablaDeDatos` hace bajar la línea de base (`BAJAR_CERCOS=1`). La migración del resto va por las etapas E-B…E-G del diseño; las matrices (permisos, conteo físico) y la
 * ficha de cocina impresa se evalúan una por una. Meta: 0, o excepciones con motivo.
 */
const PIEZA_DE_LA_TABLA = "src/ui/componentes/datos/tabla-de-datos.tsx";

export function contarTablasAMano(fuente: string): number {
  return contarCoincidencias(fuente, /<table[\s>]/g);
}

const CERCO_TABLAS: Cerco = {
  regla: "tablas-a-mano",
  meta: "bajar a 0 al terminar las etapas E-B…E-G: toda tabla de datos usa TablaDeDatos (las matrices y la ficha impresa, con excepción y motivo)",
  medir: medirPorArchivo({
    raices: ["src"],
    extensiones: [".tsx"],
    incluir: (ruta) => ruta !== PIEZA_DE_LA_TABLA,
    contar: (fuente) => ({ "table-a-mano": contarTablasAMano(fuente) }),
  }),
};

describe("cerco «tablas a mano»: el detector", () => {
  it("cuenta cada <table escrita a mano", () => {
    expect(contarTablasAMano('<table className="w-full"><tr/></table><table>')).toBe(2);
  });

  it("no confunde otras etiquetas que empiezan igual", () => {
    expect(contarTablasAMano("<TablaDeDatos titulo=\"x\" /> <tableau>")).toBe(0);
  });
});

probarCerco(CERCO_TABLAS);
