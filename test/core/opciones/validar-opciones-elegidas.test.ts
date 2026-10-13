import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CODIGOS_DE_ERROR_DE_OPCIONES, validarOpcionesElegidas, type GrupoPermitido, type OpcionElegida } from "../../../src/core/opciones/validar-opciones-elegidas";
import { CAFE, HOTEL, SPA, permitidosDe } from "./escenarios";

/**
 * GO-0b, invariantes I2 e I3 (diseño §5): lo elegido contra lo permitido. Cada regla tiene su código y su mensaje; el producto no admite nada por defecto. Los casos son
 * del café, del hotel y del spa: lo único que cambia entre rubros son los datos.
 */

const una = (opcionId: string, cantidad = 1, versionDeOpcionId?: string): OpcionElegida => ({ opcionId, cantidad, ...(versionDeOpcionId === undefined ? {} : { versionDeOpcionId }) });

function falla(permitidos: readonly GrupoPermitido[], elegidas: readonly OpcionElegida[] | null | undefined) {
  const r = validarOpcionesElegidas(permitidos, elegidas);
  if (r.ok) throw new Error("se esperaba un rechazo y se aceptó");
  expect(r.mensaje.trim().length, `el rechazo ${r.codigo} tiene que traer un mensaje para quien vende`).toBeGreaterThan(10);
  return r;
}

describe("validarOpcionesElegidas: lo que se acepta", () => {
  it("café: un tamaño y un tipo, devueltos en el orden de la lista de permitidos (no en el de entrada)", () => {
    const r = validarOpcionesElegidas(permitidosDe(CAFE), [una("o-con-leche"), una("o-mediano")]);
    expect(r).toEqual({
      ok: true,
      opciones: [
        { grupoId: "g-tamano", nombreGrupo: "Tamaño", tipo: "MEDIDA", opcionId: "o-mediano", nombreOpcion: "Mediano", versionDeOpcionId: "v-mediano-1", cantidad: 1, esNinguna: false },
        { grupoId: "g-tipo", nombreGrupo: "Tipo", tipo: "VARIANTE", opcionId: "o-con-leche", nombreOpcion: "Con leche", versionDeOpcionId: "v-con-leche-1", cantidad: 1, esNinguna: false },
      ],
    });
  });

  it("café: el tamaño solo alcanza (la variante y los extras son opcionales) y la versión que vio quien vende puede venir o no", () => {
    expect(validarOpcionesElegidas(permitidosDe(CAFE), [una("o-chico")]).ok).toBe(true);
    expect(validarOpcionesElegidas(permitidosDe(CAFE), [una("o-chico", 1, "v-chico-1")]).ok).toBe(true);
    expect(validarOpcionesElegidas(permitidosDe(CAFE), [{ opcionId: "o-chico", cantidad: 1, versionDeOpcionId: null }]).ok).toBe(true);
  });

  it("café: dos shots extra caben en el tope de la opción y en el máximo del grupo", () => {
    const r = validarOpcionesElegidas(permitidosDe(CAFE), [una("o-grande"), una("o-shot", 2)]);
    expect(r.ok && r.opciones.map((o) => [o.opcionId, o.cantidad])).toEqual([
      ["o-grande", 1],
      ["o-shot", 2],
    ]);
  });

  it("hotel: régimen y cama obligatorios, con cama extra (tope 1) y desayunos extra (tope 4) dentro del máximo del grupo (5)", () => {
    const r = validarOpcionesElegidas(permitidosDe(HOTEL), [una("o-con-desayuno"), una("o-dos-camas"), una("o-cama-extra"), una("o-desayuno-extra", 4)]);
    expect(r.ok).toBe(true);
  });

  it("spa: duración, aroma obligatorio y aceite premium opcional", () => {
    const r = validarOpcionesElegidas(permitidosDe(SPA), [una("o-90"), una("o-lavanda"), una("o-aceite-premium")]);
    expect(r.ok && r.opciones.map((o) => o.opcionId)).toEqual(["o-90", "o-aceite-premium", "o-lavanda"]);
  });

  it("la opción «ninguna» cuenta como una elegida (sin ella, un grupo obligatorio quedaría vacío)", () => {
    const permitidos = permitidosDe(SPA, { opcion: (o) => (o.opcionId === "o-eucalipto" ? { ...o, esNinguna: true, nombre: "Sin aroma" } : o) });
    const r = validarOpcionesElegidas(permitidos, [una("o-60"), una("o-eucalipto")]);
    expect(r.ok && r.opciones.find((o) => o.opcionId === "o-eucalipto")?.esNinguna).toBe(true);
  });
});

