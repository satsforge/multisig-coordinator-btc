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
    es: '<strong>Fase 1 de 3:</strong> armar la wallet multifirma (P2WSH) a partir de las claves publicas de cada cosigner y consultar su saldo. Todavia <strong>no arma ni firma transacciones</strong> - eso llega en la fase 2. No hay ninguna clave privada en ningun momento: esta herramienta solo entiende claves publicas extendidas.',
    en: '<strong>Phase 1 of 3:</strong> build the multisig (P2WSH) wallet from each cosigner\'s public key and check its balance. It does not yet <strong>build or sign transactions</strong> - that lands in phase 2. There is no private key anywhere at any point: this tool only ever understands extended public keys.',
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
