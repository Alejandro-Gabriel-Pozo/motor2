import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { versionVigenteDeReceta } from "../setup/version-de-receta";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto } from "../../src/server/actions/catalogo/productos";
import { guardarRecetaACiegas as guardarReceta } from "../../src/server/actions/catalogo/receta-a-ciegas";
import {
  agregarIngredienteAReceta,
  actualizarIngredienteDeReceta,
  quitarIngredienteDeReceta,
  agregarPasoAReceta,
  actualizarPasoDeReceta,
  quitarPasoDeReceta,
  reordenarPasosDeReceta,
  insertarPasoEnReceta,
  actualizarCabeceraDeReceta,
  obtenerRecetaVigente,
  listarVersionesDeReceta,
} from "../../src/server/actions/catalogo/recetas";

describe("recetas", () => {
  let unidadKgId: string;
  let unidadGId: string;
  let pvId: string;
  let mp1Id: string;
  let mp2Id: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    await darDeAltaProducto({ nombre: "Pizza muzza", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1 });
    await darDeAltaProducto({ nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    await darDeAltaProducto({ nombre: "Muzzarella", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    pvId = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Pizza muzza" } })).id;
    mp1Id = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina" } })).id;
    mp2Id = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Muzzarella" } })).id;
  });

  it("crea la v1 y luego una v2 — la v1 sigue existiendo, la vigente es solo v2", async () => {
    await guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }]);
    await guardarReceta(pvId, [
      { insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId },
      { insumoProductoId: mp2Id, cantidad: 0.2, unidadId: unidadKgId },
    ]);

    const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pvId } });
    expect(versiones.map((v) => v.version).sort()).toEqual([1, 2]);

    const vigente = await obtenerRecetaVigente(pvId);
    expect(vigente?.version).toBe(2);
    // Nunca la unión de v1+v2 — bug real que corrigió construirMapaRecetas_.
    expect(vigente?.ingredientes).toHaveLength(2);
  });

  it("rechaza receta de una MP sin 'se produce'", async () => {
    const resultado = await guardarReceta(mp1Id, [{ insumoProductoId: mp2Id, cantidad: 1, unidadId: unidadKgId }]);
    expect(resultado.ok).toBe(false);
  });

  it("rechaza un ingrediente que no es MP activa (ej. otro PV)", async () => {
    const resultado = await guardarReceta(pvId, [{ insumoProductoId: pvId, cantidad: 1, unidadId: unidadKgId }]);
    expect(resultado.ok).toBe(false);
  });

  it("rechaza una MP que no está disponible en NINGUNA sucursal (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §5.6)", async () => {
    const mpSinDisponibilidad = await prisma.producto.create({ data: { codigo: "MP_HUERFANA", nombre: "Sin disponibilidad", tipo: "MP", unidadStockId: unidadKgId } });
    const resultado = await guardarReceta(pvId, [{ insumoProductoId: mpSinDisponibilidad.id, cantidad: 1, unidadId: unidadKgId }]);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.mensaje).toContain("Sin disponibilidad");
  });

  it("acepta una MP disponible en OTRA sucursal aunque no en la actual — validarIngredientes es global, no por sucursal (§5.6)", async () => {
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const mpDeOtraSucursal = await prisma.producto.create({ data: { codigo: "MP_OTRA_SUC", nombre: "Solo en otra sucursal", tipo: "MP", unidadStockId: unidadKgId } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursal.id, productoId: mpDeOtraSucursal.id, disponible: true } });

    const resultado = await guardarReceta(pvId, [{ insumoProductoId: mpDeOtraSucursal.id, cantidad: 1, unidadId: unidadKgId }]);
    expect(resultado.ok, !resultado.ok ? resultado.mensaje : "").toBe(true);
  });

  it("agregarIngredienteAReceta preserva los existentes y rechaza duplicado", async () => {
    await guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }]);

    const resultado = await agregarIngredienteAReceta(pvId, { insumoProductoId: mp2Id, cantidad: 0.1, unidadId: unidadKgId }, await versionVigenteDeReceta(pvId));
    expect(resultado.ok).toBe(true);

    const vigente = await obtenerRecetaVigente(pvId);
    expect(vigente?.ingredientes).toHaveLength(2);

    const duplicado = await agregarIngredienteAReceta(pvId, { insumoProductoId: mp2Id, cantidad: 0.5, unidadId: unidadKgId }, await versionVigenteDeReceta(pvId));
    expect(duplicado.ok).toBe(false);
  });

  it("actualizarIngredienteDeReceta cambia cantidad/unidad de UN ingrediente sin tocar los demás, en una sola versión nueva", async () => {
    await guardarReceta(pvId, [
      { insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId },
      { insumoProductoId: mp2Id, cantidad: 0.2, unidadId: unidadKgId },
    ]);

    const resultado = await actualizarIngredienteDeReceta(pvId, mp1Id, { cantidad: 0.15, unidadId: unidadGId, mermaPorcentaje: 5 }, await versionVigenteDeReceta(pvId));
    expect(resultado.ok).toBe(true);

    const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pvId } });
    expect(versiones.map((v) => v.version).sort()).toEqual([1, 2]); // un solo cambio = una sola versión nueva, no dos (Quitar + Agregar)

    const vigente = await obtenerRecetaVigente(pvId);
    expect(vigente?.ingredientes).toHaveLength(2);
    const editado = vigente!.ingredientes.find((i) => i.insumoProductoId === mp1Id)!;
    expect(Number(editado.cantidad)).toBe(0.15);
    expect(editado.unidadId).toBe(unidadGId);
    expect(Number(editado.mermaPorcentaje)).toBe(5);
    const intacto = vigente!.ingredientes.find((i) => i.insumoProductoId === mp2Id)!;
    expect(Number(intacto.cantidad)).toBe(0.2);
  });

  it("actualizarIngredienteDeReceta rechaza un insumo que no está en la receta vigente", async () => {
    await guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }]);

    const resultado = await actualizarIngredienteDeReceta(pvId, mp2Id, { cantidad: 1, unidadId: unidadKgId }, await versionVigenteDeReceta(pvId));
    expect(resultado.ok).toBe(false);
  });

  it("listarVersionesDeReceta trae TODAS las versiones, más reciente primero, cada una con sus propios ingredientes", async () => {
    await guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }]);
    await guardarReceta(pvId, [
      { insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId },
      { insumoProductoId: mp2Id, cantidad: 0.2, unidadId: unidadKgId },
    ]);

    const versiones = await listarVersionesDeReceta(pvId);
    expect(versiones.map((v) => v.version)).toEqual([2, 1]);
    expect(versiones[0].ingredientes).toHaveLength(2);
    expect(versiones[1].ingredientes).toHaveLength(1);
  });

  it("listarVersionesDeReceta da vacío si el producto nunca tuvo receta", async () => {
    expect(await listarVersionesDeReceta(pvId)).toEqual([]);
  });

  describe("ficha técnica: cabecera y pasos", () => {
    it("guardarReceta acepta cabecera y pasos junto con los ingredientes, en la misma versión", async () => {
      const resultado = await guardarReceta(
        pvId,
        [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }],
        [{ orden: 1, nombre: "Armado", instruccion: "Estirar la masa", minutos: 5, insumoProductoIds: [mp1Id] }],
        { rendimientoCantidad: 1, rendimientoUnidadId: unidadKgId, racionesCantidad: 4, comentarios: "Servir caliente" }
      );
      expect(resultado.ok).toBe(true);

      const vigente = await obtenerRecetaVigente(pvId);
      expect(Number(vigente?.rendimientoCantidad)).toBe(1);
      expect(vigente?.racionesCantidad).toBe(4);
      expect(vigente?.comentarios).toBe("Servir caliente");
      expect(vigente?.pasos).toHaveLength(1);
      expect(vigente?.pasos[0].instruccion).toBe("Estirar la masa");
      // El puente paso↔ingrediente se armó en la fase 2 de la transacción con ids reales.
      expect(vigente?.pasos[0].ingredientes).toHaveLength(1);
      expect(vigente?.pasos[0].ingredientes[0].recetaIngrediente.insumoProductoId).toBe(mp1Id);
    });

    it("rechaza dos pasos con el mismo orden", async () => {
      const resultado = await guardarReceta(
        pvId,
        [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }],
        [
          { orden: 1, instruccion: "Paso A" },
          { orden: 1, instruccion: "Paso B" },
        ]
      );
      expect(resultado.ok).toBe(false);
    });

    it("rechaza un paso que marca un insumo que no está en la receta", async () => {
      const resultado = await guardarReceta(
        pvId,
        [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }],
        [{ orden: 1, instruccion: "Paso A", insumoProductoIds: [mp2Id] }]
      );
      expect(resultado.ok).toBe(false);
    });

    it("agregarPasoAReceta agrega preservando ingredientes y cabecera vigentes, rechaza orden duplicado", async () => {
      await guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }], [], { racionesCantidad: 4 });

      const resultado = await agregarPasoAReceta(pvId, { orden: 1, instruccion: "Estirar la masa" }, await versionVigenteDeReceta(pvId));
      expect(resultado.ok).toBe(true);

      const vigente = await obtenerRecetaVigente(pvId);
      expect(vigente?.ingredientes).toHaveLength(1);
      expect(vigente?.racionesCantidad).toBe(4);
      expect(vigente?.pasos).toHaveLength(1);

      const duplicado = await agregarPasoAReceta(pvId, { orden: 1, instruccion: "Otro paso" }, await versionVigenteDeReceta(pvId));
      expect(duplicado.ok).toBe(false);
    });

    it("actualizarPasoDeReceta edita UN paso sin tocar los demás, en una sola versión nueva", async () => {
      await guardarReceta(
        pvId,
        [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }],
        [
          { orden: 1, instruccion: "Paso A", minutos: 5 },
          { orden: 2, instruccion: "Paso B", minutos: 10 },
        ]
      );

      const resultado = await actualizarPasoDeReceta(pvId, 1, { instruccion: "Paso A editado", minutos: 7 }, await versionVigenteDeReceta(pvId));
      expect(resultado.ok).toBe(true);

      const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pvId } });
      expect(versiones.map((v) => v.version).sort()).toEqual([1, 2]);

      const vigente = await obtenerRecetaVigente(pvId);
      expect(vigente?.pasos).toHaveLength(2);
      const editado = vigente!.pasos.find((p) => p.orden === 1)!;
      expect(editado.instruccion).toBe("Paso A editado");
      expect(editado.minutos).toBe(7);
      const intacto = vigente!.pasos.find((p) => p.orden === 2)!;
      expect(intacto.instruccion).toBe("Paso B");
    });

    it("actualizarPasoDeReceta rechaza un orden que no está en la receta vigente", async () => {
      await guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }], [{ orden: 1, instruccion: "Paso A" }]);

      const resultado = await actualizarPasoDeReceta(pvId, 2, { instruccion: "No existe" }, await versionVigenteDeReceta(pvId));
      expect(resultado.ok).toBe(false);
    });

    it("quitarPasoDeReceta quita el paso sin tocar ingredientes ni otros pasos", async () => {
      await guardarReceta(
        pvId,
        [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }],
        [
          { orden: 1, instruccion: "Paso A" },
          { orden: 2, instruccion: "Paso B" },
        ]
      );

      const resultado = await quitarPasoDeReceta(pvId, 1, await versionVigenteDeReceta(pvId));
      expect(resultado.ok).toBe(true);

      const vigente = await obtenerRecetaVigente(pvId);
      expect(vigente?.ingredientes).toHaveLength(1);
      expect(vigente?.pasos).toHaveLength(1);
      expect(vigente?.pasos[0].orden).toBe(2);
    });

    it("reordenarPasosDeReceta reordena y renumera; la versión anterior conserva el orden original", async () => {
      await guardarReceta(
        pvId,
        [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }],
        [
          { orden: 1, instruccion: "Paso A" },
          { orden: 2, instruccion: "Paso B" },
          { orden: 3, instruccion: "Paso C" },
        ]
      );

      const resultado = await reordenarPasosDeReceta(pvId, [3, 1, 2], await versionVigenteDeReceta(pvId));
      expect(resultado.ok).toBe(true);

      const versiones = await listarVersionesDeReceta(pvId);
      expect(versiones.map((v) => v.version).sort()).toEqual([1, 2]);
      const v1 = versiones.find((v) => v.version === 1)!;
      expect(v1.pasos.map((p) => p.instruccion)).toEqual(["Paso A", "Paso B", "Paso C"]);

      const vigente = await obtenerRecetaVigente(pvId);
      expect(vigente?.ingredientes).toHaveLength(1);
      expect(vigente?.pasos.map((p) => ({ orden: p.orden, instruccion: p.instruccion }))).toEqual([
        { orden: 1, instruccion: "Paso C" },
        { orden: 2, instruccion: "Paso A" },
        { orden: 3, instruccion: "Paso B" },
      ]);
    });

    it("reordenarPasosDeReceta preserva la relación paso↔ingrediente en el paso correcto", async () => {
      await guardarReceta(
        pvId,
        [
          { insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId },
          { insumoProductoId: mp2Id, cantidad: 0.2, unidadId: unidadKgId },
        ],
        [
          { orden: 1, instruccion: "Con harina", insumoProductoIds: [mp1Id] },
          { orden: 2, instruccion: "Con muzza", insumoProductoIds: [mp2Id] },
        ]
      );

      const resultado = await reordenarPasosDeReceta(pvId, [2, 1], await versionVigenteDeReceta(pvId));
      expect(resultado.ok).toBe(true);

      const vigente = await obtenerRecetaVigente(pvId);
      const primero = vigente!.pasos.find((p) => p.orden === 1)!;
      const segundo = vigente!.pasos.find((p) => p.orden === 2)!;
      expect(primero.instruccion).toBe("Con muzza");
      expect(primero.ingredientes.map((i) => i.recetaIngrediente.insumoProductoId)).toEqual([mp2Id]);
      expect(segundo.instruccion).toBe("Con harina");
      expect(segundo.ingredientes.map((i) => i.recetaIngrediente.insumoProductoId)).toEqual([mp1Id]);
    });

    it("reordenarPasosDeReceta con una secuencia inválida no guarda ninguna versión nueva", async () => {
      await guardarReceta(
        pvId,
        [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }],
        [
          { orden: 1, instruccion: "Paso A" },
          { orden: 2, instruccion: "Paso B" },
        ]
      );

      const repetida = await reordenarPasosDeReceta(pvId, [1, 1], await versionVigenteDeReceta(pvId));
      expect(repetida.ok).toBe(false);
      const incompleta = await reordenarPasosDeReceta(pvId, [1], await versionVigenteDeReceta(pvId));
      expect(incompleta.ok).toBe(false);

      const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pvId } });
      expect(versiones.map((v) => v.version)).toEqual([1]);
    });

    it("reordenarPasosDeReceta sin cambios reales no crea una versión nueva", async () => {
      await guardarReceta(
        pvId,
        [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }],
        [
          { orden: 1, instruccion: "Paso A" },
          { orden: 2, instruccion: "Paso B" },
        ]
      );

      const resultado = await reordenarPasosDeReceta(pvId, [1, 2], await versionVigenteDeReceta(pvId));
      expect(resultado.ok).toBe(true);

      const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pvId } });
      expect(versiones.map((v) => v.version)).toEqual([1]);
    });

    it("insertarPasoEnReceta inserta en el medio, corriendo los siguientes y conservando su instrucción e ingredientes", async () => {
      await guardarReceta(
        pvId,
        [
          { insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId },
          { insumoProductoId: mp2Id, cantidad: 0.2, unidadId: unidadKgId },
        ],
        [
          { orden: 1, instruccion: "Paso A", insumoProductoIds: [mp1Id] },
          { orden: 2, instruccion: "Paso B", insumoProductoIds: [mp2Id] },
        ]
      );

      const resultado = await insertarPasoEnReceta(pvId, 2, { instruccion: "Paso nuevo" }, await versionVigenteDeReceta(pvId));
      expect(resultado.ok).toBe(true);

      const vigente = await obtenerRecetaVigente(pvId);
      expect(vigente?.ingredientes).toHaveLength(2);
      expect(vigente?.pasos.map((p) => p.instruccion)).toEqual(["Paso A", "Paso nuevo", "Paso B"]);
      const pasoA = vigente!.pasos.find((p) => p.instruccion === "Paso A")!;
      const pasoB = vigente!.pasos.find((p) => p.instruccion === "Paso B")!;
      expect(pasoA.ingredientes.map((i) => i.recetaIngrediente.insumoProductoId)).toEqual([mp1Id]);
      expect(pasoB.ingredientes.map((i) => i.recetaIngrediente.insumoProductoId)).toEqual([mp2Id]);
    });

    it("insertarPasoEnReceta y quitarPasoDeReceta rechazan una posición o un número de paso que no es entero (NaN no inserta al principio ni guarda una versión idéntica)", async () => {
      await guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }], [{ orden: 1, instruccion: "Paso A" }, { orden: 2, instruccion: "Paso B" }]);

      for (const posicion of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
        const r = await insertarPasoEnReceta(pvId, posicion, { instruccion: "Paso nuevo" }, await versionVigenteDeReceta(pvId));
        expect(r.ok, String(posicion)).toBe(false);
      }
      for (const orden of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
        const r = await quitarPasoDeReceta(pvId, orden, await versionVigenteDeReceta(pvId));
        expect(r.ok, String(orden)).toBe(false);
      }

      const vigente = await obtenerRecetaVigente(pvId);
      expect(vigente?.version).toBe(1);
      expect(vigente?.pasos.map((p) => p.instruccion)).toEqual(["Paso A", "Paso B"]);
    });

    it("quitarIngredienteDeReceta también lo saca de cualquier paso que lo mencionara", async () => {
      await guardarReceta(
        pvId,
        [
          { insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId },
          { insumoProductoId: mp2Id, cantidad: 0.2, unidadId: unidadKgId },
        ],
        [{ orden: 1, instruccion: "Mezclar todo", insumoProductoIds: [mp1Id, mp2Id] }]
      );

      const resultado = await quitarIngredienteDeReceta(pvId, mp1Id, await versionVigenteDeReceta(pvId));
      expect(resultado.ok).toBe(true);

      const vigente = await obtenerRecetaVigente(pvId);
      expect(vigente?.ingredientes).toHaveLength(1);
      expect(vigente?.ingredientes[0].insumoProductoId).toBe(mp2Id);
      expect(vigente?.pasos[0].ingredientes).toHaveLength(1);
      expect(vigente?.pasos[0].ingredientes[0].recetaIngrediente.insumoProductoId).toBe(mp2Id);
    });

    it("actualizarCabeceraDeReceta cambia solo la cabecera, preservando ingredientes y pasos vigentes", async () => {
      await guardarReceta(
        pvId,
        [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }],
        [{ orden: 1, instruccion: "Paso A" }],
        { racionesCantidad: 4 }
      );

      const resultado = await actualizarCabeceraDeReceta(pvId, { racionesCantidad: 6, comentarios: "Ojo con la sal" }, await versionVigenteDeReceta(pvId));
      expect(resultado.ok).toBe(true);

      const vigente = await obtenerRecetaVigente(pvId);
      expect(vigente?.racionesCantidad).toBe(6);
      expect(vigente?.comentarios).toBe("Ojo con la sal");
      expect(vigente?.ingredientes).toHaveLength(1);
      expect(vigente?.pasos).toHaveLength(1);
    });

    it("actualizarCabeceraDeReceta rechaza si el producto todavía no tiene ninguna receta", async () => {
      const resultado = await actualizarCabeceraDeReceta(pvId, { racionesCantidad: 4 }, await versionVigenteDeReceta(pvId));
      expect(resultado.ok).toBe(false);
    });

    describe("validarCabecera: bug real — antes NaN llegaba directo a prisma.recetaVersion.create sin ningún control", () => {
      beforeEach(async () => {
        await guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }], [], { racionesCantidad: 4 });
      });

      it("rechaza rendimientoCantidad sin unidad elegida", async () => {
        const resultado = await actualizarCabeceraDeReceta(pvId, { rendimientoCantidad: 2 }, await versionVigenteDeReceta(pvId));
        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.mensaje).toMatch(/unidad del rendimiento/i);
      });

      it("rechaza rendimientoCantidad con más decimales que los que admite su unidad (g, 0 decimales)", async () => {
        const resultado = await actualizarCabeceraDeReceta(pvId, { rendimientoCantidad: 1.5, rendimientoUnidadId: unidadGId }, await versionVigenteDeReceta(pvId));
        expect(resultado.ok).toBe(false);
      });

      it("rechaza rendimientoCantidad en 0 (no tiene sentido un rendimiento nulo)", async () => {
        const resultado = await actualizarCabeceraDeReceta(pvId, { rendimientoCantidad: 0, rendimientoUnidadId: unidadKgId }, await versionVigenteDeReceta(pvId));
        expect(resultado.ok).toBe(false);
      });

      it("rechaza racionTamano sin unidad elegida", async () => {
        const resultado = await actualizarCabeceraDeReceta(pvId, { racionTamano: 200 }, await versionVigenteDeReceta(pvId));
        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(resultado.mensaje).toMatch(/unidad del tamaño de ración/i);
      });

      it("rechaza racionesCantidad negativa", async () => {
        const resultado = await actualizarCabeceraDeReceta(pvId, { racionesCantidad: -1 }, await versionVigenteDeReceta(pvId));
        expect(resultado.ok).toBe(false);
      });

      it("rechaza racionesCantidad no entera", async () => {
        const resultado = await actualizarCabeceraDeReceta(pvId, { racionesCantidad: 2.5 }, await versionVigenteDeReceta(pvId));
        expect(resultado.ok).toBe(false);
      });

      it("rechaza racionesCantidad NaN — antes llegaba tal cual a la base sin ningún aviso", async () => {
        const resultado = await actualizarCabeceraDeReceta(pvId, { racionesCantidad: Number.NaN }, await versionVigenteDeReceta(pvId));
        expect(resultado.ok).toBe(false);
      });

      it("rechaza tiempoPreparacionMinutos negativo", async () => {
        const resultado = await actualizarCabeceraDeReceta(pvId, { tiempoPreparacionMinutos: -5 }, await versionVigenteDeReceta(pvId));
        expect(resultado.ok).toBe(false);
      });

      it("rechaza tiempoCoccionMinutos no entero", async () => {
        const resultado = await actualizarCabeceraDeReceta(pvId, { tiempoCoccionMinutos: 12.5 }, await versionVigenteDeReceta(pvId));
        expect(resultado.ok).toBe(false);
      });

      it("acepta una cabecera válida con rendimiento y ración en su unidad correspondiente", async () => {
        const resultado = await actualizarCabeceraDeReceta(pvId, {
          rendimientoCantidad: 1.25,
          rendimientoUnidadId: unidadKgId,
          racionTamano: 250,
          racionUnidadId: unidadGId,
          tiempoPreparacionMinutos: 10,
          tiempoCoccionMinutos: 20,
        }, await versionVigenteDeReceta(pvId));
        expect(resultado.ok).toBe(true);

        const vigente = await obtenerRecetaVigente(pvId);
        expect(Number(vigente?.rendimientoCantidad)).toBe(1.25);
        expect(Number(vigente?.racionTamano)).toBe(250);
      });
    });
  });
});
