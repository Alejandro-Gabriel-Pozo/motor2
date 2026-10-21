import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * MEDICIÓN «ANTES» de cuatro tareas del producto con las pantallas de HOY (Fase 6, paso 6.0.2; ver docs/medicion-espacio-del-producto-2026-10-21.md). No mide tiempo ni rendimiento: mide
 * cuánto camino pide cada tarea, para que el bloque 2 (el espacio del producto) demuestre que no empeora (umbral del dueño: «no peor que hoy» en pantallas y clics, y 0 salidas del espacio en
 * las tareas de opciones y de publicar). Por ahora SOLO AFIRMA que cada tarea terminó bien; los umbrales se afirman en 6.21, cuando esta spec se reescriba con los recorridos nuevos.
 *
 * LAS CUATRO TAREAS (cada una arranca en una pantalla de partida y se recorre solo con clics y campos, sin escribir una URL a mitad de camino)
 *  a) Crear un producto DIRECTO hasta que quede vendible. Parte de la lista de productos. Hoy «directo o base» es «¿Cómo se vende?», que existe SOLO al editar (el alta nace directa): elegir
 *     «directo» no cuesta nada.
 *  b) Crear una base configurable: un grupo «Tamaño» con precio final en cada una de 3 opciones, un grupo «Incluida sin costo» con una opción, un producto nuevo que los admite y pasarlo a
 *     «Por opción» en «¿Cómo se vende?» (con la clave `producto_campos_sensibles`). Parte de «Opciones de venta».
 *  c) Cambiar el precio final de una opción de una base ya armada. Parte de la ficha del producto (sembrado).
 *  d) Publicar el producto en la carta («Fuera de carta» → «Agregar a la carta» → sección). Parte de la ficha del producto (sembrado).
 *
 * QUÉ SE CUENTA (el medidor `Medidor`, abajo; todo a 1280 px de ancho, el menú lateral a la vista)
 *  - PANTALLAS: rutas distintas visitadas. Un `framenavigated` del marco principal cuenta cuando CAMBIA el path; el mismo path con otra query (`?nivel=…`, `?guardado=…`) o un refresco no cuentan.
 *    El id de un grupo, un producto o un usuario se normaliza a `[id]`: «/catalogo/opciones/<id>» es una sola pantalla aunque se abran dos grupos. `visitas` cuenta los cambios de path tal cual
 *    (con repetidas) y `secuencia` las lista. La pantalla de partida cuenta.
 *  - CLICS: solo los que da el ayudante `clic` (envuelve `locator.click`) y `marcar` (un radio o una casilla, que es un clic). Llegar a la pantalla de partida con `ir` NO es un clic. Para llegar
 *    por el menú (`irPorElMenu`) se cuentan TODOS los clics que hagan falta (el panel Empresa/Sucursal y el grupo del menú, si están cerrados, y el enlace).
 *  - CAMPOS TOCADOS: los que tocan `llenar` (escribir) y `elegir` (un `<select>`), y `marcar` (un radio o una casilla cuenta como clic Y como campo). Los campos que quedan como vienen no cuentan.
 *  - SALIDAS DEL ESPACIO (tareas b, c y d; en la a es null): cuántas veces hay que dejar la pantalla de la tarea para ir a otra pantalla DISTINTA de administración. Hoy se cuenta como las pantallas
 *    distintas menos 1 (la de partida no es una salida). En el espacio del producto (bloque 2), todo lo del producto pasa a ser un paso del mismo espacio y el número tiene que ser 0.
 *
 * JSON DE LA MEDICIÓN: se escribe SOLO si existe la variable de entorno `MOTOR2_MEDICIONES`, y solo después de que la tarea terminó bien (una corrida rota no deja cifras).
 *  - Si el valor termina en `.json`, es UN archivo con el arreglo de las cuatro mediciones (se crea si no existe; cada tarea reemplaza su entrada por `tarea`).
 *  - Si no, es una CARPETA (se crea si no existe) y cada tarea escribe su archivo `<tarea>.json`.
 *  Cada medición es `{ tarea, pantallas, rutas, clics, campos, salidas, visitas, secuencia }`. Sin la variable, la spec solo afirma y no escribe nada.
 *  Ejemplo: MOTOR2_MEDICIONES=$S/mediciones/antes.json node scripts/operaciones/con-env.mjs $S/env-lb-e2e -- npx playwright test medicion-tareas-del-producto
 *
 * DATOS: todo lleva una marca única en el nombre (la base e2e es compartida y se vacía entera al empezar cada corrida). Las tablas de opciones solo se agregan (ver `fixtures/opciones.ts`): lo que
 * sembramos o creamos de opciones no se borra al terminar. La tarea d borra lo que ella misma crea de la carta (el contenido y la sección propia) para no tocar a las otras specs de la carta.
 *
 * MUTACIONES A SOBREVIVIR A MANO (no corren en CI, esta spec no se corre sola en el gate; se hacen una vez al correrla por primera vez y se deshacen):
 *  1) Cambiar el selector de un paso (p. ej. en la tarea c, el rótulo `Precio de Napolitana en este producto` por `Precio de Napolitano en este producto`) → esa tarea tiene que FALLAR con el
 *     mensaje «[medición c-cambiar-precio-final] no se pudo «…»: …» que nombra el paso, y no escribir ningún JSON.
 *  2) Sacar un clic de una tarea (p. ej. quitar el `clic` de «+ Agregar opción» en la tarea b, o el de «Visibilidad» en la d, dejando el paso que sigue sin su pantalla) → o falla con el mismo
 *     mensaje, o, si el flujo sigue siendo válido, el número `clics` del JSON baja exactamente en uno.
 */