describe("validarOpcionesElegidas: por defecto un producto no admite nada (I2)", () => {
  it("sin lista de permitidos, cualquier opción es OPCIONES_NO_ADMITIDAS", () => {
    const r = falla([], [una("o-chico")]);
    expect(r.codigo).toBe("OPCIONES_NO_ADMITIDAS");
    expect(r.mensaje).toBe("Este producto no admite opciones.");
  });

  it("sin lista de permitidos y sin opciones es lo de siempre: se acepta y no devuelve nada", () => {
    expect(validarOpcionesElegidas([], [])).toEqual({ ok: true, opciones: [] });
    expect(validarOpcionesElegidas([], undefined)).toEqual({ ok: true, opciones: [] });
    expect(validarOpcionesElegidas([], null)).toEqual({ ok: true, opciones: [] });
  });

  it("un grupo con la fila del producto apagada (desasignar = apagar) es como no admitirlo", () => {
    const permitidos = permitidosDe(CAFE, { grupo: (g) => ({ ...g, admitido: false }) });
    expect(falla(permitidos, [una("o-chico")]).codigo).toBe("OPCIONES_NO_ADMITIDAS");
  });

  it("una opción de otro producto (no está en la lista) es OPCION_NO_PERMITIDA, sin decir de cuál se trata", () => {
    const r = falla(permitidosDe(CAFE), [una("o-chico"), una("o-90")]);
    expect(r.codigo).toBe("OPCION_NO_PERMITIDA");
    expect(r.opcionId).toBe("o-90");
    expect(r.mensaje).toBe("Una de las opciones elegidas no se puede elegir para este producto.");
  });

  it("una opción desasignada del producto (fila apagada) es OPCION_NO_PERMITIDA y esa sí se nombra", () => {
    const permitidos = permitidosDe(CAFE, { opcion: (o) => (o.opcionId === "o-grande" ? { ...o, admitida: false } : o) });
    const r = falla(permitidos, [una("o-grande")]);
    expect(r.codigo).toBe("OPCION_NO_PERMITIDA");
    expect(r.mensaje).toBe("La opción «Grande» no se puede elegir para este producto.");
  });
});

describe("validarOpcionesElegidas: apagadas (I3)", () => {
  it("opción apagada para toda la empresa → OPCION_APAGADA", () => {
    const permitidos = permitidosDe(CAFE, { opcion: (o) => (o.opcionId === "o-cortado" ? { ...o, activa: false } : o) });
    const r = falla(permitidos, [una("o-chico"), una("o-cortado")]);
    expect(r).toMatchObject({ codigo: "OPCION_APAGADA", opcionId: "o-cortado", grupoId: "g-tipo", mensaje: "«Cortado» ya no está disponible." });
  });

  it("opción apagada en la sucursal que vende → OPCION_APAGADA_EN_SUCURSAL (se acabó la leche de almendras)", () => {
    const permitidos = permitidosDe(CAFE, { opcion: (o) => (o.opcionId === "o-con-leche" ? { ...o, apagadaEnSucursal: true } : o) });
    const r = falla(permitidos, [una("o-chico"), una("o-con-leche")]);
    expect(r).toMatchObject({ codigo: "OPCION_APAGADA_EN_SUCURSAL", opcionId: "o-con-leche", mensaje: "«Con leche» no está disponible en esta sucursal por ahora." });
  });

  it("grupo apagado para toda la empresa: elegir de él → GRUPO_APAGADO", () => {
    const permitidos = permitidosDe(CAFE, { grupo: (g) => (g.grupoId === "g-tipo" ? { ...g, activo: false } : g) });
    const r = falla(permitidos, [una("o-chico"), una("o-cortado")]);
    expect(r).toMatchObject({ codigo: "GRUPO_APAGADO", grupoId: "g-tipo", mensaje: "«Tipo» no está disponible por ahora." });
  });

  it("grupo opcional apagado y sin elegir nada de él: no participa y la venta sigue", () => {
    const permitidos = permitidosDe(CAFE, { grupo: (g) => (g.grupoId === "g-tipo" ? { ...g, activo: false } : g) });
    expect(validarOpcionesElegidas(permitidos, [una("o-chico")]).ok).toBe(true);
  });

  it("grupo OBLIGATORIO apagado: falla cerrado aunque no se elija nada de él (no se puede vender sin el tamaño que fija el precio)", () => {
    const permitidos = permitidosDe(CAFE, { grupo: (g) => (g.grupoId === "g-tamano" ? { ...g, activo: false } : g) });
    const r = falla(permitidos, []);
    expect(r).toMatchObject({ codigo: "GRUPO_APAGADO", grupoId: "g-tamano" });
    expect(r.mensaje).toBe("«Tamaño» no está disponible por ahora y este producto lo necesita para venderse.");
  });

  it("la opción apagada gana sobre el mínimo del grupo: apagar «chico» no deja cobrar sin tamaño", () => {
    const permitidos = permitidosDe(CAFE, { opcion: (o) => (o.opcionId === "o-chico" ? { ...o, apagadaEnSucursal: true } : o) });
    expect(falla(permitidos, [una("o-chico")]).codigo).toBe("OPCION_APAGADA_EN_SUCURSAL");
    expect(falla(permitidos, []).codigo).toBe("GRUPO_MINIMO_NO_ALCANZADO");
    expect(validarOpcionesElegidas(permitidos, [una("o-mediano")]).ok).toBe(true);
  });
});

