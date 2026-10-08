import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Caracterizaciones congeladas (Hito 3, paso 0.1 de `docs/plan-hito-3-pureza.md`; O.33 de `docs/pureza-integracion.md`).
 *
 * Las huellas, goldens y la matriz de acceso son la red que prueba que mover el login y el gobierno (tramo B) no cambió NADA. La
 * auditoría de la Fase 3 (hallazgo 16) encontró que «la matriz de acceso quedó idéntica a lo largo de todo el tramo» no se podía
 * verificar: nada impedía regenerarla en el mismo commit que cambiaba el comportamiento y que el test siguiera verde. Este guardián
 * fija el CONTENIDO de cada archivo por su hash: regenerar un golden (con `REGENERAR_*=1`, `GOLDEN_ACTUALIZAR=1` o a mano) pone este
 * test en rojo hasta que se declara la regeneración abajo, con su commit y su motivo — un cambio deliberado queda escrito y a la
 * vista de la auditoría del hito; uno accidental no pasa.
 *
 * Hash: el sha1 de blob de git (`git hash-object`) del contenido NORMALIZADO A LF. Este equipo tiene `core.autocrlf=true` (el
 * archivo en disco puede tener CRLF y el blob de git LF), así que se normaliza antes de hashear: el valor coincide con
 * `git rev-parse <commit>:<ruta>` y se puede cruzar contra la historia (ver la evidencia de O.33 en la lista de control).
 *
 * Cómo se regenera a propósito: se suma una entrada a `regeneraciones` de la ruta con el blob NUEVO, el commit que la regenera y por
 * qué. El esperado es el blob de la última regeneración (o el de `blob` si no hubo ninguna). Nunca se edita `blob` ni se borra una
 * regeneración: es el registro.
 */
const RAIZ = join(__dirname, "../..");

interface Regeneracion {
  blob: string;
  commit: string;
  motivo: string;
}

interface Congelada {
  /** Blob de git del contenido vigente al congelarla (paso 0.1 del Hito 3). */
  blob: string;
  /** Commit desde el que el contenido es ese blob. */
  desde: string;
  motivo: string;
  regeneraciones: Regeneracion[];
}

