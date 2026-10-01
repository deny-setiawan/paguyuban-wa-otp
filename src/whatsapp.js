import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_PATH = process.env.SESSION_PATH || path.join(__dirname, '..', 'session')

let sock = null
let isConnected = false
let connectedPhone = null

export function getStatus() {
  return { connected: isConnected, phone: connectedPhone }
}

export async function sendMessage(jid, text) {
  if (!sock || !isConnected) throw new Error('WhatsApp belum terhubung')
  await sock.sendMessage(jid, { text })
}

export async function startWhatsApp(onReady) {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH)
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: { level: 'silent', child: () => ({ level: 'silent', info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: () => ({}) }) },
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Scan QR code berikut dengan WhatsApp Anda:\n')
      qrcode.generate(qr, { small: true })
      console.log('\nAtau salin QR string ke wa.link/qr jika terminal tidak mendukung.\n')
    }

    if (connection === 'close') {
      isConnected = false
      connectedPhone = null
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode
      if (reason === DisconnectReason.loggedOut) {
        console.log('❌ WhatsApp logged out. Hapus folder session/ dan restart.')
      } else {
        console.log('🔄 Koneksi terputus, mencoba reconnect...')
        setTimeout(() => startWhatsApp(onReady), 5000)
      }
    }

    if (connection === 'open') {
      isConnected = true
      connectedPhone = sock.user?.id?.split(':')[0] || null
      console.log(`✅ WhatsApp terhubung: ${connectedPhone}`)
      if (onReady) onReady()
    }
  })
}
