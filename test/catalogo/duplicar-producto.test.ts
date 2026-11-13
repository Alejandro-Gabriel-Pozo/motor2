import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

// La falla inyectada a mitad de la copia (atomicidad): por defecto todo pasa derecho; un test enciende una de las dos y la copia revienta DESPUÉS de haber escrito el producto (y, en la segunda, también la receta).
const falla = vi.hoisted(() => ({ enLaReceta: false, enLaSegundaAdmision: false, admisiones: 0 }));
vi.mock("../../src/server/persistencia/catalogo/guardar-version-de-receta", async (original) => {
  const modulo = await original<typeof import("../../src/server/persistencia/catalogo/guardar-version-de-receta")>();
  return {
    ...modulo,
    escribirVersionDeReceta: (...args: Parameters<typeof modulo.escribirVersionDeReceta>) => {
      if (falla.enLaReceta) throw new Error("falla inyectada al escribir la receta");
      return modulo.escribirVersionDeReceta(...args);
    },
  };
});
vi.mock("../../src/server/actions/catalogo/casos-de-uso/fijar-admision-de-grupo-en-producto", async (original) => {
  const modulo = await original<typeof import("../../src/server/actions/catalogo/casos-de-uso/fijar-admision-de-grupo-en-producto")>();
  return {
    ...modulo,
    fijarAdmisionDeGrupoEnTx: (...args: Parameters<typeof modulo.fijarAdmisionDeGrupoEnTx>) => {
      falla.admisiones += 1;
      if (falla.enLaSegundaAdmision && falla.admisiones === 2) throw new Error("falla inyectada al copiar las opciones");
      return modulo.fijarAdmisionDeGrupoEnTx(...args);
    },
  };
});

import { COLUMNAS_DEL_DUPLICADO } from "../../src/core/catalogo/duplicar-producto";
import { duplicarProducto } from "../../src/server/actions/catalogo/duplicar-producto";
import { guardarRecetaACiegas } from "../../src/server/actions/catalogo/receta-a-ciegas";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { NOMBRE_DEL_BIFE, nuevoDuplicadoId, sembrarElBife, type EscenarioDelBife } from "../setup/duplicar-producto";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";

/**
 * «Duplicar producto» (E4, `docs/diseno-duplicar-producto-2026-11-12.md`) contra Postgres real, por la Server Action (con permiso, guard y caso de uso). El caso del dueño: «Bife a criolla» → «Bife con chimichurri».
 * Cubre lo que el diseño pide en los niveles 5, 7 y 10: qué se copia y qué no (contra el oráculo de columnas), la copia independiente, la trazabilidad, la idempotencia, la concurrencia, la atomicidad (falla inyectada a
 * mitad), el aislamiento entre empresas, los casos de «¿qué pasa si…?» (ingrediente dado de baja, receta circular, origen sin receta ni opciones, grupos archivados) y la receta de otra sucursal (S-07). Los permisos y las
 * combinaciones están en `duplicar-producto-permisos.test.ts` y `duplicar-producto-combinaciones.test.ts`.
 */
const CONTEOS = ["producto", "disponibilidadProducto", "recetaVersion", "recetaIngrediente", "recetaPaso", "recetaPasoIngrediente", "sustitutoRecetaIngrediente", "productoAdmiteGrupo", "productoAdmiteOpcion", "registroAuditoria"] as const;

async function fotoDeLaBase(): Promise<Record<string, number>> {
  const foto: Record<string, number> = {};
  for (const tabla of CONTEOS) foto[tabla] = await (prismaAdmin[tabla] as unknown as { count: () => Promise<number> }).count();
  return foto;
}

