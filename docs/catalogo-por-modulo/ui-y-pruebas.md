# Catálogo por módulo: PANTALLAS (UI) Y PRUEBAS TRANSVERSALES — 2026-11-06

Inventario de SOLO LECTURA (no se tocó código ni se corrió ningún test ni el gate). Rama `alegp/catalogo-ui-y-pruebas` sobre `50c1153`. Diseño de partida leído: `origin/alegp/diseno-flujos-y-pasos:docs/diseno-flujos-y-pasos-2026-11-06.md` (`ecec656`). Evidencia como `archivo:línea` donde la línea se leyó; el resto va como `archivo` y lo no comprobado, como NO VERIFICADO (§9).

## 1. FLUJOS de la capa de pruebas y de pantallas

| Flujo | Para qué existe | Pasos (cómo se completa) | Evidencia |
|---|---|---|---|
| F1 Regla nueva entra al gate | que una regla de arquitectura no dependa de la memoria de nadie | 1) se escribe un guardián `test/arquitectura/*.test.ts` (188 archivos, 28 611 líneas) o un contrato en `contratos/contratos/*.ts` + `manifiesto.ts` (receta en `contratos/LEEME.md`); 2) si ya hay violaciones: línea de base congelada (`CREAR_CERCOS=1`) o `deuda` del contrato; 3) se asienta su huella en `gobernanza/aprobaciones.ts`; 4) corre en `npm run arquitectura` (dep-cruiser + `contratos/ejecutar.ts`, falla si leyó menos de `PISO_DE_ARCHIVOS_LEIDOS`=2254, `politica.ts:~33`) y en `npm test`; 5) CI: jobs `estatico`/`integracion`/`gate` (`.github/workflows/ci.yml:51,148,435`) | `cercos/trinquete.ts:1-30`, `contratos/politica.ts`, `ci.yml:60-90` |
| F2 Excepción de un CERCO | dejar pasar un archivo que el cerco cuenta | 1) agregar `{ruta, motivo}` a `excepciones` del cerco (exacta, con motivo); 2) el trinquete exige que el archivo exista y siga violando; 3) **no hay responsable, aprobación ni fecha** | `trinquete.ts:36-39` (`Excepcion = {ruta, motivo}`) |
| F3 Excepción/deuda de un CONTRATO | dejar pasar un uso concreto | `excepciones[]`/`deuda[]` con motivo≥20, responsable `dueño`, aprobación `PR #n`/`commit`/`DEC-nn`, `creada`, `vence` ≤60 días (G1b), hasta 2 renovaciones sin aviso | `politica.ts:15-30`, `contratos/tokens-visuales.ts:26-32` |
| F4 Excepción de dep-cruiser | dependencia prohibida permitida | entrada con `motivo` en `.dependency-cruiser-excepciones.cjs`; `dependencias.test.ts` exige que siga haciendo falta. **Sin fecha ni responsable** | `.dependency-cruiser-excepciones.cjs:1-12`, `473-488` |
| F5 Excepción de knip | export/dependencia “sin uso” legítima | línea en `knip.jsonc` con comentario `RESERVADO —` (convención, no esquema). **Sin fecha** | `knip.jsonc:30-90` |
| F6 Bajar un cerco | pagar deuda | `BAJAR_CERCOS=1 npx vitest run <cerco>`; solo escribe si nada subió | `trinquete.ts:10-16` |
| F7 Pantalla nueva | que use las primitivas | usar `src/ui/primitivas/*` o `src/ui/componentes/*`; lo vigilan 8 contratos `primitiva-*`, `tokens-visuales`, y 10 cercos (controles, diálogos, colores, tipografía, number, inputmode, fecha, número de formulario, modo oscuro, primitivas de dominio) | `contratos/manifiesto.ts`, `cercos/linea-de-base/` |

Observación de flujo: F2, F4 y F5 son excepciones sin responsable ni vencimiento; solo F3 cumple G1b. El cerco «solo baja» pero no tiene reloj.

## 2. INVENTARIO DE GUARDIANES (188 `*.test.ts` + `guardas/` + `contratos/`)

