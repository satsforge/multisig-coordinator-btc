# Coordinador Multifirma BTC

Repo: [github.com/satsforge/multisig-coordinator-btc](https://github.com/satsforge/multisig-coordinator-btc)

Coordinador de wallets multifirma (P2WSH) 100% del lado del cliente, al
estilo de [Caravan](https://github.com/caravan-bitcoin/caravan) pero como
una herramienta de un solo archivo, en el mismo espíritu que el resto del
grupo [SatsForge](https://github.com/satsforge). Arma una wallet M-de-N a
partir de las claves públicas extendidas de cada cosigner (o de un
descriptor ya armado por otra herramienta) y consulta su saldo real contra
la red — **sin que ninguna clave privada, ni siquiera pública en el sentido
de "una sola", pase nunca por acá**: esta herramienta solo entiende
descriptores y xpubs.

> ⚠️ **Aviso importante — proyecto sin auditoría externa todavía.**
> Deriva direcciones reales de Bitcoin a partir de claves públicas de
> terceros. Nadie ajeno a este repositorio auditó el código todavía. Es
> software "tal cual", sin garantía. **Probá primero en testnet.** Antes de
> confiarle una wallet real: leé el código fuente vos mismo.

## Un proyecto en fases

Esta herramienta se construye en fases, cada una un incremento real y
usable por sí solo — no una demo parcial:

- **✅ Fase 1 — Configurar y consultar.** Armar la wallet M-de-N a partir de
  xpubs/descriptores, derivar direcciones (BIP67 `sortedmulti`, P2WSH),
  consultar saldo real contra mempool.space, y exportar/reimportar la
  configuración como descriptor. Puramente watch-only.
- **✅ Fase 2 (esta release) — Coordinar PSBTs.** Armar una transacción de
  gasto desde la wallet multifirma (con `bip32Derivation` correcto por
  cosigner en cada input, incluido el output de cambio), exportar el PSBT
  sin firmar, combinar los PSBTs parcialmente firmados que cada cosigner
  trae de vuelta hasta juntar el quorum, y finalizar — el resultado es un
  hex listo para llevar a [BTC Airgap Bridge](../btc-airgap-bridge) (o a
  cualquier nodo/wallet que transmita) y difundirlo. Esta herramienta nunca
  firma ni transmite nada ella misma.
- **🔜 Fase 3 — Hardware wallets.** Conexión directa por WebUSB/WebHID a
  Trezor/Ledger/Coldcard para exportar xpubs y firmar sin pegar texto a
  mano. Es la fase más costosa y menos alineada con el patrón "pegá el
  PSBT" del resto del grupo, así que queda para el final — mientras tanto,
  el intercambio manual de PSBTs (por ejemplo firmando en
  [PSBT Signer BTC](../psbt-signer-btc), que ya sabe identificar y firmar
  inputs multifirma vía `bip32Derivation` sin haber cambiado una línea de
  código) sigue siendo la forma de usar esto con un hardware wallet real.

## Cómo usarlo

```bash
npm install
npm run build     # genera dist/index.html e index.html
```

Abrí `index.html` en un navegador moderno. Necesita conexión a internet
para consultar saldos (igual que My Wallet BTC y BTC Airgap Bridge).

1. Elegí la red (Testnet por defecto; Mainnet exige el checkbox de
   confirmación explícita).
2. Elegí **M** (firmas requeridas) y **N** (cantidad de cosigners).
3. Cargá los cosigners de dos formas posibles:
   - **Uno por uno**: para cada cosigner, un nombre (solo para vos, no se
     exporta a la red), su clave pública extendida (xpub, o el prefijo
     "vestido" que le corresponda - Zpub/Vpub para P2WSH, aunque cualquiera
     de los prefijos SLIP132 conocidos funciona, son cosméticos), su
     **fingerprint** (8 caracteres hex - identifica la clave maestra de la
     que salió esa xpub) y su **ruta de derivación** (por convención BIP48
     para P2WSH: `48'/0'/0'/2'` en mainnet, `48'/1'/0'/2'` en testnet).
     Fingerprint y ruta los exporta el mismo software o hardware wallet que
     generó el xpub — son necesarios para que cualquier coordinador o
     firmador (incluida la Fase 2 de esta misma herramienta) sepa
     exactamente con qué clave firmar cada input.
   - **Pegar un descriptor**: si ya tenés un descriptor `wsh(sortedmulti(M,
     [fgp/ruta]xpub/0/*,...))` exportado por Sparrow, Coldcard, Bitcoin
     Core, u otra instancia de esta misma herramienta, pegalo directo y se
     completan M, N y los cosigners automáticamente.
4. **"Armar wallet y consultar saldo"** deriva las direcciones y escanea
   ambas ramas (recepción y cambio) contra mempool.space con el límite de
   huecos estándar (20).
5. Desde el panel: **Recibir** (próxima dirección sin usar + QR),
   **Actualizar** (re-escanea la misma wallet), **Direcciones** (lista
   completa o solo las que tienen saldo), **Exportar configuración**
   (descarga ambos descriptores — externo `/0/*` e interno `/1/*` — como
   `.txt`, para poder volver a cargar exactamente esta wallet más adelante,
   acá o en cualquier otra herramienta que entienda descriptores), y
   **Enviar** (habilitado solo si hay saldo).
6. **Enviar** arma una transacción de gasto en varios pasos:
   - **Armar**: destino, monto (o "enviar todo"), y tarifa (rápida/media/
     económica según mempool.space, o una personalizada en sats/vB).
   - **Revisar**: total de entradas, salidas, comisión, y cada salida con su
     dirección y monto — la de cambio queda marcada como propia.
   - **Exportar PSBT sin firmar**: el PSBT resultante (base64, con
     `witnessScript` y un `bip32Derivation` por cosigner en cada input y en
     el cambio) se muestra en texto, QR y `.txt` descargable. Llevalo a cada
     cosigner para que lo firme con su propio firmador — [PSBT Signer
     BTC](../psbt-signer-btc), un hardware wallet, o cualquier otra
     herramienta compatible con BIP174 — **cada cosigner firma por
     separado, siempre partiendo de este mismo PSBT sin firmar**.
   - **Juntar firmas**: pegá cada PSBT parcialmente firmado que te devuelva
     un cosigner. Un panel de progreso muestra cuántas firmas tiene cada
     input contra el quorum M requerido.
   - **Finalizar y exportar**: una vez que todos los inputs alcanzan M
     firmas, se arma la transacción final — TXID, hex, QR y descarga. Llevá
     ese hex a BTC Airgap Bridge (o a cualquier nodo/wallet que transmita)
     para difundirlo a la red.

## Modelo de seguridad

- **Nunca ve una clave privada**: literalmente no hay ningún campo en toda
  la interfaz para pegar una. Todo el flujo — desde parsear cada xpub hasta
  derivar cada dirección — usa derivación pública pura
  (`HDKey.deriveChild()` sobre nodos sin clave privada), la misma técnica
  que el modo watch-only de [My Wallet BTC](../my_btc_wallet).
- **BIP67 / sortedmulti**: el orden en que se cargan los cosigners no
  afecta la dirección resultante — `sortedMultisig()` (de
  `@scure/btc-signer`, librería auditada) ordena las claves públicas
  canónicamente en cada índice antes de armar el script, exactamente como
  especifica BIP67 y como hacen Sparrow/Coldcard/Bitcoin Core.
- **Checksum de descriptores (BIP380)**: tanto al generar como al leer un
  descriptor se calcula/verifica su checksum de 8 caracteres. Un descriptor
  pegado con un error de tipeo se rechaza explícitamente ("el checksum no
  coincide") en vez de derivar direcciones silenciosamente incorrectas. La
  implementación está verificada contra el vector de prueba oficial de la
  propia especificación BIP380 (`raw(deadbeef)#89f8spxm`).
- **Fingerprint validado por formato**: se exige que sean 8 caracteres hex
  antes de aceptar un cosigner - no previene un fingerprint incorrecto en
  sí (eso requeriría la clave privada correspondiente para verificar), pero
  sí rechaza errores de tipeo obvios (longitud incorrecta, caracteres no
  hexadecimales) antes de que lleguen a un descriptor exportado.
- **Cosigners duplicados rechazados**: en el modo manual, si dos cosigners
  terminan con exactamente la misma clave pública, el armado de la wallet
  se rechaza explícitamente — repetir una clave silenciosamente convertiría
  un "M-de-N" en una wallet más débil de lo que el usuario cree tener.
- **Cero persistencia**: no se usa `localStorage`, `sessionStorage`,
  cookies ni IndexedDB. Por eso la sección "Exportar configuración" es
  central al flujo, no un extra — sin ella, cerrar la pestaña significa
  volver a tipear cada xpub/fingerprint/ruta a mano.
- **CSP con la misma excepción que sus hermanas watch-only**: `script-src`
  restringido a un hash SHA-256 del único bloque de script inline;
  `connect-src` apunta a `https://mempool.space` porque consultar saldo es
  parte esencial de esta fase.
- **Armar una transacción tampoco necesita ninguna clave privada**: desde
  seleccionar UTXOs hasta calcular la comisión y el cambio, todo usa
  `selectUTXO` de `@scure/btc-signer` sobre los mismos nodos públicos de
  siempre. La única acción que un cosigner hace FUERA de esta herramienta es
  firmar — acá nunca hay una clave privada que proteger.
- **Combinar PSBTs valida que sean de la misma transacción**: `combine()` (de
  `@scure/btc-signer`, BIP174) rechaza explícitamente un PSBT cuya
  transacción sin firmar no coincida con la que se está coordinando, en vez
  de mezclar datos de dos gastos distintos en silencio.
- **Finalizar exige el quorum completo**: la transacción solo se arma cuando
  cada input alcanzó M firmas válidas contra las pubkeys de su
  `witnessScript` — no hay forma de finalizar (ni de exportar algo que
  parezca finalizado) con menos firmas de las que la wallet requiere.

## Estructura del proyecto

```
src/
  lib/
    descriptor.js      checksum BIP380, parseo de xpubs (SLIP132), construir/parsear
                        descriptores wsh(sortedmulti(...)), derivación de direcciones multisig
    scan.js             escaneo con límite de huecos (recepción + cambio) contra mempool.space
    network.js          cliente Esplora (mempool.space): saldo/UTXOs/tarifas, mainnet/testnet
    txbuilder.js         arma un PSBT de gasto: anota UTXOs (witnessScript + bip32Derivation
                        por cosigner) y selecciona entradas/cambio con selectUTXO
    psbtcoordinate.js    decodifica/codifica PSBTs, combina las firmas parciales de cada
                        cosigner, calcula el progreso de firmas por input, y finaliza
    i18n.js              diccionario ES/EN + walker data-i18n (mismo patrón que el resto del grupo)
  app.js                controlador de la UI (sin frameworks)
  styles.css             tema oscuro/claro al estilo del resto del grupo
index.src.html          plantilla HTML fuente (placeholders __CSS__/__SCRIPT__/__CSP__)
build.mjs               empaqueta todo en un único index.html autocontenido
test/                   tests (node:test)
```

## Tests

```bash
npm test
```

`descriptor.test.mjs` es el núcleo de la cobertura: valida el checksum
BIP380 contra el vector oficial de la especificación, el round-trip
completo construir→parsear un descriptor de 2-de-3, el rechazo de un
checksum alterado y de M > N, el parseo lenient de prefijos xpub/Zpub/tpub/
Vpub, el rechazo de una clave privada, y que la dirección derivada por
`deriveMultisigPayment` coincida exactamente con una re-derivación manual
usando `sortedMultisig` directamente de `@scure/btc-signer`.

`scan.test.mjs` verifica la lógica de límite de huecos contra un proveedor
Esplora simulado: que el escaneo se detenga a los 20 consecutivos sin uso
por rama, que se extienda correctamente cuando aparece una dirección usada
dentro de la ventana, que la suma de saldos sea correcta, y que "próxima
dirección de recepción" salte las ya usadas.

`spend.test.mjs` prueba el flujo completo de la Fase 2 de punta a punta,
sin ningún mock: arma un PSBT de gasto real desde una wallet 2-de-3
financiada, lo codifica a base64 (el mismo formato que se exporta desde la
UI), lo decodifica dos veces por separado — simulando a dos cosigners que
jamás se comunican entre sí — y cada uno firma con su propia clave privada
real (nunca expuesta al "coordinador"). Después combina ambos PSBTs
parcialmente firmados, verifica que el progreso de firmas sea correcto en
cada paso (1 de 2, después 2 de 2), finaliza, y confirma que el TXID final
coincide con el de la transacción original — además de los casos de fondos
insuficientes y de progreso antes/después de finalizar.

Además del test suite, el flujo completo se probó a mano en el navegador:

- **Fase 1 contra mainnet real** (mempool.space): armar una wallet 2-de-3
  cargando tres xpubs uno por uno, completar el escaneo real de 40
  direcciones, confirmar que la dirección de recepción mostrada en el
  dashboard coincide exactamente con una re-derivación offline vía Node,
  exportar el descriptor, y volver a importarlo desde cero en modo "pegar
  descriptor" — confirmando que reproduce byte a byte la misma wallet.
- **Fase 2 con la UI real, red simulada, firmas reales**: se interceptó
  `fetch` en el navegador para simular una wallet 2-de-3 con saldo (sin
  depender de conseguir fondos reales en una address multifirma), y se hizo
  el flujo completo a través de la interfaz: armar una transacción de
  0.0005 BTC con cambio, revisar (el total de entradas, salidas, comisión y
  cambio cuadran exactamente), exportar el PSBT sin firmar, firmarlo con dos
  claves privadas reales por fuera del navegador (simulando a dos
  cosigners independientes, como lo haría PSBT Signer BTC), pegar ambas
  firmas de vuelta, ver el progreso pasar de "1 de 2" a "completa", y
  finalizar — la pantalla de resultado mostró el TXID y el hex final
  correctos.

## Limitaciones conocidas

- Solo P2WSH nativo (`wsh(sortedmulti(...))`). No soporta P2SH-P2WSH
  (`sh(wsh(...))`, wallets multisig más viejas) ni Taproot multisig
  (`tr(musig2(...))` / `tr(...,multi_a(...))`) - son extensiones posibles
  para más adelante, no incluidas para mantener el alcance de esta fase
  acotado.
- No hay conexión directa a hardware wallets (Fase 3): los xpubs,
  fingerprints y rutas se pegan/tipean a mano, exportados previamente desde
  el hardware wallet o software correspondiente por otro medio.
- El escaneo usa el límite de huecos estándar (20) por rama. Una wallet con
  fondos en un índice más allá de 20 direcciones sin uso consecutivas no se
  va a detectar automáticamente.
- El nombre de cada cosigner es solo para mostrar en esta sesión — no se
  incluye en el descriptor exportado (los descriptores no tienen un campo
  estándar para eso), así que no viaja entre herramientas.
- Depende de la disponibilidad de `mempool.space`. Si el servicio está
  caído o limita la tasa de pedidos, la consulta falla o se hace lenta - no
  hay fallback a otro proveedor ni a un nodo propio configurable desde la
  UI.
- Un solo destino por transacción (más el cambio automático) — no arma
  transacciones con múltiples salidas en un solo envío.
- No transmite nada ella misma, a propósito: el hex final se exporta para
  llevarlo a [BTC Airgap Bridge](../btc-airgap-bridge) u otra herramienta.
  Tampoco tiene forma de esperar o consultar confirmaciones de una
  transacción ya transmitida.
- Si un cosigner firma con un `sighash` distinto del default, o el PSBT que
  trae de vuelta corresponde a una transacción distinta (otro monto, otro
  destino), `combine()` lo rechaza explícitamente en vez de mezclarlo en
  silencio — pero no hay forma de "reparar" ese PSBT desde acá, hay que
  volver a exportar el PSBT sin firmar original y pedirle al cosigner que
  firme de nuevo.

## Licencia

ISC — software "tal cual", sin garantía. Antes de confiarle una wallet
real: leé el código fuente y probá primero en testnet.