describe("duplicarProducto: el bife con chimichurri", () => {
  let e: EscenarioDelBife;

  const duplicar = (extra: Record<string, unknown> = {}) =>
    duplicarProducto({ duplicadoId: nuevoDuplicadoId(), origenId: e.bifeId, nombre: "Bife con chimichurri", copiarReceta: true, copiarOpciones: true, sucursalDeLaRecetaId: null, ...extra });
  const entre = async (p: Promise<{ ok: boolean; mensaje: string }>) => {
    const r = await p;
    expect(r.ok, r.mensaje).toBe(true);
    return r as { ok: true; mensaje: string; id: string; nombre: string };
  };

  beforeEach(async () => {
    falla.enLaReceta = false;
    falla.enLaSegundaAdmision = false;
    falla.admisiones = 0;
    await limpiarBaseDeTest();
    e = await sembrarElBife();
    await mockearUsuarioActual({ id: e.adminId, email: "admin@test.com", nombre: null });
  });

  it("copia la ficha, el precio, las opciones y la receta como versión 1, con el nombre y el código propios", async () => {
    const r = await entre(duplicar());
    const origen = await prisma.producto.findUniqueOrThrow({ where: { id: e.bifeId } });
    const nuevo = await prisma.producto.findUniqueOrThrow({ where: { id: r.id } });

    // Nombre propio y código autogenerado; lo que no se hereda queda de fábrica.
    expect(nuevo.nombre).toBe("Bife con chimichurri");
    expect(nuevo.codigo).toMatch(/^PV_[0-9a-f-]{6}$/);
    expect(nuevo.codigo).not.toBe(origen.codigo);
    expect({ insumoId: nuevo.insumoId, esConsignacion: nuevo.esConsignacion, proveedor: nuevo.proveedorConsignacionId, consignacion: Number(nuevo.precioConsignacion) }).toEqual({ insumoId: null, esConsignacion: false, proveedor: null, consignacion: 0 });

    // El oráculo de columnas: cada columna declarada «se copia» (con o sin permiso: acá hay clave) sale igual que en el original.
    for (const [columna, destino] of Object.entries(COLUMNAS_DEL_DUPLICADO.Producto!)) {
      if (destino !== "SE_COPIA" && destino !== "SE_COPIA_CON_PERMISO") continue;
      const a = (origen as Record<string, unknown>)[columna];
      const b = (nuevo as Record<string, unknown>)[columna];
      expect(String(b), `Producto.${columna}`).toBe(String(a));
    }
    expect(nuevo).toMatchObject({ tipo: "PV", categoriaId: e.categoriaId, unidadStockId: e.kgId, observaciones: "Se sirve a punto", alicuotaIvaVenta: "IVA_21", modoDeVenta: "DIRECTO", seProduce: false });
    expect([Number(nuevo.precioVenta), Number(nuevo.pasoVenta), Number(nuevo.factorConversion)]).toEqual([5000, 0.5, 1]);

    // La disponibilidad nace con la regla del alta (con la clave: disponible en todas las sucursales), no copiada tal cual.
    const disponibilidad = await prisma.disponibilidadProducto.findMany({ where: { productoId: r.id }, orderBy: { sucursalId: "asc" } });
    expect(disponibilidad.map((d) => [d.sucursalId, d.disponible])).toEqual([e.centralId, e.norteId].sort().map((s) => [s, true]));

    // La receta: versión 1 de la serie central del producto nuevo, con sus ingredientes, el sustituto, los pasos y la ficha técnica.
    const recetaOrigen = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: e.bifeId }, include: { ingredientes: { include: { sustitutos: true } }, pasos: { include: { ingredientes: true } } } });
    const receta = await prisma.recetaVersion.findFirstOrThrow({
      where: { productoId: r.id },
      include: { ingredientes: { include: { sustitutos: true }, orderBy: { insumoProductoId: "asc" } }, pasos: { orderBy: { orden: "asc" }, include: { ingredientes: { include: { recetaIngrediente: true } } } } },
    });
    expect(await prisma.recetaVersion.count({ where: { productoId: r.id } })).toBe(1);
    expect({ version: receta.version, sucursalId: receta.sucursalId, basadaEnVersionId: receta.basadaEnVersionId }).toEqual({ version: 1, sucursalId: null, basadaEnVersionId: null });
    for (const [columna, destino] of Object.entries(COLUMNAS_DEL_DUPLICADO.RecetaVersion!)) {
      if (destino !== "SE_COPIA") continue;
      expect(String((receta as Record<string, unknown>)[columna]), `RecetaVersion.${columna}`).toBe(String((recetaOrigen as Record<string, unknown>)[columna]));
    }
    expect(receta.ingredientes.map((i) => [i.insumoProductoId, Number(i.cantidad), i.unidadId, Number(i.mermaPorcentaje), i.observaciones, i.sustitutos.map((s) => [s.insumoSustitutoId, s.orden])])).toEqual(
      [
        [e.carneId, 0.3, e.kgId, 5, "Corte alto", [[e.insumoId, 1]]],
        [e.salId, 0.01, e.kgId, 0, null, []],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    );
    expect(receta.pasos.map((p) => [p.orden, p.nombre, p.instruccion, p.minutos])).toEqual([
      [1, "Sellar", "Sellar el bife de carne", 4],
      [2, "Salar", "Salar al servir", null],
    ]);
    // La tabla paso↔ingrediente se reconstruyó contra los ingredientes NUEVOS: ninguno es una fila del original.
    const idsDelOrigen = new Set(recetaOrigen.ingredientes.map((i) => i.id));
    const idsDeLosPasosDelOrigen = new Set(recetaOrigen.pasos.map((p) => p.id));
    expect(receta.pasos.map((p) => p.ingredientes.map((pi) => pi.recetaIngrediente.insumoProductoId))).toEqual([[e.carneId], [e.salId]]);
    for (const paso of receta.pasos) {
      expect(idsDeLosPasosDelOrigen.has(paso.id)).toBe(false);
      for (const pi of paso.ingredientes) {
        expect(idsDelOrigen.has(pi.recetaIngredienteId)).toBe(false);
        expect(pi.recetaIngrediente.recetaVersionId).toBe(receta.id);
      }
    }

    // Lo que admite: los MISMOS grupos y opciones de la biblioteca, con su orden, límites, «Mostrar en la carta» y el precio propio de cada opción; el grupo archivado no se copia.
    const grupos = await prisma.productoAdmiteGrupo.findMany({ where: { productoId: r.id }, orderBy: { orden: "asc" } });
    expect(grupos.map((g) => [g.grupoId, g.orden, g.cantidadMinima, g.cantidadMaxima, g.seMuestraEnCarta, g.activo, g.version])).toEqual([
      [e.grupoGuarnicionId, 1, 0, 1, true, true, 1],
      [e.grupoSalsasId, 2, 0, 1, false, true, 1],
    ]);
    const opciones = await prisma.productoAdmiteOpcion.findMany({ where: { productoId: r.id }, orderBy: { opcionId: "asc" } });
    expect(opciones.map((o) => [o.opcionId, o.cantidadMaxima, o.tipoDeDiferencia, o.diferenciaPrecio === null ? null : Number(o.diferenciaPrecio), o.activo]).sort()).toEqual(
      [
        [e.papasId, 1, null, null, true],
        [e.ensaladaId, 2, "MONTO", 450, true],
        [e.chimichurriId, 1, null, null, true],
      ].sort()
    );
    expect(await prisma.grupoDeOpciones.count()).toBe(3); // no se creó ningún grupo ni opción nuevos
    expect(await prisma.opcionDeGrupo.count()).toBe(4);

    // Lo que NO se copia: la carta, los precios por sucursal, el stock.
    expect(await prisma.contenidoCartaProducto.count({ where: { productoId: r.id } })).toBe(0);
    expect(await prisma.precioLocalProducto.count({ where: { productoId: r.id } })).toBe(0);
    expect(await prisma.movimientoStock.count({ where: { productoId: r.id } })).toBe(0);

    // El mensaje dice qué se copió, qué quedó pendiente y el aviso de pasos a revisar.
    expect(r.mensaje).toContain('Producto "Bife con chimichurri"');
    expect(r.mensaje).toContain("2 ingredientes, 2 pasos y la ficha técnica");
    expect(r.mensaje).toContain("2 grupos con 3 opciones, 1 con precio");
    expect(r.mensaje).toContain("1 grupo archivado en la biblioteca no se copió");
    expect(r.mensaje).toContain("«En la carta» queda pendiente de completar");
    expect(r.mensaje).toContain("Hay pasos para revisar");
  });

  it("la copia es independiente: cambiar la receta del original después no toca la del duplicado", async () => {
    const r = await entre(duplicar());
    const guardada = await guardarRecetaACiegas(e.bifeId, [{ insumoProductoId: e.salId, cantidad: 0.5, unidadId: e.kgId }]);
    expect(guardada.ok).toBe(true);
    expect(await prisma.recetaVersion.count({ where: { productoId: e.bifeId } })).toBe(2);
    const delDuplicado = await prisma.recetaVersion.findMany({ where: { productoId: r.id }, include: { ingredientes: true } });
    expect(delDuplicado).toHaveLength(1);
    expect(delDuplicado[0]!.version).toBe(1);
    expect(delDuplicado[0]!.ingredientes).toHaveLength(2);
    // Y guardar en el duplicado deja su propia versión 2, sin tocar la del original.
    const enElDuplicado = await guardarRecetaACiegas(r.id, [{ insumoProductoId: e.carneId, cantidad: 0.25, unidadId: e.kgId }]);
    expect(enElDuplicado.ok).toBe(true);
    expect(await prisma.recetaVersion.count({ where: { productoId: r.id } })).toBe(2);
    expect(await prisma.recetaVersion.count({ where: { productoId: e.bifeId } })).toBe(2);
  });

  it("se puede copiar solo la receta, solo las opciones o ninguna de las dos: lo que no se pide no se copia", async () => {
    const soloReceta = await entre(duplicar({ nombre: "Bife solo receta", copiarOpciones: false }));
    expect(await prisma.recetaVersion.count({ where: { productoId: soloReceta.id } })).toBe(1);
    expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: soloReceta.id } })).toBe(0);
    const soloOpciones = await entre(duplicar({ nombre: "Bife solo opciones", copiarReceta: false }));
    expect(await prisma.recetaVersion.count({ where: { productoId: soloOpciones.id } })).toBe(0);
    expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: soloOpciones.id } })).toBe(2);
    expect(soloOpciones.mensaje).not.toContain("Hay pasos para revisar");
    const ninguna = await entre(duplicar({ nombre: "Bife pelado", copiarReceta: false, copiarOpciones: false }));
    expect(await prisma.recetaVersion.count({ where: { productoId: ninguna.id } })).toBe(0);
    expect(await prisma.productoAdmiteOpcion.count({ where: { productoId: ninguna.id } })).toBe(0);
    expect(await prisma.producto.count({ where: { id: ninguna.id } })).toBe(1);
  });

  it("el precio es un punto de partida editable: con la clave, el que se escribe", async () => {
    const r = await entre(duplicar({ precioVenta: "5600.50" }));
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: r.id } })).precioVenta)).toBe(5600.5);
    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidadId: r.id, campo: "precioVenta" } });
    expect({ anterior: auditoria.valorAnterior, nuevo: auditoria.valorNuevo, actorId: auditoria.actorId }).toEqual({ anterior: null, nuevo: "5600.5", actorId: e.adminId });
    expect(auditoria.descripcion).toContain("editado al duplicar");
  });

  it("trazabilidad: la auditoría dice quién duplicó, a partir de cuál producto y de qué versión de la receta", async () => {
    const r = await entre(duplicar());
    const duplicadoDe = await prisma.registroAuditoria.findMany({ where: { entidad: "Producto", entidadId: r.id, campo: "duplicadoDe" } });
    expect(duplicadoDe).toHaveLength(1);
    expect(duplicadoDe[0]).toMatchObject({ actorId: e.adminId, valorAnterior: null, valorNuevo: e.bifeId, sucursalId: null });
    expect(duplicadoDe[0]!.descripcion).toBe(`Producto "Bife con chimichurri" creado por duplicación de "${NOMBRE_DEL_BIFE}".`);
    const recetaNueva = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: r.id } });
    const deLaReceta = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "RecetaVersion", entidadId: recetaNueva.id } });
    expect(deLaReceta).toMatchObject({ actorId: e.adminId, campo: "version", valorAnterior: null, valorNuevo: "1" });
    expect(deLaReceta.descripcion).toBe(`Receta de "Bife con chimichurri" creada como versión 1 por duplicación de "${NOMBRE_DEL_BIFE}" (la receta central, versión 1).`);
    // Cada grupo y cada opción vinculados dejan sus filas por columna, con el mismo actor.
    const delProducto = await prisma.productoAdmiteGrupo.findMany({ where: { productoId: r.id }, select: { id: true } });
    const filasDeGrupos = await prisma.registroAuditoria.findMany({ where: { entidad: "ProductoAdmiteGrupo", entidadId: { in: delProducto.map((g) => g.id) } } });
    expect(filasDeGrupos.length).toBeGreaterThanOrEqual(2);
    expect(new Set(filasDeGrupos.map((f) => f.actorId))).toEqual(new Set([e.adminId]));
  });

  describe("idempotencia", () => {
    it("el mismo pedido repetido (doble clic, reintento) devuelve el producto ya creado: un solo producto y nada auditado de más", async () => {
      const duplicadoId = nuevoDuplicadoId();
      const primero = await entre(duplicarProducto({ duplicadoId, origenId: e.bifeId, nombre: "Bife con chimichurri", copiarReceta: true, copiarOpciones: true, sucursalDeLaRecetaId: null }));
      const antes = await fotoDeLaBase();
      const segundo = await entre(duplicarProducto({ duplicadoId, origenId: e.bifeId, nombre: "Bife con chimichurri", copiarReceta: true, copiarOpciones: true, sucursalDeLaRecetaId: null }));
      expect(segundo.id).toBe(primero.id);
      expect(segundo.mensaje).toContain("ya estaba creado");
      expect(await fotoDeLaBase()).toEqual(antes);
      expect(await prisma.producto.count({ where: { nombre: "Bife con chimichurri" } })).toBe(1);
    });

    it("el mismo identificador con otro nombre o con otro original es ID_REUTILIZADO y no escribe nada", async () => {
      const duplicadoId = nuevoDuplicadoId();
      await entre(duplicarProducto({ duplicadoId, origenId: e.bifeId, nombre: "Bife con chimichurri", copiarReceta: true, copiarOpciones: true, sucursalDeLaRecetaId: null }));
      const otro = await prisma.producto.create({ data: { codigo: "PV_OTRO", nombre: "Milanesa", tipo: "PV", unidadStockId: e.kgId } });
      const antes = await fotoDeLaBase();
      const otroNombre = await duplicarProducto({ duplicadoId, origenId: e.bifeId, nombre: "Bife con otra salsa", copiarReceta: true, copiarOpciones: true, sucursalDeLaRecetaId: null });
      const otroOrigen = await duplicarProducto({ duplicadoId, origenId: otro.id, nombre: "Bife con chimichurri", copiarReceta: false, copiarOpciones: false, sucursalDeLaRecetaId: null });
      for (const r of [otroNombre, otroOrigen]) {
        expect(r.ok).toBe(false);
        expect(r.mensaje).toContain("identificador de duplicado ya se usó");
      }
      expect(await fotoDeLaBase()).toEqual(antes);
    });

    it("dos pedidos IGUALES a la vez (doble clic real) terminan en un solo producto", async () => {
      for (let i = 0; i < 5; i++) {
        const duplicadoId = nuevoDuplicadoId();
        const pedido = { duplicadoId, origenId: e.bifeId, nombre: `Bife doble ${i}`, copiarReceta: true, copiarOpciones: true, sucursalDeLaRecetaId: null };
        const resultados = await Promise.all([duplicarProducto(pedido), duplicarProducto(pedido)]);
        expect(resultados.every((r) => r.ok), JSON.stringify(resultados)).toBe(true);
        expect(await prisma.producto.count({ where: { nombre: `Bife doble ${i}` } }), `iteración ${i}`).toBe(1);
        expect(await prisma.recetaVersion.count({ where: { productoId: duplicadoId } })).toBe(1);
        expect(await prisma.registroAuditoria.count({ where: { entidadId: duplicadoId, campo: "duplicadoDe" } })).toBe(1);
      }
    });
  });

  describe("el nombre", () => {
    it("es obligatorio: vacío o solo espacios se rechaza antes de crear nada", async () => {
      const antes = await fotoDeLaBase();
      for (const nombre of ["", "   ", undefined]) {
        const r = await duplicar({ nombre });
        expect(r).toEqual({ ok: false, mensaje: "El nombre del producto nuevo no puede estar vacío." });
      }
      expect(await fotoDeLaBase()).toEqual(antes);
    });

    it("no puede repetir el de otro producto (sin distinguir mayúsculas ni espacios de los costados), disponible o no", async () => {
      const antes = await fotoDeLaBase();
      const r = await duplicar({ nombre: "  BIFE A CRIOLLA " });
      expect(r).toEqual({ ok: false, mensaje: 'Ya existe un producto llamado "BIFE A CRIOLLA". Elegí otro nombre.' });
      await prisma.disponibilidadProducto.updateMany({ where: { productoId: e.bifeId }, data: { disponible: false } });
      expect((await duplicar({ nombre: "Bife a criolla" })).ok).toBe(false);
      expect(await fotoDeLaBase()).toEqual(antes);
    });

    it("dos duplicados a la vez con el mismo nombre: uno gana y el otro recibe «ya existe» (nunca dos productos)", async () => {
      for (let i = 0; i < 6; i++) {
        const nombre = `Bife carrera ${i}`;
        const resultados = await Promise.all([duplicar({ nombre }), duplicar({ nombre })]);
        const ok = resultados.filter((r) => r.ok);
        const rechazados = resultados.filter((r) => !r.ok);
        expect(ok, JSON.stringify(resultados)).toHaveLength(1);
        expect(rechazados).toHaveLength(1);
        expect(rechazados[0]!.mensaje).toBe(`Ya existe un producto llamado "${nombre}". Elegí otro nombre.`);
        expect(await prisma.producto.count({ where: { nombre } }), `iteración ${i}`).toBe(1);
        const nuevo = await prisma.producto.findFirstOrThrow({ where: { nombre } });
        expect(await prisma.recetaVersion.count({ where: { productoId: nuevo.id } })).toBe(1);
        expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: nuevo.id } })).toBe(2);
      }
    });
  });

  describe("atomicidad: si algo falla a mitad no queda NADA del producto nuevo", () => {
    it("falla al escribir la receta (el producto y su disponibilidad ya estaban escritos)", async () => {
      const antes = await fotoDeLaBase();
      falla.enLaReceta = true;
      await expect(duplicar()).rejects.toThrow("falla inyectada al escribir la receta");
      falla.enLaReceta = false;
      expect(await fotoDeLaBase()).toEqual(antes);
      expect(await prisma.producto.count({ where: { nombre: "Bife con chimichurri" } })).toBe(0);
      // Y el mismo pedido, ya sin la falla, sale bien (nada quedó trabado a medias).
      await entre(duplicar());
    });

    it("falla al copiar las opciones (el producto, su disponibilidad, la receta y el primer grupo ya estaban escritos)", async () => {
      const antes = await fotoDeLaBase();
      falla.enLaSegundaAdmision = true;
      falla.admisiones = 0;
      await expect(duplicar()).rejects.toThrow("falla inyectada al copiar las opciones");
      falla.enLaSegundaAdmision = false;
      expect(await fotoDeLaBase()).toEqual(antes);
      expect(await prisma.producto.count({ where: { nombre: "Bife con chimichurri" } })).toBe(0);
    });

    it("un rechazo de las reglas de las opciones DESPUÉS de escribir el producto, la receta y el primer grupo también deja todo como estaba", async () => {
      // El original vende la ensalada con un descuento de $450 sobre $5.000: válido. Duplicado con un precio de lista de $100, esa opción daría un precio negativo y la regla de las opciones frena la copia entera.
      await prisma.productoAdmiteOpcion.update({ where: { productoId_opcionId: { productoId: e.bifeId, opcionId: e.ensaladaId } }, data: { tipoDeDiferencia: "MONTO", diferenciaPrecio: "-450.00" } });
      const antes = await fotoDeLaBase();
      const r = await duplicar({ precioVenta: "100" });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("No se pudieron copiar las opciones");
      expect(r.mensaje).toContain("Ensalada mixta");
      expect(await fotoDeLaBase()).toEqual(antes);
      // Con el precio del original sí se copia.
      await entre(duplicar());
    });
  });

  describe("aislamiento entre empresas", () => {
    it("un producto de otra empresa no se puede duplicar ni se revela si existe", async () => {
      const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
      const unidad = await testigo.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
      const ajeno = await testigo.producto.create({ data: { codigo: "PV_AJENO", nombre: "Producto ajeno", tipo: "PV", unidadStockId: unidad.id } });
      const antes = await fotoDeLaBase();
      const r = await duplicar({ origenId: ajeno.id, copiarReceta: false, copiarOpciones: false });
      expect(r).toEqual({ ok: false, mensaje: "No se encontró el producto." });
      expect(await fotoDeLaBase()).toEqual(antes);
      expect(await testigo.producto.count()).toBe(1);
    });

    it("el identificador de un producto de otra empresa no sirve de `duplicadoId`: se rechaza sin tocar nada de ninguna de las dos", async () => {
      const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
      const unidad = await testigo.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
      const ajeno = await testigo.producto.create({ data: { codigo: "PV_AJENO", nombre: "Producto ajeno", tipo: "PV", unidadStockId: unidad.id } });
      const antes = await fotoDeLaBase();
      const r = await duplicarProducto({ duplicadoId: ajeno.id, origenId: e.bifeId, nombre: "Bife con chimichurri", copiarReceta: true, copiarOpciones: true, sucursalDeLaRecetaId: null });
      expect(r.ok).toBe(false);
      expect(await fotoDeLaBase()).toEqual(antes);
      expect(await testigo.producto.findUniqueOrThrow({ where: { id: ajeno.id } })).toMatchObject({ nombre: "Producto ajeno" });
    });

    it("la sucursal de la receta tiene que ser de la empresa: una de otra empresa se rechaza", async () => {
      const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
      const ajena = await testigo.sucursal.create({ data: { nombre: "Sucursal ajena" } });
      const antes = await fotoDeLaBase();
      const r = await duplicar({ sucursalDeLaRecetaId: ajena.id });
      expect(r).toEqual({ ok: false, mensaje: "No se encontró esa sucursal." });
      expect(await fotoDeLaBase()).toEqual(antes);
    });
  });

  describe("¿qué pasa si…?", () => {
    it("un ingrediente está dado de baja: falla todo y se nombran TODOS los dados de baja", async () => {
      await prisma.disponibilidadProducto.updateMany({ where: { productoId: { in: [e.carneId, e.salId] } }, data: { disponible: false } });
      const antes = await fotoDeLaBase();
      const r = await duplicar();
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("«Carne de bife»");
      expect(r.mensaje).toContain("«Sal fina»");
      expect(r.mensaje).toContain("dados de baja");
      expect(await fotoDeLaBase()).toEqual(antes);
      // Duplicándolo sin la receta, en cambio, no hay problema.
      await entre(duplicar({ copiarReceta: false }));
    });

    it("un sustituto inactivo hace fallar la copia como un ingrediente dado de baja", async () => {
      await prisma.insumo.update({ where: { id: e.insumoId }, data: { activo: false } });
      const antes = await fotoDeLaBase();
      const r = await duplicar();
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("está inactivo");
      expect(await fotoDeLaBase()).toEqual(antes);
    });

    it("receta circular: el producto nuevo no puede ser ingrediente de su propia receta (usar el id de un ingrediente como `duplicadoId` se rechaza y no toca nada)", async () => {
      const antes = await fotoDeLaBase();
      const r = await duplicarProducto({ duplicadoId: e.carneId, origenId: e.bifeId, nombre: "Bife circular", copiarReceta: true, copiarOpciones: false, sucursalDeLaRecetaId: null });
      expect(r.ok).toBe(false);
      expect(await fotoDeLaBase()).toEqual(antes);
      expect(await prisma.producto.findUniqueOrThrow({ where: { id: e.carneId } })).toMatchObject({ nombre: "Carne de bife", tipo: "MP" });
    });

    it("el original no tiene receta: pedir copiarla se rechaza (no se copia «lo que se pueda»)", async () => {
      const sinReceta = await prisma.producto.create({ data: { codigo: "PV_SIN", nombre: "Agua", tipo: "PV", unidadStockId: e.kgId } });
      const antes = await fotoDeLaBase();
      const r = await duplicar({ origenId: sinReceta.id, copiarOpciones: false });
      expect(r).toEqual({ ok: false, mensaje: "«Agua» no tiene receta: no hay nada que copiar." });
      expect(await fotoDeLaBase()).toEqual(antes);
      await entre(duplicar({ origenId: sinReceta.id, nombre: "Agua con gas", copiarReceta: false, copiarOpciones: false }));
    });

    it("el original no tiene opciones vinculadas: pedir copiarlas se rechaza", async () => {
      const sinOpciones = await prisma.producto.create({ data: { codigo: "PV_SIN2", nombre: "Flan", tipo: "PV", unidadStockId: e.kgId } });
      const antes = await fotoDeLaBase();
      const r = await duplicar({ origenId: sinOpciones.id, copiarReceta: false });
      expect(r).toEqual({ ok: false, mensaje: "«Flan» no tiene opciones vinculadas: no hay nada que copiar." });
      expect(await fotoDeLaBase()).toEqual(antes);
    });

    it("un grupo que el original admite pero está archivado en la biblioteca no se copia, y se avisa", async () => {
      const r = await entre(duplicar());
      expect(r.mensaje).toContain("1 grupo archivado en la biblioteca no se copió");
      expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: r.id, grupoId: e.grupoArchivadoId } })).toBe(0);
    });

    it("una opción archivada en la biblioteca no se copia, y se avisa", async () => {
      await prisma.opcionDeGrupo.update({ where: { id: e.chimichurriId }, data: { activa: false } });
      const r = await entre(duplicar());
      expect(r.mensaje).toContain("1 opción archivada en la biblioteca no se copió");
      expect(await prisma.productoAdmiteOpcion.count({ where: { productoId: r.id, opcionId: e.chimichurriId } })).toBe(0);
      expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: r.id, grupoId: e.grupoSalsasId } })).toBe(1);
    });

    it("el producto de respaldo de un adicional no se duplica", async () => {
      const ancla = await prisma.producto.create({ data: { codigo: "PV_ANCLA", nombre: "Shot (ancla)", tipo: "PV", unidadStockId: e.kgId } });
      const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: "Extras", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2 } });
      await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: "Shot", orden: 1, productoId: ancla.id } });
      const r = await duplicar({ origenId: ancla.id, copiarReceta: false, copiarOpciones: false });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("producto de respaldo de un adicional");
    });

    it("una materia prima también se duplica (su ficha), sin receta ni opciones", async () => {
      const r = await entre(duplicar({ origenId: e.carneId, nombre: "Carne de lomo", copiarReceta: false, copiarOpciones: false }));
      const nuevo = await prisma.producto.findUniqueOrThrow({ where: { id: r.id } });
      expect(nuevo).toMatchObject({ tipo: "MP", unidadStockId: e.kgId, nombre: "Carne de lomo" });
      expect(nuevo.codigo).toMatch(/^MP_/);
    });

    it("los datos mal formados se rechazan sin crear nada: ids, banderas y precio", async () => {
      const antes = await fotoDeLaBase();
      const malos: Record<string, unknown>[] = [
        { duplicadoId: "corto" },
        { duplicadoId: { $ne: 1 } },
        { origenId: { id: e.bifeId } },
        { copiarReceta: "true" },
        { copiarOpciones: 1 },
        { sucursalDeLaRecetaId: { id: e.norteId } },
        { precioVenta: "abc" },
        { precioVenta: "-5" },
        { precioVenta: "10.123" },
      ];
      for (const extra of malos) expect((await duplicar(extra)).ok, JSON.stringify(extra)).toBe(false);
      expect((await duplicarProducto(null as never)).ok).toBe(false);
      expect(await fotoDeLaBase()).toEqual(antes);
    });
  });

  describe("la receta de otra sucursal (S-07)", () => {
    async function darleRecetaPropiaANorte() {
      const propia = await prisma.recetaVersion.create({
        data: { productoId: e.bifeId, version: 1, sucursalId: e.norteId, comentarios: "Receta de Norte", ingredientes: { create: [{ insumoProductoId: e.carneId, cantidad: "0.4000", unidadId: e.kgId, mermaPorcentaje: "0" }] } },
      });
      await prisma.recetaSucursal.create({ data: { sucursalId: e.norteId, productoId: e.bifeId, habilitada: true } });
      return propia;
    }

    it("la Central: se copia la receta central; una sucursal sin receta propia habilitada también copia la central", async () => {
      const central = await entre(duplicar({ nombre: "Desde la central" }));
      const deNorteSinPropia = await entre(duplicar({ nombre: "Desde Norte sin propia", sucursalDeLaRecetaId: e.norteId }));
      for (const r of [central, deNorteSinPropia]) {
        expect(await prisma.recetaIngrediente.count({ where: { recetaVersion: { productoId: r.id } } })).toBe(2);
      }
      expect(deNorteSinPropia.mensaje).toContain("la receta central");
    });

    it("una sucursal con receta propia habilitada: se copia SU receta vigente, como versión 1 de la serie central del producto nuevo", async () => {
      await darleRecetaPropiaANorte();
      const r = await entre(duplicar({ nombre: "Bife de Norte", sucursalDeLaRecetaId: e.norteId }));
      const receta = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: r.id }, include: { ingredientes: true } });
      expect({ version: receta.version, sucursalId: receta.sucursalId, comentarios: receta.comentarios, ingredientes: receta.ingredientes.map((i) => [i.insumoProductoId, Number(i.cantidad)]) }).toEqual({
        version: 1,
        sucursalId: null,
        comentarios: "Receta de Norte",
        ingredientes: [[e.carneId, 0.4]],
      });
      expect(r.mensaje).toContain("la receta propia de «Norte»");
      // Y la receta propia de Norte no se tocó.
      expect(await prisma.recetaVersion.count({ where: { productoId: e.bifeId, sucursalId: e.norteId } })).toBe(1);
    });

    it("sin membresía y el «Ver» de receta_sucursal_copiar en esa sucursal se rechaza antes de leer nada (la Central no pide nada más)", async () => {
      await darleRecetaPropiaANorte();
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Sur" } });
      const antes = await fotoDeLaBase();
      const r = await duplicar({ sucursalDeLaRecetaId: otraSucursal.id });
      expect(r).toEqual({ ok: false, mensaje: "No tenés acceso a esa sucursal." });
      expect(await fotoDeLaBase()).toEqual(antes);
      // Sin pedir la receta, la sucursal ni se mira.
      await entre(duplicar({ nombre: "Bife sin receta", copiarReceta: false, sucursalDeLaRecetaId: otraSucursal.id }));
    });
  });
});
