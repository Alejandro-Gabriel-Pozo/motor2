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
 * regeneración: es el registro. Un golden que se BORRA (su prueba se retira) pasa de `CONGELADAS` a `RETIRADAS`, con su último blob.
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
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, `54f1f169` («Lista de control: filas O.54, O.55, O.61 y O.90 (tanda T2…»). Corregido por la tanda T14 (la auditoría intermedia, M-37): decía `5c18eb8b` (el commit S-12 de la rama local desde la que se hizo el cherry-pick); el padre real de `aff32b92` es `54f1f169`. El campo `commit` es solo metadato: ningún test lo compara con git (solo exige la forma de un hash).
        // El commit que regenera es el de S-41 (fila O.90 de la lista de control, que lo cita por su hash).
        commit: "54f1f169",
        motivo:
          "S-41/D4 (O.90; CAMBIA COMPORTAMIENTO, plan de endurecimiento de seguridad T2): la semilla de `producto_sincronizar_precio_carta` pasa de [admin, operador] a [admin] (piso operario intacto: clase O, delegable por configuración). Cambia SOLO lo que dice esa clave para el usuario «operador» (y los roles que lo incluyen), en 18 líneas: 16 donde sale de `ok`/`ver=true editar=true`/`sucursalesDondeElUsuarioPuedeVer` y entra a los grupos de SIN_PERMISO/`ver=false editar=false`, en los 4 registros de módulos; y 2 mensajes de denegación del usuario «operador + especial», que nombran la primera clave que le falta (ahora esta, antes `insumo_renombrar_fusionar`). Ninguna respuesta de otra clave cambia (comprobado quitando la clave de ambas versiones: la única diferencia que queda son esos 2 mensajes).",
      },
      {
        blob: "f279289e81d30fb5ae30094b4eed945f29f0295c",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, «Golden del registro de modulos: poner al dia lo que S-41 dejo desactualizado (producto_sincronizar_precio_carta ya no es del operador)».
        // El commit que regenera es el de S-10 / D1 (fila O.59 de la lista de control, que lo cita por su hash).
        commit: "e7f373b9",
        motivo:
          "S-10/D1 (O.59; CAMBIA COMPORTAMIENTO, plan de endurecimiento de seguridad T6, decisión del dueño): `carta_generos`, `carta_contenido_producto` y `carta_items_agrupados` pasan de contexto EMPRESA a contexto SUCURSAL (solo escriben en la carta de la sucursal activa). Cambia SOLO lo que dicen esas tres claves, en todas las funciones y registros: salen de los bloques `[empresa]` (requierePermisoDeEmpresa, requierePermisoVerDeEmpresa, obtenerMiNivelPermisoDeEmpresa) y entran a los de sucursal (`[S1]`/`[S2]`: requierePermiso, requierePermisoVer, obtenerMiNivelPermiso, accionesQueElUsuarioPuedeVer, accionesDelMenu), con el resultado que da el gate de ESA sucursal (por ejemplo `SIN_ACCESO_A_SUCURSAL` en S2 para quien solo tiene membresía en S1, donde antes la empresa le decía `ok`). Comprobado por TRIPLES (bloque, resultado, clave) entre la matriz vieja y la nueva: las únicas claves cuyas triples cambian son esas tres (110 quitadas y 218 agregadas por clave); cero triples de otra clave. Más un ARTEFACTO del generador (el test de caracterización no se edita): al sumarse tres claves a la lista de sucursal, las sondas de `sucursalesDondeElUsuarioPuedeVer`, que eligen su clave por posición (`DE_SUCURSAL[i]`), pasan de `carta_promo_activar`, `proceso_venta` y `reporte_consolidado` a `carta_contenido_producto`, `proceso_control` y `pagar_consignante`; las 108 sondas que siguen existiendo son idénticas. La fila «por encima del piso» del rol especial (`secciones`) y las 12 primeras de operario y 6 de empresa no se mueven (las tres claves van después de ellas en el catálogo).",
      },
      {
        blob: "7d3fe56f3c44dc25ab094802567575f03ac840b6",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, `1df6d19` («M.1-C7: documentacion del procedimiento corregido»).
        commit: "1df6d19",
        motivo:
          "M.2 P1 (clave nueva `producto_campos_sensibles`, contexto empresa, piso operario, semilla solo admin; NO cambia comportamiento todavía: ningún código la consulta hasta P2). Cambia SOLO lo que dice esa clave, en todos los registros de módulos y usuarios: 120 apariciones nuevas (tripletas registro/usuario/bloque, resultado, clave), todas de la clave nueva, en los 4 bloques de empresa (requierePermisoDeEmpresa, requierePermisoVerDeEmpresa, obtenerMiNivelPermisoDeEmpresa) y en el menú (accionesDelMenuQueElUsuarioPuedeVer, S1 y S2), y NINGUNA tripleta de otra clave quitada ni agregada (verificado comparando la versión anterior con la nueva por tripletas). Más 2 líneas de mensajes de denegación del usuario «dos sucursales» (rol «especial»): la firma de la denegación conserva el ÚLTIMO mensaje generado y la clave nueva es la última del catálogo que el operador no tiene, así que el mensaje nombra `producto_campos_sensibles` donde antes nombraba `producto_sincronizar_precio_carta` (mismo artefacto del generador que en S-41; ninguna respuesta de otra clave cambia). El generador no se edita.",
      },
      {
        blob: "616da9f114fa236fab6c3c22818b27383e0af353",
        // El commit PADRE de este (ceb56f07) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "ceb56f07",
        motivo:
          "Paquete 3, M3a (O.269; ADITIVO): las claves `compra_repartir` (empresa, piso administrador) y `compra_recibir` (sucursal, piso operario, semilla admin) aparecen en las listas de claves de los usuarios que ya alcanzaban las de su piso. Revisado con `git diff --word-diff`: solo se suman `, compra_repartir` y `, compra_recibir` a esas listas.",
      },
      {
        blob: "9d1f55b0166ecb20ae7df03a27eb1a02e044b2fa",
        // El commit PADRE de este (ac290d8, GO-2a paso 2) es el último antes del cambio; la matriz se regenera en el commit siguiente (GO-2a paso 3).
        commit: "ac290d8",
        motivo:
          "GO-2a paso 3 (ADITIVO; las claves ya estaban en la base desde GO-1a, ahora entran a ACCIONES): `opciones_definir` y `producto_opciones_admitidas` (empresa, piso administrador) y `opcion_apagar_en_sucursal` (sucursal, piso operario, semilla admin) aparecen en las listas de claves de cada bloque y registro. Revisado con `git diff --word-diff` y comparando sin esas tres claves: lo único que queda distinto son 4 líneas de mensajes de denegación del rol «especial» y de «operador + especial», que nombran la ÚLTIMA clave del catálogo que no tienen (`opcion_apagar_en_sucursal` donde decía `compra_recibir`, `producto_opciones_admitidas` donde decía `compra_repartir`): el mismo artefacto del generador que en M.2. Ninguna respuesta de otra clave cambia.",
      },
      {
        blob: "866fcd0fc8c182b50125cdaee4bd27a747bb5216",
        // El commit PADRE de este (562e914, GO-3b D4) es el último antes del cambio; la matriz se regenera en el commit siguiente (GO-3b D6).
        commit: "562e914",
        motivo:
          "GO-3b D6 (ADITIVO; las claves ya estaban en la base desde las migraciones GO-3d y GO-3a, ahora entran a ACCIONES): `promo_menu_del_dia` (sucursal, piso operario, semilla admin) y `grupos_de_precio_definir` (empresa, piso administrador) aparecen en las listas de claves de cada bloque y registro. Revisado con `git diff --word-diff` (contando las líneas que cambian): solo se suman las dos claves a las listas; lo único que no es una suma son los mensajes de denegación del rol «especial» y de «operador + especial», que nombran la ÚLTIMA clave del catálogo que no tienen (ahora `promo_menu_del_dia`/`grupos_de_precio_definir` donde decía `opcion_apagar_en_sucursal`/`producto_opciones_admitidas`): el mismo artefacto del generador que en M.2 y GO-2a. Ninguna respuesta de otra clave cambia.",
      },
      {
        blob: "0008bd2b00a7ac268897930ff324f069f4d9ee7f",
        // El commit PADRE de este (0c12131, Fase 3 paso 3.0b) es el último antes del cambio; la matriz se regenera en el commit siguiente (paso 3.1).
        commit: "0c12131",
        motivo:
          "Ola «precio y carta», Fase 3, paso 3.1 (retiro de GO-3a; SACA una clave, no cambia ninguna otra): `grupos_de_precio_definir` (las tarifas compartidas de las combinaciones) sale de ACCIONES y desaparece de las listas de claves de cada bloque y registro. Revisado con `git diff --word-diff=porcelain … | grep '^[-+][^-+]' | sort | uniq -c`: 120 líneas pierden `, grupos_de_precio_definir` (108 donde la lista terminaba en `producto_opciones_admitidas, grupos_de_precio_definir` y 12 en el medio de una lista) y lo único que no es una resta son los 2 mensajes de denegación de «operador + especial», que nombran la ÚLTIMA clave del catálogo que no tienen: vuelven a nombrar `producto_opciones_admitidas` (como antes de GO-3b), el mismo artefacto del generador que en M.2, GO-2a y GO-3b. Ninguna respuesta de otra clave cambia.",
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
        // (carril A) Primera regeneración de esta huella: S-41/D4.
        blob: "334d34b8a738cd073d463b708ce03941949749b6",
        // El commit PADRE de este (`54f1f169`; ver la entrada de la matriz de acceso).
        commit: "54f1f169",
        motivo:
          "S-41/D4 (O.90; CAMBIA COMPORTAMIENTO; REGENERACIÓN NO PREVISTA EN EL PLAN, consecuencia directa de la misma semilla, a revisar por el orquestador): la huella siembra los permisos de fábrica de las empresas que da de alta, así que el rol «operador» ya no recibe `producto_sincronizar_precio_carta`. Cambia SOLO 2 líneas, una por empresa sembrada: `PERMISO operador:producto_sincronizar_precio_carta ver=true editar=true` → `ver=false editar=false`. Ningún resultado, mensaje ni otra fila cambia.",
      },
      {
        // (carril B) Segunda regeneración, partiendo de la versión del carril B (sin la semilla de S-41): S-33.
        blob: "6107a22b385ccd5c2a4f9c3a6c3779cc6ecb56cd",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, «Lista de control: fila O.57 (tanda T4 del endurecimiento, S-08, carril B), con el hash de su commit».
        // El commit que regenera es el de «S-33 (actor de plataforma)»: la fila O.82 de la lista de control, que lo cita por su hash.
        commit: "6056f39a",
        motivo:
          "S-33, actor de los scripts de plataforma (CAMBIA COMPORTAMIENTO, decidido por el dueño el 2026-10-08: «el admin de plataforma no es User y no debe serlo»). Los pasos 8a-8e (`cambiarModulosDeEmpresa` y `cambiarPoliticaDeEmpresa`) ya no escriben `RegistroAuditoria` a nombre de un `User`: auditan en `AuditoriaPlataforma` (que esta huella no vuelca). Cambia SOLO: (1) desaparecen las 30 líneas `AUDITORIA actorId=operador …` de los pasos 8a-8e (módulos y perillas de política); (2) como los ids simbólicos `id#N` se numeran por orden de aparición y esas filas ya no existen, el módulo `carta` pasa de `id#20` a `id#18` (5 líneas MODULO) y las cuatro filas del paso 9 (`numero`, `booleano`, `alta`, `baja`) de `id#26…29` a `id#19…22`. Los resultados de 8a-8e, EMPRESA, INVITACION, USUARIO_* y MODULO (salvo el id simbólico de `carta`), byte a byte. Regeneración NO prevista en el plan de endurecimiento: queda declarada para la revisión del orquestador.",
      },
      {
        // Tercera regeneración: la MEZCLA de los dos carriles. Es el resultado de combinar sin conflicto de texto la regeneración de S-41 (carril A, `334d34b8`) con la de S-33 (carril B, `6107a22b`).
        blob: "5af19ba75557c285e1a368ae017f7484c27f55ae",
        // El commit PADRE de la mezcla (primer padre = la rama principal, «Lista de control: filas O.56, O.60, O.65 y O.89 (tanda T3 …)»). La mezcla es el commit siguiente a este.
        commit: "dc7289b3",
        motivo:
          "Mezcla del carril B en la rama principal (2026-10-09). Sin cambio de comportamiento propio: la huella resultante es exactamente la del carril B más las dos líneas de la semilla de S-41 (el operador de fábrica deja de tener `producto_sincronizar_precio_carta`, una línea por empresa sembrada). Verificado con `git diff` contra cada padre: respecto del carril A solo aporta lo de S-33 (los cambios de módulos y de política dejan de dejar rastro en `RegistroAuditoria` de la empresa y los ids enmascarados se renumeran); respecto del carril B solo aporta lo de S-41.",
      },
      {
        blob: "4ad12a817aba26c2964e3cac0b65828b182c9a8c",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, `1df6d19` («M.1-C7: documentacion del procedimiento corregido»).
        commit: "1df6d19",
        motivo:
          "M.2 P1 (clave nueva `producto_campos_sensibles`, semilla solo admin; NO cambia comportamiento todavía). La huella siembra los permisos de fábrica de las empresas que da de alta y cuenta el catálogo. Cambia SOLO 6 líneas, 3 por empresa sembrada: `PERMISO admin:producto_campos_sensibles ver=true editar=true`, `PERMISO operador:producto_campos_sensibles ver=false editar=false` y `ACCIONES 124` → `ACCIONES 125` (el tamaño del catálogo). Ningún resultado, mensaje ni otra fila cambia.",
      },
      {
        blob: "3125e2daf2c1813a48cff05c5f83c1baeae5e45d",
        // El commit PADRE de este (7d4e2182) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "7d4e2182",
        motivo:
          "M0-IVA (O.266; ADITIVO, no cambia comportamiento): `Empresa.condicionIva` (migración 20261015101000) aparece en las 28 filas EMPRESA de la huella, en null («no declarada»). Revisado con `git diff --word-diff`: solo se suma `condicionIva=null`; ningún permiso ni rol cambia.",
      },
      {
        blob: "afffbcf6bb013c7d4cfa8002dc497abcc6fcc667",
        // El commit PADRE de este (ceb56f07) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "ceb56f07",
        motivo:
          "Paquete 3, M3a y M3d (O.269 y O.272; ADITIVO): `ACCIONES 125 a 127` por las claves nuevas `compra_repartir` y `compra_recibir` (las recibe el rol admin de cada empresa; el operador las tiene sin Ver ni Editar) y `Empresa.llevaIvaDeCompras=false` en las 28 filas EMPRESA. Revisado con `git diff --word-diff`: solo suman esas cosas.",
      },
      {
        blob: "36d08725faed2122076e8a14b2e5e1752aefbdb4",
        // El commit PADRE de este (ac290d8, GO-2a paso 2) es el último antes del cambio; la huella se regenera en el commit siguiente (GO-2a paso 3).
        commit: "ac290d8",
        motivo:
          "GO-2a paso 3 (ADITIVO): `ACCIONES 127 a 130` por las tres claves de los grupos de opciones de venta, que entran a ACCIONES (`opciones_definir`, `producto_opciones_admitidas` y `opcion_apagar_en_sucursal`: las recibe el rol admin de cada empresa; el operador las tiene sin Ver ni Editar). Revisado con `git diff --word-diff`: solo se suman esas filas PERMISO y el conteo.",
      },
      {
        blob: "d36414573d1904eec2d6e2695f6b373d42b8739a",
        // El commit PADRE de este (562e914, GO-3b D4) es el último antes del cambio; la huella se regenera en el commit siguiente (GO-3b D6).
        commit: "562e914",
        motivo:
          "GO-3b D6 (ADITIVO): `ACCIONES 130 a 132` por las dos claves de GO-3 que entran a ACCIONES (`promo_menu_del_dia` y `grupos_de_precio_definir`: las recibe el rol admin de cada empresa; el operador las tiene sin Ver ni Editar). Revisado con `git diff --word-diff`: solo se suman esas filas PERMISO y el conteo.",
      },
      {
        blob: "a8154f10e6a90daa5806b46bee128fca2b1a6adb",
        // El commit PADRE de este (0c12131, Fase 3 paso 3.0b) es el último antes del cambio; la huella se regenera en el commit siguiente (paso 3.1).
        commit: "0c12131",
        motivo:
          "Ola «precio y carta», Fase 3, paso 3.1 (retiro de GO-3a; SACA una clave): `ACCIONES 132 a 131` y desaparecen las 2 filas PERMISO de `grupos_de_precio_definir` (admin con Ver y Editar, operador sin) de cada una de las 2 empresas sembradas: 4 líneas menos y los 2 conteos (diff revisado línea a línea). Ningún resultado, mensaje ni otra fila cambia.",
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
    regeneraciones: [
      {
        blob: "b9ef4b4077ae2e0e4bc5d74126b71c08e12f0db9",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, `2ea2dd1` («P1 paso 1: mediodiaDelDia(dia, zona) en core/tiempo…»).
        commit: "2ea2dd1",
        motivo:
          "P1 paso 7 (O.254; CAMBIA el día que citan los textos guardados al anular): el día de la venta en `detalleReversionDeVenta` («Anulación de la venta … (fecha).») y en `descripcionAuditoriaAnulacionDeVenta` («Venta del …: anulación») pasa de UTC a hora argentina. Cambia SOLO la fecha dentro de esos textos, en 2 líneas (los dos AJUSTE de la anulación de la venta op11: 2026-09-27 → 2026-09-26, porque el fixture guarda el día a las 00:00Z, que en hora argentina es el día anterior a las 21:00); mismas líneas, mismo orden, ninguna consulta ni número distinto.",
      },
      {
        blob: "9de92b42995ab38589e108dca16bcf541a0b5085",
        // El commit PADRE de este (b4c7670f) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "b4c7670f",
        motivo:
          "M2 (O.268; ADITIVO, no cambia comportamiento): las líneas OPERACION suman `mermaPorAnulacionDeId`, `motivoAnulacion`, `reemplazaAOperacionId`, `revierteAOperacionId` y `ventaId` en null, y las KARDEX suman `devuelveAMovimientoId` en null. Verificado: el golden nuevo, sin esas columnas en null, es idéntico al anterior.",
      },
      {
        blob: "7f056b39fc146860e5a63d28bb2a056d4d0d0924",
        // El commit PADRE de este (ceb56f07) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "ceb56f07",
        motivo:
          "Paquete 3, M3b (O.270; ADITIVO): las líneas KARDEX suman `facturaProveedorRenglonId=null`. Verificado: sin esa columna en null, idéntico al anterior.",
      },
      {
        blob: "63a46586eabecb8ef203c930848d3432e018f056",
        // El commit PADRE de este (c980e5fb) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "c980e5fb",
        motivo:
          "GO-1d (O.324; ADITIVO, no cambia comportamiento): las líneas OPERACION suman `operacionPadreId=null`. Verificado con diff: el golden nuevo, sin esa columna en null, es idéntico al anterior.",
      },
      {
        blob: "85c7776d5e08d16a6892056dbcc156630435433e",
        // El commit PADRE de este (9e0f5078, main con GO-3b) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "9e0f5078",
        motivo:
          "MOSTRADOR (O.430; CAMBIA LAS CONSULTAS, no la salida): la barrera de las opciones obligatorias de la venta (`armarLinea`) lee UNA vez por lote lo que admite cada producto de las líneas sin configurar (`cargarOpcionesParaVender`, un `producto.findMany`), la primera vez que una línea llega a ella. Cambia SOLO la línea `lecturas (N)` de 5 escenas (la que ya pasaba la barrera): N suma 1 y `producto.findMany` suma 1; ninguna fila OPERACION, KARDEX ni resultado cambia. Verificado con `git diff --word-diff`: cada línea cambiada, sin el número N y sin `producto.findMany×k`, es idéntica a la anterior.",
      },
    ],
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
      {
        blob: "2bd7e81c72dac6e7287fc448ff4a577db170e158",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, «Documentacion: tabla unica de pendientes con destino (corrige las secciones 4 y 5.3) y filas O.178 a O.185».
        commit: "9217bea9",
        motivo:
          "I-1 de la auditoria final (CAMBIA COMPORTAMIENTO dentro de la decision D7 del dueño: anular una venta con algo posterior se RECHAZA): anularVenta mira tambien los conteos fisicos posteriores que NO escribieron movimiento (diferencia 0, «falta movimiento», «descartar»), porque solo existen en ConteoFisico. Cambia SOLO la linea `lecturas (N)` de 5 entradas (A8, C5, C6, D5 y consignacion): cada una suma `conteoFisico.findMany×1` (2→3, 2→3, 2→3, 3→4, 4→5). Ningun resultado, mensaje ni escritura cambia.",
      },
      {
        blob: "60ae1571c71f8fb0d231ae8a478fbd51cf5af2b1",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, `2ea2dd1` («P1 paso 1: mediodiaDelDia(dia, zona) en core/tiempo…»).
        commit: "2ea2dd1",
        motivo:
          "P1 paso 7 (O.254; CAMBIA el día que citan los textos guardados al anular): el día de la venta en `detalleReversionDeVenta` («Anulación de la venta … (fecha).») y en `descripcionAuditoriaAnulacionDeVenta` («Venta del …: anulación») pasa de UTC a hora argentina. Cambia SOLO la fecha dentro de esos textos, en 8 líneas (las anulaciones de op12, op6 y op4, cada una con su AJUSTE y su auditoría: un día antes, porque los fixtures guardan el día a las 00:00Z, que en hora argentina es el día anterior a las 21:00); mismas líneas, mismo orden, ninguna consulta ni número distinto.",
      },
      {
        blob: "65dce1332dd948a8b9feb6436fadd97fbf6a35e3",
        // El commit PADRE de este (b4c7670f) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "b4c7670f",
        motivo:
          "M2 (O.268; ADITIVO, no cambia comportamiento): igual que la matriz de venta; solo columnas nuevas en null en las líneas OPERACION y KARDEX. Verificado: sin esas columnas, idéntico al anterior.",
      },
      {
        blob: "0d7517922ecf5654e07ff6ff53ab9ee17499f51c",
        // El commit PADRE de este (ceb56f07) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "ceb56f07",
        motivo:
          "Paquete 3, M3b (O.270; ADITIVO): las líneas KARDEX suman `facturaProveedorRenglonId=null`. Verificado: sin esa columna en null, idéntico al anterior.",
      },
      {
        blob: "753582df08068590bb92c9b4ff8e7fd022e31c54",
        // El commit PADRE de este (c980e5fb) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "c980e5fb",
        motivo:
          "GO-1d (O.324; ADITIVO, no cambia comportamiento): las líneas OPERACION suman `operacionPadreId=null` y las CUENTA_ITEM suman `huellaOpciones=null` y `lineaPadreId=null`. Verificado con diff: sin esas columnas en null, idéntico al anterior.",
      },
      {
        blob: "386a1e493df79adc0526112b8e5c971df3f175f8",
        // El commit PADRE de este (b1cd4c8, main con GO-1, GO-2a y GO-2b) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "b1cd4c8",
        motivo:
          "RECETA (ADR-033; CAMBIA COMPORTAMIENTO, decisión del dueño del 2026-10-13: «sin receta no se vende»). El escenario cambia lo mínimo: el Agua y el Flan, que eran «PV sin receta», pasan a ser de REVENTA (receta de 1 unidad de «Agua (reventa)» / «Flan (reventa)»); el stock del Agua entra en la misma COMPRA que las Tapas (jornada A) y el del Flan en la misma que el Vino, en «Barra» (jornada D), sin Operaciones nuevas (la numeración opN no se corre); en la jornada B el Flan sigue sin stock. Diff revisado línea a línea y con un normalizador (sin las filas KARDEX de las dos MP de reventa, sin el renglón «lecturas» y con `costoUnitarioVenta` del Agua/Flan en null queda IDÉNTICO salvo): los títulos de A1, B y B5 (ya no dicen «sin receta»); B5 ahora avisa el stock negativo de «Flan (reventa)» en «Barra» (antes `avisos=[]`); D5 revierte 4 movimientos en vez de 3 (también el CONSUMO del Flan de la promo); y el paso nuevo R7 (al final: la Soda, un PV SIN receta, se rechaza con PRODUCTO_SIN_RECETA sin escribir nada). Las filas nuevas son los CONSUMO de las dos MP (y su COMPRA y reversión), el `costoUnitarioVenta` del Agua pasa de null a 300 y el del Flan a 1000 (el costo de su MP), y las lecturas suman las de la receta de reventa (disponibilidad, saldos y la ficha de la MP). Ninguna sección de una fila VENTA cambia.",
      },
      {
        blob: "6b05b59d98702916f0a43cd16534040ef046d298",
        // El commit PADRE de este (9e0f5078, main con GO-3b) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "9e0f5078",
        motivo:
          "MOSTRADOR (O.430; CAMBIA LAS CONSULTAS, no la salida): igual que la matriz de venta. La barrera de las opciones obligatorias lee UNA vez por lote lo que admite cada producto de las líneas sin configurar (`producto.findMany`), la primera vez que una línea llega a ella. Cambia SOLO la línea `lecturas (N)` de 19 escenas (las que pasan la barrera: ventas de mostrador, cierres del POS y sus rechazos posteriores a ella): N suma 1 y `producto.findMany` suma 1; los rechazos anteriores a la barrera (producto inexistente, no disponible, cantidad inválida) no cambian. Ninguna fila OPERACION, KARDEX ni resultado cambia. Verificado con `git diff --word-diff` y por programa: cada línea cambiada, sin N y sin `producto.findMany×k`, es idéntica a la anterior.",
      },
      {
        blob: "496f44c738f2be69865addc2b4f97c4f5005b84c",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, `1be5631e` («Menú de Movimientos: Registrar movimiento como entrada única y mudanza de las demás entradas»).
        commit: "1be5631e",
        motivo:
          "Fase 7, P6 (vocabulario; CAMBIA SOLO UN TEXTO): el rechazo de la venta sin respaldo (`rechazoSinRespaldo`, plan-de-la-venta.ts) nombraba el camino «Movimientos → Secciones»; Secciones se mudó al grupo Stock y se llama «Depósitos», así que el texto dice «Stock → Depósitos». Cambia SOLO esa frase dentro de la única línea `resultado: rechazo «Ninguna sección de …»` (1 línea); el resto de la matriz es idéntico. Regenerado con REGENERAR_CARACTERIZACION_DE_VENTA_AMPLIADA=1.",
      },
      {
        blob: "ed630085f5c0e1625ac0eb615d1baf82eaf5eb62",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, `a878640a` («M1.1 mostrador: núcleo puro del puesto del salón (rótulo y frases) y guardián G1 de textos»).
        commit: "a878640a",
        motivo:
          "M1 del mostrador (ADR-039, migración 20261027100000_m1_puesto_mostrador; ADITIVO, no cambia comportamiento): las 21 líneas CUENTA suman `tipoMesa=SALON` (la columna nueva `Cuenta.tipoMesa`, default SALON). Verificado con `git diff --word-diff` y por programa: sin esa columna el contenido es IDÉNTICO al blob anterior, byte a byte; ninguna fila, importe ni traza de consultas cambió.",
      },
      {
        blob: "5c931eee70360d97aa6dd2c926d761c98e1f0829",
        // Un commit no puede llevar su propio hash: es el commit PADRE de la fusión de las ramas de la Fase 7 (Movimientos) y del mostrador (M1), `ff51d59f` («Merge branch 'alegp/carril-m' …»).
        commit: "ff51d59f",
        motivo:
          "Fusión de dos regeneraciones hechas en paralelo sobre el mismo golden: la de Fase 7 P6 (un texto: el camino del menú «Stock → Depósitos» en el rechazo sin respaldo) y la de M1 del mostrador (las 21 líneas CUENTA suman `tipoMesa=SALON`, aditivo). La fusión automática de git dio el contenido de las dos juntas (comprobado: 21 líneas con `tipoMesa=SALON`, el texto nuevo del camino del menú y ningún marcador de conflicto); ningún otro número cambia.",
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
      {
        blob: "50da82faa90188ee358df979bf38bbc298c5da99",
        // El commit que regenera es el `2b11b2e` («P1 paso 5: Compras, Perdidas, Devoluciones, Historial, Rotacion y Vencimientos cortan el dia en la zona de la empresa», fila O.253 de la lista de control); la declaración va en el commit siguiente porque un commit no puede llevar su propio hash.
        commit: "2b11b2e",
        motivo:
          "P1 paso 5 (O.253; CAMBIA COMPORTAMIENTO a propósito: «hace N días» de Pérdidas y Devoluciones se cuenta en días de la zona de la empresa, no en días UTC). Cambia SOLO 2 líneas (729 y 1590): la `desde` de Pérdidas y la de Devoluciones, `Date(2026-02-13T00:00:00.000Z)` → `Date(2026-02-13T03:00:00.000Z)` (+3 h: el inicio del día argentino); ningún número ni conteo de consultas se mueve.",
      },
      {
        blob: "e4fa1aea100e0385f4540573020232fe6158986a",
        // El commit PADRE de este, «P1 paso 1: mediodiaDelDia(dia, zona) en core/tiempo, con ejemplos, propiedad y mutaciones».
        commit: "2ea2dd1",
        motivo:
          "P1 paso 4 (CAMBIA COMPORTAMIENTO, el día en hora argentina): Rendimiento de recetas corta los días en la zona de la empresa (no en UTC). Cambian SOLO 4 líneas, `anclaDesde`/`anclaHasta` de las dos filas de la entrada rendimiento-recetas.calcularRendimientoRecetasSimples (Central, período): el día de la ancla pasa de ser la medianoche UTC (`T00:00:00.000Z`) a ser el inicio de ese día argentino (`T03:00:00.000Z`), el mismo día calendario (2026-02-18, 2026-03-10, 2026-03-06 y 2026-03-12). Ningún número, ningún método y ningún conteo de consultas cambia.",
      },
      {
        blob: "f6652b056d5fe76d136f98f96925e9f095a7209a",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, «P1 paso 1: mediodiaDelDia(dia, zona) en core/tiempo, con ejemplos, propiedad y mutaciones».
        commit: "2ea2dd1",
        motivo:
          "P1 paso 3 (O.251; CAMBIA COMPORTAMIENTO, plan P1 «el día en hora argentina»): Período y su familia cortan cada día en la zona de la empresa (`rangoDeDias(…, zona)`) y no en UTC. Cambia SOLO 6 líneas, todas `Date(…)` de desde/hasta (+3 h, Argentina es UTC−3): las entradas 27 y 29 (periodo.obtenerReportePorPeriodo y generarReporteVentasPorCategoria: desde 02-16T00:00Z → 02-16T03:00Z, hasta 03-15T23:59:59.999Z → 03-16T02:59:59.999Z) y el financiero de la entrada 34 (resumen-operativo: desde 02-14T00:00Z → 02-14T03:00Z, hasta como arriba). Ningún número, ninguna consulta ni su conteo cambia.",
      },
      {
        blob: "fe2625ff868bde65dbb8cb021239d1ebb4cebece",
        // El commit desde el que el contenido es ese blob es la fusión `f7c93bb` («Merge p1-periodo»), donde se juntan las tres regeneraciones de P1 (pasos 3, 4 y 5) en un solo golden.
        commit: "f7c93bb",
        motivo:
          "P1, unión de las regeneraciones de los pasos 3 (Período y su familia), 4 (Rendimiento de recetas) y 5 (Pérdidas y Devoluciones) hechas por tres constructores en paralelo (O.251, O.252 y O.253). CAMBIA COMPORTAMIENTO a propósito (el día en hora argentina): se mueven SOLO líneas `Date(...)` de `desde`/`hasta` y de `anclaDesde`/`anclaHasta` (+3 h, T00:00:00.000Z → T03:00:00.000Z, el mismo día calendario). La fusión automática de git dio el mismo contenido que regenerar con `REGENERAR_CARACTERIZACION_DE_REPORTES=1` sobre el código fusionado (comparado archivo contra archivo). Ningún número, método ni conteo de consultas cambió.",
      },
    ],
  },
  "test/caracterizacion-tramo-a/lecturas-tramo-a.golden.json": {
    blob: "8e1e3e873cb7804aa9cc4245eb1fccd38d66fb3a",
    desde: "0b08f2f4",
    motivo: "Caracterización «.0» del tramo A (2.3). Regenerada en 0b08f2f4 (O.39: solo bajan los conteos).",
    regeneraciones: [
      {
        blob: "495c93eced8170107c1e41901ae0e6a2ad160edd",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, «Lista de control: fila O.59 (tanda T6 del endurecimiento de seguridad, S-10 / D1), con el hash de cada commit».
        // El commit que regenera es el de S-22 (promociones apagadas en el POS; fila O.71 de la lista de control, que lo cita por su hash).
        commit: "19cd8ad2",
        motivo:
          "S-22/D2 (O.71; CAMBIA COMPORTAMIENTO, plan de endurecimiento de seguridad T10, decisión del dueño): el selector del POS y la lectura de cada promo para agregar leen el registro de módulos de la empresa (sin Promociones no ofrecen ni aceptan promos). Cambia SOLO la línea de conteo de 5 entradas, sin tocar ningún resultado: `pos.cargarSelectorCartaDeLaMesa(Central)` y `(Norte)` 15 → 17 consultas (`sucursal.findUnique` ×1 → ×2 y `moduloEmpresa.findMany` ×1 nueva), `pos.cargarPromoCartaParaAgregar(Central, Menú del día)` 16 → 18 (lo mismo) y sus dos casos `null` (informativa sin cupos; apagada en Norte) 1 → 3 (`moduloEmpresa.findMany` y `sucursal.findUnique`, que ahora van antes de buscar la promo). En la pantalla real la segunda lectura del registro sale de la memoria por pedido (`cache` de React: el guard ya la hizo con el mismo `db`).",
      },
      {
        blob: "8de0ce3d9bc515953ee8c08d607fb2c61322e58d",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, `da979dd` («M.3-A7: la carta publica resuelve el slug en SucursalPublica y lee con una base de solo lectura en esa sucursal»), que fue el que cambió el golden.
        commit: "da979dd",
        motivo:
          "M.3-A7 (refactor de acceso, sin cambio de resultado): `carta.resolverCartaPublica` resuelve el slug en `SucursalPublica` con la base de la empresa y lee la carta (menú, precios locales, descuentos, promos y tema) con una base de SOLO LECTURA de esa única sucursal, lo que suma una lectura de `sucursal` (`sucursal.findUnique` ×1 → ×2: la del menú y la del tema). Cambia SOLO la línea `consultas` de 2 entradas, `resolverCartaPublica(empresa, «central»)` y `(empresa, «norte»: sin tema)`: 9 → 10 consultas; el `resultado` de ambas y todas las demás entradas, byte a byte (verificado con `git diff b55c39f HEAD` del golden: exactamente esas 2 líneas).",
      },
      {
        blob: "b0b8c71f5fef87e7c9d0a173e4031499f3130bfb",
        // El commit desde el que el contenido es ese blob es `c0414b00` («P1: la matriz de denegacion mapea 'zona' y el golden del tramo A mueve desde/hasta…»).
        commit: "c0414b00",
        motivo:
          "P1, paso 3 (O.251; CAMBIA COMPORTAMIENTO a propósito, el día en hora argentina): Ventas por sección (Carta interna) corta el día en la zona de la empresa. Cambian SOLO 2 líneas del resultado de `generarReporteVentasPorSeccion`: `desde` pasa de 2026-09-30T00:00:00.000Z a 2026-09-30T03:00:00.000Z y `hasta` de 2026-09-30T23:59:59.999Z a 2026-10-01T02:59:59.999Z (el mismo día calendario argentino). Ningún número ni conteo de consultas cambió. Detectado por el CI de e0f5395 (parte 4 de 4), que el constructor del paso 3 no pudo correr.",
      },
      {
        blob: "7d3cc1c24710b57426ae233bffc8f57d1998365d",
        // El golden es la UNION de dos cambios deliberados: el de zona de `c0414b00` (entrada anterior) y el de P2.1 de `5707566` («P2.1: el item agrupado mira solo el descuento de su sucursal…»).
        commit: "5707566",
        motivo:
          "Paquete 1, P2.1 (se BORRA una función; el resto del golden no cambia): `productoTieneDescuentoEnAlgunaSucursal` ya no existe (el ítem agrupado de la carta mira solo el descuento de SU sucursal con `descuentosConfiguradosEnSucursal`, que ya tiene su caso), así que se va su caso `carta.productoTieneDescuentoEnAlgunaSucursal(Empanada)` (1 consulta, `descuentoProductoSucursal.count`, resultado `true`). Ninguna otra entrada cambia.",
      },
      {
        blob: "8056ac4ed8e4bb9fa312aca046c723d9920b5aff",
        // El commit PADRE de este (7d4e2182) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "7d4e2182",
        motivo:
          "M0-IVA (O.266; ADITIVO, no cambia comportamiento): `Producto.alicuotaIvaVenta` y `Producto.alicuotaIvaCompra` (migración 20261015100000) aparecen en una sola entrada de la lectura, en null («sin declarar»). Revisado con `git diff --word-diff`: solo se suman esas dos claves.",
      },
      {
        blob: "ff1ea4de397303f109ddafa1fc27a1a035fbba2c",
        // El commit PADRE de este (8ff510de) es el último antes del cambio; el golden se regenera en el commit siguiente (Fase 4, C1).
        commit: "8ff510de",
        motivo:
          "Ola «precio y carta», Fase 4, C1 (ADITIVO, no cambia comportamiento): `Producto.modoDeVenta` (migración 20261021130000) aparece en la única entrada de la lectura que trae la fila del producto, en «DIRECTO» (el default: lo que ya hacía). Revisado con `git diff`: una sola línea agregada, `\"modoDeVenta\": \"DIRECTO\"`.",
      },
      {
        blob: "1c5bde01c794b7fafd6432a6b1790978ab267f63",
        // El commit PADRE de este (2f39a774) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "2f39a774",
        motivo:
          "Ola «precio y carta», Fase 5 (CAMBIA COMPORTAMIENTO a propósito, decisión del dueño: escala de letra de la carta con mínimo de 14 px para el texto de decisión): en las dos lecturas de `carta.resolverCartaPublica` los tamaños por defecto del tema suben (`carta_fuente_item_nombre` y `_precio` de 0.88rem a 1.1875rem, `_descripcion` de 0.6875rem a 0.875rem y `_tags` de 0.6875rem a 0.75rem, y sus variables `--carta-fuente-item-*`) y se suman las variables `--carta-fs-*` (producto, precio, opción, aclaración, etiqueta, título, rótulo, columna, tamaño y elección, con su versión impresa). Revisado con `git diff`: cambian solo esos valores y se suman esas claves; ningún precio, nombre, orden ni conteo de consultas se movió. Quedó rojo en la CI (parte 4 de Integración) desde la Fase 5 porque nadie regeneró este golden.",
      },
    ],
  },
  "test/pos/caracterizacion/huella-del-pos.golden.txt": {
    blob: "8d2f170f6ee4f020fdd138e8388329a30ccf5687",
    desde: "f9e5a286",
    motivo:
      "Huella del POS (Hito 4, paso 0.1): las 10 Server Actions del POS sin caso de uso (apertura, mesas y pedido) como admin, mozo y operador, con los rechazos de dos fallas a la vez. Red de 4.1: mudar esas acciones a casos de uso no cambia nada (salvo lo aprobado: liberarMesa con ctx.ahora no cambia el golden, que solo dice si hay fecha).",
    regeneraciones: [
      {
        blob: "e6f590094e950773020d2b9350a6f80d170ee3d9",
        // El commit PADRE de este (c980e5fb) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "c980e5fb",
        motivo:
          "GO-1d (O.324; ADITIVO, no cambia comportamiento; primera regeneración de este golden): las líneas ITEM suman `huellaOpciones=null` y `lineaPadreId=null` y las OPERACION suman `operacionPadreId=null`. Verificado con diff: sin esas columnas en null, idéntico al anterior.",
      },
      {
        blob: "4ef38a43f32e26e8f78ab57bdb6cfc7bc4867af3",
        // Un commit no puede llevar su propio hash: es el commit PADRE de este, `a878640a` («M1.1 mostrador: núcleo puro del puesto del salón (rótulo y frases) y guardián G1 de textos»).
        commit: "a878640a",
        motivo:
          "M1 del mostrador (ADR-039, migración 20261027100000_m1_puesto_mostrador; ADITIVO, no cambia comportamiento): las 207 líneas MESA suman `tipo=SALON` y las 174 CUENTA suman `tipoMesa=SALON` (las columnas nuevas `Mesa.tipo` y `Cuenta.tipoMesa`, default SALON). Verificado con `git diff --word-diff` y por programa: sin esas dos columnas el contenido es IDÉNTICO al blob anterior (e6f590094e95), byte a byte; ningún mensaje, número ni orden cambió (los textos de las mesas pasaron por core/pos/puesto.ts en M1.1 y esta huella pasó verde sin regenerar).",
      },
    ],
  },
  "test/pos/caracterizacion/venta-con-opciones.golden.txt": {
    blob: "c1a535dd2da666e1fe3153415e310b4151f30fed",
    // Un commit no puede llevar su propio hash: es el commit PADRE de este (GO-2b paso 8, «el nucleo de la venta con lineas configuradas y adicionales»); la caracterización nace en el siguiente.
    desde: "ff53437",
    motivo:
      "GO-2b (ADR-030; NUEVA, no regenera ninguna vieja): la venta CON OPCIONES de punta a punta en el salón (agregar un café grande con almendras y dos shots, dos chicos y un flan; el mismo grande otra vez; enviar; cerrar con cliente al 10%) con todas las filas de CuentaItem, OpcionElegidaEnLinea, Operacion y MovimientoStock. Fija la huella en la clave (dos grandes iguales = una Operacion de ×2), el adicional en su línea con su padre, la Operacion hija con `operacionPadreId`, el consumo transformado por las opciones, el costo congelado de sus pedidos y que el adicional no lleva descuento de cliente.",
    regeneraciones: [
      {
        blob: "d2f29ebd446bc622b422f4856dfa335511a03973",
        // El commit PADRE de este (b1cd4c8, main con GO-1, GO-2a y GO-2b) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "b1cd4c8",
        motivo:
          "RECETA (ADR-033; CAMBIA COMPORTAMIENTO, decisión del dueño del 2026-10-13: «sin receta no se vende»): el flan del fixture del salón ahora tiene su receta de reventa (1 unidad de «Flan (reventa)», con stock), así que su venta CONSUME. Diff revisado línea a línea: UNA sola línea nueva, el MOVIMIENTO CONSUMO de `flanReventa` (-1, op1, sección salon); las demás filas son idénticas salvo el número correlativo `movN` de los movimientos, que se corre en uno. Ningún resultado, consulta, precio ni fila de la cuenta cambia.",
      },
    ],
  },
  "test/persistencia/__golden__/kardex-escritores.golden.json": {
    blob: "4ba48f056c55dbfc6c49ba4c8acac8adf67f9d1a",
    desde: "4af23e8b",
    motivo:
      "Huella de los escritores del Kardex (Hito 5, pieza 5.4, A2; O.13): cada escritura (modelo, operación, args con la presencia o ausencia de cada clave) y el estado final de Operacion, MovimientoStock y TraspasoSucursal en ocho casos (aprobación, envío directo, aceptación con y sin clave I3, reingreso, anulación de compra con y sin clave, anulación de venta). Red de A4 y A5: reunir las dos escrituras de traspasos y las dos de anulación en una función cada una no cambia NADA de lo que llega a la base.",
    regeneraciones: [
      {
        blob: "1fd953a1cd1554a3685c79e8776eee10fb0808d1",
        // El commit PADRE de este (b4c7670f) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "b4c7670f",
        motivo:
          "M2 (O.268; ADITIVO, no cambia comportamiento): la huella de escritores del Kardex suma las columnas nuevas de `Operacion`, `MovimientoStock` y `ConteoFisico` (`motivoCancelacion`) en null. Verificado: sin esas claves en null, idéntico al anterior.",
      },
      {
        blob: "ad8f816b2c9a25e1711a7ec0b24171427f2302c0",
        // El commit PADRE de este (ceb56f07) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "ceb56f07",
        motivo:
          "Paquete 3, M3b (O.270; ADITIVO, no cambia comportamiento): cada movimiento del Kardex suma `facturaProveedorRenglonId` en null. Verificado: sin esa clave en null, idéntico al anterior.",
      },
      {
        blob: "a50058f8b5a61e31a87d252afbb31b5156939fb4",
        // El commit PADRE de este (c980e5fb) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "c980e5fb",
        motivo:
          "GO-1d (O.324; ADITIVO, no cambia comportamiento): la huella de escritores del Kardex suma `operacionPadreId` en null en cada `Operacion`. Verificado con diff: sin esa clave en null, idéntico al anterior.",
      },
    ],
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
      {
        blob: "ef85b2af2f043343cf1136a51227dd00bf1f4915",
        // El commit PADRE de este (52d5b77, «Paquete 1: piso del precio local de promo con lectura de verificacion…») es el que cambió el código; el golden se regenera en el commit siguiente.
        commit: "52d5b77",
        motivo:
          "Paquete 1, piso del precio LOCAL de una promo (CAMBIA UN TEXTO, a propósito): `guardarCuposPromoCarta` ya no nombra el importe ni la sucursal cuando el que no alcanza el piso es el precio LOCAL de alguna sucursal (puede ser una que quien guarda no ve; con las políticas de RLS por sucursal el control lee todas con la lectura de verificación). Cambia SOLO la línea `resultado` del paso «promo: cupos que dejan el precio local bajo el piso»: de «El precio de \"Menú del día\" ($0.05) no alcanza el piso…» a «El precio local de \"Menú del día\" en alguna sucursal no alcanza el piso…». El rechazo por el precio de la EMPRESA no cambia.",
      },
      {
        blob: "e80354ded4366966265790f447b5c465f1d02751",
        // El commit PADRE de este (7d4e2182) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "7d4e2182",
        motivo:
          "M0-IVA (O.266; ADITIVO, no cambia comportamiento): las filas de producto de la huella suman `alicuotaIvaCompra=null alicuotaIvaVenta=null` (13 líneas). Revisado con `git diff --word-diff`: ningún importe ni regla de dinero cambia.",
      },
      {
        blob: "ab9b9e4dff4d6dd3337be0b325ac264c4a46a14d",
        // El commit PADRE de este (48741e0, GO-3b AB5) es el último antes del cambio; el golden se regenera en el commit siguiente.
        commit: "48741e0",
        motivo:
          "GO-3b D3 (CAMBIA COMPORTAMIENTO, decidido en el diseño de GO-3, ADR-032: guardar los cupos ya no borra): en el paso «promo: sin cupos vuelve a informativa» los dos cupos que antes se BORRABAN ahora quedan dados de baja (`activo=false`): la huella muestra la fila vieja y la nueva (2 líneas `+ PROMO_CUPO … activo=false`). Revisado con `git diff --word-diff`: el resultado, los efectos y las 4 líneas de auditoría son idénticos; ningún importe cambia.",
      },
      {
        blob: "09fcd693f4fe1145296fe7a9dbe7c33d12360ffc",
        // El commit PADRE de este (8ff510de) es el último antes del cambio; el golden se regenera en el commit siguiente (Fase 4, C1).
        commit: "8ff510de",
        motivo:
          "Ola «precio y carta», Fase 4, C1 (ADITIVO, no cambia comportamiento): las 13 filas PRODUCTO de la huella suman `modoDeVenta=DIRECTO` (migración 20261021130000; el default, lo que ya hacía). Revisado con `git diff`: quitando ese campo, cada línea es idéntica a la anterior; ningún importe ni regla de dinero cambia.",
      },
    ],
  },
  "test/caracterizacion-precio-y-carta/precios.golden.txt": {
    blob: "4e643fae598c8916f23e2155158ef2dd0ef28bf8",
    desde: "31354ad",
    motivo:
      "Ola «precio y carta», Fase 0: foto de lo que HOY se cobra y se muestra (venta, vista previa del POS, resumen del POS y de la carta pública) sobre el catálogo de referencia que reproduce producción y los casos CU-01 a CU-12. NO es una aprobación: incluye la trampa de la milanesa M2 con base cargada por error ($38.000). Las fases siguientes la regeneran declarándolo acá; el retiro de GO-3a (Fase 3) NO debe moverla.",
    regeneraciones: [],
  },
  "test/caracterizacion-precio-y-carta/cobro-y-carta.golden.txt": {
    blob: "c565330202519909cf9f0f931b6e737b2cede797",
    desde: "9c88d3d",
    motivo:
      "Ola «precio y carta», Fase 0: foto de lo que HOY cobra la acción real del POS (agregarItems) y de la carta pública que recibe el navegador (CartaPublicaV1) sobre el catálogo de referencia sembrado en Postgres. NO es una aprobación. Las fases siguientes la regeneran declarándolo acá; el retiro de GO-3a (Fase 3) NO debe moverla.",
    regeneraciones: [
      {
        blob: "ca337d00ddf8fe04d116c635eddb3327febfd9a6",
        // El commit PADRE de este (274a43c5, Fase 5 paso 6) es el último antes del cambio; el golden se regenera en el commit siguiente (paso 7).
        commit: "274a43c5",
        motivo:
          "Ola «precio y carta», Fase 5 («carta pareja»), paso 7 (ADITIVO; SOLO la parte de CARTA, el COBRO idéntico): la carta pública suma, por PV con opciones, la forma ya resuelta en el servidor (`presentacion`) y, por sección, sus `tandas` de columnas compartidas. El test las vuelca en su PROPIA línea (`presentacion {…}` y `tandas […]`, JSON tal como viaja) y las saca de la línea ITEM/SECCION (que quedan idénticas). Cambian SOLO 7 líneas, todas agregadas: 5 `presentacion` (Pizzas, Milanesas, Bife a la criolla, Café, y el Café de la carta con la grilla de la sucursal, con Mediano 4200) y 2 `tandas` (Platos y Cafetería; la carta del café con la grilla solo vuelca su ítem). Revisado con `git diff -U0`: ninguna línea quitada ni cambiada; de `## COBRO` en adelante la ÚNICA diferencia es la línea `presentacion` del café con la grilla (que es carta). Pizzas y Milanesas salen como productos DIRECTOS (la semilla no los marca como base): Pizzas cae a lista con el nombre arriba (6 columnas > 3) y Milanesas en columnas con «Milanesas de» como aclaración (sin prefijo cargado). Ningún texto visible cambia en esta tanda: el dibujo nuevo es de la tanda B.",
      },
      {
        blob: "b087742c0b75fb85ef52b2e10b2851df843dc0c4",
        // El commit PADRE de este (9c8f7b88) es el último antes del cambio; el golden se regenera en el commit siguiente (Fase 5, tanda C2).
        commit: "9c8f7b88",
        motivo:
          "Ola «precio y carta», Fase 5 tanda C (jerarquía; ADITIVO, solo CARTA, el COBRO idéntico): la lista que cae de una tanda de más de 3 tamaños lleva protagonista: \"nombre\". Revisado con `git diff -U0`: cambia SOLO la línea `presentacion` de Pizzas (producto directo con 6 tamaños), que suma `\"protagonista\":\"nombre\"` después de `\"encabezado\":true`; de `## COBRO` en adelante nada cambia.",
      },
    ],
  },
  "test/e2e/linea-de-base-precio-y-carta.golden.txt": {
    blob: "11a7b90078489a6eb2cc26e499b2aa363c5a3ead",
    desde: "30a9994",
    motivo:
      "Ola «precio y carta», Fase 0: foto en navegador (375 y 1280 px) del texto visible de la carta pública, con su tipografía computada de hoy (ítems sin opciones a 14,08 px frente a 19 px con opciones), y de las pantallas de opciones de Pizzas, del grupo «Tipos de Pizza» y de la parametrización de secciones. NO es una aprobación. Las Fases 5 (escala de letra única, carta pareja) y 6 (interfaz del producto) la regeneran declarándolo acá.",
    regeneraciones: [
      {
        blob: "c79b78a136676d86c10b2bb4ce64a9501b813b75",
        // El commit PADRE de este (9750d6b, Fase 3 paso 3.3) es el último antes de la corrección; el texto lo cambió el paso 3.2 (ed9ff97), que borró el enlace y no regeneró este golden.
        commit: "9750d6b",
        motivo:
          "Ola «precio y carta», Fase 3, paso 3.2 (retiro de GO-3a; CAMBIA UN TEXTO de administración, no la carta): la pantalla de opciones del producto deja de enlazar a «Combinaciones» (la pantalla se borró). Cambian SOLO 2 líneas (la de Pizzas a 1280 px y la de 375 px): «… se arman en [enlace: Opciones de venta]. Las combinaciones (un precio o una receta propia para «grande con almendras») se arman en [enlace: Combinaciones].» pasa a «… se arman en [enlace: Opciones de venta].». Regenerado A MANO (el e2e no se corre en esta tanda; el texto sale del JSX: `en{\" \"}<EnlaceInterno>…</EnlaceInterno>` seguido de `.`): a confirmar con `npm run test:e2e` en el gate final. Ni una línea de la carta pública ni de la tipografía cambia.",
      },
      {
        blob: "4d8ffc781df0d2bb3a792eada0831bcb93b489c7",
        // El commit PADRE de este (25d9243e, Fase 5 paso 12) es el último antes de la regeneración; los cambios visuales son de los pasos 3, 4, 8, 9 y 10 (tanda B).
        commit: "25d9243e",
        motivo:
          "Ola «precio y carta», Fase 5 tanda B (CAMBIO VISUAL DELIBERADO, «carta pareja»; regenerado con REGENERAR_LB_PRECIO_Y_CARTA=1 en la corrida de capturas del paso 13, contra motor2_e2e local). (1) DATOS de la siembra e2e: Pizzas y Milanesas como producto BASE, «Milanesas de» con «De» y «Pizza bomba» agotada hoy (lo que el dueño va a cargar a mano), así salen las cuatro formas; cambian por eso las pantallas de administración de Pizzas. (2) El volcado lee la FORMA de cada ítem (lista sin encabezado para las pizzas, tabla para las milanesas, simple para el bife, tanda para el café) en lugar de las listas de tamaños, pastillas y «Adicionales:» retiradas. (3) La tipografía: todo plato a 19 px (antes 14,08 px sin opciones), filas de opción 16 px, aclaraciones 14 px, con UN par tamaño/peso por rol a 375 y 1280 px (se agrega la sección «Escala única»). (4) Se agrega «Impresión»: 0 listas cortadas, el pie con la fecha enmascarada y la dirección, la carta completa con lo agotado hoy y la escala en puntos. El precio cobrado no se toca (precios.golden.txt y cobro-y-carta.golden.txt sin cambios).",
      },
      {
        blob: "709df8a9dbe7444475baa38b22fd5d461164331e",
        // El commit PADRE de este (b74d4423, Fase 5 tanda C paso 7) es el último antes de la regeneración; los cambios visuales son de los pasos C1 a C6.
        commit: "b74d4423",
        motivo:
          "Ola «precio y carta», Fase 5 tanda C (CAMBIO VISUAL DELIBERADO, jerarquía de la carta aprobada por el dueño con maquetas; regenerado con REGENERAR_LB_PRECIO_Y_CARTA=1 en la corrida de capturas «despues2», contra motor2_e2e local). (1) Milanesas (tabla de dos ejes): el nombre pasa a ser un RÓTULO en mayúsculas de 13 px (el innerText lo vuelve «MILANESAS»; antes 19 px), con línea fina; las filas y los precios quedan como platos. (2) Aclaraciones y adicionales en P1: el bife lee «Guarnicion Elegí: …» (una línea) y cada extra en su propia fila con el recargo a la derecha; el café lee «Preparación del café Incluidas: solo, cortado» y lágrima y con leche cada una en su fila con su recargo. (3) La tanda del café: una tabla por producto con el nombre arriba (sin la celda del nombre en la tabla). (4) Escala única: sumas de los roles columna 16 px / 600, eleccion 15 px / 400, rotulo 13 px / 600 y tamano 15 px / 600 (en papel, 14,67 / 14 / 12,67 / 14 px); el rol aclaracion deja de aparecer porque la carta de esta siembra ya no dibuja aclaraciones en una línea. Las pantallas de administración y las Pizzas no cambian; el precio cobrado no se toca.",
      },
      {
        blob: "fe0a9dff7e5c66ad312760ded4fdcde40cc92b18",
        // El commit PADRE de este (c29a0a8b, Fase 5 tanda C paso 10) es el último antes de la regeneración; los cambios son de los pasos C9 (textos neutros) y C10 (café de especialidad).
        commit: "c29a0a8b",
        motivo:
          "Ola «precio y carta», Fase 5 tanda C, segunda regeneración (CAMBIO VISUAL DELIBERADO; regenerado con REGENERAR_LB_PRECIO_Y_CARTA=1 en la corrida de capturas «despues3», contra motor2_e2e local). (1) Textos neutros de las aclaraciones (C9, decisión del dueño): el grupo donde todo es gratis se lee «Guarnicion ensalada · papas fritas · puré» (sin «Elegí:» ni «o») y el grupo que mezcla se lee «Sin cargo: solo · cortado» (antes «Incluidas:») con cada recargo en su fila. (2) Datos de la siembra e2e (C10): se suma «Café de especialidad» (tamaño Chico/Mediano/Grande más preparación obligatoria Solo/Cortado/Lágrima +$200/Con leche +$300) a la sección Cafetería, que sale como TABLA DE DOBLE ENTRADA con precios finales; por eso cambian las pantallas de administración que listan los productos de la carta (Cafetería: 2 productos; el nuevo producto en la parametrización). La carta y la tipografía del resto no cambian; el precio cobrado no se toca.",
      },
      {
        blob: "65ce97796ee07f83128c4b26aee2367bf8f7d1ab",
        // El commit PADRE de este (1f8d2c5c, Fase 5 tanda C paso 13) es el último antes de la regeneración; el cambio es del paso C13.
        commit: "1f8d2c5c",
        motivo:
          "Ola «precio y carta», Fase 5 tanda C, tercera regeneración (ADITIVO: el volcado suma la sección «Separadores entre productos», a 375 y a 1280 px; el resto del texto y la tipografía no cambian; regenerado con REGENERAR_LB_PRECIO_Y_CARTA=1 contra motor2_e2e local). Mide con getComputedStyle el borderBottomColor de cada ítem de la lista de cada sección y el spec afirma que todos son el mismo color claro (rgb(231, 229, 228)) y que ninguno es el color del texto (rgb(28, 27, 25)): fija en navegador real el bug de los separadores negros que arreglaron C12 y C13.",
      },
      {
        blob: "a4c8fcd74fbaf86955c37681b2c13dd321a5c810",
        // El commit PADRE de este (fa3028e4) es el último antes de la regeneración; el texto lo cambió el paso 6.15a (carril A), que agregó la lectura del precio a la pantalla de opciones del producto.
        commit: "fa3028e4",
        motivo:
          "Ola «precio y carta», Fase 6, paso 6.15a (CAMBIA UN TEXTO de administración, no la carta pública; decisión del ingeniero con el visto del dueño para regenerar solo las secciones de ADMINISTRACIÓN): la pantalla de opciones del producto «Pizzas» (y su par a 1280 px) muestra bajo cada importe la lectura del precio de la opción («Pizza muzzarella = $ 18.000», y las otras cinco de «Tipos de Pizza»). Cambian SOLO 12 líneas, todas agregadas (6 por ancho) dentro de la sección de ADMINISTRACIÓN; revisado con `git diff`: la carta pública y el resto del texto quedaron idénticos byte a byte.",
      },
      {
        blob: "a41765be9e598bead836060c092370fcde07dc16",
        // El commit PADRE de este (ec86a946) es el último antes de la regeneración; el texto lo cambió el paso 6.15b (carril B): la pantalla de opciones del producto pasó a ser el paso 2 del espacio del producto.
        commit: "ec86a946",
        motivo:
          "Ola «precio y carta», Fase 6, paso 6.15b (CAMBIA UN TEXTO de administración, no la carta pública; regenerado con REGENERAR_LB_PRECIO_Y_CARTA=1 contra motor2_cb_e2e local, con el visto del dueño para regenerar solo las secciones de ADMINISTRACIÓN). La pantalla de opciones de Pizzas (a 1280 y a 375 px) queda dentro del marco del espacio del producto: el título pasa de «Opciones de venta de «Pizzas»» a «Pizzas» con el código, «Por opción», «Disponible en «…»» y la tira de pasos (Resumen, Qué se vende, Opciones y precio, Receta, En la carta), y el paso se titula «Opciones y precio»; «Agregar grupo» (el selector y su botón) pasa a ser el botón «Agregar un grupo existente» que abre una ventana; suma la línea del precio por sucursal con el enlace «Precio local»; y los títulos de los grupos y de «Así se cobra» bajan de nivel (## a ###). Revisado con `git diff`: cambian SOLO las dos secciones «## ADMINISTRACIÓN … Opciones de venta del producto «Pizzas»» (a 1280 y a 375 px); la carta pública (todo lo anterior a la primera sección de ADMINISTRACIÓN), «Grupo de opciones «Tipos de Pizza»» y «Carta › Parametrización › Secciones» quedan idénticos byte a byte.",
      },
      {
        blob: "fb96a2af391557ade14cfefe3cc8b7532e11305a",
        // El commit PADRE de este (401bfba2) es el último antes de la regeneración; el texto lo cambió el paso 6.15c (carril B): el paso 2 del producto suma el botón «+ Nuevo grupo».
        commit: "401bfba2",
        motivo:
          "Ola «precio y carta», Fase 6, paso 6.15c (CAMBIA UN TEXTO de administración, no la carta pública; ADITIVO; regenerado con REGENERAR_LB_PRECIO_Y_CARTA=1 contra motor2_cb_e2e local). La pantalla de opciones de Pizzas (a 1280 y a 375 px) suma el botón «+ Nuevo grupo», que se dibuja porque el usuario de la foto es el administrador y tiene el «Editar» de `opciones_definir`. Revisado con `git diff`: cambian SOLO 2 líneas, `[botón: + Nuevo grupo]`, una en la sección de 1280 px y otra en la de 375 px, justo antes de `[botón: Agregar un grupo existente]`; la carta pública, «Tipos de Pizza» y Secciones quedan idénticos byte a byte.",
      },
      {
        blob: "0ebe73390313f56e4f2fd0af62c988bfddd0da2b",
        // El commit PADRE de este (6666dd43) es el último antes de la regeneración; el texto lo cambió el paso 6.17c (carril B): cada producto de Secciones suma «Abrir en el producto».
        commit: "6666dd43",
        motivo:
          "Ola «precio y carta», Fase 6, paso 6.17c (CAMBIA UN TEXTO de administración, no la carta pública; ADITIVO; regenerado con REGENERAR_LB_PRECIO_Y_CARTA=1 contra motor2_cb_e2e local, con el visto del dueño para regenerar solo las secciones de ADMINISTRACIÓN). La pantalla «Carta › Parametrización › Secciones» (a 1280 y a 375 px) suma el enlace `[enlace: Abrir en el producto]` dentro de la ficha de cada producto de la carta (hacia el paso «En la carta» del espacio del producto): 14 líneas nuevas en total, 7 por ancho (una por cada ficha abierta del volcado). Revisado con `git diff -U0`: son solo líneas agregadas, todas dentro de las dos secciones de Secciones; la carta pública, las opciones de Pizzas y «Tipos de Pizza» quedan idénticos byte a byte.",
      },
      {
        blob: "3859e3a3a80b0d30f425517fc84c4b0fd95780cc",
        // El commit PADRE de este (be697319) es el último antes de la regeneración; el texto lo cambió el paso 6.18 (carril B): el paso 2 del producto suma «Cómo se va a ver en la carta».
        commit: "be697319",
        motivo:
          "Ola «precio y carta», Fase 6, paso 6.18 (CAMBIA UN TEXTO de administración, no la carta pública; ADITIVO; regenerado con REGENERAR_LB_PRECIO_Y_CARTA=1 contra motor2_cb_e2e local, con el visto del dueño para regenerar solo las secciones de ADMINISTRACIÓN). La pantalla de opciones de Pizzas (a 1280 y a 375 px) suma, antes de «Así se cobra», la sección «Cómo se va a ver en la carta» (la forma que le da la carta pública: las pizzas como platos sueltos con su precio de lista). Son 26 líneas agregadas (13 por ancho) y ninguna borrada; las secciones de la carta pública, la tipografía y el resto de la administración quedan idénticos (lo verifica el diff del golden: solo líneas agregadas dentro de las dos secciones «Opciones de venta del producto «Pizzas»»).",
      },
      {
        blob: "1a24a6420e673f56a84dd5a26c270bc25281fab0",
        // El commit PADRE de este (7e676180) es el último antes de la regeneración; el texto lo cambia «+ Opción» / «+ Extra» (bloque 3 de la Fase 6).
        commit: "7e676180",
        motivo:
          "Fase 6, bloque 3 («+ Opción» y «+ Extra»; ADITIVO, solo ADMINISTRACIÓN, la carta pública y el cobro idénticos; regenerado con REGENERAR_LB_PRECIO_Y_CARTA=1): la tarjeta de cada grupo del paso 2 «Opciones y precio» suma el botón «+ Opción» (con el nombre accesible «+ Opción en <grupo>») antes de «Quitar de este producto», para quien puede Editar `opciones_definir`. Revisado con `git diff -U0`: cambian SOLO 2 líneas, las dos de la tarjeta de «Tipos de Pizza» (1280 y 375 px), que suman `[botón: + Opción (lector: «+ Opción en Tipos de Pizza»)]`; las secciones de la carta pública no cambian.",
      },
    ],
  },
};