describe("validarOpcionesElegidas: versión (I3, OPCION_CAMBIO)", () => {
  it("la versión que vio quien vende ya no es la vigente → OPCION_CAMBIO, nombrando la opción", () => {
    const permitidos = permitidosDe(CAFE, { opcion: (o) => (o.opcionId === "o-mediano" ? { ...o, versionVigenteId: "v-mediano-2" } : o) });
    const r = falla(permitidos, [una("o-mediano", 1, "v-mediano-1")]);
    expect(r).toMatchObject({ codigo: "OPCION_CAMBIO", opcionId: "o-mediano" });
    expect(r.mensaje).toBe("«Mediano» cambió desde que la elegiste: volvé a elegirla para ver el precio y el detalle actuales.");
  });

  it("con la versión vigente se acepta y la salida lleva siempre la vigente", () => {
    const permitidos = permitidosDe(CAFE, { opcion: (o) => (o.opcionId === "o-mediano" ? { ...o, versionVigenteId: "v-mediano-2" } : o) });
    const r = validarOpcionesElegidas(permitidos, [una("o-mediano", 1, "v-mediano-2")]);
    expect(r.ok && r.opciones[0].versionDeOpcionId).toBe("v-mediano-2");
    const sinVersion = validarOpcionesElegidas(permitidos, [una("o-mediano")]);
    expect(sinVersion.ok && sinVersion.opciones[0].versionDeOpcionId).toBe("v-mediano-2");
  });
});

