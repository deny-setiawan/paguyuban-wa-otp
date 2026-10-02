import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_PATH = process.env.SESSION_PATH || path.join(__dirname, '..', 'session')

let sock = null
let isConnected = false
let connectedPhone = null
let latestQr = null
let connectionState = 'disconnected' // 'disconnected' | 'connecting' | 'connected'
let onReadyCallback = null

function makeNoopLogger() {
  const noop = () => {}
  const logger = {
    level: 'silent',
    info: noop, warn: noop, error: noop,
    debug: noop, trace: noop, fatal: noop,
    child: () => makeNoopLogger(),
  }
  return logger
}

export function getStatus() {
  return {
    connected: isConnected,
    phone: connectedPhone,
    state: connectionState,
    hasQr: latestQr !== null,
  }
}

export function getLatestQr() {
  return latestQr
}

export async function sendMessage(jid, text) {
  if (!sock || !isConnected) throw new Error('WhatsApp belum terhubung')
  await sock.sendMessage(jid, { text })
}

export async function reconnect() {
  // Close current socket
  if (sock) {
    try { sock.end() } catch { /* ignore */ }
    sock = null
  }
  isConnected = false
  connectedPhone = null
  latestQr = null
  connectionState = 'disconnected'

  // Delete session files to force fresh QR scan
  if (fs.existsSync(SESSION_PATH)) {
    fs.rmSync(SESSION_PATH, { recursive: true, force: true })
  }

  // Restart
  await startWhatsApp(onReadyCallback)
}

export async function startWhatsApp(onReady) {
  if (onReady) onReadyCallback = onReady
  connectionState = 'connecting'
  latestQr = null

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH)
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: makeNoopLogger(),
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQr = qr
      connectionState = 'connecting'
      console.log('\n📱 QR code tersedia — buka /status di browser untuk scan.\n')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'close') {
      isConnected = false
      connectedPhone = null
      connectionState = 'disconnected'
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode
      if (reason === DisconnectReason.loggedOut) {
        console.log('❌ WhatsApp logged out. Gunakan tombol Reconnect di /status.')
        latestQr = null
      } else {
        console.log('🔄 Koneksi terputus, mencoba reconnect...')
        setTimeout(() => startWhatsApp(onReadyCallback), 5000)
      }
    }

    if (connection === 'open') {
      isConnected = true
      latestQr = null
      connectionState = 'connected'
      connectedPhone = sock.user?.id?.split(':')[0] || null
      console.log(`✅ WhatsApp terhubung: ${connectedPhone}`)
      if (onReadyCallback) onReadyCallback()
    }
  })
}
