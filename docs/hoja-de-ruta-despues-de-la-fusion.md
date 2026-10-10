# Hoja de ruta después de la fusión del PR #95 (2026-10-09)

De lo general a lo específico. Solo documentación: este PR no cambia código. Las fuentes de cada punto están citadas; los planes largos viven en el repositorio de documentación (`motor2-docs`, carpeta `_planes/`), que es privado.

## 1. Dónde estamos
- La rama integradora `pureza-integracion` (PR #95) se **fusionó a `main`** el 2026-10-09 (merge commit `057974b2`). Trae las Fases 0 a 4 de la pureza, las correcciones de las Fases 0 a 3 y el **endurecimiento de seguridad (tandas T1 a T16)**.
- **Producción:** la app `stockhneuquen` se desplegó a mano ese día (`vercel deploy --prod` desde `main`); la consola `plataforma-motor2` y la demo `motor2-demo` desplegaron solas al fusionar. Sin migraciones: `prisma/` no cambió.
- **Gate local** (8 comandos): tsc, lint, arquitectura, knip, build, build de la consola y e2e (517) limpios; `npm test` con 777 archivos y 9.919 tests, 0 fallos. **El CI de GitHub no corrió**: los jobs fallan en 3 segundos por la facturación de Actions.

## 2. El orden propuesto
| # | Qué | Quién decide o autoriza | ¿Migra la base? |
|---|---|---|---|
| **0** | **Antes de todo, lo que debe cerrarse en producción** (sección 3) | Dueño | Solo M.1 |
| **1** | **Cierre de la seguridad que quedó abierta** (sección 4) | Dueño y Claude | M.2 y M.3 sí |
| **2** | **Fase 5** — la base: saldos, índice y candado del Kardex (sección 5) | Dueño, **un paso por vez** | **Sí (3 migraciones)** |
| **3** | **Fase 6** — sesión y tipos fuera del núcleo (sección 6) | Claude, en su propia rama | No |
| **4** | **Etapa A** — gastos, compras y ventas: ADR, funciones puras, y después migraciones M0 a M7 y pantallas (sección 7) | Dueño | Sí, desde la Etapa B |
| — | **Entre medio** (sección 8) y **lo que podría haberse olvidado** (sección 9) | | |

**Cada fase en su propia rama integradora**, con merge commit (no squash), una auditoría independiente por hito, el gate de 8 comandos una vez al final y **ninguna migración ni relleno de datos sin autorización expresa**, base por base, con simulación primero y `down.sql`.

## 3. Paso 0 — Producción (acciones del dueño; el código no las reemplaza)
Lista completa en `docs/pureza-integracion.md` (filas E.1 a E.9 y M.1).
- **E.1** Preview sin credenciales de producción: hoy `stockhneuquen` comparte entre Production y Preview `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `BOOTSTRAP_ADMIN_EMAILS` y las `storagenqn_*`. (Las `DATABASE_URL`/`DIRECT_URL` ya son solo de Production.)
- **E.2** `MOTOR2_ENTORNO_ESTRICTO=1` en Preview; sacar `ALLOWED_EMAIL_DOMAINS` tras desplegar. **E.3** confirmar que `MOTOR2_MIGRAR_EN_BUILD` no existe (hoy no figura en Production).
- **E.4** Dependabot sin Preview. **E.5** la consola no debe desplegar en cada push (`ignoreCommand` en `plataforma/vercel.json`): **se vio que hoy sí despliega** (Preview y Production solos).
- **E.6** Firewall de Vercel (límites por IP). **E.7** GitHub: Dependabot de Actions, actions fijadas por SHA, alertas, aprobación de workflows de forks. **E.8** correo propio de la consola.
- **Facturación de GitHub Actions**: sin ella el check «Gate (requerido)» no puede pasar y ningún PR futuro se puede fusionar con CI.
- **M-33**: confirmar con qué usuario se conecta la app (`DATABASE_URL` debe ser `motor2_app`, no `neondb_owner`: con ese rol la RLS no rige).
- **M.1**: recortar `INSERT/UPDATE/DELETE` de `motor2_app` sobre `Empresa` (script con `-v restringir=1`, simulado antes en una rama de Neon).
- **E.9 Rotación de claves**, **después** de E.1 a E.5, M.1 y el deploy: empezar por la clave de Anthropic que se pegó en un chat. Runbook: `runbook-rotacion-de-claves.md`.
- **Decisiones abiertas del dueño**: D3/S-09 (quién aplica la diferencia de un conteo), 36 (puertas del portal `carta_portal` y sucursales), B8 (tope de 10 códigos de la consola), 43 (correo de quien operó visible en reportes), M-17 (tope de 5.000 claves de los limitadores), M-11, M9 (topes de solicitudes y conteos pendientes), M-35 (banda del dólar).

## 4. Paso 1 — Seguridad que quedó abierta (código y base)
- **M.2** clave fina `producto_campos_sensibles` (precio, factor, unidades, consignante; incluye el factor de la presentación alternativa). **M.3 / R.1** **RLS por sucursal** [MIG] y el guard `alcance-de-sucursal`: hoy 61 consultas y 30 lecturas con `sucursalId` confían en quien las llama.
- **M-19**: el cupo de lecturas se cuenta después de resolver el contexto (su primer intento se revirtió porque cargaba Auth.js en toda lectura). **S-51**: M19 (gates leídos fuera de la transacción).
- Pruebas que faltan: la **mutación contra el `vercel.json` real** (GT-21; el entorno la bloquea, la hace el dueño), el prompt de terminal de M-32 en una terminal real, la limpieza de Sentry con un evento real del SDK.
- Los ~18 hallazgos menores diferidos de las auditorías por recurso: relevarlos uno por uno y dar la lista corta de los que valen la pena.
- Higiene: `git bisect skip` de 7 commits intermedios (`fdd0d146 e1925c89 1cb0fb14 4af23e8b 159cca95 bd5670ab c5258c69`); vigilar los tests de idempotencia de concurrencia (fallaron una vez sin repetirse).

## 5. Fase 5 — La base [MIG] (hoja de `docs/plan-fase-4-pureza.md` §6 y O.13)
Tres pasos, **cada uno con autorización expresa**, simulación primero, base por base, con `down.sql`:
1. **`SaldoStock`**: tabla de saldos por producto, sección y lote (hoy se calcula sumando el Kardex).
2. **Índice** `MovimientoStock(seccionId, productoId)`: el `EXPLAIN` mostró que hoy las lecturas usan `..._productoId_seccionId_loteVencimiento_idx`; **falta medir con volumen real**, y eso es parte de la simulación.
3. **Candado del Kardex**: `REVOKE` más un trigger que impide editar o borrar líneas (solo agregar).
- Preparación hecha (O.13): los escritores de líneas del Kardex bajaron de 5 a 3, con la huella congelada y un guardián de lista cerrada; la Fase 0 ya fijó que el Kardex solo agrega.
- **Respaldo obligatorio**: la base con datos está en Neon (`inventario-api`, rama `main`, plan gratuito con 6 horas de historia): crear un snapshot o una rama de respaldo **antes** de cada paso.
- Riesgo: el candado puede romper scripts de mantenimiento que borran filas (`bench_*`); revisar las excepciones.

## 6. Fase 6 — Sesión y tipos (sin migración; 25 entradas heredadas)
Inventario completo en `test/arquitectura/pureza-heredada-del-nucleo.ts`:
- (a) `core/auth/{base,contexto,ir-al-login,rol-de-ejecucion,session}` a `server/sesion`, una sola vez y sin tocar su código.
- (b) Los tipos de Prisma en `core`: 19 archivos solo con tipos más `core/fiscal/factura-autorizada.ts` (que recibe `Db` y lo usa la consola, que no puede importar `src/server`): tipos de dominio propios.
- (c) Los resabios de `server/sesion` (O.24): `new Date()` y `ALLOWED_EMAIL_DOMAINS` en `acceso.ts`, hasta que el borde de Auth.js reciba la hora y el entorno ya leídos.
- (d) El único estado de módulo permitido en `core` (`let datosDelRolDelProceso`, `core/auth/base.ts`).
- (e) **241 `vi.mock` de `core/auth/session`** en tests y scripts, que el codemod de imports no reescribe: cambiarlos a mano o con una herramienta nueva.
- (f) Las 2 lecturas de `auth/usuarios.ts` con `new Date()` (D.3). (g) Diferidos a esta rama u otra: **O.38b** (recetas vigentes y precio local por capacidad para N sucursales) y **O.14** (lecturas repetidas de la venta).
- Meta: **todo `src/core/` en nivel P0** (hoy 286 de 311).

## 7. Etapa A — Gastos, compras y ventas (`plan-unificado-gastos-compras-y-ventas.md`, v1.0 cerrada + v1.1)
**Aviso de nombres:** el plan unificado llama «Fase 5/6» a otra cosa (pagos, cuenta corriente y fiscal); **no son las Fases 5 y 6 de la pureza**.
- **Etapa A (sin migración):** (1) **ADR único** (aún sin escribir), (2) línea de base, (3) guardián `kardex-solo-agrega`, (4) tests de caracterización, (5) funciones puras con consumidor (reparto de cantidades y dinero, nota de crédito, aviso de duplicado, fraccionador de ventas, validación de distribuciones, `NumeroComprobante`) y **IVA-1 a IVA-5**, (6) módulo `servicios` «en desarrollo».
- **Etapa B (migraciones, cada una con autorización):** **M0-IVA** (`Empresa.condicionIva`, `Producto.alicuotaIvaVenta/Compra`), **M1** proveedor de productos/servicios, **M2** `Venta` y reversiones, **M3** factura de proveedor repartida, **M4** conceptos de gasto, **M5** reclasificación, **M6** nota de crédito, **M7** centros de costos.
- **Etapa C:** casos de uso y pantallas tras cada migración (factura repartida, «Gastos y servicios», notas de crédito, anular unidades, unidades de negocio).
- **Decisiones del dueño del 2026-10-08 que entran:** unidad de stock inmutable con historia (CAT-1), IVA por producto (CAT-8), conversión de unidades propia con `decimal.js`, rubros y unidades de negocio como datos de la consola (plantillas de rubro), **conteo por insumo** (`modoDeConteo`), cierre de períodos (CP0 a CP2), **bienes de uso** (Fase 7: BU0 a BU8 y CF1/CF2).
- **Facturación fiscal** (`EmisorFiscal`): SOAP propio primero (WSAA + WSFE), AfipSDK después; elección por empresa; facturar es un proceso posterior al cierre, con la solicitud persistida antes de llamar a ARCA y la llamada fuera de toda transacción; reconciliación a cargo de motor2. Faltan el spike de homologación (certificado por adaptador) y verificar `FEParamGetTiposIva`.
- **Grupos de opciones — HUECO DECLARADO (GO-0 a GO-2, 2026-10-10)** (tamaño, variante, guarnición, adicional; el café por modificadores es el caso disparador). **No está en la Fase 5** (esa es solo `SaldoStock`, índice y candado del Kardex) y hasta ahora no tenía ítem propio: estaba nombrado en una viñeta y la pieza de diseño no existe. Queda declarado así (las siglas son propuestas; el dueño las ajusta):
  - **GO-0, Etapa A (sin migración):** escribir la pieza de diseño (grupos con mínimo y máximo, lista de permitidos por producto y por sucursal, recargo como línea aparte, IVA del recargo, efecto sobre el stock, frontera con los ítems agrupados) y su ADR. Se escribe después de M2 y **solo cuando el dueño responda las preguntas que bloquean**: 1 a 4 y las 7 de §5.4 de `preguntas-abiertas-grupos-de-opciones-cafe-2026-10-09.md` (ticket consolidado o línea aparte, stock suma/reemplaza/escala, IVA del recargo —depende de CAT-8/M0-IVA—, frontera con ítems agrupados, guarnición premium, tope del adicional, lista por sucursal).
  - **GO-1, Etapa B (migración con autorización, sin número todavía):** tablas de grupos y opciones y la referencia opcional a la línea padre que M2 ya reserva. Va **después de M0-IVA y M2**.
  - **GO-2, Etapa C:** casos de uso y pantallas (configurar grupos, tomar el pedido con opciones, carta pública con precios por tamaño —requiere ampliar la lista cerrada con aprobación—).
  - Decididas: decisiones 5, 7, 8 y 9 del 2026-10-08 (modificadores sin stock quedan descartados por ahora). Por defecto un producto no admite nada. En el código no existe nada de esto.
  - Mientras GO-0 no se escriba, **este hueco no tiene dueño de ejecución ni fecha**: figura también en `docs/pureza-integracion.md` (fila GO).
- **Las 52 preguntas** (`cruce-52-preguntas-odoo-dolibarr-motor2-2026-10-08.md`): 11 cerrables, unas 15 de negocio del dueño y 4 que cambian el modelo (3, 11, 13, 28). Prioridades propuestas: idempotencia obligatoria en el servidor (H-2, H-3, H-4), reversa del pago al consignante, borrador persistido de la factura y separar factura, recepción y pago.

## 8. Lo que viene entre medio
- **Entre el paso 0 y la Fase 5:** el respaldo de Neon y el ensayo (rama de Neon) de cada migración; revisar que ningún script de mantenimiento choque con el candado.
- **Entre las fases y la Etapa A:** terminar M.2/M.3 (la RLS por sucursal conviene **antes** de sumar tablas de documentos por sucursal), cerrar el ADR único y la lista de las 52 preguntas, y decidir si el CI de GitHub se repara (facturación) o se usa un runner propio.
- **Deploy:** hoy la app despliega a mano; reactivar los deploys automáticos de la app es una decisión aparte (hace falta CI en verde y las variables de Preview separadas).

## 9. Lo que podría haberse olvidado (revisar con el dueño)
1. ~~**E.5 y E.1**~~ **Hechas (2026-10-10):** E.1 a E.3 en Vercel; E.5 y E.7 en código en este PR (E.5 surte efecto al fusionarlo).
2. **Rotación de claves** y la clave de Anthropic pegada en un chat.
3. **Idempotencia obligatoria** de consumo, merma, ajuste y compra sin N.º de factura (hallazgos H-2/H-3/H-4 del cruce): verificar si quedó cerrada con el endurecimiento.
4. **Pago al consignante** sin reversa ni tope contra saldo (el único flujo «no cumple»).
5. **Skew Protection de Vercel** (acción del dueño) y el límite de Neon (plan gratuito, 6 horas de historia): política de respaldos.
6. **Módulo de reservas** (no existe; destino de «asociar a reserva» de la facturación).
7. **Contador**: confirmar el tratamiento de percepciones de IIBB y Ganancias (valor por defecto: crédito).
8. **Dominio de la carta** (`CARTA_DOMINIO_BASE`) y la carta pública si se amplía con precios por tamaño (hay que ampliar la lista cerrada con aprobación).
9. **Documentos desactualizados**: `docs/plan-de-pureza-y-estado.md` dice que el CI funciona y que la Fase 4 espera fusión; este PR agrega una nota de actualización.
10. **Procedimientos operativos** (gate, deploy, rollback, sincronización de documentos): `procedimientos-operativos.md` en el repositorio de documentación.
