import type { CategoriaProducto, Prisma } from "@prisma/client";
import { primerHostNoLocal } from "../../src/core/auth/hosts-de-conexion";

/**
 * Las ÚNICAS dos puertas por las que un test o un script de prueba crea o borra categorías (E1-0 de `docs/diseno-e1-arbol-de-categorias-niveles-6-10-2026-11-17.md`; H1 y H3 de
 * `docs/inventario-lectores-clasificacion-e1-2026-11-17.md`). Hoy la tabla es plana y esto es una envoltura sin cambio de comportamiento; existe para que la migración del árbol (E1-1)
 * se haga en UN lugar y no en ~45 sitios:
 *  - **Crear** (`crearCategoriaDeTest`): cuando la tabla exija `nombreClave`, este ayudante lo calcula con la función única de producción (`claveDeNombreDeCarta`); ningún test lo escribe a mano.
 *  - **Borrar** (`limpiarCategoriasDeTest`): las categorías no se borran en producción (se desactivan; dueño, 2026-11-17, «como pedernal»). La limpieza de las pruebas es un camino explícito y SOLO LOCAL:
 *    se NIEGA si la base a la que apuntan las variables de conexión no es la de esta máquina o si el proceso es de producción. Con el árbol (E1-1) borrará de las hojas hacia arriba (la FK autorreferente es RESTRICT).
 * Un guardián (`test/arquitectura/categoria-de-prueba-por-el-ayudante.test.ts`) falla si aparece `categoriaProducto.create/createMany/update/delete…` en un test o script fuera de este archivo.
 */

/** Lo único que estos ayudantes piden al cliente: el delegado de la tabla (sirve el cliente de los fixtures, el del dueño y el de los e2e). */
export interface ClienteConCategorias {
  categoriaProducto: {
    create(args: { data: Prisma.CategoriaProductoUncheckedCreateInput }): Promise<CategoriaProducto>;
    createMany(args: { data: Prisma.CategoriaProductoCreateManyInput[] }): Promise<{ count: number }>;
    deleteMany(args?: { where?: Prisma.CategoriaProductoWhereInput }): Promise<{ count: number }>;
  };
}

/** Crea una categoría de prueba. Devuelve la fila, igual que `create`. */
export async function crearCategoriaDeTest(cliente: ClienteConCategorias, datos: Prisma.CategoriaProductoUncheckedCreateInput): Promise<CategoriaProducto> {
  return cliente.categoriaProducto.create({ data: datos });
}

/** Crea varias categorías de prueba de una vez (ids fijos, como los escenarios de caracterización). */
export async function crearCategoriasDeTest(cliente: ClienteConCategorias, filas: Prisma.CategoriaProductoCreateManyInput[]): Promise<{ count: number }> {
  return cliente.categoriaProducto.createMany({ data: filas });
}

/** Variables que dicen a qué base se conecta este proceso (la de los tests de integración, la del dueño y la de los e2e). */
const VARIABLES_DE_CONEXION = ["DATABASE_URL", "DIRECT_URL", "MOTOR2_PRUEBAS_DATABASE_URL", "MOTOR2_E2E_DATABASE_URL", "MOTOR2_E2E_APP_DATABASE_URL"] as const;
const SERVIDORES_LOCALES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * ¿Es seguro borrar categorías desde acá? CIERRA ante la duda: hace falta al menos una variable de conexión y TODAS las definidas tienen que apuntar a esta máquina (servidor local o socket de unix);
 * un `NODE_ENV=production` lo niega siempre. Una URL ilegible niega. Función pura (recibe el entorno) para poder probarla.
 */
export function esBaseLocalParaLimpiar(entorno: Readonly<Record<string, string | undefined>>): boolean {
  if (entorno.NODE_ENV === "production") return false;
  const definidas = VARIABLES_DE_CONEXION.map((v) => entorno[v]).filter((v): v is string => typeof v === "string" && v !== "");
  if (definidas.length === 0) return false;
  return definidas.every((url) => {
    try {
      const u = new URL(url);
      // `postgresql:///base?host=/var/run/postgresql` (socket): sin servidor en la URL, el host va en el parámetro (y tiene que ser una ruta, sin `hostaddr`).
      if (u.hostname === "") {
        const hosts = u.searchParams.getAll("host");
        return hosts.length > 0 && hosts.every((h) => h.startsWith("/")) && u.searchParams.getAll("hostaddr").length === 0;
      }
      // GT-22 (M-29): se mira TODO host al que la conexión va de verdad (`host=`, `hostaddr=`, listas), no solo el `hostname` de la URL.
      return primerHostNoLocal(u, [...SERVIDORES_LOCALES]) === null;
    } catch {
      return false;
    }
  });
}

/**
 * Borra categorías de prueba (todas, o las que cumplan `donde`). SOLO LOCAL: se niega con un error si la base no es la de esta máquina. Hoy la tabla es plana; con el árbol (E1-1) borrará de las
 * hojas hacia arriba.
 */
export async function limpiarCategoriasDeTest(cliente: ClienteConCategorias, donde?: Prisma.CategoriaProductoWhereInput, entorno: Readonly<Record<string, string | undefined>> = process.env): Promise<number> {
  if (!esBaseLocalParaLimpiar(entorno)) {
    throw new Error("limpiarCategoriasDeTest se niega a borrar: la base de datos no es la de esta máquina (o el proceso es de producción). Las categorías no se borran fuera de las pruebas locales; en producción se desactivan.");
  }
  return (await cliente.categoriaProducto.deleteMany(donde ? { where: donde } : undefined)).count;
}
