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

- **✅ Fase 1 (esta release) — Configurar y consultar.** Armar la wallet
  M-de-N a partir de xpubs/descriptores, derivar direcciones (BIP67
  `sortedmulti`, P2WSH), consultar saldo real contra mempool.space, y
  exportar/reimportar la configuración como descriptor. Puramente
  watch-only: nunca arma ni firma una transacción.
- **🔜 Fase 2 — Coordinar PSBTs.** Armar una transacción de gasto desde la
  wallet multifirma (con `bip32Derivation` correcto por cosigner en cada
  input), combinar los PSBTs parcialmente firmados que cada cosigner trae de
  vuelta hasta juntar el quorum, finalizar, y entregar el resultado a
  [BTC Airgap Bridge](../btc-airgap-bridge) para transmitir. Reutiliza gran
  parte de la lógica de [PSBT Signer BTC](../psbt-signer-btc).
- **🔜 Fase 3 — Hardware wallets.** Conexión directa por WebUSB/WebHID a
  Trezor/Ledger/Coldcard para exportar xpubs y firmar sin pegar texto a
  mano. Es la fase más costosa y menos alineada con el patrón "pegá el
  PSBT" del resto del grupo, así que queda para el final — mientras tanto,
  el intercambio manual de PSBTs (como ya hace PSBT Signer BTC) sigue
  siendo la forma de usar esto con un hardware wallet real.

## Cómo usarlo (Fase 1)

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
   completa o solo las que tienen saldo), y **Exportar configuración**
   (descarga ambos descriptores — externo `/0/*` e interno `/1/*` — como
   `.txt`, para poder volver a cargar exactamente esta wallet más adelante,
   acá o en cualquier otra herramienta que entienda descriptores).

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

## Estructura del proyecto

```
src/
  lib/
    descriptor.js   checksum BIP380, parseo de xpubs (SLIP132), construir/parsear
                     descriptores wsh(sortedmulti(...)), derivación de direcciones multisig
    scan.js          escaneo con límite de huecos (recepción + cambio) contra mempool.space
    network.js       cliente Esplora (mempool.space) mainnet/testnet
    i18n.js          diccionario ES/EN + walker data-i18n (mismo patrón que el resto del grupo)
  app.js             controlador de la UI (sin frameworks)
  styles.css         tema oscuro/claro al estilo del resto del grupo
index.src.html       plantilla HTML fuente (placeholders __CSS__/__SCRIPT__/__CSP__)
build.mjs            empaqueta todo en un único index.html autocontenido
test/                tests (node:test)
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

Además del test suite, el flujo completo se probó a mano en el navegador
contra **mainnet real** (mempool.space): armar una wallet 2-de-3 cargando
tres xpubs uno por uno, completar el escaneo real de 40 direcciones,
confirmar que la dirección de recepción mostrada en el dashboard coincide
exactamente con una re-derivación offline vía Node, exportar el descriptor,
y volver a importarlo desde cero en modo "pegar descriptor" — confirmando
que reproduce byte a byte la misma wallet (misma dirección de recepción
#0), que es la garantía central de la que depende todo el flujo de
"exportar para no perder la configuración".

## Limitaciones conocidas (Fase 1)

- Solo P2WSH nativo (`wsh(sortedmulti(...))`). No soporta P2SH-P2WSH
  (`sh(wsh(...))`, wallets multisig más viejas) ni Taproot multisig
  (`tr(musig2(...))` / `tr(...,multi_a(...))`) - son extensiones posibles
  para más adelante, no incluidas para mantener el alcance de esta fase
  acotado.
- No arma ni firma transacciones todavía (Fase 2). El "Enviar" no existe en
  esta versión a propósito, en vez de un botón que no hace lo que promete.
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

## Licencia

ISC — software "tal cual", sin garantía. Antes de confiarle una wallet
real: leé el código fuente y probá primero en testnet.