const CONGELADAS: Record<string, Congelada> = {
  "test/permisos/caracterizacion/matriz-de-acceso.txt": {
    blob: "ef5427d015f9ba23c7d38b4120a28be11fce2b2a",
    desde: "01adabd9",
    motivo:
      "Matriz de acceso (3B.1). Idéntica en los 8 commits del tramo B de `origin/pureza-fase-3c-permisos` (01adabd9 a 7a2a3894) y en `main` desde la fusión 7cd594af (#76). F1 (3.4) NO la regenera.",
    regeneraciones: [
      {
        blob: "684138a1d1b209b5ab09755c856d6b3d96dc6a28",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, «S-12 (D8): el costo de consignacion (precio y consignante) solo lo ve y lo edita quien tiene pagar_consignante».
        // El commit que regenera es el de S-41 (fila O.90 de la lista de control, que lo cita por su hash).
        commit: "5c18eb8b",
        motivo:
          "S-41/D4 (O.90; CAMBIA COMPORTAMIENTO, plan de endurecimiento de seguridad T2): la semilla de `producto_sincronizar_precio_carta` pasa de [admin, operador] a [admin] (piso operario intacto: clase O, delegable por configuración). Cambia SOLO lo que dice esa clave para el usuario «operador» (y los roles que lo incluyen), en 18 líneas: 16 donde sale de `ok`/`ver=true editar=true`/`sucursalesDondeElUsuarioPuedeVer` y entra a los grupos de SIN_PERMISO/`ver=false editar=false`, en los 4 registros de módulos; y 2 mensajes de denegación del usuario «operador + especial», que nombran la primera clave que le falta (ahora esta, antes `insumo_renombrar_fusionar`). Ninguna respuesta de otra clave cambia (comprobado quitando la clave de ambas versiones: la única diferencia que queda son esos 2 mensajes).",
      },
    ],
  },
  "test/auth/caracterizacion/huella-de-login.golden.txt": {
    blob: "233ac7baa0d982f4e01a0b87776810955f85c9ed",
    desde: "c12a6b78",
    motivo: "Huella de `vincularCuentaConInvitacion` (1.1). Red de B3: el login no cambia.",
    regeneraciones: [],
  },
  "test/auth/caracterizacion/huella-de-alta-de-admin.golden.txt": {
    blob: "ed99f61991bcc3659993b75409878257d4e36fde",
    desde: "31459b18",
    motivo: "Huella de la alta de admin con azar inyectado (1.2).",
    regeneraciones: [],
  },
  "test/auth/caracterizacion/huella-de-gobierno.golden.txt": {
    blob: "1c0366bde31dabd25a3b773386ed978f9c7046fa",
    desde: "44f1909f",
    motivo: "Huella de gobierno (B0, #82). Red de la Fase I y la Fase II: las 16 mutaciones de auth y permisos no cambian.",
    regeneraciones: [
      {
        blob: "334d34b8a738cd073d463b708ce03941949749b6",
        // El commit PADRE de este (ver la entrada de la matriz de acceso).
        commit: "5c18eb8b",
        motivo:
          "S-41/D4 (O.90; CAMBIA COMPORTAMIENTO; REGENERACIÓN NO PREVISTA EN EL PLAN, consecuencia directa de la misma semilla, a revisar por el orquestador): la huella siembra los permisos de fábrica de las empresas que da de alta, así que el rol «operador» ya no recibe `producto_sincronizar_precio_carta`. Cambia SOLO 2 líneas, una por empresa sembrada: `PERMISO operador:producto_sincronizar_precio_carta ver=true editar=true` → `ver=false editar=false`. Ningún resultado, mensaje ni otra fila cambia.",
      },
    ],
  },
  "test/auth/caracterizacion/huella-de-aceptacion.golden.txt": {
    blob: "1e34981243c2d5807b4e0492bd05e92d024f356f",
    desde: "94011900",
    motivo:
      "Huella de aceptación (B3-1, O.34): aceptar gerente y aceptar usuario con todos sus rechazos (texto y orden), éxito y segundo uso. Red de B3: mudar las dos aceptaciones a casos de uso no cambia nada.",
    regeneraciones: [],
  },
  "test/movimientos/caracterizacion/venta-matriz.golden.txt": {
    blob: "5166de7e5b4db922c884b99e381dbfd52b3021b0",
    desde: "71050ded",
    motivo: "Matriz de la venta (7 escenarios vigentes).",
    regeneraciones: [],
  },
  "test/movimientos/caracterizacion/venta-matriz-ampliada.golden.txt": {
    blob: "01e01aab7058600ec0f662b1d63ff44840823e71",
    desde: "b7ec61b2",
    motivo:
      "Matriz de la venta ampliada (2.7). Regenerada dentro del Hito 2 antes de congelarla (0b8aa59b: golden sin ICU; b7ec61b2: FEFO del PV que se produce, O.40 1).",
    regeneraciones: [
      {
        blob: "f69bb57cc57c90eccdb333690f0fb284d37868c2",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, «S-02: anular una compra con lote exige que el saldo TOTAL del producto en la seccion la cubra».
        // El commit que regenera es el de S-03 (fila O.52 de la lista de control, que lo cita por su hash).
        commit: "48cc066a",
        motivo:
          "S-03/D7 (O.52; CAMBIA COMPORTAMIENTO, decidido por el dueño el 2026-10-08): anularVenta lee, antes de escribir, lo POSTERIOR a la venta (un CONTROL/AJUSTE del mismo producto y sección, y un pago al consignante de lo que consumió). Cambia SOLO la línea `lecturas` de los 5 pasos de anulación (las lecturas nuevas son `movimientoStock.findMany` ×1 y, si la venta consumió una MP en consignación, `producto.findMany` ×1 y `pagoConsignante.findMany` ×1); ni un resultado, ni una fila, ni una escritura, ni un mensaje cambian. Regeneración NO prevista en el plan de endurecimiento (decía que venta-matriz* no cambiaba): queda declarada para la revisión del orquestador.",
      },
    ],
  },
  "test/reportes/caracterizacion/reportes-c0.golden.txt": {
    blob: "ce02d51f612cd043f0b5b4d423472aaf226d75c2",
    desde: "0b08f2f4",
    motivo: "Caracterización C0 de los reportes (2.2): resultado y conteo de consultas. Regenerada en 0b08f2f4 (O.37-O.39: solo bajan los conteos).",
    regeneraciones: [
      {
        blob: "1a6b47514a6ec4c9f136674267eb7f94c01c4342",
        // Un commit no puede llevar su propio hash: es el commit HIJO de este, «Hito 4 (H4E2-2, O.38b D1): las líneas del período de N sucursales en una lectura».
        commit: "87d63d2d",
        motivo:
          "O.38b D1 (refactor, sin cambio de resultado): el Consolidado lee las líneas del período de todas las sucursales en UNA lectura. Cambia SOLO la línea de conteo de la entrada 35 (resumen-consolidado): 19 → 18 consultas, `movimientoStock.findMany` ×2 → ×1; el resultado y las demás entradas, byte a byte.",
      },
      {
        blob: "92ffb6b2e16eebc91581214f98325d48ff4715cf",
        // El commit HIJO de este, «Hito 4 (H4E2-3, O.38b D2): el costo de reposición de N sucursales en una consulta».
        commit: "ea7278f9",
        motivo:
          "O.38b D2 (refactor, sin cambio de resultado): el Consolidado lee el costo de reposición de todas las sucursales en UNA consulta. Cambia SOLO la línea de conteo de la entrada 35: 18 → 17 consultas, `$queryRaw` ×2 → ×1; el resultado y las demás entradas (que leen el costo de una sucursal con la misma implementación), byte a byte.",
      },
      {
        blob: "1b3a6bfeea63b685aa970d9b3dafdcbce8325f93",
        // El commit HIJO de este, «Hito 4 (H4E2-4, O.38b D3): la disponibilidad de N sucursales en una consulta».
        commit: "9d5d1adf",
        motivo:
          "O.38b D3 (refactor, sin cambio de resultado): el Consolidado lee la disponibilidad de todas las sucursales en UNA consulta. Cambia SOLO la línea de conteo de la entrada 35: 17 → 16 consultas (8 + 4N con N = 2), `disponibilidadProducto.findMany` ×2 → ×1; el resultado y las demás entradas, byte a byte.",
      },
    ],
  },
  "test/caracterizacion-tramo-a/lecturas-tramo-a.golden.json": {
    blob: "8e1e3e873cb7804aa9cc4245eb1fccd38d66fb3a",
    desde: "0b08f2f4",
    motivo: "Caracterización «.0» del tramo A (2.3). Regenerada en 0b08f2f4 (O.39: solo bajan los conteos).",
    regeneraciones: [],
  },
  "test/pos/caracterizacion/huella-del-pos.golden.txt": {
    blob: "8d2f170f6ee4f020fdd138e8388329a30ccf5687",
    desde: "f9e5a286",
    motivo:
      "Huella del POS (Hito 4, paso 0.1): las 10 Server Actions del POS sin caso de uso (apertura, mesas y pedido) como admin, mozo y operador, con los rechazos de dos fallas a la vez. Red de 4.1: mudar esas acciones a casos de uso no cambia nada (salvo lo aprobado: liberarMesa con ctx.ahora no cambia el golden, que solo dice si hay fecha).",
    regeneraciones: [],
  },
  "test/persistencia/__golden__/kardex-escritores.golden.json": {
    blob: "4ba48f056c55dbfc6c49ba4c8acac8adf67f9d1a",
    desde: "4af23e8b",
    motivo:
      "Huella de los escritores del Kardex (Hito 5, pieza 5.4, A2; O.13): cada escritura (modelo, operación, args con la presencia o ausencia de cada clave) y el estado final de Operacion, MovimientoStock y TraspasoSucursal en ocho casos (aprobación, envío directo, aceptación con y sin clave I3, reingreso, anulación de compra con y sin clave, anulación de venta). Red de A4 y A5: reunir las dos escrituras de traspasos y las dos de anulación en una función cada una no cambia NADA de lo que llega a la base.",
    regeneraciones: [],
  },
  "test/catalogo/caracterizacion/dinero-tramo-c.golden.txt": {
    blob: "ae6ec3b65f5c3bf20391493b64ebae0b036f7442",
    desde: "18bdd881",
    motivo:
      "Huella de dinero del tramo C (Hito 4, H4C-0.3): las 11 Server Actions de dinero de carta (4.2: descuento, promos, precio local, rendimiento local, volver a la receta central) y las de dinero de los bloques B y C (alta y edición de producto, sincronizar precio, presentaciones, unidades, clientes, margen objetivo), con filas tocadas, auditoría y cuántas veces revalidan o refrescan. Red de 4.2 y 4.3: mudar esas acciones a casos de uso no cambia nada.",
    regeneraciones: [
      {
        blob: "a19ca38907a4413b3e558c9cd28fa2e212d2b3de",
        // Un commit no puede llevar su propio hash: es el commit HIJO de este, «Hito 4 (H4D-1, O.42): editar una promo mira el piso de sus cupos».
        commit: "9d7463a5",
        motivo:
          "O.42 (CAMBIA COMPORTAMIENTO, aprobado por el dueño el 2026-10-08): editar una promo mira el piso de $0,01 por unidad del peor caso de sus cupos. Cambia SOLO el paso «precio de la empresa bajo el piso de sus cupos» (antes se guardaba $0,01 con su auditoría; ahora se rechaza con el mensaje del piso, sin filas ni auditoría ni revalidación) y su título, que describía el hallazgo.",
      },
      {
        blob: "77472200f27ebcf9dd07e64d47101ae689c65c25",
        // El commit HIJO de este, «Hito 4 (H4D-2, O.43): precio de carta sin forma de número dice que se use el punto».
        commit: "909ec0a5",
        motivo:
          "O.43 (cambia un texto, aprobado por el dueño el 2026-10-08; criterio conservador: la coma sigue sin aceptarse, el parseo no se toca): `validarPrecioCarta` dice «El precio no tiene un formato válido: usá el punto como separador decimal (por ejemplo, 12.5).» para lo que no tiene forma de número, en vez de «no puede ser negativo». Cambian SOLO los pasos «precio inválido» («abc») y «precio con coma» (su resultado y el título del segundo, que describía el hallazgo); ninguna fila ni efecto.",
      },
      {
        blob: "f7368038f92f4a65adfd93de60fdc75b74eb6035",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, «Lista de control: filas O.50 a O.52 (tanda T1 del endurecimiento de seguridad), con el hash de cada commit».
        // El commit que regenera es el de S-06 (fila O.55 de la lista de control, que lo cita por su hash).
        commit: "6038560b",
        motivo:
          "S-06 (O.55; CAMBIA COMPORTAMIENTO, plan de endurecimiento de seguridad T2): guardar los cupos de una promo deja una fila de auditoría por columna (`cantidadMinima`, `cantidadMaxima`) de cada cupo que cambia, aparece o desaparece (entidad `PromoCartaCupo`, `entidadId` = `promo:seccion`). Agrega SOLO 8 líneas AUDITORIA: 4 en el paso «promo: cupos del Menú (Platos hasta 2, Postres 1 a 1)» (2 cupos nuevos × 2 columnas) y 4 en «promo: sin cupos vuelve a informativa» (los 2 cupos que se quitan × 2 columnas); ningún resultado, fila de tabla ni efecto cambia.",
      },
    ],
  },
};

