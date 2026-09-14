import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { conversationsRouter } from './routes/conversations.js'
import { contactsRouter } from './routes/contacts.js'
import { systemRouter } from './routes/system.js'
import { templatesRouter } from './routes/templates.js'
import { createWebhookRouter } from './routes/webhook.js'
import { automationsRouter } from './routes/automations.js'
import { authRouter } from './routes/auth.js'
import { requireAuth } from './auth.js'
import { prisma } from './db.js'
import bcrypt from 'bcryptjs'
import { whatsappFlowsRouter } from './routes/whatsapp-flows.js'
import { flowDataEndpoint } from './routes/flow-endpoint.js'
import { whatsappConnectionsRouter } from './routes/whatsapp-connections.js'
import { audiencesRouter } from './routes/audiences.js'

const app = express()
const port = Number(process.env.PORT || 3000)
const eventClients = new Set<express.Response>()

// Meta signs the exact request bytes, so verification must run before JSON parsing.
app.use('/api/webhooks/whatsapp', express.raw({ type: 'application/json' }))
app.post('/api/whatsapp-flows/data', express.raw({ type: 'application/json', limit: '100kb' }), flowDataEndpoint)
app.use(express.json({ limit: '2mb' }))
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }))

app.use('/api/auth', authRouter)
app.use('/api/webhooks', createWebhookRouter(broadcastEvent))
app.use('/api', requireAuth)
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  res.write('event: connected\ndata: {}\n\n')
  eventClients.add(res)
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25000)
  req.on('close', () => { clearInterval(heartbeat); eventClients.delete(res) })
})

function broadcastEvent(event: string) {
  for (const client of eventClients) client.write(`event: ${event}\ndata: {"updatedAt":"${new Date().toISOString()}"}\n\n`)
}

app.use('/api', systemRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/contacts', contactsRouter)
app.use('/api/audiences', audiencesRouter)
app.use('/api/templates', templatesRouter)
app.use('/api/automations', automationsRouter)
app.use('/api/whatsapp-flows', whatsappFlowsRouter)
app.use('/api/whatsapp-connections', whatsappConnectionsRouter)

async function start() {
  const email = (process.env.ADMIN_EMAIL || 'admin@relay.local').toLowerCase()
  if (!await prisma.user.findUnique({ where: { email } })) await prisma.user.create({ data: { email, name: process.env.ADMIN_NAME || 'Relay Admin', role: 'ADMIN', passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@123', 12) } })
  app.listen(port, () => console.log(`Relay API listening on http://localhost:${port}`))
}
start().catch(error => { console.error(error); process.exit(1) })
