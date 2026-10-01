import Fastify from 'fastify'
import { startWhatsApp, getStatus, sendMessage } from './whatsapp.js'

const PORT = Number(process.env.PORT) || 3001
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || ''

const app = Fastify({ logger: { transport: { target: 'pino-pretty' } } })

// Auth guard
app.addHook('onRequest', async (request, reply) => {
  if (request.url === '/health') return
  const secret = request.headers['x-internal-secret']
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    reply.code(401).send({ error: 'Unauthorized' })
  }
})

app.get('/health', async () => {
  const status = getStatus()
  return { status: status.connected ? 'connected' : 'disconnected', phone: status.phone }
})

app.post('/send-otp', async (request, reply) => {
  const { phone, otp } = request.body

  if (!phone || !otp) {
    return reply.code(400).send({ ok: false, error: 'phone dan otp wajib diisi' })
  }

  // Normalize nomor: pastikan format internasional (628xxx)
  let normalized = String(phone).replace(/\D/g, '')
  if (normalized.startsWith('0')) normalized = '62' + normalized.slice(1)
  if (!normalized.startsWith('62')) normalized = '62' + normalized
  const jid = normalized + '@s.whatsapp.net'

  const message = `Halo! Kode OTP Anda untuk login *Paguyuban PKR-Pepe*:\n\n*${otp}*\n\nBerlaku 5 menit. Jangan bagikan ke siapapun. 🔒`

  try {
    await sendMessage(jid, message)
    return { ok: true }
  } catch (err) {
    app.log.error(err)
    return reply.code(500).send({ ok: false, error: err.message })
  }
})

// Start WhatsApp + server
console.log('🚀 Memulai WhatsApp OTP Service...')
startWhatsApp(() => {
  console.log('✅ WhatsApp siap menerima request')
})

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1) }
  console.log(`🌐 Server berjalan di port ${PORT}`)
  if (!INTERNAL_SECRET) {
    console.warn('⚠️  INTERNAL_SECRET tidak di-set! Set environment variable sebelum production.')
  }
})
