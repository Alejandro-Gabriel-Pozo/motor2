/**
 * Planes versionados de la plataforma (frente 4, M1). La lógica vive en `src/server/operaciones-de-plataforma/planes.ts` (transaccional, con auditoría, testeada); esto solo lee los argumentos. Es la ÚNICA vía
 * para operar planes: ninguna pantalla de la app ni de la consola lo hace todavía (la pantalla es M2).
 *
 * Uso (cada comando necesita --actor, el email de un administrador de plataforma ACTIVO, y el código de 6 dígitos de su app de autenticación: ver `scripts/politica-empresa.ts`):
 *   npm run plan-de-plataforma -- crear     --codigo basico --nombre "Básico" --modulos stock,compras --actor yo@plataforma.com [--clave <uuid>] [--instalacion zuluhub]
 *   npm run plan-de-plataforma -- borrador  --codigo basico --nombre "Básico" --modulos stock,compras,carta --actor … [--clave <uuid>]
 *   npm run plan-de-plataforma -- publicar  --codigo basico --numero 1 --motivo "Primera versión" --actor …
 *   npm run plan-de-plataforma -- asignar   --slug norte --codigo basico --version 1 --motivo "Contrato nuevo" --actor … [--clave <uuid>]
 *
 * `--clave` es la clave de reintento (un UUID): si el comando se corta o se repite, volver a correrlo con la MISMA clave devuelve lo ya hecho y no duplica nada. Sin `--clave` se genera una y se IMPRIME
 * (guardala si querés poder reintentar). `publicar --numero` es el número que esperás para la versión (la última publicada + 1): si otra persona publicó antes, falla sin pisar nada.
 * En M1 el plan NO se aplica todavía a lo que ven las empresas: `asignar` solo lo guarda y avisa qué módulos activos quedarían en solo lectura cuando se conecte (M1b).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { ConexionDePlataformaError, describirConexion } from "./conexion-de-plataforma";
import { abrirContextoDePlataforma, type ContextoDePlataforma } from "./contexto-de-plataforma";
import { PlanesError } from "../src/core/features/empresa/planes";
import { ActorDePlataformaError } from "../src/server/operaciones-de-plataforma/requerir-admin-de-plataforma";
import { asignarPlanAEmpresa, crearPlan, guardarBorradorDePlan, publicarVersionDePlan } from "../src/server/operaciones-de-plataforma/planes";

let contexto: ContextoDePlataforma | undefined;

function requerido(valor: string | undefined, opcion: string): string {
  if (!valor) throw new PlanesError(`Falta --${opcion}.`);
  return valor;
}

function entero(valor: string | undefined, opcion: string): number {
  const texto = requerido(valor, opcion);
  if (!/^[1-9][0-9]{0,8}$/.test(texto)) throw new PlanesError(`--${opcion} tiene que ser un entero desde 1 (llegó "${texto}").`);
  return Number(texto);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      actor: { type: "string" },
      instalacion: { type: "string" },
      clave: { type: "string" },
      codigo: { type: "string" },
      nombre: { type: "string" },
      modulos: { type: "string" },
      numero: { type: "string" },
      version: { type: "string" },
      slug: { type: "string" },
      motivo: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const comando = positionals[0];
  if (!comando || !["crear", "borrador", "publicar", "asignar"].includes(comando)) throw new PlanesError("Indicá el comando: crear, borrador, publicar o asignar.");
  if (!values.actor) throw new PlanesError("Falta --actor (el email del administrador de plataforma que hace el cambio).");
  const clave = values.clave ?? randomUUID();
  const modulos = (values.modulos ?? "").split(",").map((m) => m.trim()).filter((m) => m !== "");

  contexto = await abrirContextoDePlataforma(process.env, { instalacion: values.instalacion, actor: values.actor });
  console.log(`Instalación: ${describirConexion(contexto.conexion)}. Actor: ${contexto.autor.adminEmail}. Clave de reintento: ${clave}`);

  if (comando === "crear") {
    const r = await crearPlan(contexto.db, { clave, codigo: requerido(values.codigo, "codigo"), nombreComercial: requerido(values.nombre, "nombre"), modulos }, contexto.autor);
    console.log(r.creado ? `Plan "${values.codigo}" creado con su primer borrador (${modulos.join(", ") || "sin módulos"}).` : `Sin cambios: el plan "${values.codigo}" ya estaba creado con esa clave.`);
  } else if (comando === "borrador") {
    const r = await guardarBorradorDePlan(contexto.db, { clave, codigo: requerido(values.codigo, "codigo"), nombreComercial: requerido(values.nombre, "nombre"), modulos }, contexto.autor);
    console.log(r.cambiado ? `Borrador del plan "${values.codigo}" guardado.` : "Sin cambios: ese borrador ya estaba guardado con esa clave.");
  } else if (comando === "publicar") {
    const r = await publicarVersionDePlan(contexto.db, { codigo: requerido(values.codigo, "codigo"), numeroEsperado: entero(values.numero, "numero"), motivo: requerido(values.motivo, "motivo") }, contexto.autor);
    console.log(`Versión ${r.numero} del plan "${values.codigo}" publicada. Es inmutable: para cambiarla, guardá un borrador nuevo y publicalo.`);
  } else {
    const r = await asignarPlanAEmpresa(
      contexto.db,
      { clave, slug: requerido(values.slug, "slug"), codigoDePlan: requerido(values.codigo, "codigo"), numeroDeVersion: entero(values.version, "version"), motivo: requerido(values.motivo, "motivo") },
      contexto.autor,
    );
    const fuera = Object.keys(r.fueraDelTecho);
    console.log(r.asignado ? `Plan asignado a "${values.slug}" (asignación nº ${r.numero}).` : `Sin cambios: "${values.slug}" ya tenía esa versión (asignación nº ${r.numero}).`);
    if (fuera.length > 0) console.log(`Aviso: estos módulos activos de la empresa quedarían en SOLO LECTURA cuando el plan se conecte (M1b): ${fuera.join(", ")}. Hoy no cambia nada de lo que ven.`);
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof PlanesError || error instanceof ConexionDePlataformaError || error instanceof ActorDePlataformaError) console.error(`Error: ${error.message}`);
    else console.error(error);
    process.exitCode = 1;
  })
  .finally(() => contexto?.cerrar());