type Tarea = "a-producto-directo" | "b-base-configurable" | "c-cambiar-precio-final" | "d-publicar-en-la-carta";

interface Medicion {
  tarea: Tarea;
  pantallas: number;
  rutas: string[];
  clics: number;
  campos: number;
  /** null en la tarea a (no aplica). */
  salidas: number | null;
  visitas: number;
  secuencia: string[];
}

/** El id de un grupo, un producto o un usuario (cuid, UUID o similar: 20 caracteres o más con algún dígito) pasa a `[id]`, para contar pantallas y no registros. */
function normalizarRuta(path: string): string {
  const segmentos = path
    .split("/")
    .filter((s) => s !== "")
    .map((s) => (/^[a-z0-9_-]{20,}$/i.test(s) && /\d/.test(s) ? "[id]" : s));
  return `/${segmentos.join("/")}`;
}

/** Dónde queda un enlace del menú lateral, para abrir lo que haga falta (y contar esos clics) cuando no está a la vista. */
interface DestinoDelMenu {
  href: string;
  /** El panel del menú donde vive; `ambos` si está en los dos. */
  panel: "empresa" | "sucursal" | "ambos";
  /** El rótulo del grupo del menú que lo contiene. */
  grupo: string;
}

class Medidor {
  clics = 0;
  campos = 0;
  private readonly secuencia: string[] = [];
  private ultimoPath: string | null = null;

  constructor(
    readonly page: Page,
    readonly tarea: Tarea,
  ) {
    page.on("framenavigated", (marco) => {
      if (marco !== page.mainFrame()) return;
      const url = new URL(marco.url());
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      // El mismo path con otra query (o un refresco) no es otra pantalla.
      if (url.pathname === this.ultimoPath) return;
      this.ultimoPath = url.pathname;
      this.secuencia.push(normalizarRuta(url.pathname));
    });
  }

