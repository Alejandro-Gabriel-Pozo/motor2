import { describe, expect, it } from "vitest";
import { MODULOS } from "../../src/core/modulos/catalogo";
import { modulosEfectivos, validarCambioDeModulos } from "../../src/core/modulos/clausura";
import { explicarErrorDeCambio, modulosDisponiblesParaActivar, nombreDeModulo, vistaDeModulos } from "../../src/core/modulos/vista-de-modulos";

/** E7 (ADR-023): lo que la consola muestra de los módulos de una empresa sale de la MISMA clausura que usa el guard. */
const VENDIBLES_DISPONIBLES = MODULOS.filter((m) => m.tipo === "vendible" && m.estado === "disponible").map((m) => m.id as string);
const fila = (activos: string[], id: string) => vistaDeModulos(activos).find((f) => f.id === id)!;

describe("vistaDeModulos: los casos de ADR-015", () => {
  it("con el registro vacío la empresa cuenta solo con Administración y todo vendible se puede activar", () => {
    const vista = vistaDeModulos([]);
    expect(vista.filter((f) => f.efectivo).map((f) => f.id)).toEqual(["administracion"]);
    for (const f of vista.filter((x) => x.tipo === "vendible")) expect(f, f.id).toMatchObject({ enRegistro: false, puedeActivar: true, puedeDesactivar: false });
  });

  it("activar Salón no le crea fila a Stock, pero Stock queda «incluido por Salón» y NO se puede desactivar", () => {
    const stock = fila(["salon"], "stock");
    expect(stock).toMatchObject({ enRegistro: false, efectivo: true, incluidoPor: ["salon"], puedeDesactivar: false });
    // Si además se activa Stock a mano, queda en el registro pero bloqueado por Salón.
    expect(fila(["salon", "stock"], "stock")).toMatchObject({ enRegistro: true, bloqueadoPor: ["salon"], puedeDesactivar: false });
  });

  it("qué se suma al activar y qué se pierde al desactivar", () => {
    expect(fila([], "salon").alActivarSeSuman.sort()).toEqual(["catalogo_basico", "clientes_basico", "stock"]);
    expect(fila(["salon"], "salon").alDesactivarSePierden.sort()).toEqual(["catalogo_basico", "clientes_basico", "stock"]);
  });

  it("desactivar Salón no pierde Stock si Stock está activo por su cuenta... salvo que otro lo siga trayendo", () => {
    // Stock propio: al sacar Salón, Stock y Catálogo básico se conservan; se pierde solo Clientes básico.
    expect(fila(["salon", "stock"], "salon").alDesactivarSePierden).toEqual(["clientes_basico"]);
  });

  it("Consignación sin Compras: trae Proveedores básico y Stock, y no necesita a Compras", () => {
    const f = fila(["consignacion"], "compras");
    expect(f).toMatchObject({ efectivo: false, puedeActivar: true });
    expect(fila(["consignacion"], "proveedores_basico")).toMatchObject({ efectivo: true, incluidoPor: ["consignacion"] });
  });

  it("los fijos y de soporte nunca se activan ni se desactivan", () => {
    for (const id of ["administracion", "catalogo_basico", "clientes_basico", "proveedores_basico"]) expect(fila(VENDIBLES_DISPONIBLES, id), id).toMatchObject({ puedeActivar: false, puedeDesactivar: false });
  });

  it("ignora ids que no son vendibles disponibles (basura en el registro no cambia nada)", () => {
    expect(vistaDeModulos(["no-existe", "administracion", "catalogo_basico"]).filter((f) => f.enRegistro)).toEqual([]);
  });

  it("modulosDisponiblesParaActivar: los vendibles que todavía no están en el registro", () => {
    expect(modulosDisponiblesParaActivar(["salon"])).not.toContain("salon");
    expect(modulosDisponiblesParaActivar([]).sort()).toEqual([...VENDIBLES_DISPONIBLES].sort());
    expect(modulosDisponiblesParaActivar(VENDIBLES_DISPONIBLES)).toEqual([]);
  });
});

describe("vistaDeModulos coincide con la clausura en los 512 registros posibles", () => {
  const subconjuntos = Array.from({ length: 1 << VENDIBLES_DISPONIBLES.length }, (_, mascara) => VENDIBLES_DISPONIBLES.filter((_, i) => mascara & (1 << i)));

  it("efectivo, puedeDesactivar y puedeActivar son exactamente lo que dicen modulosEfectivos y validarCambioDeModulos", () => {
    expect(subconjuntos).toHaveLength(512);
    for (const activos of subconjuntos) {
      const efectivos = modulosEfectivos(activos);
      for (const f of vistaDeModulos(activos)) {
        const clave = `${f.id} con [${activos.join(",")}]`;
        expect(f.efectivo, clave).toBe(efectivos.has(f.id));
        if (f.tipo !== "vendible") continue;
        if (f.enRegistro) {
          expect(f.puedeDesactivar, clave).toBe(validarCambioDeModulos(activos, { desactivar: [f.id] }).ok);
          expect(f.alDesactivarSePierden.every((id) => !modulosEfectivos(activos.filter((a) => a !== f.id)).has(id)), clave).toBe(true);
        } else {
          expect(f.puedeActivar, clave).toBe(validarCambioDeModulos(activos, { activar: [f.id] }).ok);
          const despues = modulosEfectivos([...activos, f.id]);
          expect(new Set([...efectivos, ...f.alActivarSeSuman, f.id]), clave).toEqual(despues);
        }
      }
    }
  });
});

describe("textos", () => {
  it("nombreDeModulo y explicarErrorDeCambio", () => {
    expect(nombreDeModulo("salon")).toBe("Salón");
    expect(nombreDeModulo("no-existe")).toBe("no-existe");
    expect(explicarErrorDeCambio({ motivo: "LO_REQUIEREN_OTROS", modulo: "stock", requeridoPor: ["salon", "traspasos"] })).toBe("Stock no se puede desactivar mientras estén activos: Salón, Traspasos.");
    expect(explicarErrorDeCambio({ motivo: "EN_DESARROLLO", modulo: "salon" })).toContain("en desarrollo");
    expect(explicarErrorDeCambio({ motivo: "DESCONOCIDO", modulo: "x" })).toContain("no existe");
    expect(explicarErrorDeCambio({ motivo: "NO_ES_VENDIBLE", modulo: "stock" })).toContain("fijo o de soporte");
  });
});
