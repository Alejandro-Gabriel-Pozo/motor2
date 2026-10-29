import { beforeEach, describe, expect, it, vi } from "vitest";
import { agregarEntradaDeCupoCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/agregar-entrada-de-cupo";
import { actualizarActivaEntradaDeCupoCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/actualizar-activa-entrada-de-cupo";
import { guardarVigenciaPromoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-vigencia-promo-carta";
import { guardarCuposPromoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-cupos-promo-carta";
import { guardComandoAgregarEntradaDeCupo, guardComandoGuardarVigenciaPromoCarta } from "../../src/core/features/carta/combos.guard";
import { guardComandoGuardarCuposPromoCarta } from "../../src/core/features/carta/promos.guard";
import { rechazoDeComponenteDeCombo } from "../../src/core/pos/public";
import { limpiarBaseDeTest, prisma, prismaAdmin, prismaSinEmpresa } from "../setup/test-db";
import { actorDeCombos, sembrarCombosAjenos, sembrarCombosGo3b, type EscenarioDeCombosGo3b } from "../setup/combos-go3b";

/**
 * GO-3b (ADR-032, pasos D4a y D4b): las OPCIONES de un lugar LISTA de un combo (productos de venta, aunque no estén en la carta, con una configuración fija opcional de sus opciones) y la VIGENCIA
 * de la promo. Contra Postgres real, como `motor2_app` con el alcance de la sucursal activa (A).
 *
 * Reglas: solo PV que no sea ancla (`PRODUCTO_INVALIDO`), con precio de referencia (D-8, `COMPONENTE_SIN_PRECIO_DE_REFERENCIA`) y receta o stock propio (D-9, `COMPONENTE_SIN_RECETA`); una
 * configuración válida para lo que el producto admite, sin adicionales (`CONFIGURACION_INVALIDA`); sin mezclar alícuotas declaradas distintas en el combo (D-2, `COMBO_ALICUOTAS_DISTINTAS`, también
 * al guardar los lugares); otra empresa no se ve (RLS: «no encontrado»). Por estado (repetir no escribe), con su auditoría, y una sola fila con dos altas a la vez.
 *
 * Mutaciones demostradas (rojo y revertidas): sacar el chequeo de receta de `rechazoDeComponenteDeCombo` (rojo: «sin receta» y «reactivar»); no pasar la configuración a `armarLineaConfigurada`
 * (rojo: «obligatoria» y «adicional»); sacar `revisarAlicuotasEnTx` del alta (rojo: «alícuotas»); sacar la comparación de la versión leída Y el `version: esperada` del `updateMany` de la
 * vigencia (rojo: «versión vieja» y «dos editores»; cada uno solo no la pone en rojo: el otro, o SERIALIZABLE, la frena igual).
 */
const ITERACIONES = 10;

describe("las opciones de un lugar LISTA y la vigencia de una promo (GO-3b, D4)", () => {
  let e: EscenarioDeCombosGo3b;
  const actor = () => actorDeCombos(e.usuarioId, e.sucursalA);
  const agregar = (cupoId: string, productoId: string, opciones?: unknown) => {
    const comando = guardComandoAgregarEntradaDeCupo({ cupoId, productoId, opciones });
    if (!comando.ok) throw new Error(comando.mensaje);
    return agregarEntradaDeCupoCasoDeUso(actor(), comando.valor);
  };
  const auditoria = async () =>
    (await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "EntradaDeCupo" }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).map((f) => [f.entidadId, f.valorAnterior, f.valorNuevo]);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarCombosGo3b();
  });

  it("un producto FUERA DE CARTA con receta entra como opción; repetir no escribe ni audita", async () => {
    const r = await agregar(e.cupoEntradaId, e.guisoId);
    expect(r).toMatchObject({ ok: true, datos: { huboCambio: true } });
    const entradas = await prisma.entradaDeCupo.findMany({ where: { cupoId: e.cupoEntradaId } });
    expect(entradas.map((x) => [x.productoId, x.claveConfiguracion, x.activa, x.orden])).toEqual([[e.guisoId, "", true, 0]]);
    expect(await auditoria()).toEqual([[entradas[0]!.id, null, "true"]]);
    expect(await agregar(e.cupoEntradaId, e.guisoId)).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await prisma.entradaDeCupo.count({ where: { cupoId: e.cupoEntradaId } })).toBe(1);
    expect(await auditoria()).toHaveLength(1);
    // La segunda opción va al final de la lista.
    expect(await agregar(e.cupoEntradaId, e.sopaId)).toMatchObject({ ok: true });
    expect((await prisma.entradaDeCupo.findFirstOrThrow({ where: { productoId: e.sopaId } })).orden).toBe(1);
  });

  it("D-9: un PV sin receta se rechaza nombrando el producto y mandando a Catálogo → Recetas; uno que se produce, sin receta, entra", async () => {
    const r = await agregar(e.cupoEntradaId, e.sinRecetaId);
    expect(r).toMatchObject({ ok: false, codigo: "COMPONENTE_SIN_RECETA" });
    expect(r.mensaje).toContain("«Sin receta»");
    expect(r.mensaje).toContain("Catálogo → Recetas");
    await prisma.producto.update({ where: { id: e.sinRecetaId }, data: { seProduce: true } });
    expect(await agregar(e.cupoEntradaId, e.sinRecetaId)).toMatchObject({ ok: true });
    expect(await auditoria()).toHaveLength(1);
  });

  it("ventas con opciones (2026-10-29): una base SIN receta entra con una configuración fija que descuenta un insumo (Coca); con una que no descuenta nada (Fanta) se rechaza nombrando la opción", async () => {
    const botella = await prisma.producto.create({ data: { codigo: "MP_COCA_500", nombre: "Coca botella 500", tipo: "MP", unidadStockId: e.unidadId } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: e.sucursalA, productoId: botella.id, disponible: true } });
    const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: "Marca", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1 } });
    const opcion = async (nombre: string, orden: number, conConsumo: boolean) => {
      const o = await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre, orden } });
      const v = await prisma.versionDeOpcion.create({ data: { opcionId: o.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: e.usuarioId } });
      if (conConsumo) await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: v.id, efecto: "SUMA", insumoProductoId: botella.id, cantidad: "1.0000", unidadId: e.unidadId } });
      await prisma.productoAdmiteOpcion.create({ data: { productoId: e.sinRecetaId, opcionId: o.id } });
      return o.id;
    };
    await prisma.productoAdmiteGrupo.create({ data: { productoId: e.sinRecetaId, grupoId: grupo.id, orden: 0 } });
    const cocaId = await opcion("Coca", 1, true);
    const fantaId = await opcion("Fanta", 2, false);

    const fanta = await agregar(e.cupoEntradaId, e.sinRecetaId, [{ opcionId: fantaId }]);
    expect(fanta).toMatchObject({ ok: false, codigo: "COMPONENTE_SIN_RECETA" });
    expect(fanta.mensaje).toContain("“Sin receta” con “Fanta” no descuenta ningún insumo");
    expect(await prisma.entradaDeCupo.count()).toBe(0);
    expect(await agregar(e.cupoEntradaId, e.sinRecetaId, [{ opcionId: cocaId }])).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect(await prisma.entradaDeCupo.count({ where: { productoId: e.sinRecetaId } })).toBe(1);
    // Sin configuración sigue siendo un componente sin receta (el grupo obligatorio pide su configuración).
    expect(await agregar(e.cupoEntradaId, e.sinRecetaId)).toMatchObject({ ok: false });
  });

  it("D-8: sin precio de venta de referencia se rechaza; una materia prima o el ancla de un adicional no son componentes", async () => {
    await prisma.producto.update({ where: { id: e.guisoId }, data: { precioVenta: 0 } });
    expect(await agregar(e.cupoEntradaId, e.guisoId)).toMatchObject({ ok: false, codigo: "COMPONENTE_SIN_PRECIO_DE_REFERENCIA" });
    expect(await agregar(e.cupoEntradaId, e.lecheId)).toMatchObject({ ok: false, codigo: "PRODUCTO_INVALIDO" });
    expect(await agregar(e.cupoEntradaId, e.anclaDelShotId)).toMatchObject({ ok: false, codigo: "PRODUCTO_INVALIDO" });
    expect(await prisma.entradaDeCupo.count()).toBe(0);
  });

  it("D4b: un producto con una opción OBLIGATORIA necesita su configuración fija; con ella entra, con su clave estable, sus opciones y la lista compuesta como precio", async () => {
    expect(await agregar(e.cupoEntradaId, e.cafeId)).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    // El café admite también la INCLUIDA «Viene con» (1 a 1): la configuración la lleva.
    const r = await agregar(e.cupoEntradaId, e.cafeId, [{ opcionId: e.medianoId }, { opcionId: e.azucarId }]);
    expect(r).toMatchObject({ ok: true });
    const entrada = await prisma.entradaDeCupo.findFirstOrThrow({ where: { productoId: e.cafeId }, include: { opciones: true } });
    expect(entrada.claveConfiguracion).toBe([`${e.azucarId}=1`, `${e.medianoId}=1`].sort().join(";"));
    expect(entrada.opciones.map((o) => [o.opcionId, o.cantidad]).sort()).toEqual([[e.azucarId, 1], [e.medianoId, 1]].sort());
    // Otra configuración del mismo producto es otra opción (otra fila); la misma en otro orden es la misma.
    expect(await agregar(e.cupoEntradaId, e.cafeId, [{ opcionId: e.grandeId }, { opcionId: e.azucarId }])).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect(await agregar(e.cupoEntradaId, e.cafeId, [{ opcionId: e.azucarId }, { opcionId: e.medianoId }])).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await prisma.entradaDeCupo.count({ where: { productoId: e.cafeId } })).toBe(2);
  });

  it("D4b: una configuración con un adicional, una opción repetida o una que el producto no admite se rechaza", async () => {
    expect(await agregar(e.cupoEntradaId, e.cafeId, [{ opcionId: e.medianoId }, { opcionId: e.azucarId }, { opcionId: e.shotId }])).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await agregar(e.cupoEntradaId, e.cafeId, [{ opcionId: e.medianoId }, { opcionId: e.medianoId }])).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await agregar(e.cupoEntradaId, e.guisoId, [{ opcionId: e.medianoId }])).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await prisma.entradaDeCupo.count()).toBe(0);
  });

  it("solo en un lugar LISTA activo: el plato del día no se carga acá, un lugar dado de baja tampoco", async () => {
    expect(await agregar(e.cupoDelDiaId, e.guisoId)).toMatchObject({ ok: false, codigo: "CUPO_INVALIDO" });
    await prismaAdmin.promoCartaCupo.update({ where: { id: e.cupoEntradaId }, data: { activo: false } });
    expect(await agregar(e.cupoEntradaId, e.guisoId)).toMatchObject({ ok: false, codigo: "CUPO_INVALIDO" });
  });

  it("aislamiento: un lugar o un producto de OTRA empresa no existen (sin oráculo)", async () => {
    const ajeno = await sembrarCombosAjenos();
    expect(await agregar(ajeno.cupoLista.id, e.guisoId)).toMatchObject({ ok: false, codigo: "CUPO_NO_ENCONTRADO" });
    expect(await agregar(e.cupoEntradaId, ajeno.producto.id)).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
    expect(await actualizarActivaEntradaDeCupoCasoDeUso(actor(), { entradaId: ajeno.entrada.id, activa: false })).toMatchObject({ ok: false, codigo: "ENTRADA_NO_ENCONTRADA" });
    expect(await ajeno.testigo.entradaDeCupo.findUniqueOrThrow({ where: { id: ajeno.entrada.id } })).toMatchObject({ activa: true });
  });

  it("D-2: alícuotas declaradas distintas en el combo se rechazan (al agregar una opción y al guardar los lugares); sin declarar no bloquea", async () => {
    await prisma.producto.update({ where: { id: e.guisoId }, data: { alicuotaIvaVenta: "IVA_21" } });
    await prisma.producto.update({ where: { id: e.flanId }, data: { alicuotaIvaVenta: "IVA_10_5" } });
    expect(await agregar(e.cupoEntradaId, e.guisoId)).toMatchObject({ ok: true });
    expect(await agregar(e.cupoEntradaId, e.sopaId)).toMatchObject({ ok: true }); // sin declarar: aviso, no bloqueo
    const r = await agregar(e.cupoPostreId, e.flanId);
    expect(r).toMatchObject({ ok: false, codigo: "COMBO_ALICUOTAS_DISTINTAS" });
    expect(r.mensaje).toContain("«Guiso de lentejas»");

    // Al guardar los lugares: una sección cuya carta tiene un producto de otra alícuota.
    const postres = (await prisma.seccionCarta.create({ data: { nombre: "Postres" } })).id;
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: e.sucursalB, productoId: e.flanId, visibleEnCarta: true, seccionCartaId: postres } });
    const cupos = guardComandoGuardarCuposPromoCarta({
      cupos: [
        { tipo: "LISTA", nombre: "Entrada", cantidadMinima: 1, cantidadMaxima: 1 },
        { seccionCartaId: postres, cantidadMinima: 1, cantidadMaxima: 1 },
      ],
    });
    expect(await guardarCuposPromoCartaCasoDeUso(actor(), { promoCartaId: e.promoId, cupos })).toMatchObject({ ok: false, codigo: "COMBO_ALICUOTAS_DISTINTAS" });
  });

  it("apagar y prender: por estado y auditado; prender vuelve a validar (la receta pudo desactivarse)", async () => {
    expect(await agregar(e.cupoEntradaId, e.guisoId)).toMatchObject({ ok: true });
    const entradaId = (await prisma.entradaDeCupo.findFirstOrThrow({ where: { productoId: e.guisoId } })).id;
    expect(await actualizarActivaEntradaDeCupoCasoDeUso(actor(), { entradaId, activa: false })).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect(await actualizarActivaEntradaDeCupoCasoDeUso(actor(), { entradaId, activa: false })).toMatchObject({ ok: true, datos: { huboCambio: false } });
    await prismaAdmin.recetaIngrediente.deleteMany({ where: { recetaVersion: { productoId: e.guisoId } } });
    expect(await actualizarActivaEntradaDeCupoCasoDeUso(actor(), { entradaId, activa: true })).toMatchObject({ ok: false, codigo: "COMPONENTE_SIN_RECETA" });
    expect(await prisma.entradaDeCupo.findUniqueOrThrow({ where: { id: entradaId } })).toMatchObject({ activa: false });
    expect(await auditoria()).toEqual([
      [entradaId, null, "true"],
      [entradaId, "true", "false"],
    ]);
  });

  it("concurrencia real: dos altas a la vez de la MISMA opción dejan una sola fila y una sola alta auditada (loop de 10)", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      const cupoId = (await prisma.promoCartaCupo.create({ data: { promoCartaId: e.promoId, tipo: "LISTA", nombre: `Bebida ${i}`, cantidadMinima: 0, cantidadMaxima: 1 } })).id;
      const resultados = await Promise.allSettled([agregar(cupoId, e.guisoId), agregar(cupoId, e.guisoId)]);
      expect(resultados.map((r) => r.status), `iteración ${i}`).toEqual(["fulfilled", "fulfilled"]);
      const valores = resultados.map((r) => (r.status === "fulfilled" ? r.value : null));
      expect(valores.every((v) => v?.ok), `iteración ${i}: ${valores.map((v) => v?.mensaje).join(" | ")}`).toBe(true);
      expect(valores.filter((v) => v?.ok && v.datos.huboCambio), `iteración ${i}`).toHaveLength(1);
      const filas = await prisma.entradaDeCupo.findMany({ where: { cupoId } });
      expect(filas, `iteración ${i}`).toHaveLength(1);
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "EntradaDeCupo", entidadId: filas[0]!.id } })).toBe(1);
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron: el test no ejercitó el único ni el reintento").toBeGreaterThan(2 * ITERACIONES);
    intentos.mockRestore();
  });

  describe("la vigencia", () => {
    const vigencia = (versionEsperada: number, extra: Record<string, unknown>) => {
      const c = guardComandoGuardarVigenciaPromoCarta({ promoCartaId: e.promoId, versionEsperada, ...extra });
      if (!c.ok) throw new Error(c.mensaje);
      return guardarVigenciaPromoCartaCasoDeUso(actor(), c.valor);
    };

    it("guarda fechas y días (lunes a viernes) con la versión vista, sube la versión y audita por columna; los siete días son «todos»", async () => {
      expect(await vigencia(1, { vigenteDesde: "2026-10-01", vigenteHasta: "2026-10-31", diasDeSemana: [0, 1, 2, 3, 4] })).toMatchObject({ ok: true, datos: { huboCambio: true } });
      const promo = await prisma.promoCarta.findUniqueOrThrow({ where: { id: e.promoId } });
      expect([promo.vigenteDesde?.toISOString().slice(0, 10), promo.vigenteHasta?.toISOString().slice(0, 10), promo.diasDeSemana, promo.version]).toEqual(["2026-10-01", "2026-10-31", 31, 2]);
      const filas = await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "PromoCarta", entidadId: e.promoId }, orderBy: { campo: "asc" } });
      expect(filas.map((f) => [f.campo, f.valorAnterior, f.valorNuevo])).toEqual([
        ["diasDeSemana", null, "31"],
        ["vigenteDesde", null, "2026-10-01"],
        ["vigenteHasta", null, "2026-10-31"],
      ]);
      // La misma vigencia otra vez: sin cambio, sin escribir.
      expect(await vigencia(2, { vigenteDesde: "2026-10-01", vigenteHasta: "2026-10-31", diasDeSemana: [4, 3, 2, 1, 0] })).toMatchObject({ ok: true, datos: { huboCambio: false } });
      expect(await vigencia(2, { diasDeSemana: [0, 1, 2, 3, 4, 5, 6] })).toMatchObject({ ok: true, datos: { huboCambio: true } });
      expect(await prisma.promoCarta.findUniqueOrThrow({ where: { id: e.promoId } })).toMatchObject({ vigenteDesde: null, vigenteHasta: null, diasDeSemana: null, version: 3 });
    });

    it("con una versión vieja no escribe nada (VERSION_DESACTUALIZADA); el guard rechaza desde > hasta y ningún día", async () => {
      expect(await vigencia(1, { vigenteDesde: "2026-10-01" })).toMatchObject({ ok: true });
      expect(await vigencia(1, { vigenteDesde: "2026-11-01" })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      expect((await prisma.promoCarta.findUniqueOrThrow({ where: { id: e.promoId } })).vigenteDesde?.toISOString().slice(0, 10)).toBe("2026-10-01");
      expect(guardComandoGuardarVigenciaPromoCarta({ promoCartaId: e.promoId, versionEsperada: 2, vigenteDesde: "2026-10-10", vigenteHasta: "2026-10-01" }).ok).toBe(false);
      expect(guardComandoGuardarVigenciaPromoCarta({ promoCartaId: e.promoId, versionEsperada: 2, diasDeSemana: [] }).ok).toBe(false);
      expect(guardComandoGuardarVigenciaPromoCarta({ promoCartaId: e.promoId, versionEsperada: 2, vigenteDesde: "2026-02-30" }).ok).toBe(false);
    });

    it("concurrencia real: dos editores sobre la misma versión, uno gana y el otro VERSION_DESACTUALIZADA (loop de 10)", async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        const version = (await prisma.promoCarta.findUniqueOrThrow({ where: { id: e.promoId } })).version;
        const [a, b] = await Promise.all([vigencia(version, { vigenteDesde: `2026-10-${String(i + 1).padStart(2, "0")}` }), vigencia(version, { vigenteHasta: `2026-12-${String(i + 1).padStart(2, "0")}` })]);
        expect([a, b].filter((r) => r.ok), `iteración ${i}: ${a.mensaje} | ${b.mensaje}`).toHaveLength(1);
        expect([a, b].filter((r) => !r.ok).map((r) => (r.ok ? "" : r.codigo))).toEqual(["VERSION_DESACTUALIZADA"]);
        expect((await prisma.promoCarta.findUniqueOrThrow({ where: { id: e.promoId } })).version).toBe(version + 1);
      }
    });
  });
});