Agrupados por tema (no uno por uno: 188 archivos). «Lista de deuda» = entradas que hoy se toleran.

| Guardián (grupo) | Qué vigila | Fuente única que defiende | Lista de deuda (cant.) | ¿Vencimiento? | ¿Mira todo lo que dice? |
|---|---|---|---|---|---|
| 15 cercos `cerco-*.test.ts` + `cercos/trinquete.ts` (416 líneas) | UI/datos: controles a mano, diálogos, colores, tipografía, `type=number`, `inputMode`, fecha de texto, nº de formulario, modo oscuro, primitivas de dominio, dueño único por modelo, columnas de significado, escritores de precio, casos de uso en guardianes | `src/ui/*`, tokens de `globals.css`, `core/datos/importe.ts`, `core/tiempo` | **170 entradas en 15 JSON** (§7) + 20 excepciones/motivos inline | No (solo texto «meta: … Fase 6 / lote 6.33 / Fase 2») | Raíces `src` + `plataforma/src`; `.tsx`/`.ts` por AST. NO mira `test/` ni `scripts/` (`cerco-controles-a-mano.test.ts:44`) |
| 8 contratos `primitiva-*` (`contratos/primitivas.ts:23-36`) | `<Boton/Campo/Selector/AreaDeTexto/Casilla/Aviso/Enlace/Insignia>` se importa de la fuente y no se redefine | cada archivo de `src/ui/primitivas` marcado `// @contrato` | 0 (`deuda: []`, `excepciones: []`) | n/a | Raíces `test/ui`, `src/app`, `src/components`. **No cubre `plataforma/src`** ni `src/ui/componentes/*` (Dialogo, CampoFecha, TablaDeDatos, PestanasDeRuta, LecturaEnVivo) ni `OpcionesExcluyentes` (sin `@contrato`: `grep @contrato src`) |
| contrato `tokens-visuales` | color solo vía tokens `--color-*` | `src/app/globals.css` `@theme static` | **15** alias de color del salón | **Sí: 2026-12-20** (`tokens-visuales.ts:31`), 60 días desde 2026-10-21, ref DEC-03 | Raíces `src/app`, `src/components`, `src/ui`; no `plataforma/src` (la cubre `cerco-colores`) |
| `contrato borde-propio-de-carta`, `separador-de-lista-de-carta` | CSS de la carta | `globals.css:304-308` | 0 | n/a | solo CSS |
| `primitivas-sin-clases-de-presentacion`, `ui-sin-negocio`, `boton-no-en-componentes-de-servidor`, `campos-con-nombre`, `encabezados-de-tabla`, `iconos-accesibles`, `contraste-de-color`, `tokens-del-sistema-visual`, `sin-modo-oscuro`, `sin-alias-de-color-del-salon`, `loading-sin-404`, `pantalla-de-error` | reglas duras de UI (base 0) | `src/ui`, `globals.css` | 0 declarados | n/a | `src/app`+`src/components` (no `plataforma/`) según `primitivas-sin-clases-de-presentacion.test.ts` cabecera |
| `dependencias.test.ts` + `.dependency-cruiser*.cjs` (515+488+29 líneas, 38 reglas) | capas, dominios, ciclos; que cada excepción siga haciendo falta | `.dependency-cruiser.cjs`, `-dominios.cjs` | **100** (ACCIONES_CON_CASO_DE_USO 50, persistencia-de-otro-dominio 34, base-solo-desde-lista 8, db-solo-desde 4, sesion-capa 2, otras 2) | No | `src plataforma next.config.ts` (`package.json` script `arquitectura`) |
| `caracterizaciones-congeladas` | hash de goldens | el archivo golden | 17 CONGELADAS (+RETIRADAS) | No | solo los listados |
| `ids-de-sucursal-declaran-a-que-se-atan` | todo `sucursal…Id` recibido declara a qué se ata | `src/server/actions/**` | 36 DECLARADAS (no es deuda: inventario cerrado) | No | acciones |
| `escrituras-en-sucursal-desde-empresa` | escritura a sucursal desde acción de empresa | ídem | 11 DECLARADAS | No | acciones |
| `semantica-sin-fila` | modelos por sucursal: familia «sin fila = …» | `prisma/schema.prisma` | 35 REGISTRO | No | modelos con `sucursalId` |
| `oraculos-entre-empresas` | lecturas de `user`/`empresa` | `src/**` | 18 LECTURAS | No | `src` |
| `sin-filas-enteras` | `select` obligatorio en modelos sensibles | `src/server/persistencia` | 4 + `SIN_SELECT` | No | `src` |
| `variables-de-entorno-declaradas` | toda `process.env.X` en schema | `src/env.ts` | 26 FUERA_DEL_SCHEMA + 3 listas más | No | `src`, consola, scripts |
| ~150 guardianes restantes (acciones, guardas, permisos, carta, pos, auditoría, tiempo, kardex…) | seguridad/dominio, fuera del alcance UI | varios | NO VERIFICADO uno por uno | No (grep `vence`/`venceElDia` en `test/arquitectura`: solo contratos y `cantidad-acotada` por nombre de reporte) | ver §9 |
| knip (`knip.jsonc`) | código muerto, código de salida 0 | — | 5 `ignoreDependencies` + 2 `ignoreExportsUsedInFile` (todos los `type`/`interface`) + ~13 `entry` a mano | No | workspaces `.` y `plataforma` |
| eslint (`eslint.config.mjs`, 62 líneas) | `no-floating-promises`, `no-misused-promises`, `$queryRawUnsafe` | — | 0 | n/a | `src`, `plataforma`; **no `test/` ni `scripts/`** para el `no-restricted-properties` (`eslint.config.mjs:31-33`) |