interface Retirada {
  /** Blob de git del ÚLTIMO contenido que tuvo el golden (el congelado o su última regeneración), para cruzarlo contra la historia. */
  blob: string;
  /** Commit que lo retira (como en las regeneraciones, el PADRE: un commit no puede llevar su propio hash). */
  commit: string;
  motivo: string;
}

/**
 * Goldens RETIRADOS (Fase 3 de la ola «precio y carta»: el retiro de GO-3a borra el golden de las combinaciones junto con su prueba). Un golden no se borra de `CONGELADAS` en silencio: pasa
 * acá con su último blob, el commit y el motivo, y se revisan las dos direcciones: el archivo ya NO existe (si alguien lo vuelve a crear, rojo: o se congela de nuevo o no vuelve) y la ruta ya NO
 * está en `CONGELADAS` (una ruta no puede estar congelada y retirada a la vez). Nunca se borra una entrada: es el registro.
 */
const RETIRADAS: Record<string, Retirada> = {
  "test/caracterizacion-precio-y-carta/combinaciones.golden.txt": {
    blob: "551283ff305dcfff5d8341fa2d50cdd18a1a744c",
    // El commit PADRE de este (ed9ff97, Fase 3 paso 3.2) es el último que lo tiene; se borra en el commit siguiente (paso 3.3).
    commit: "ed9ff97",
    motivo:
      "Ola «precio y carta», Fase 3, paso 3.3 (retiro de GO-3a, DEC-02 y DEC-16; en producción GO-3a no tiene filas ni ventas): la venta y la vista previa ya no leen combinaciones, así que la foto de las combinaciones (CU-07 y CU-11) se borra junto con su prueba (`combinaciones.test.ts`) y su catálogo (`test/setup/referencia-combinaciones.ts`). Congelada en 31354ad con este blob y nunca regenerada. Los goldens de los demás productos (`precios.golden.txt`) y el integrado (`cobro-y-carta.golden.txt`) NO se mueven: esa es la prueba de que el retiro no cambió el precio de nadie.",
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

  it.each(Object.entries(RETIRADAS))("%s está retirada: el archivo ya no existe y no figura en CONGELADAS", (ruta) => {
    expect(existsSync(join(RAIZ, ruta)), `${ruta} está RETIRADA y volvió a existir: o se congela de nuevo (sacala de RETIRADAS y sumala a CONGELADAS) o se borra`).toBe(false);
    expect(Object.hasOwn(CONGELADAS, ruta), `${ruta} no puede estar congelada y retirada a la vez`).toBe(false);
  });

  it("cada retirada está completa (último blob y commit con forma de hash, motivo escrito)", () => {
    for (const [ruta, r] of Object.entries(RETIRADAS)) {
      expect(r.blob, ruta).toMatch(/^[0-9a-f]{40}$/);
      expect(r.commit, ruta).toMatch(/^[0-9a-f]{7,40}$/);
      expect(r.motivo.trim(), ruta).not.toBe("");
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
