/**
 * Activa y desactiva módulos vendibles de una empresa (ADR-011/ADR-014/ADR-015). La lógica vive en `src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa.ts`
 * (valida la clausura, transaccional, con auditoría, testeada); esto solo lee los argumentos. Es la ÚNICA vía para cambiar el registro desde la línea de comandos: ninguna pantalla
 * de la app lo hace, y la base solo deja escribirlo al dueño y a `motor2_plataforma` (la consola de plataforma lo hace con su propia pantalla).
 *
 * Uso: npm run modulos-empresa -- --slug norte --actor operador@plataforma.com [--instalacion zuluhub] [--activar stock,compras] [--desactivar salon]
 *
 * Los módulos se nombran por su id del catálogo (`stock`, `compras`, `traspasos`, `consignacion`, `recetas`, `produccion`, `carta`, `promociones`, `salon`).
 * Activar uno trae solo lo que requiere (Salón trae Stock); desactivar uno que otro activo requiere se rechaza.
 *
 * Conexión (ADR-025): con `--instalacion <id>`, esa instalación de `PLATAFORMA_INSTALACIONES_ADICIONALES` (o la principal); sin el flag, si el archivo de
 * entorno administra varias instalaciones hay que elegir una (no cae en la principal en silencio); sin el flag y sin instalaciones adicionales, el
 * comportamiento de siempre: PLATAFORMA_DATABASE_URL (sin ella falla: no cae en la conexión de la app, S-33). La conexión tiene que ser del rol `motor2_plataforma` (se comprueba con
 * `select current_user`).
 *
 * `--actor` es el email de un administrador de plataforma ACTIVO (`AdminPlataforma`, S-33): se verifica contra la base de identidad de la consola (la instalación principal). NO tiene que
 * ser un usuario de la app ni se crea ninguno. El cambio queda en la auditoría de PLATAFORMA (`AuditoriaPlataforma`, con la instalación), no en el registro de auditoría de la empresa.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { ConexionDePlataformaError, describirConexion } from "./conexion-de-plataforma";
import { abrirContextoDePlataforma, type ContextoDePlataforma } from "./contexto-de-plataforma";
import { ModulosDeEmpresaError } from "../src/core/features/empresa/cambio-de-modulos";
import { cambiarModulosDeEmpresa } from "../src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa";
import { ActorDePlataformaError } from "../src/server/operaciones-de-plataforma/requerir-admin-de-plataforma";

function lista(valor: string | undefined): string[] {
  return (valor ?? "").split(",").map((m) => m.trim()).filter(Boolean);
}

let contexto: ContextoDePlataforma | undefined;

async function main() {
  const { values } = parseArgs({
    options: { slug: { type: "string" }, actor: { type: "string" }, instalacion: { type: "string" }, activar: { type: "string" }, desactivar: { type: "string" } },
    strict: true,
  });
  if (!values.slug || !values.actor) throw new ModulosDeEmpresaError("Faltan --slug y --actor (el email del administrador de plataforma que hace el cambio).");

  // La conexión, el rol y el actor (un AdminPlataforma activo de la base de identidad) quedan resueltos ANTES de la operación.
  contexto = await abrirContextoDePlataforma(process.env, { instalacion: values.instalacion, actor: values.actor });
  console.log(`Instalación: ${describirConexion(contexto.conexion)}. Actor: ${contexto.autor.adminEmail}.`);

  const resultado = await cambiarModulosDeEmpresa(contexto.db, { slug: values.slug, activar: lista(values.activar), desactivar: lista(values.desactivar) }, contexto.autor);

  const cambios = resultado.cambiados.map((c) => `${c.modulo}: ${c.antes ?? "sin fila"} → ${c.despues}`);
  console.log(
    cambios.length === 0
      ? `Sin cambios: la empresa "${values.slug}" ya estaba así.`
      : `Empresa "${values.slug}" actualizada (${cambios.join("; ")}). Quedó en la auditoría de plataforma (no en el registro de la empresa).`,
  );
  console.log(`Vendibles activos: ${resultado.activos.join(", ") || "ninguno"}.`);
  console.log(`La empresa cuenta con: ${resultado.efectivos.join(", ")}.`);
}

main()
  .catch((error: unknown) => {
    if (error instanceof ModulosDeEmpresaError || error instanceof ConexionDePlataformaError || error instanceof ActorDePlataformaError) console.error(`Error: ${error.message}`);
    else console.error(error);
    process.exitCode = 1;
  })
  .finally(() => contexto?.cerrar());