## 3. PRIMITIVAS DE PANTALLA y componentes duplicados

Fuente real: `src/ui/primitivas` (9 archivos, 648 líneas) y `src/ui/componentes` (5). Usos = archivos `.tsx` de `src/` + `plataforma/src` que usan la etiqueta (conteo con grep).

| Nombre | Archivo | Variantes | Usos | ¿Guardián? |
|---|---|---|---|---|
| Boton | `src/ui/primitivas/boton.tsx:105` | `variante`, `tamano`, `cargando` | 84 | Sí (contrato + cerco-controles) |
| Campo | `campo.tsx:142` | `etiqueta`, `ayuda`, `error`, `alinear` | 60 | Sí |
| Selector | `selector.tsx:29` | tamaño | 43 | Sí |
| AreaDeTexto | `area-de-texto.tsx:26` | tamaño | 9 | Sí |
| Casilla / Enlace / Insignia | `casilla.tsx:27`, `enlace.tsx:28`, `insignia.tsx:31` | tono/variante | 19 / 16 / 7 | Sí (contrato) |
| Aviso | `aviso.tsx:64` | `variante`, `forma` | 83 | Sí + cerco diálogos/avisos |
| OpcionesExcluyentes | `opciones-excluyentes.tsx:39` | — | 8 | **No** (sin `@contrato`) |
| Dialogo | `src/ui/componentes/superposiciones/dialogo.tsx:61` | `forma`, `ancho` | 12 | Solo cerco diálogos (estático) |
| CampoFecha, TablaDeDatos, PestanasDeRuta, LecturaEnVivo | `src/ui/componentes/*` | — | 16 / 2 / 5 / 3 | **No** |
| CampoNumero | `src/components/campo-numero.tsx` (194) | tipos de número | 29 | Cercos `type-number`/`inputmode` (por exclusión), no contrato |
| CampoCodigo, CampoNumeroDeComprobante | `src/components/campo-codigo.tsx`, `campo-numero-de-comprobante.tsx` | — | NO VERIFICADO | No |
| **Modal** | `src/components/modal.tsx:14` (envuelve `Dialogo`) | — | 5 archivos | **No: segundo diálogo** junto a `Dialogo` |
| **QuickCrear** + `QuickCrearProducto` | `src/components/catalogo/quick-crear.tsx` (81), `quick-crear-producto.tsx` (98) | alta rápida por modal | 5 pantallas | No |
| **Activar/desactivar ×3** | `boton-activar-desactivar.tsx:21` (111), `activar-desactivar-fila.tsx:18` (52), `boton-con-confirmacion.tsx:31` (159) | confirmación sí/no | 5 / 7 / 12 archivos | No: tres componentes para «activar/desactivar con confirmación» |
| **Alta «nombre + Crear» copiada** | `panel-de-maestro-simple.tsx` (usado en 2 pantallas: motivos-merma, destinos-consumo) vs ≥15 pantallas con `name="nombre"`+Crear/Agregar (sucursales, roles, agrupados, categorías, unidades, clientes, proveedores, alta-de-grupo, alta-de-opcion, secciones…) | — | 15 | No |
| **20 casos de uso `actualizar-activo/a-*`** | `src/server/actions/**/casos-de-uso/actualizar-activo(a)-*.ts` (20; ej. `actualizar-activo-grupo.ts` 28 líneas, `actualizar-activo-cliente.ts` 38, `actualizar-activo-sucursal.ts` 155) | — | 20 | No (cada uno pasa por `casos-de-uso-con-tags-de-contrato`, sin detectar la copia) |
| Avisos de acción | `aviso-con-deshacer.tsx` (120), `avisos-de-accion.tsx`, `form-con-resultado.tsx` (136), `boton-de-servidor.tsx` (15) | — | NO VERIFICADO | No |