describe("validarOpcionesElegidas: cantidades, topes y repetidas (I3)", () => {
  it("hotel: la cama extra tiene tope 1 por producto y por opción → OPCION_TOPE_SUPERADO", () => {
    const r = falla(permitidosDe(HOTEL), [una("o-solo-alojamiento"), una("o-matrimonial"), una("o-cama-extra", 2)]);
    expect(r).toMatchObject({ codigo: "OPCION_TOPE_SUPERADO", opcionId: "o-cama-extra", mensaje: "De «Cama extra» se pueden pedir como máximo 1." });
  });

  it("el tope es por opción: el mismo tope se respeta en el límite (2 shots sí, 3 no)", () => {
    expect(validarOpcionesElegidas(permitidosDe(CAFE), [una("o-chico"), una("o-shot", 2)]).ok).toBe(true);
    expect(falla(permitidosDe(CAFE), [una("o-chico"), una("o-shot", 3)]).codigo).toBe("OPCION_TOPE_SUPERADO");
  });

  it("el máximo del grupo cuenta unidades: cama extra + 4 desayunos extra caben (5), un desayuno más no", () => {
    const permitidos = permitidosDe(HOTEL, { opcion: (o) => (o.opcionId === "o-desayuno-extra" ? { ...o, cantidadMaxima: 10 } : o) });
    expect(validarOpcionesElegidas(permitidos, [una("o-solo-alojamiento"), una("o-matrimonial"), una("o-cama-extra"), una("o-desayuno-extra", 4)]).ok).toBe(true);
    const r = falla(permitidos, [una("o-solo-alojamiento"), una("o-matrimonial"), una("o-cama-extra"), una("o-desayuno-extra", 5)]);
    expect(r).toMatchObject({ codigo: "GRUPO_MAXIMO_SUPERADO", grupoId: "g-adicionales", mensaje: "En «Adicionales» podés elegir como máximo 5 opciones." });
  });

  it("el máximo de un grupo de una sola opción se dice en singular (dos tamaños a la vez → GRUPO_MAXIMO_SUPERADO)", () => {
    const r = falla(permitidosDe(CAFE), [una("o-chico"), una("o-grande")]);
    expect(r).toMatchObject({ codigo: "GRUPO_MAXIMO_SUPERADO", grupoId: "g-tamano", mensaje: "En «Tamaño» podés elegir como máximo 1 opción." });
  });

  it("la misma opción dos veces → OPCION_REPETIDA (se usa la cantidad)", () => {
    const r = falla(permitidosDe(CAFE), [una("o-chico"), una("o-shot"), una("o-shot")]);
    expect(r).toMatchObject({ codigo: "OPCION_REPETIDA", opcionId: "o-shot", mensaje: "La opción «Shot extra» está repetida: usá la cantidad en vez de cargarla dos veces." });
  });

  it.each([0, -1, 1.5, 11, Number.NaN, Number.POSITIVE_INFINITY])("la cantidad %s no es válida → CANTIDAD_INVALIDA", (cantidad) => {
    const r = falla(permitidosDe(CAFE), [una("o-chico"), una("o-shot", cantidad)]);
    expect(r).toMatchObject({ codigo: "CANTIDAD_INVALIDA", opcionId: "o-shot", mensaje: "La cantidad de «Shot extra» tiene que ser un número entero entre 1 y 10." });
  });

  it("la repetida de una opción desconocida tampoco inventa su nombre", () => {
    expect(falla(permitidosDe(CAFE), [una("o-fantasma"), una("o-fantasma")]).mensaje).toBe("Una opción está repetida: usá la cantidad en vez de cargarla dos veces.");
  });

  it("un rechazo que no es de una opción no lleva opcionId ni grupoId (ni siquiera como undefined)", () => {
    expect(Object.keys(falla([], [una("o-chico")])).sort()).toEqual(["codigo", "mensaje", "ok"]);
    expect(Object.keys(falla(permitidosDe(CAFE), [])).sort()).toEqual(["codigo", "grupoId", "mensaje", "ok"]);
  });

  it("la cantidad inválida de una opción desconocida no inventa su nombre", () => {
    expect(falla(permitidosDe(CAFE), [una("o-fantasma", 0)]).mensaje).toBe("La cantidad de una opción tiene que ser un número entero entre 1 y 10.");
  });

  it("la cantidad de 10 es válida para la validación de cantidad (el tope de la opción es lo que corta)", () => {
    const permitidos = permitidosDe(CAFE, { opcion: (o) => (o.opcionId === "o-shot" ? { ...o, cantidadMaxima: 10 } : o), grupo: (g) => ({ ...g, cantidadMaxima: 10 }) });
    expect(validarOpcionesElegidas(permitidos, [una("o-chico"), una("o-shot", 10)]).ok).toBe(true);
  });
});

