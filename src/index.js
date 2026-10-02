import Fastify from 'fastify'
import QRCode from 'qrcode'
import { startWhatsApp, getStatus, getLatestQr, sendMessage, reconnect } from './whatsapp.js'

const PORT = Number(process.env.PORT) || 3001
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || ''

const app = Fastify({ logger: { transport: { target: 'pino-pretty' } } })

// Public routes — skip auth guard
const PUBLIC_PATHS = ['/', '/status', '/qr.png', '/health', '/reconnect']

app.addHook('onRequest', async (request, reply) => {
  if (PUBLIC_PATHS.includes(request.url.split('?')[0])) return
  const secret = request.headers['x-internal-secret']
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    reply.code(401).send({ error: 'Unauthorized' })
  }
})

// ── Redirect root to /status ───────────────────────────────────────────────
app.get('/', async (request, reply) => {
  return reply.redirect('/status')
})

// ── Web status + QR page ──────────────────────────────────────────────────
app.get('/status', async (request, reply) => {
  const { state, phone, hasQr } = getStatus()
  const isConnected = state === 'connected'
  const isConnecting = state === 'connecting'

  const autoRefresh = !isConnected ? `<meta http-equiv="refresh" content="4">` : ''
  const statusColor = isConnected ? '#16a34a' : isConnecting ? '#d97706' : '#dc2626'
  const statusBg = isConnected ? '#f0fdf4' : isConnecting ? '#fffbeb' : '#fef2f2'
  const statusLabel = isConnected
    ? `&#x2705; Terhubung &mdash; ${phone ? `+${phone}` : 'aktif'}`
    : isConnecting
      ? '&#x1F7E1; Menunggu QR Scan&hellip;'
      : '&#x1F534; Terputus'

  let qrHtml = ''
  if (!isConnected && hasQr) {
    qrHtml = `
      <div style="text-align:center;margin:24px 0 8px">
        <img src="/qr.png?t=${Date.now()}" alt="QR Code"
          style="width:220px;height:220px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.12)" />
        <div style="margin-top:10px;font-size:12px;color:#6b7280;line-height:1.5">
          Buka WhatsApp &rarr; Perangkat Tertaut &rarr; Tautkan Perangkat
        </div>
      </div>`
  } else if (!isConnected && !hasQr) {
    qrHtml = `
      <div style="text-align:center;margin:24px 0;color:#6b7280;font-size:13px;line-height:1.6">
        QR belum tersedia.<br/>Halaman akan refresh otomatis&hellip;
      </div>`
  }

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  ${autoRefresh}
  <title>WA OTP Status</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
    .card{background:#fff;border-radius:20px;padding:28px 24px;max-width:360px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.08)}
    h1{font-size:20px;font-weight:800;color:#111827;margin-bottom:2px}
    .sub{font-size:13px;color:#6b7280;margin-bottom:20px}
    .pill{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:100px;font-size:13px;font-weight:700;background:${statusBg};color:${statusColor};border:1.5px solid ${statusColor}44}
    hr{border:none;border-top:1px solid #f3f4f6;margin:20px 0}
    .btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}
    .btn-danger{background:#fef2f2;color:#dc2626}
    .btn-danger:hover{background:#fee2e2}
    .info{background:#eff6ff;border-radius:10px;padding:10px 14px;font-size:12px;color:#1d4ed8;line-height:1.6;margin-top:16px}
  </style>
</head>
<body>
<div class="card">
  <h1>&#x1F4F1; WA OTP Service</h1>
  <div class="sub">Paguyuban PKR-Pepe</div>
  <div class="pill">${statusLabel}</div>
  ${qrHtml}
  <hr/>
  <form method="POST" action="/reconnect" onsubmit="return confirm('Reset koneksi dan tampilkan QR baru?')">
    <button type="submit" class="btn btn-danger">&#x1F504; Reset &amp; QR Baru</button>
  </form>
  <div class="info">
    ${isConnected
      ? '&#x2705; WhatsApp aktif dan siap kirim OTP. Klik Reset jika perlu ganti nomor.'
      : 'Halaman refresh otomatis setiap 4 detik. Scan QR dengan WhatsApp &rarr; Perangkat Tertaut.'}
  </div>
</div>
</body>
</html>`

  reply.header('Content-Type', 'text/html; charset=utf-8')
  reply.header('Cache-Control', 'no-store')
  return reply.send(html)
})

// ── QR as PNG ──────────────────────────────────────────────────────────────
app.get('/qr.png', async (request, reply) => {
  const qr = getLatestQr()
  if (!qr) {
    reply.code(404).send('No QR available')
    return
  }
  const buffer = await QRCode.toBuffer(qr, { width: 300, margin: 2 })
  reply.header('Content-Type', 'image/png')
  reply.header('Cache-Control', 'no-store')
  return reply.send(buffer)
})

// ── Reconnect (POST — clears session, forces new QR) ──────────────────────
app.post('/reconnect', async (request, reply) => {
  reconnect().catch(err => app.log.error(err))
  return reply.redirect('/status')
})

// ── Health (public) ────────────────────────────────────────────────────────
app.get('/health', async () => {
  const { state, phone } = getStatus()
  return { status: state, phone }
})

// ── Send OTP (protected by x-internal-secret) ─────────────────────────────
app.post('/send-otp', async (request, reply) => {
  const { phone, otp } = request.body

  if (!phone || !otp) {
    return reply.code(400).send({ ok: false, error: 'phone dan otp wajib diisi' })
  }

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

// ── Start ──────────────────────────────────────────────────────────────────
console.log('🚀 Memulai WhatsApp OTP Service...')
startWhatsApp(() => {
  console.log('✅ WhatsApp siap menerima request')
})

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1) }
  console.log(`🌐 Server berjalan di port ${PORT}`)
  console.log(`📊 Status page: http://localhost:${PORT}/status`)
  if (!INTERNAL_SECRET) {
    console.warn('⚠️  INTERNAL_SECRET tidak di-set!')
  }
})