Controles crudos fuera de `src/ui`: `<button>` en 25 archivos, `<input>` en 31, `<select>` en 9, `role=dialog` en 7 (grep). Están en la línea de base de los cercos (§7), incluidas 9 piezas de `src/components` (menu-celular, selector-empresa, selector-producto, selector-rango, selector-sucursal, sidebar-colapsable, sidebar-nav, campo-numero, carta/campo-color) que son ellas mismas pantallas «compartidas» sin primitiva.

## 4. FUENTES DE VERDAD (listas duplicadas / el mismo valor en dos listas)

| Valor | Dónde está (más de una fuente) | Evidencia |
|---|---|---|
| Colores/tokens | `globals.css` `@theme static` (fuente) + `cerco-colores` (hex y escala, 11 excepciones inline) + contrato `tokens-visuales` (15 alias, vence 2026-12-20) + `tokens-del-sistema-visual`, `contraste-de-color`, `sin-alias-de-color-del-salon`, `cerco-modo-oscuro` **y** `sin-modo-oscuro.test.ts` | `cerco-colores.test.ts:72-91`, `tokens-visuales.ts:26`; `sin-modo-oscuro` y `cerco-modo-oscuro` (0 entradas) dicen lo mismo |
| Primitivas | contratos `primitiva-*` (8) **y** `cerco-controles-a-mano`/`dialogos` **y** `primitivas-sin-clases-de-presentacion`: tres guardianes por primitiva, con alcances de carpetas distintos (contrato: `test/ui`,`src/app`,`src/components`; cercos: `src`+`plataforma/src` menos `src/ui`) | `primitivas.ts:29`, `cerco-controles-a-mano.test.ts:44` |
| Metas «Fase 6», «lote 6.33», «Fase 2» | texto libre en 15 JSON + 10 cabeceras de test; no es un dato único | `linea-de-base/*.json` campo `meta` |
| Excepción con motivo | 4 formatos distintos: `{ruta,motivo}` (cercos), `{archivo,fragmento,motivo,responsable,aprobacion,creada,vence}` (contratos), `{desde,hacia,motivo}` (dep-cruiser), `RESERVADO —` en comentario (knip) | `trinquete.ts:36`, `contratos/tipos.ts`, `.dependency-cruiser-excepciones.cjs`, `knip.jsonc` |
| Responsable permitido / plazo 60 días | `politica.ts` (`HORIZONTE_EXCEPCION_DIAS`/`HORIZONTE_DEUDA_DIAS`, dos constantes con el mismo valor 60) ; `scripts/auditoria-dependencias-excepciones.ts` usa otro formato (`venceElDia`, sin tope) | `politica.ts:~19-22`, `auditoria-dependencias-excepciones.ts:10-21` |
| Dos listas de dominios | `.dependency-cruiser-dominios.cjs` (9 negocio + 12 infra) vs `dominios-clasificados.test.ts` (lo verifica); y `COMANDOS_PUBLICOS` (1) exporta una lista que el cruzador usa dos veces (exportada con dos estilos de clave: kebab y MAYÚSCULAS) | `.dependency-cruiser-excepciones.cjs:473-488` |
| Exclusión de `plataforma/` | cada cerco repite `raices: ["src","plataforma/src"]` a mano; el contrato lo omite | `cerco-*.test.ts` |
| Lista de módulos con `server-only`/`next/headers` stubs | `knip.jsonc` (`entry`) + `vitest.config.ts` alias | `knip.jsonc:60-70` |