describe("la regla del componente de un combo (pura, D-8 y D-9)", () => {
  const base = { nombre: "X", tipo: "PV", esAnclaDeAdicional: false, precioDeReferencia: 100, seProduce: false, ingredientesDeLaRecetaVigente: 1 };
  it("en orden: PV, no ancla, precio de referencia, origen de stock", () => {
    expect(rechazoDeComponenteDeCombo(base)).toBeNull();
    expect(rechazoDeComponenteDeCombo({ ...base, tipo: "MP", precioDeReferencia: 0 })?.codigo).toBe("PRODUCTO_INVALIDO");
    expect(rechazoDeComponenteDeCombo({ ...base, esAnclaDeAdicional: true })?.codigo).toBe("PRODUCTO_INVALIDO");
    expect(rechazoDeComponenteDeCombo({ ...base, precioDeReferencia: 0.009, ingredientesDeLaRecetaVigente: 0 })?.codigo).toBe("COMPONENTE_SIN_PRECIO_DE_REFERENCIA");
    expect(rechazoDeComponenteDeCombo({ ...base, precioDeReferencia: 0.01 })).toBeNull();
    expect(rechazoDeComponenteDeCombo({ ...base, ingredientesDeLaRecetaVigente: 0 })?.codigo).toBe("COMPONENTE_SIN_RECETA");
    expect(rechazoDeComponenteDeCombo({ ...base, ingredientesDeLaRecetaVigente: 0, seProduce: true })).toBeNull();
  });
});
