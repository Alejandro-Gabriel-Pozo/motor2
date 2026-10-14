import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardarRecetaDeCombinacionCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/guardar-receta-de-combinacion";
import { guardComandoGuardarRecetaDeCombinacion } from "../../src/core/features/catalogo/combinaciones.guard";
import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { limpiarBaseDeTest, prisma, prismaAdmin, prismaSinEmpresa } from "../setup/test-db";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDeCombos } from "../setup/combos-go3b";

/**
 * GO-3b (ADR-032, frente B, paso AB5): la RECETA PROPIA de una combinación («el flat white grande lleva 36 g de café y 200 ml de leche», no «lo del mediano × 1,5»). Versiones que solo se agregan;
 * una versión sin ingredientes vuelve a la regla general; el envase del tamaño del eje tiene que poder aplicarse (bloqueo) y un cambio de otra opción que no aplica es un aviso. Contra Postgres real.
 *
 * Mutaciones demostradas (rojo y revertidas): sacar el bloqueo del envase (rojo: «envase»); comparar el número esperado sin la rama del doble clic (rojo: «idempotente»); sacar el chequeo de MP
 * (rojo: «materia prima»).
 */
const ITERACIONES = 10;

describe("la receta propia de una combinación (GO-3b, AB5)", () => {
  let e: EscenarioDeOpciones;
  let combinacionId: string;
  let granoId: string;
  let vasoChicoId: string;
  let vasoGrandeId: string;
  const actor = (usuarioId = e.usuarioId) => actorDeCombos(usuarioId, e.sucursalA);
  const guardar = (numeroEsperado: number, ingredientes: unknown[], usuarioId?: string) => {
    const c = guardComandoGuardarRecetaDeCombinacion({ combinacionId, numeroEsperado, ingredientes });
    if (!c.ok) throw new Error(c.mensaje);
    return guardarRecetaDeCombinacionCasoDeUso(actor(usuarioId), c.valor);
  };
  const flatWhite = () => [
    { insumoProductoId: granoId, cantidad: 0.036 },
    { insumoProductoId: e.lecheId, cantidad: 0.2 },
    { insumoProductoId: vasoChicoId, cantidad: 1 },
  ];

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    const mp = async (codigo: string, nombre: string) => (await prisma.producto.create({ data: { codigo, nombre, tipo: "MP", unidadStockId: e.unidadId } })).id;
    granoId = await mp("MP_GRANO", "Café en grano");
    vasoChicoId = await mp("MP_VASO_CH", "Vaso chico");
    vasoGrandeId = await mp("MP_VASO_GR", "Vaso grande");
    // El ENVASE del grande: reemplaza el vaso chico por el grande, sin escalar con la medida.
    await prisma.consumoDeOpcion.create({
      data: { versionDeOpcionId: e.versionDe[e.grandeId]!, efecto: "REEMPLAZA", insumoProductoId: vasoGrandeId, reemplazaAProductoId: vasoChicoId, cantidad: "1.0000", unidadId: e.unidadId, escalaConLaMedida: false },
    });
    await prisma.productoAdmiteGrupo.update({ where: { productoId_grupoId: { productoId: e.cafeId, grupoId: e.grupoMedidaId } }, data: { ejeDeCombinacion: 1 } });
    combinacionId = (await prisma.combinacionDeProducto.create({ data: { productoId: e.cafeId, opcionEje1Id: e.grandeId } })).id;
  });

  const versiones = () => prisma.recetaDeCombinacionVersion.findMany({ where: { combinacionId }, orderBy: { numero: "asc" }, include: { ingredientes: { orderBy: { orden: "asc" } } } });

  it("guarda la versión 1 en la unidad de stock de cada MP, auditada; el mismo pedido del mismo usuario es idempotente; otro, VERSION_DESACTUALIZADA", async () => {
    const r = await guardar(0, flatWhite());
    expect(r).toMatchObject({ ok: true, datos: { numero: 1, huboCambio: true } });
    const [v1] = await versiones();
    expect(v1!.ingredientes.map((i) => [i.insumoProductoId, Number(i.cantidad), i.unidadId, i.orden])).toEqual([
      [granoId, 0.036, e.unidadId, 0],
      [e.lecheId, 0.2, e.unidadId, 1],
      [vasoChicoId, 1, e.unidadId, 2],
    ]);
    const filas = await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "RecetaDeCombinacionVersion" } });
    expect(filas.map((f) => [f.entidadId, f.campo, f.valorAnterior, f.valorNuevo])).toEqual([[v1!.id, "numero", null, "1"]]);
    expect(filas[0]!.descripcion).toContain("Café en grano 0.036");
    // El doble clic: el mismo contenido con el mismo número esperado, del mismo usuario.
    expect(await guardar(0, flatWhite())).toMatchObject({ ok: true, datos: { huboCambio: false } });
    const otro = (await prisma.user.create({ data: { email: "otro@test.com" } })).id;
    expect(await guardar(0, flatWhite(), otro)).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(await versiones()).toHaveLength(1);
  });

  it("una versión sin ingredientes vuelve a la regla general (sin borrar nada); repetirla no agrega otra", async () => {
    expect(await guardar(0, flatWhite())).toMatchObject({ ok: true });
    expect(await guardar(1, [])).toMatchObject({ ok: true, datos: { numero: 2, huboCambio: true } });
    expect(await guardar(2, [])).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect((await versiones()).map((v) => [v.numero, v.ingredientes.length])).toEqual([[1, 3], [2, 0]]);
    // Sin versión previa, una vacía no escribe nada.
    await prismaAdmin.recetaDeCombinacionIngrediente.deleteMany({});
    await prismaAdmin.recetaDeCombinacionVersion.deleteMany({});
    expect(await guardar(0, [])).toMatchObject({ ok: true, datos: { huboCambio: false } });
  });

  it("el ENVASE del tamaño del eje que reemplaza un insumo que la receta no tiene BLOQUEA; un cambio de otra opción que no aplica es un AVISO", async () => {
    const sinVaso = await guardar(0, flatWhite().slice(0, 2));
    expect(sinVaso).toMatchObject({ ok: false, codigo: "RECETA_INVALIDA" });
    expect(sinVaso.mensaje).toContain("Vaso chico");
    // Con el vaso, se guarda; las almendras (no son eje) reemplazan la leche: si la receta no la tiene, se avisa.
    const conVasoSinLeche = await guardar(0, [{ insumoProductoId: granoId, cantidad: 0.036 }, { insumoProductoId: vasoChicoId, cantidad: 1 }]);
    expect(conVasoSinLeche).toMatchObject({ ok: true });
    expect(conVasoSinLeche.ok && conVasoSinLeche.datos.avisos.join(" ")).toContain("Almendras");
  });

  it("solo materias primas; un producto que se produce no admite excepción; una combinación de otra empresa no existe", async () => {
    const conUnPv = await guardar(0, [{ insumoProductoId: e.cafeId, cantidad: 1 }, { insumoProductoId: vasoChicoId, cantidad: 1 }]);
    expect(conUnPv).toMatchObject({ ok: false, codigo: "RECETA_INVALIDA" });
    expect(conUnPv.mensaje).toContain("materia prima");
    await prisma.producto.update({ where: { id: e.cafeId }, data: { seProduce: true } });
    expect(await guardar(0, flatWhite())).toMatchObject({ ok: false, codigo: "PRODUCTO_SE_PRODUCE" });
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const u = await testigo.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    const pv = await testigo.producto.create({ data: { codigo: "PV_T", nombre: "T", tipo: "PV", unidadStockId: u.id } });
    const g = await testigo.grupoDeOpciones.create({ data: { nombre: "T", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 } });
    const o = await testigo.opcionDeGrupo.create({ data: { grupoId: g.id, nombre: "T" } });
    const ajena = await testigo.combinacionDeProducto.create({ data: { productoId: pv.id, opcionEje1Id: o.id } });
    const c = guardComandoGuardarRecetaDeCombinacion({ combinacionId: ajena.id, numeroEsperado: 0, ingredientes: [] });
    expect(c.ok && (await guardarRecetaDeCombinacionCasoDeUso(actor(), c.valor))).toMatchObject({ ok: false, codigo: "COMBINACION_NO_ENCONTRADA" });
    expect(await prisma.recetaDeCombinacionVersion.count()).toBe(0);
  });

  it("el guard: cantidades de 4 decimales, merma de 0 a 100 con 2, sin repetir la MP", () => {
    const g = (ingredientes: unknown[]) => guardComandoGuardarRecetaDeCombinacion({ combinacionId: "c", numeroEsperado: 0, ingredientes }).ok;
    expect(g([{ insumoProductoId: "a", cantidad: 0.0365 }])).toBe(true);
    expect(g([{ insumoProductoId: "a", cantidad: 0.03651 }])).toBe(false);
    expect(g([{ insumoProductoId: "a", cantidad: 0 }])).toBe(false);
    expect(g([{ insumoProductoId: "a", cantidad: 1, mermaPorcentaje: 101 }])).toBe(false);
    expect(g([{ insumoProductoId: "a", cantidad: 1, mermaPorcentaje: 5.555 }])).toBe(false);
    expect(g([{ insumoProductoId: "a", cantidad: 1 }, { insumoProductoId: "a", cantidad: 2 }])).toBe(false);
  });

  it("concurrencia real: 2 y 3 guardados a la vez con el mismo número esperado dejan exactamente UNA versión nueva (loop de 10)", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      const esperado = (await versiones()).length;
      const cuantos = i % 2 === 0 ? 2 : 3;
      const resultados = await Promise.allSettled(
        Array.from({ length: cuantos }, (_x, k) => guardar(esperado, [{ insumoProductoId: granoId, cantidad: Number((0.03 + (i * 3 + k) / 10000).toFixed(4)) }, { insumoProductoId: vasoChicoId, cantidad: 1 }])),
      );
      expect(resultados.every((r) => r.status === "fulfilled"), `iteración ${i}`).toBe(true);
      const valores = resultados.map((r) => (r.status === "fulfilled" ? r.value : null));
      expect(valores.filter((v) => v?.ok), `iteración ${i}: ${valores.map((v) => v?.mensaje).join(" | ")}`).toHaveLength(1);
      expect(valores.filter((v) => v && !v.ok).map((v) => (v && !v.ok ? v.codigo : ""))).toEqual(Array(cuantos - 1).fill("VERSION_DESACTUALIZADA"));
      expect((await versiones()).map((v) => v.numero)).toEqual(Array.from({ length: esperado + 1 }, (_x, k) => k + 1));
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron: el test no ejercitó el único ni el reintento").toBeGreaterThan(25);
    intentos.mockRestore();
  });
});
