/**
 * Single source of truth for every user-facing string. Same dictionary/
 * walker pattern as the rest of the SatsForge suite, scoped to this tool's
 * own screens.
 */
export const LANGS = ['es', 'en'];
export const DEFAULT_LANG = 'es';

const dict = {
  'meta.title': { es: 'Coordinador Multifirma BTC', en: 'BTC Multisig Coordinator' },
  'topbar.brand': { es: 'Coordinador Multifirma BTC', en: 'BTC Multisig Coordinator' },
  'topbar.theme.toLight': { es: '☀ Modo claro', en: '☀ Light mode' },
  'topbar.theme.toDark': { es: '🌙 Modo oscuro', en: '🌙 Dark mode' },
  'topbar.lang.toEnglish': { es: '🌐 English', en: '🌐 English' },
  'topbar.lang.toSpanish': { es: '🌐 Español', en: '🌐 Español' },

  'notice.phase': {
    es: '<strong>Fase 3 de 3:</strong> armar la wallet multifirma (P2WSH), consultar su saldo, armar una transaccion de gasto, y coordinar las firmas de los cosigners hasta juntar el quorum - pegando texto, cargando un archivo, o escaneando un codigo QR (BBQr, el formato de Coldcard) con la camara. No hay ninguna clave privada en ningun momento: esta herramienta solo entiende claves publicas extendidas y PSBTs.',
    en: '<strong>Phase 3 of 3:</strong> build the multisig (P2WSH) wallet, check its balance, build a spending transaction, and coordinate cosigner signatures until the quorum is met - by pasting text, loading a file, or scanning a QR code (BBQr, Coldcard\'s format) with the camera. There is no private key anywhere at any point: this tool only ever understands extended public keys and PSBTs.',
  },

  'network.legend': { es: 'Red', en: 'Network' },
  'network.testnet.label': { es: 'Testnet (recomendado para probar)', en: 'Testnet (recommended for testing)' },
  'network.mainnet.label': { es: 'Mainnet (Bitcoin real)', en: 'Mainnet (real Bitcoin)' },
  'network.mainnet.confirm': {
    es: 'Entiendo que voy a operar con Bitcoin real y puedo perder mis fondos si me equivoco.',
    en: 'I understand I am operating with real Bitcoin and can lose my funds if I make a mistake.',
  },
  'network.badge.testnet': { es: 'TESTNET', en: 'TESTNET' },
  'network.badge.mainnet': { es: 'MAINNET', en: 'MAINNET' },

  'fileLoad.button': { es: '📁 Cargar desde archivo', en: '📁 Load from file' },
  'error.fileReadFailed': { es: 'No se pudo leer el archivo: {msg}', en: 'Could not read the file: {msg}' },

  'setup.title': { es: 'Configurar wallet multifirma', en: 'Configure the multisig wallet' },
  'setup.quorum.label': { es: 'Firmas requeridas (M) de un total de (N)', en: 'Required signatures (M) out of (N) total' },
  'setup.m.label': { es: 'M (firmas requeridas)', en: 'M (required signatures)' },
  'setup.n.label': { es: 'N (cantidad de cosigners)', en: 'N (number of cosigners)' },

  'setup.mode.manual': { es: 'Agregar cosigners uno por uno', en: 'Add cosigners one by one' },
  'setup.mode.descriptor': { es: 'Pegar un descriptor ya armado', en: 'Paste an existing descriptor' },

  'setup.cosigner.name': { es: 'Nombre', en: 'Name' },
  'setup.cosigner.xpub': { es: 'Clave publica extendida (xpub/Zpub/tpub/Vpub...)', en: 'Extended public key (xpub/Zpub/tpub/Vpub...)' },
  'setup.cosigner.fingerprint': { es: 'Fingerprint (8 caracteres hex)', en: 'Fingerprint (8 hex characters)' },
  'setup.cosigner.path': { es: 'Ruta de derivacion', en: 'Derivation path' },
  'setup.cosigner.hint': {
    es: 'El fingerprint y la ruta identifican exactamente que clave usar dentro del hardware wallet o software que la genero - se necesitan para que otras herramientas (y fases futuras de esta) sepan con que firmar. Los exporta el mismo software/hardware wallet que generó el xpub.',
    en: 'The fingerprint and path identify exactly which key to use inside the hardware wallet or software that generated it - needed so other tools (and future phases of this one) know what to sign with. They are exported by the same software/hardware wallet that produced the xpub.',
  },

  'setup.descriptor.label': { es: 'Descriptor (wsh(sortedmulti(...)))', en: 'Descriptor (wsh(sortedmulti(...)))' },
  'setup.descriptor.hint': {
    es: 'Pegá el descriptor "externo" (el que termina en /0/*) que exportó Sparrow, Coldcard, Bitcoin Core, u otra instancia de esta misma herramienta. Se completan M, N y los cosigners automáticamente.',
    en: 'Paste the "external" descriptor (the one ending in /0/*) exported by Sparrow, Coldcard, Bitcoin Core, or another instance of this same tool. M, N, and the cosigners are filled in automatically.',
  },

  'setup.build': { es: 'Armar wallet y consultar saldo', en: 'Build wallet and check balance' },
  'setup.addCosigner': { es: '+ Agregar cosigner', en: '+ Add cosigner' },
  'setup.removeCosigner': { es: 'Quitar', en: 'Remove' },

  'error.setupFailed': { es: 'No se pudo armar la wallet: {msg}', en: 'Could not build the wallet: {msg}' },

  'scan.title': { es: 'Consultando la red...', en: 'Querying the network...' },
  'scan.progress': { es: 'Revisando {chainLabel} #{index}', en: 'Checking {chainLabel} #{index}' },
  'scan.chain.receive': { es: 'recepcion', en: 'receive' },
  'scan.chain.change': { es: 'cambio', en: 'change' },
  'error.scanFailed': { es: 'No se pudo consultar la red: {msg}', en: 'Could not query the network: {msg}' },

  'dashboard.checksumWarning': {
    es: '<strong>Aviso:</strong> el descriptor con el que se armó esta wallet no traía checksum, así que no se pudo verificar que esté copiado sin errores. Un solo caracter alterado ahí puede derivar direcciones distintas a las que tus cosigners esperan. Si podés, volvé a exportarlo desde la fuente original (con checksum) y cargalo de nuevo.',
    en: '<strong>Warning:</strong> the descriptor this wallet was built from had no checksum, so it could not be verified as copied correctly. A single altered character there can derive different addresses than your cosigners expect. If you can, re-export it from the original source (with a checksum) and load it again.',
  },
  'dashboard.quorum': { es: '{m} de {n} firmas', en: '{m}-of-{n} signatures' },
  'dashboard.balance.label': { es: 'Saldo total', en: 'Total balance' },
  'dashboard.update': { es: 'Actualizar', en: 'Refresh' },
  'dashboard.newWallet': { es: 'Nueva wallet', en: 'New wallet' },
  'dashboard.receive.title': { es: 'Recibir', en: 'Receive' },
  'dashboard.receive.copy': { es: 'Copiar direccion', en: 'Copy address' },
  'dashboard.copied': { es: 'Copiado!', en: 'Copied!' },
  'dashboard.export.title': { es: 'Exportar configuracion', en: 'Export configuration' },
  'dashboard.export.hint': {
    es: 'Esta herramienta no guarda nada entre sesiones - descargá el descriptor para poder volver a cargar esta misma wallet mas adelante, en esta herramienta o en cualquier otra que entienda descriptores (Sparrow, Coldcard, Bitcoin Core).',
    en: 'This tool keeps nothing between sessions - download the descriptor so you can reload this exact wallet later, in this tool or in any other that understands descriptors (Sparrow, Coldcard, Bitcoin Core).',
  },
  'dashboard.export.download': { es: '⬇ Descargar descriptores (.txt)', en: '⬇ Download descriptors (.txt)' },
  'dashboard.addresses.title': { es: 'Direcciones', en: 'Addresses' },
  'dashboard.addresses.receive': { es: 'Recepcion', en: 'Receive' },
  'dashboard.addresses.change': { es: 'Cambio', en: 'Change' },
  'dashboard.addresses.empty': { es: 'Ninguna direccion tiene saldo todavia.', en: 'No address has a balance yet.' },
  'dashboard.addresses.showAll': { es: 'Mostrar todas ({n})', en: 'Show all ({n})' },
  'dashboard.addresses.showFunded': { es: 'Mostrar solo con saldo', en: 'Show only funded' },
  'dashboard.send': { es: 'Enviar', en: 'Send' },

  'send.build.title': { es: 'Armar transaccion', en: 'Build transaction' },
  'send.destination.label': { es: 'Direccion de destino', en: 'Destination address' },
  'send.amount.label': { es: 'Monto (BTC)', en: 'Amount (BTC)' },
  'send.sendMax.label': { es: 'Enviar todo el saldo disponible', en: 'Send the entire available balance' },
  'send.fee.label': { es: 'Tarifa', en: 'Fee rate' },
  'send.fee.fast': { es: 'Rapida (~1 bloque)', en: 'Fast (~1 block)' },
  'send.fee.medium': { es: 'Media (~1 hora)', en: 'Medium (~1 hour)' },
  'send.fee.economy': { es: 'Economica (~1 dia)', en: 'Economy (~1 day)' },
  'send.fee.custom': { es: 'Personalizada (sats/vB)', en: 'Custom (sats/vB)' },
  'send.fee.unit': { es: 'sats/vB', en: 'sats/vB' },
  'send.build.button': { es: 'Armar', en: 'Build' },
  'send.cancel': { es: 'Cancelar', en: 'Cancel' },
  'send.back': { es: 'Volver al dashboard', en: 'Back to dashboard' },
  'error.sendBuildFailed': { es: 'No se pudo armar la transaccion: {msg}', en: 'Could not build the transaction: {msg}' },
  'error.insufficientFunds': {
    es: 'Los UTXOs seleccionados no alcanzan para cubrir el monto mas la comision.',
    en: 'The selected UTXOs cannot cover the amount plus the fee.',
  },

  'send.review.title': { es: 'Revisar antes de exportar', en: 'Review before exporting' },
  'send.review.inputsTotal': { es: 'Total de entradas', en: 'Total inputs' },
  'send.review.outputsTotal': { es: 'Total de salidas', en: 'Total outputs' },
  'send.review.fee': { es: 'Comision', en: 'Fee' },
  'send.review.outputs': { es: 'Salidas', en: 'Outputs' },
  'send.review.change': { es: '(cambio, es de esta wallet)', en: '(change, belongs to this wallet)' },
  'send.review.feeWarning': {
    es: 'La comisión calculada es inusualmente alta en relación al total de entradas. Puede ser una tarifa personalizada mal ingresada. Revisala antes de exportar.',
    en: 'The calculated fee is unusually high relative to the total inputs. It may be a mistyped custom rate. Review it before exporting.',
  },
  'send.review.feeAck': { es: 'Entiendo el riesgo y quiero exportar igual.', en: 'I understand the risk and want to export anyway.' },
  'send.review.export': { es: 'Exportar PSBT sin firmar', en: 'Export unsigned PSBT' },

  'send.export.title': { es: 'PSBT sin firmar', en: 'Unsigned PSBT' },
  'send.export.hint': {
    es: 'Llevá este PSBT a cada cosigner para que lo firme con su propio firmador (por ejemplo PSBT Signer BTC, o un hardware wallet que exporte PSBTs firmados). Cada cosigner firma por separado, empezando siempre desde este mismo PSBT sin firmar.',
    en: 'Take this PSBT to each cosigner so they can sign it with their own signer (for example PSBT Signer BTC, or a hardware wallet that exports signed PSBTs). Each cosigner signs separately, always starting from this same unsigned PSBT.',
  },
  'send.export.copy': { es: 'Copiar', en: 'Copy' },
  'send.export.copied': { es: 'Copiado!', en: 'Copied!' },
  'send.export.download': { es: '⬇ Descargar .txt', en: '⬇ Download .txt' },

  'send.collect.title': { es: 'Juntar firmas de los cosigners', en: 'Collect cosigner signatures' },
  'send.collect.label': { es: 'PSBT firmado por un cosigner', en: 'PSBT signed by one cosigner' },
  'send.collect.add': { es: 'Agregar firma', en: 'Add signature' },
  'send.collect.progress.title': { es: 'Progreso', en: 'Progress' },
  'send.collect.progress.input': { es: 'Entrada {i}: {count} de {m} firmas', en: 'Input {i}: {count} of {m} signatures' },
  'send.collect.progress.done': { es: 'Entrada {i}: completa', en: 'Input {i}: complete' },
  'send.collect.finalize': { es: 'Finalizar y exportar', en: 'Finalize and export' },
  'error.collectFailed': { es: 'No se pudo agregar esa firma: {msg}', en: 'Could not add that signature: {msg}' },
  'error.finalizeFailed': { es: 'No se pudo finalizar: {msg}', en: 'Could not finalize: {msg}' },

  'send.result.title': { es: 'Transaccion lista para transmitir', en: 'Transaction ready to broadcast' },
  'send.result.hint': {
    es: 'Todas las firmas necesarias estan presentes. Este es el hex final - llevalo a BTC Airgap Bridge (o a cualquier nodo/wallet que sepa transmitir) para difundirlo a la red. Esta herramienta nunca se conecta a internet para transmitir nada.',
    en: 'All required signatures are present. This is the final hex - take it to BTC Airgap Bridge (or any node/wallet that can broadcast) to spread it to the network. This tool never connects to the internet to broadcast anything.',
  },
  'send.result.txid': { es: 'TXID', en: 'TXID' },
  'send.result.hexLabel': { es: 'Transaccion firmada (hex)', en: 'Signed transaction (hex)' },

  'qr.scan.button': { es: '📷 Escanear', en: '📷 Scan' },
  'qr.scanner.title': { es: 'Escanear codigo QR', en: 'Scan QR code' },
  'qr.scanner.waiting': { es: 'Apunta la camara al codigo QR...', en: 'Point the camera at the QR code...' },
  'qr.scanner.progress': { es: 'Parte {n} de {total}', en: 'Part {n} of {total}' },
  'qr.scanner.cancel': { es: 'Cancelar', en: 'Cancel' },
  'qr.animated.part': { es: 'Parte {n} de {total}', en: 'Part {n} of {total}' },
  'error.cameraFailed': { es: 'No se pudo acceder a la camara: {msg}', en: 'Could not access the camera: {msg}' },
  'error.qrDecodeFailed': { es: 'No se pudo decodificar el codigo QR: {msg}', en: 'Could not decode the QR code: {msg}' },

  'footer.note': {
    es: 'Solo entiende claves publicas - ninguna clave privada pasa por aca. Consulta 100% desde tu navegador · sin cookies · sin almacenamiento persistente. Revisa el codigo fuente antes de confiarle una wallet real.',
    en: 'Only ever handles public keys - no private key passes through here. Queries 100% from your browser · no cookies · no persistent storage. Review the source before trusting it with a real wallet.',
  },
};

export function t(key, lang, vars) {
  const entry = dict[key];
  let str = entry ? (entry[lang] ?? entry[DEFAULT_LANG]) : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}