## 5. AYUDANTES DE PRUEBA duplicados

| Ayudante | Copias | Archivos (muestra) |
|---|---|---|
| `hacerGerente` | **7** locales | `test/administracion/gerente-unico.test.ts:35`, `gobierno-g2-usuarios`, `gobierno-g2-sucursales`, `seguridad-s1a-admin-y-sucursales`, `test/permisos/{caracterizacion-supuestos-rbac,actor-releido-en-la-transaccion,techo-en-el-alta-de-sucursal}.test.ts` |
| `crearEmpresa` | 5 locales + el compartido `test/setup/crear-empresa.ts` (16 archivos lo usan) | `test/auth/{db-de-empresa,empresa-activa}`, `test/persistencia/{modulos-desde-la-consola,multiempresa-estructura}`, `test/core/carta-empresa-carta` |
| `sembrar` (sin sufijo) | **35** definiciones locales (9 en `test/` no-e2e, 25 en `test/e2e/*.spec.ts`), 75 archivos lo nombran | `test/reportes/*`, `test/aislamiento/*`, `test/carta/*`, casi todos los `test/e2e/pos-*`, `carta-*`, `stock-*` |
| `sembrar*` con sufijo | ≥65 más (`sembrarMundo` 3, `sembrarBase` 2, `sembrarCatalogo` 2, `sembrarBife` 2, …) | 205 archivos definen alguna `crear*/hacer*/sembrar*/armar*` |
| `crearProducto` / `crearProveedor` | 3 / 2 | `test/consultas/catalogo/recetas.test.ts`, `test/e2e/catalogo-ficha-*` |
| Compartidos que sí existen | `test/setup/` 35 archivos (`empresa-de-prueba.ts`, `membresia.ts`, `siembra-precio-y-carta.ts`…) y `test/e2e/fixtures/` 19 (`base-e2e.ts`, `db.ts`, `auth.ts`…). `siembra-precio-y-carta` existe **dos veces** (`test/setup/` y `test/e2e/fixtures/`) | listados con `ls` |

No hay guardián de «fábrica local duplicada» (los de `test/setup` no se hacen cumplir). `fechas-fijas-en-tests-con-base` y `mocks-sin-huerfanos` son los únicos guardianes sobre hábitos de test.

## 6. ARNESES Y ORÁCULOS

Fuente: `docs/mapa-cobertura-de-combinaciones-2026-10-28.md:15-29` y `docs/diseno-arnes-de-matrices-2026-11-03.md` (E0 hecha; E1–E3 en papel).

| Módulo | Oráculo | Test exhaustivo | Guardián de dimensión nueva | Qué falta |
|---|---|---|---|---|
| Permisos y acceso | `test/permisos/matriz-esperada.ts` | sí | **Sí** | rol×clave solo por muestras (mapa:26) |
| Compras etapa 1 (comprobante único) | `docs/oraculo-combinaciones-compras-etapa-1…` + `test/setup/oraculo-comprobante-unico.ts` | sí (32 filas) | **Sí** `combinaciones-comprobante-unico-declaradas.test.ts` | — |
| Compras etapa 2a (unidad de compra) | `test/setup/oraculo-unidad-de-compra.ts` | sí (32) | **Sí** `combinaciones-unidad-de-compra-declaradas.test.ts` | — |
| Traspasos | `traspaso-guard.test.ts` (estados×operaciones×lados) | sí | Parcial | `ESTADOS` escrito a mano (mapa:27) |
| Carta pública / visibilidad | `test/carta/{va-con,incluye-en-carta,nombre-en-carta}.oraculo.ts`, `forma-de-la-carta.oraculo.test.ts`, `visibilidad-de-promos-matriz.test.ts` | parcial | Parcial | la carta ignora vigencia; sin matriz lectores×regla |
| Promos / combos / cupos | `test/pos/{promo-a-elegir,ticket-oculto}.oraculo.ts` | propiedades | No | matriz qué/a quién/qué precio |
| Stock / Kardex | `Record` de procesos (compila) | propiedades | Parcial | tabla proceso×campos |
| Mesas / cuentas | — | ejemplos | Parcial | estado×operación |
| IVA de compras | CHECKs SQL | propiedades | Parcial | matriz de exigencia |
| Cobro/precio, Factura repartida, Consignación, Reportes de costos, Clientes/descuentos | — | goldens/ejemplos | **No** | las 5 sin oráculo ni guardián |