  /** Cada paso con su nombre: si falla, el mensaje dice qué paso de qué tarea (y por qué) en vez de un selector suelto. */
  async paso<T>(descripcion: string, hacer: () => Promise<T>): Promise<T> {
    try {
      return await hacer();
    } catch (error) {
      const motivo = error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error);
      throw new Error(`[medición ${this.tarea}] no se pudo «${descripcion}»: ${motivo}`, { cause: error });
    }
  }

  /** Llega a la pantalla de partida: cuenta como pantalla, no como clic. */
  async ir(url: string, descripcion: string): Promise<void> {
    await this.paso(descripcion, () => this.page.goto(url).then(() => undefined));
  }

  async clic(locator: Locator, descripcion: string): Promise<void> {
    await this.paso(descripcion, () => locator.click());
    this.clics++;
  }

  async llenar(locator: Locator, valor: string, descripcion: string): Promise<void> {
    await this.paso(descripcion, () => locator.fill(valor));
    this.campos++;
  }

  async elegir(locator: Locator, opcion: string, descripcion: string): Promise<void> {
    await this.paso(descripcion, () => locator.selectOption({ label: opcion }).then(() => undefined));
    this.campos++;
  }

  /** Un radio o una casilla: es un clic y es un campo tocado. */
  async marcar(locator: Locator, descripcion: string): Promise<void> {
    await this.paso(descripcion, () => locator.check());
    this.clics++;
    this.campos++;
  }

  /** Una espera sobre lo que tiene que verse (no cuenta nada): el paso queda nombrado si no se cumple. */
  async ver(descripcion: string, comprobar: () => Promise<void>): Promise<void> {
    await this.paso(descripcion, comprobar);
  }

  /** Va a una pantalla por el menú lateral. Si el enlace no está a la vista abre el panel y el grupo que falten, y todos esos clics cuentan. */
  async irPorElMenu(destino: DestinoDelMenu): Promise<void> {
    const { page } = this;
    const enlace = page.locator(`nav a[href="${destino.href}"]:visible`).first();
    if ((await enlace.count()) === 0 && destino.panel !== "ambos") {
      const boton = page.getByRole("group", { name: "Panel del menú" }).getByRole("button", { name: destino.panel === "empresa" ? "Empresa" : "Sucursal", exact: true });
      if ((await boton.count()) > 0 && (await boton.getAttribute("aria-pressed")) !== "true") await this.clic(boton, `abrir el panel «${destino.panel}» del menú`);
    }
    if ((await enlace.count()) === 0) {
      await this.clic(page.locator("nav button", { hasText: destino.grupo }).first(), `abrir el grupo «${destino.grupo}» del menú`);
    }
    await this.clic(enlace, `ir por el menú a ${destino.href}`);
  }

  resultado(conSalidas: boolean): Medicion {
    const rutas = [...new Set(this.secuencia)];
    return {
      tarea: this.tarea,
      pantallas: rutas.length,
      rutas,
      clics: this.clics,
      campos: this.campos,
      salidas: conSalidas ? rutas.length - 1 : null,
      visitas: this.secuencia.length,
      secuencia: [...this.secuencia],
    };
  }
}