describe("validarOpcionesElegidas: obligatorias y mínimos (I3)", () => {
  it("un cliente viejo que no manda opciones a un producto con tamaño obligatorio → GRUPO_MINIMO_NO_ALCANZADO (no se cobra el precio base)", () => {
    for (const elegidas of [undefined, null, []] as const) {
      const r = falla(permitidosDe(CAFE), elegidas);
      expect(r).toMatchObject({ codigo: "GRUPO_MINIMO_NO_ALCANZADO", grupoId: "g-tamano", mensaje: "Elegí al menos 1 opción de «Tamaño»." });
    }
  });

  it("hotel: falta la cama (incluida, obligatoria) aunque el régimen esté elegido", () => {
    const r = falla(permitidosDe(HOTEL), [una("o-con-desayuno")]);
    expect(r).toMatchObject({ codigo: "GRUPO_MINIMO_NO_ALCANZADO", grupoId: "g-cama", mensaje: "Elegí al menos 1 opción de «Tipo de cama»." });
  });

  it("el mínimo del producto sobrescribe al del grupo: un mínimo de 2 se dice en plural", () => {
    const permitidos = permitidosDe(CAFE, { grupo: (g) => (g.grupoId === "g-extras" ? { ...g, cantidadMinima: 2 } : g) });
    expect(falla(permitidos, [una("o-chico"), una("o-shot")])).toMatchObject({ codigo: "GRUPO_MINIMO_NO_ALCANZADO", mensaje: "Elegí al menos 2 opciones de «Extras»." });
    expect(validarOpcionesElegidas(permitidos, [una("o-chico"), una("o-shot", 2)]).ok).toBe(true);
  });

  it("se informa el primer grupo, en el orden de la lista", () => {
    const r = falla(permitidosDe(SPA), []);
    expect(r).toMatchObject({ codigo: "GRUPO_MINIMO_NO_ALCANZADO", grupoId: "g-duracion" });
    expect(falla(permitidosDe(SPA), [una("o-60")])).toMatchObject({ codigo: "GRUPO_MINIMO_NO_ALCANZADO", grupoId: "g-aroma" });
  });
});

describe("validarOpcionesElegidas: orden de los problemas y textos", () => {
  it("un producto sin lista gana sobre una cantidad inválida; una cantidad inválida gana sobre una repetida; una repetida sobre una no permitida", () => {
    expect(falla([], [una("o-chico", 0)]).codigo).toBe("OPCIONES_NO_ADMITIDAS");
    expect(falla(permitidosDe(CAFE), [una("o-chico"), una("o-chico"), una("o-shot", 0)]).codigo).toBe("CANTIDAD_INVALIDA");
    expect(falla(permitidosDe(CAFE), [una("o-fantasma"), una("o-chico"), una("o-chico")]).codigo).toBe("OPCION_REPETIDA");
  });

  it("en una misma opción: no permitida, grupo apagado, opción apagada, apagada en la sucursal, versión y tope, en ese orden", () => {
    const todo = permitidosDe(CAFE, {
      grupo: (g) => (g.grupoId === "g-extras" ? { ...g, activo: false } : g),
      opcion: (o) => (o.opcionId === "o-shot" ? { ...o, activa: false, apagadaEnSucursal: true, versionVigenteId: "v-shot-2" } : o),
    });
    const elegir = [una("o-chico"), una("o-shot", 3, "v-shot-1")];
    expect(falla(todo, elegir).codigo).toBe("GRUPO_APAGADO");
    const sinGrupo = permitidosDe(CAFE, { opcion: (o) => (o.opcionId === "o-shot" ? { ...o, activa: false, apagadaEnSucursal: true, versionVigenteId: "v-shot-2" } : o) });
    expect(falla(sinGrupo, elegir).codigo).toBe("OPCION_APAGADA");
    const sinApagada = permitidosDe(CAFE, { opcion: (o) => (o.opcionId === "o-shot" ? { ...o, apagadaEnSucursal: true, versionVigenteId: "v-shot-2" } : o) });
    expect(falla(sinApagada, elegir).codigo).toBe("OPCION_APAGADA_EN_SUCURSAL");
    const soloVersion = permitidosDe(CAFE, { opcion: (o) => (o.opcionId === "o-shot" ? { ...o, versionVigenteId: "v-shot-2" } : o) });
    expect(falla(soloVersion, elegir).codigo).toBe("OPCION_CAMBIO");
    expect(falla(permitidosDe(CAFE), elegir).codigo).toBe("OPCION_TOPE_SUPERADO");
  });

  it("todos los códigos que puede devolver están en la lista y ninguno habla de un solo rubro", () => {
    expect(new Set(CODIGOS_DE_ERROR_DE_OPCIONES).size).toBe(CODIGOS_DE_ERROR_DE_OPCIONES.length);
    for (const c of CODIGOS_DE_ERROR_DE_OPCIONES) expect(c).toMatch(/^[A-Z_]+$/);
    const prohibidas = /plato|receta|cocina|comanda/i;
    const mensajes = [
      falla([], [una("a")]).mensaje,
      falla(permitidosDe(CAFE), undefined).mensaje,
      falla(permitidosDe(CAFE), [una("o-chico"), una("o-chico")]).mensaje,
      falla(permitidosDe(CAFE), [una("o-chico"), una("o-chico", 0)]).mensaje,
    ];
    for (const m of mensajes) expect(m).not.toMatch(prohibidas);
  });
});