Resumen: de 13 módulos del mapa, **2–3 con guardián de dimensión completo, 5 parcial, 5 «No»**. **E1 `recorrerMatriz` nunca se escribió** (`grep recorrerMatriz` en `test src scripts`: 0 resultados; la regla era «a la 4.ª matriz» y ya hay ≥5 oráculos `.oraculo.ts` + 2 de `test/setup`). E2 (guardián de columna nueva en modelos de dinero/visibilidad/stock) = el cerco `columnas-de-significado` (82 entradas, meta «bajar a 0 (E2)»), o sea el guardián existe pero nace con 82 columnas sin declarar.

## 7. DEUDA

| Ítem | ¿Vencimiento? | Dónde / cantidad |
|---|---|---|
| Línea de base `columnas-de-significado` (meta E2) | No | 82 entradas (48 % de toda la deuda de cercos) |
| `controles-a-mano` (meta «Fase 6») | No | 89 usos en 30 archivos (button 47, input 24, hidden 16, select 2) |
| `dialogos-y-avisos-a-mano` («Fase 6») | No | 31 en 17 archivos |
| `campo-type-number` («lote 6.33») | No | 23 en 11 archivos (cada uno con motivo A_ENTERO/…) |
| `inputmode-numerico-a-mano` («lote 6.33») | No | 17 en 9 |
| `dueno-unico-por-modelo` («Fase 2», PrecioLocalProducto DEC-22) | No | 19 en 7 modelos |
| `tipografia` («§19.4») | No | 52 en 5 |
| `fecha-de-texto-a-mano` («lote 6.33») | No | 3 en 3 |
| `colores-de-escala` («Fase 6») | No | 2 |
| `primitivas-de-dominio` («Fase 2») | No | 2 |
| `colores` («Fase 6») | No | 1 |
| `casos-de-uso-en-guardianes` | No | 1 |
| `escritores-de-precio-con-visto`, `modo-oscuro`, `numero-de-formulario-a-mano` | — | 0 entradas, **los 3 JSON ya están en 0 y siguen como cercos**: candidatos a pasar a regla dura (como hizo `carta-publica-tipografia`) |
| **Subtotal cercos** | 0 de 170 con fecha | 15 JSON, 170 entradas; metas «Fase 6 / lote 6.33 / Fase 2» (50+23+9 = 82 entradas con hito nombrado; 88 sin hito: columnas 82, tipografía 5, casos de uso 1). Esto **no coincide** con «240 en 11 cercos» del encargo: NO VERIFICADO el origen de 240 (¿otra rama?) |
| Excepciones inline de cercos (motivo, sin fecha) | No | colores 11, controles 5, diálogos 3, tipografía 1, +modo-oscuro 3 claves |
| Contrato `tokens-visuales` (15 alias del salón, DEC-03) | **Sí 2026-12-20** (44 días desde hoy) | `tokens-visuales.ts:31` — 15 deudas con el mismo `vence` |
| `EXCEPCIONES_DE_AUDITORIA` (Prisma: deepmerge-ts, mysql2) | **Sí 2026-12-01** (25 días) | `scripts/auditoria-dependencias-excepciones.ts:13-20` |
| `EXCLUSIONES` de clasificación | n/a | vacía (`exclusiones.ts:30`) |
| `.dependency-cruiser-excepciones.cjs` | No | 100: ACCIONES_CON_CASO_DE_USO 50, persistencia-de-otro-dominio 34, base 8, db 4, sesión 2, otras 2 |
| `knip.jsonc` | No | 5 ignoreDependencies, 2 reglas de tipos, 13 entradas |
| Listas «cerradas» dentro de guardianes (no son deuda declarada pero se comportan como tal: crecen y no vencen) | No | ids-sucursal 36, semántica 35, env 26, oráculos 18, caracterizaciones 17, esc-sucursal 11, sin-filas 4 |