/** Escribe la medición en `MOTOR2_MEDICIONES` (archivo `.json` con el arreglo de las cuatro, o carpeta con un archivo por tarea); sin la variable no hace nada. */
function guardarMedicion(medicion: Medicion): void {
  const destino = process.env.MOTOR2_MEDICIONES;
  if (!destino) return;
  if (destino.endsWith(".json")) {
    mkdirSync(dirname(destino), { recursive: true });
    let previas: Medicion[] = [];
    try {
      previas = JSON.parse(readFileSync(destino, "utf8")) as Medicion[];
    } catch (error) {
      // Sin archivo todavía (primera tarea de la corrida): se empieza uno nuevo. Cualquier otra falla (un JSON roto) se dice, no se pisa en silencio.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const resto = previas.filter((p) => p.tarea !== medicion.tarea);
    writeFileSync(destino, `${JSON.stringify([...resto, medicion].sort((x, y) => x.tarea.localeCompare(y.tarea)), null, 2)}\n`);
    return;
  }
  mkdirSync(destino, { recursive: true });
  writeFileSync(join(destino, `${medicion.tarea}.json`), `${JSON.stringify(medicion, null, 2)}\n`);
}

const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

const MENU_PRODUCTOS: DestinoDelMenu = { href: "/catalogo/productos", panel: "ambos", grupo: "Catálogo" };
const MENU_CARTA: DestinoDelMenu = { href: "/carta", panel: "sucursal", grupo: "Carta" };

/** Una base ya armada para las tareas c y d: un producto «Por opción» con un grupo «Tamaño» de 3 opciones, cada una con su precio final. */
async function sembrarBase(sucursalId: string, m: string) {
  const nombreGrupo = `Medición Tipos ${m}`;
  const grupo = await sembrarGrupo({
    nombre: nombreGrupo,
    tipo: "MEDIDA",
    cantidadMinima: 1,
    cantidadMaxima: 1,
    marca: m,
    opciones: [{ nombre: "Simple" }, { nombre: "Napolitana" }, { nombre: "Especial" }],
  });
  const nombre = `Medición Milanesas ${m}`;
  const { productoId } = await sembrarProductoConOpciones({
    nombre,
    codigo: `E2E-MED-${m}`,
    precioVenta: 18000,
    sucursalId,
    grupos: [{ grupo, modoPrecio: "ABSOLUTO", preciosAbsolutos: { Simple: 18000, Napolitana: 22000, Especial: 25000 } }],
  });
  await prisma.producto.update({ where: { id: productoId }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });
  return { productoId, nombre, nombreGrupo, grupo };
}

test.describe("medición «antes» de las tareas del producto (pantallas de hoy)", () => {
  test.beforeEach(async ({ paginaAutenticada: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("a) crear un producto directo hasta que quede vendible", async ({ paginaAutenticada: page, sucursalId }) => {
    const m = new Medidor(page, "a-producto-directo");
    const nombre = `Medición Directo ${marca()}`;

    await m.ir("/catalogo/productos", "abrir la lista de productos");
    await m.clic(page.getByRole("link", { name: "+ Nuevo producto" }), "tocar «+ Nuevo producto»");
    await m.ver("se abre el alta", () => expect(page.getByRole("heading", { name: "Nuevo producto", level: 1 })).toBeVisible());
    await m.marcar(page.getByRole("radio", { name: "Producto de venta (PV)" }), "elegir «Producto de venta (PV)»");
    await m.llenar(page.locator('input[name="nombre"]'), nombre, "escribir el nombre");
    await m.elegir(page.getByLabel("Unidad de stock", { exact: true }), "unidad", "elegir la unidad de stock");
    await m.llenar(page.getByRole("textbox", { name: "Precio de venta" }), "4500", "escribir el precio de venta");
    await m.clic(page.getByRole("button", { name: "Crear producto" }), "tocar «Crear producto»");
    await m.ver("se llega a la ficha del producto creado", () => expect(page).toHaveURL(/\/catalogo\/productos\/[^/?]+\?guardado=alta/));
    await m.ver("la ficha dice que está disponible en la sucursal", () => expect(page.getByText(/Disponible en «/)).toBeVisible());

    const medicion = m.resultado(false);
    // Vendible = producto de venta, directo, con precio y disponible en la sucursal activa.
    const producto = await prisma.producto.findFirstOrThrow({ where: { nombre }, select: { id: true, tipo: true, modoDeVenta: true, precioVenta: true } });
    expect({ tipo: producto.tipo, modoDeVenta: producto.modoDeVenta, precioVenta: Number(producto.precioVenta) }).toEqual({ tipo: "PV", modoDeVenta: "DIRECTO", precioVenta: 4500 });
    const disponibilidad = await prisma.disponibilidadProducto.findUniqueOrThrow({ where: { sucursalId_productoId: { sucursalId, productoId: producto.id } } });
    expect(disponibilidad.disponible, "el producto quedó disponible en la sucursal").toBe(true);
    guardarMedicion(medicion);
  });

  test("b) crear una base configurable con un grupo de precio final de 3 opciones y una opción incluida", async ({ paginaAutenticada: page }) => {
    test.setTimeout(180_000);
    const m = new Medidor(page, "b-base-configurable");
    const marcaUnica = marca();
    const grupoTamano = `Medición Tipos ${marcaUnica}`;
    const grupoIncluida = `Medición Incluida ${marcaUnica}`;
    const producto = `Medición Base ${marcaUnica}`;
    const tamanos: [string, string][] = [
      ["Simple", "18000"],
      ["Napolitana", "22000"],
      ["Especial", "25000"],
    ];
    const grupoNuevo = async (nombre: string, tipo: RegExp) => {
      await m.clic(page.getByRole("button", { name: "+ Nuevo grupo", exact: true }), "tocar «+ Nuevo grupo»");
      await m.llenar(page.getByLabel("Nombre del grupo"), nombre, `escribir el nombre del grupo «${nombre}»`);
      await m.marcar(page.getByRole("radio", { name: tipo }), `elegir el tipo del grupo «${nombre}»`);
      await m.clic(page.getByRole("button", { name: "Crear grupo", exact: true }), "tocar «Crear grupo»");
      await m.ver(`el grupo «${nombre}» aparece en la lista`, () => expect(page.getByRole("link", { name: nombre, exact: true }).first()).toBeVisible());
      await m.clic(page.getByRole("link", { name: nombre, exact: true }).first(), `abrir el grupo «${nombre}»`);
      await m.ver("se abre el grupo", () => expect(page.getByRole("heading", { name: nombre, level: 1 })).toBeVisible());
      await m.clic(page.getByRole("button", { name: "+ Agregar opción", exact: true }), "tocar «+ Agregar opción»");
    };

    // 1) El grupo de tamaños, con sus 3 opciones (el precio final de cada una se carga después, en el producto).
    await m.ir("/catalogo/opciones", "abrir «Opciones de venta»");
    await grupoNuevo(grupoTamano, /^Tamaño/);
    for (const [nombre] of tamanos) {
      await m.llenar(page.getByLabel("Nombre de la opción"), nombre, `escribir la opción «${nombre}»`);
      await m.llenar(page.getByLabel("Diferencia en pesos"), "0", `escribir la diferencia de «${nombre}»`);
      await m.clic(page.getByRole("button", { name: "Agregar opción", exact: true }), `tocar «Agregar opción» (${nombre})`);
      await m.ver(`«${nombre}» queda en el grupo`, () => expect(page.locator(`[data-opcion='${nombre}']`)).toBeVisible());
    }

    // 2) El grupo de lo incluido, con su única opción.
    await m.clic(page.getByRole("link", { name: "← Opciones de venta" }), "volver a «Opciones de venta»");
    await m.ver("se vuelve a la lista de grupos", () => expect(page).toHaveURL(/\/catalogo\/opciones$/));
    await grupoNuevo(grupoIncluida, /^Incluida sin costo/);
    await m.llenar(page.getByLabel("Nombre de la opción"), "Con papas fritas", "escribir la opción incluida");
    await m.clic(page.getByRole("button", { name: "Agregar opción", exact: true }), "tocar «Agregar opción» (incluida)");
    await m.ver("la opción incluida queda en el grupo", () => expect(page.locator("[data-opcion='Con papas fritas']")).toBeVisible());

    // 3) El producto.
    await m.irPorElMenu(MENU_PRODUCTOS);
    await m.clic(page.getByRole("link", { name: "+ Nuevo producto" }), "tocar «+ Nuevo producto»");
    await m.marcar(page.getByRole("radio", { name: "Producto de venta (PV)" }), "elegir «Producto de venta (PV)»");
    await m.llenar(page.locator('input[name="nombre"]'), producto, "escribir el nombre del producto");
    await m.elegir(page.getByLabel("Unidad de stock", { exact: true }), "unidad", "elegir la unidad de stock");
    await m.llenar(page.getByRole("textbox", { name: "Precio de venta" }), "18000", "escribir el precio de venta");
    await m.clic(page.getByRole("button", { name: "Crear producto" }), "tocar «Crear producto»");
    await m.ver("se llega a la ficha del producto", () => expect(page).toHaveURL(/\/catalogo\/productos\/[^/?]+\?guardado=alta/));

    // 4) Los grupos en el producto: el de tamaños con el precio final de cada opción, y el de lo incluido.
    await m.clic(page.getByRole("link", { name: "Editar opciones" }), "tocar «Editar opciones»");
    await m.ver("se abren las opciones de venta del producto", () => expect(page.getByRole("heading", { level: 1 })).toContainText("Opciones de venta de"));
    const selectorDeGrupo = page.getByLabel("Grupo", { exact: true });
    await m.elegir(selectorDeGrupo, `${grupoTamano} (Tamaño)`, "elegir el grupo de tamaños");
    await m.clic(page.getByRole("button", { name: "Agregar", exact: true }), "tocar «Agregar» (tamaños)");
    const tarjetaTamanos = page.locator(`[data-admision-grupo='${grupoTamano}']`);
    await m.ver("el grupo de tamaños queda en el producto", () => expect(tarjetaTamanos).toBeVisible());
    await m.marcar(tarjetaTamanos.getByRole("radio", { name: "Precio propio por tamaño" }), "elegir «Precio propio por tamaño»");
    for (const [nombre, precio] of tamanos) {
      await m.llenar(tarjetaTamanos.getByLabel(`Precio de ${nombre} en este producto`), precio, `escribir el precio final de «${nombre}»`);
    }
    await m.clic(tarjetaTamanos.getByRole("button", { name: `Guardar «${grupoTamano}»` }), "tocar «Guardar» del grupo de tamaños");
    await m.ver("se guardó el grupo de tamaños", () => expect(tarjetaTamanos.getByRole("status").filter({ hasText: "como pediste" })).toBeVisible());
    await m.elegir(selectorDeGrupo, `${grupoIncluida} (Incluida sin costo)`, "elegir el grupo de lo incluido");
    await m.clic(page.getByRole("button", { name: "Agregar", exact: true }), "tocar «Agregar» (incluida)");
    await m.ver("el grupo de lo incluido queda en el producto", () => expect(page.locator(`[data-admision-grupo='${grupoIncluida}']`)).toBeVisible());

    // 5) Pasarlo a «Por opción».
    await m.clic(page.getByRole("link", { name: `← ${producto}` }), "volver a la ficha del producto");
    await m.clic(page.getByRole("link", { name: "Editar", exact: true }), "tocar «Editar»");
    await m.ver("se abre la edición", () => expect(page.getByText(`Editar "${producto}"`)).toBeVisible());
    await m.marcar(page.getByRole("group", { name: "¿Cómo se vende?" }).getByRole("radio", { name: /Por opción/ }), "elegir «Por opción»");
    await m.clic(page.getByRole("button", { name: "Guardar cambios" }), "tocar «Guardar cambios»");
    await m.ver("se llega a la ficha ya como base", () => expect(page).toHaveURL(/\/catalogo\/productos\/[^/?]+\?guardado=cambios/));
    await m.ver("la ficha dice «Se vende por opción»", () => expect(page.locator("[data-se-vende-por-opcion]")).toBeVisible());

    const medicion = m.resultado(true);
    const guardado = await prisma.producto.findFirstOrThrow({ where: { nombre: producto }, select: { id: true, modoDeVenta: true } });
    expect(guardado.modoDeVenta).toBe("BASE_CONFIGURABLE");
    const grupos = await prisma.productoAdmiteGrupo.findMany({ where: { productoId: guardado.id, activo: true }, select: { modoPrecio: true, grupo: { select: { nombre: true, tipo: true } } } });
    expect(grupos.map((g) => [g.grupo.nombre, g.grupo.tipo, g.modoPrecio]).sort()).toEqual(
      [
        [grupoIncluida, "INCLUIDA", null],
        [grupoTamano, "MEDIDA", "ABSOLUTO"],
      ].sort(),
    );
    const precios = await prisma.productoAdmiteOpcion.findMany({ where: { productoId: guardado.id, activo: true, opcion: { grupo: { nombre: grupoTamano } } }, select: { precioAbsoluto: true, opcion: { select: { nombre: true } } } });
    expect(precios.map((p) => [p.opcion.nombre, Number(p.precioAbsoluto)]).sort()).toEqual(tamanos.map(([nombre, precio]) => [nombre, Number(precio)]).sort());
    const incluidas = await prisma.productoAdmiteOpcion.count({ where: { productoId: guardado.id, activo: true, opcion: { grupo: { nombre: grupoIncluida } } } });
    expect(incluidas, "la opción incluida quedó admitida").toBe(1);
    guardarMedicion(medicion);
  });

  test("c) cambiar el precio final de una opción", async ({ paginaAutenticada: page, sucursalId }) => {
    const m = new Medidor(page, "c-cambiar-precio-final");
    const base = await sembrarBase(sucursalId, marca());
    const opcionId = base.grupo.opciones["Napolitana"]!.opcionId;

    await m.ir(`/catalogo/productos/${base.productoId}`, "abrir la ficha del producto");
    await m.ver("la ficha es la del producto", () => expect(page.getByRole("heading", { name: base.nombre, level: 1 })).toBeVisible());
    await m.clic(page.getByRole("link", { name: "Editar opciones" }), "tocar «Editar opciones»");
    await m.ver("se abren las opciones de venta del producto", () => expect(page.getByRole("heading", { level: 1 })).toContainText("Opciones de venta de"));
    const tarjeta = page.locator(`[data-admision-grupo='${base.nombreGrupo}']`);
    await m.llenar(tarjeta.getByLabel("Precio de Napolitana en este producto"), "23500", "escribir el precio nuevo de «Napolitana»");
    await m.clic(tarjeta.getByRole("button", { name: `Guardar «${base.nombreGrupo}»` }), "tocar «Guardar» del grupo");
    await m.ver("se guardó el grupo", () => expect(tarjeta.getByRole("status").filter({ hasText: "como pediste" })).toBeVisible());
    await m.ver("el precio nuevo se ve en «Así se cobra»", () => expect(page.locator("[data-resumen-de-opciones]")).toContainText("Napolitana $ 23.500"));

    const medicion = m.resultado(true);
    const fila = await prisma.productoAdmiteOpcion.findUniqueOrThrow({ where: { productoId_opcionId: { productoId: base.productoId, opcionId } } });
    expect(Number(fila.precioAbsoluto), "el precio final nuevo quedó guardado").toBe(23500);
    const otras = await prisma.productoAdmiteOpcion.findMany({ where: { productoId: base.productoId, NOT: { opcionId } }, select: { precioAbsoluto: true } });
    expect(otras.map((o) => Number(o.precioAbsoluto)).sort(), "las otras opciones siguen igual").toEqual([18000, 25000]);
    guardarMedicion(medicion);
  });

  test("d) publicar el producto en la carta", async ({ paginaAutenticada: page, sucursalId }) => {
    const m = new Medidor(page, "d-publicar-en-la-carta");
    const marcaUnica = marca();
    const base = await sembrarBase(sucursalId, marcaUnica);
    const seccion = await prisma.seccionCarta.create({ data: { nombre: `Medición Sección ${marcaUnica}`, orden: 900 } });
    try {
      await m.ir(`/catalogo/productos/${base.productoId}`, "abrir la ficha del producto");
      await m.ver("la ficha es la del producto", () => expect(page.getByRole("heading", { name: base.nombre, level: 1 })).toBeVisible());
      await m.irPorElMenu(MENU_CARTA);
      await m.ver("se abre la carta", () => expect(page.getByRole("heading", { name: "Carta", level: 1 })).toBeVisible());
      await m.clic(page.getByRole("button", { name: "Visibilidad", exact: true }), "tocar «Visibilidad»");
      await m.ver("se abre «Visibilidad»", () => expect(page).toHaveURL(/nivel=visibilidad/));
      const fuera = page.locator("[data-fuera-de-carta]");
      await m.clic(fuera.locator("> summary"), "abrir «Fuera de carta»");
      await m.llenar(fuera.getByRole("searchbox", { name: "Buscar en «Fuera de carta»" }), base.nombre, "buscar el producto en «Fuera de carta»");
      const producto = fuera.locator(`[data-fuera-de-carta-producto="${base.nombre}"]`);
      await m.clic(producto.getByRole("button", { name: `${base.nombre}: Agregar a la carta` }), "tocar «Agregar a la carta»");
      await m.clic(producto.getByRole("button", { name: seccion.nombre, exact: true }), "elegir la sección de la carta");
      await m.ver("el aviso dice que ya sale en la carta", () => expect(page.locator("[data-aviso-carta]").locator("> span")).toHaveText(`«${base.nombre}» ya sale en la carta, al final de «${seccion.nombre}».`));

      const medicion = m.resultado(true);
      const contenido = await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { sucursalId_productoId: { sucursalId, productoId: base.productoId } } });
      expect({ visibleEnCarta: contenido.visibleEnCarta, seccionCartaId: contenido.seccionCartaId }).toEqual({ visibleEnCarta: true, seccionCartaId: seccion.id });
      guardarMedicion(medicion);
    } finally {
      // Lo de la carta se limpia (como hacen las otras specs de la carta); el producto y sus opciones se quedan, como en las demás specs de opciones.
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: base.productoId } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    }
  });
});