/** `git hash-object` del contenido normalizado a LF (lo que `core.autocrlf=true` guarda en el blob). */
function blobDeGit(contenido: Buffer): string {
  const normalizado = Buffer.from(contenido.toString("binary").replace(/\r\n/g, "\n"), "binary");
  return createHash("sha1")
    .update(`blob ${normalizado.length}\0`)
    .update(normalizado)
    .digest("hex");
}

function esperado(c: Congelada): string {
  return c.regeneraciones.at(-1)?.blob ?? c.blob;
}

describe("caracterizaciones congeladas: un golden solo cambia con una regeneración declarada", () => {
  it.each(Object.entries(CONGELADAS))("%s tiene el contenido congelado", (ruta, c) => {
    const absoluta = join(RAIZ, ruta);
    expect(existsSync(absoluta), `${ruta}: no existe (¿se movió? actualizá la ruta acá, sin tocar su blob)`).toBe(true);
    const actual = blobDeGit(readFileSync(absoluta));
    expect(
      actual,
      `${ruta} cambió: esperado ${esperado(c)}, actual ${actual}. Si la regeneración es deliberada, sumala a \`regeneraciones\` con el blob nuevo, el commit y el motivo.`
    ).toBe(esperado(c));
  });

  it("cada entrada está completa (blob y commits con forma de hash, motivos escritos)", () => {
    for (const [ruta, c] of Object.entries(CONGELADAS)) {
      expect(c.blob, ruta).toMatch(/^[0-9a-f]{40}$/);
      expect(c.desde, ruta).toMatch(/^[0-9a-f]{7,40}$/);
      expect(c.motivo.trim(), ruta).not.toBe("");
      for (const r of c.regeneraciones) {
        expect(r.blob, ruta).toMatch(/^[0-9a-f]{40}$/);
        expect(r.commit, ruta).toMatch(/^[0-9a-f]{7,40}$/);
        expect(r.motivo.trim(), ruta).not.toBe("");
      }
    }
  });

  it("el hash es el de `git hash-object` y no depende del fin de línea", () => {
    // Valores de `git hash-object` (vacío y "hola\n", el segundo también con CRLF): el algoritmo es el de git, no uno parecido.
    expect(blobDeGit(Buffer.from(""))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(blobDeGit(Buffer.from("hola\n"))).toBe("5c1b14949828006ed75a3e8858957f86a2f7e2eb");
    expect(blobDeGit(Buffer.from("hola\r\n"))).toBe("5c1b14949828006ed75a3e8858957f86a2f7e2eb");
    expect(blobDeGit(Buffer.from("hola\n"))).not.toBe(blobDeGit(Buffer.from("hola!\n")));
  });
});