describe("validarOpcionesElegidas (propiedades)", () => {
  const permitidos = permitidosDe(CAFE);
  const validas: OpcionElegida[][] = [];
  for (const tamano of ["o-chico", "o-mediano", "o-grande"]) {
    for (const tipo of [null, "o-cortado", "o-con-leche", "o-sin-lactosa"]) {
      for (const shots of [0, 1, 2]) {
        validas.push([una(tamano), ...(tipo ? [una(tipo)] : []), ...(shots ? [una("o-shot", shots)] : [])]);
      }
    }
  }

  it("una elección válida da lo mismo en cualquier orden de entrada", () => {
    const barajada = fc.constantFrom(...validas).chain((elegidas) => fc.tuple(fc.constant(elegidas), fc.shuffledSubarray(elegidas, { minLength: elegidas.length, maxLength: elegidas.length })));
    fc.assert(
      fc.property(barajada, ([elegidas, otroOrden]) => {
        const a = validarOpcionesElegidas(permitidos, elegidas);
        expect(a.ok).toBe(true);
        expect(validarOpcionesElegidas(permitidos, otroOrden)).toEqual(a);
      }),
      { numRuns: 300 }
    );
  });

  it("un producto sin lista nunca acepta una opción, con cualquier cantidad", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ opcionId: fc.string({ minLength: 1 }), cantidad: fc.integer({ min: -5, max: 20 }) }), { minLength: 1, maxLength: 5 }), (elegidas) => {
        const r = validarOpcionesElegidas([], elegidas);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.codigo).toBe("OPCIONES_NO_ADMITIDAS");
      }),
      { numRuns: 300 }
    );
  });

  it("ninguna cantidad por encima del tope de la opción se acepta, y hasta el tope sí", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 10 }), (tope, cantidad) => {
        const lista = permitidosDe(CAFE, { opcion: (o) => (o.opcionId === "o-shot" ? { ...o, cantidadMaxima: tope } : o), grupo: (g) => ({ ...g, cantidadMaxima: 10 }) });
        const r = validarOpcionesElegidas(lista, [una("o-chico"), una("o-shot", cantidad)]);
        expect(r.ok).toBe(cantidad <= tope);
        if (!r.ok) expect(r.codigo).toBe("OPCION_TOPE_SUPERADO");
      }),
      { numRuns: 300 }
    );
  });

  it("el mínimo y el máximo del grupo se cumplen exactamente (unidades entre mínimo y máximo, ni una más ni una menos)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 10 }), (a, b, cantidad) => {
        const minimo = Math.min(a, b);
        const maximo = Math.max(a, b, 1);
        const lista = permitidosDe(CAFE, {
          opcion: (o) => (o.opcionId === "o-shot" ? { ...o, cantidadMaxima: 10 } : o),
          grupo: (g) => (g.grupoId === "g-extras" ? { ...g, cantidadMinima: minimo, cantidadMaxima: maximo } : g),
        });
        const elegidas = [una("o-chico"), ...(cantidad > 0 ? [una("o-shot", cantidad)] : [])];
        const r = validarOpcionesElegidas(lista, elegidas);
        expect(r.ok).toBe(cantidad >= minimo && cantidad <= maximo);
        if (!r.ok) expect(r.codigo).toBe(cantidad > maximo ? "GRUPO_MAXIMO_SUPERADO" : "GRUPO_MINIMO_NO_ALCANZADO");
      }),
      { numRuns: 500 }
    );
  });
});