**Las «13 listas» del encargo**: no pude reconstruir cuáles son; con lo que leí cuento **19 listas distintas** (15 JSON de cercos + dep-cruiser + knip + deuda de contratos + auditoría de dependencias). **Re-fecharía** (todas con tope 60 días, G1b): las 15 líneas de base de cercos como mínimo en bloque por cerco (la Fase 6 ya pasó, así que las 5 «Fase 6» deben pasar a fecha o cerrarse), `dep-cruiser` (100), y reducir `tokens-visuales` a un único vencimiento; las 3 con 0 entradas se cierran sin fecha.

## 8. INTERFACES (lo que cruza a otros módulos; no se inventarió)

- Guardianes de acciones/guardas/permisos/auditoría/tiempo/kardex (≈150 archivos): pertenecen a los módulos de servidor y seguridad; aquí solo se anota que comparten `trinquete.ts`/`probar-cerco.ts` y `guardas/*.ts`.
- `cerco-columnas-de-significado` + `cerco-dueno-unico-por-modelo`: lista modelos Prisma de dinero/stock (módulo datos/esquema).
- `casos-de-uso-con-tags-de-contrato` y `ficha-de-caso-de-uso`: dependen de la estructura `src/server/actions/**/casos-de-uso` (módulo casos de uso).
- Los 20 `actualizar-activo(a)-*` pertenecen a catálogo, auth, carta, permisos, movimientos y clientes: acá solo el patrón duplicado.
- Oráculos y fábricas de siembra viven en `test/` pero son del dominio (compras, carta, pos, permisos).
- `scripts/` (`construir.ts`, `conteo-e2e*.ts`, `auditar-dependencias.ts`, seeds, `scripts/arquitectura/inventario.ts`): operación/CI; los seeds de demo no se leyeron.
- Con el diseño de flujos y pasos (`docs/diseno-flujos-y-pasos-2026-11-06.md`): hoy **ningún** cerco, contrato ni oráculo tiene un campo «para qué / flujo / paso»; la única declaración de finalidad es el texto `porQue` de cada contrato (`tipos.ts`) y `motivo` de cada excepción.

## 9. NO VERIFICADO

- Cuáles son las «13 listas» y el origen de «240 entradas / 11 cercos» (acá: 170 / 15 archivos JSON; 11 cercos con entradas > 0 = 12).
- Alcance real y lista de deuda de ~150 guardianes de servidor/seguridad (no leídos uno por uno); sus listas internas (§2) están contadas por patrón de regex, no revisadas.
- Conteos de usos de primitivas por grep de etiqueta (`<Boton`…); no distingue importes alias ni `React.createElement`.
- Si `CampoCodigo`/`CampoNumeroDeComprobante`/`AvisosDeAccion`/`FormConAviso` tienen duplicados funcionales.
- Que las 15 pantallas con alta «nombre + Crear» sean estructuralmente idénticas (se confirmó `name="nombre"` + Crear/Agregar, no el resto).
- `ci.yml` jobs `conteo`/`conteo-e2e`/`gate` (solo encabezados), `seguridad.yml`, `codeql.yml`, `gitleaks.yml`, `stryker*.config`: no leídos a fondo; `scripts/` salvo `auditoria-dependencias-excepciones.ts` no leídos.
- Que `cerco-escritores-de-precio-con-visto` y `cerco-numero-de-formulario` midan algo real con 0 (el piso `PISO_DE_ARCHIVOS_LEIDOS` es global, no por cerco).
- La rama de compras (`alegp/compras-etapa-1`) no se leyó; el estado de sus oráculos sale del mapa y de los guardianes ya en `main`.
