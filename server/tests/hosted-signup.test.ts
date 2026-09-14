import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import express from 'express'
import { once } from 'node:events'
import { prisma } from '../db.js'
import { captureHostedSignupEvent } from '../services/hosted-signup.js'
import { encryptConnectionToken } from '../services/connection-token.js'
import { createWebhookRouter } from '../routes/webhook.js'

test('PARTNER_ADDED fetches the customer business token and persists discovered assets', async t => {
  const originalFetch = globalThis.fetch
  const originalUpsert = prisma.whatsAppConnection.upsert, originalConnectionUpdate = prisma.whatsAppConnection.update
  const originalSignupFind = prisma.hostedSignupRequest.findFirst, originalSignupUpdate = prisma.hostedSignupRequest.update
  const originalEnv = { system: process.env.META_SYSTEM_TOKEN, secret: process.env.META_APP_SECRET, key: process.env.META_TOKEN_ENCRYPTION_KEY }
  Object.assign(process.env, { META_SYSTEM_TOKEN: 'system-token', META_APP_SECRET: 'app-secret', META_TOKEN_ENCRYPTION_KEY: 'test-encryption-key' })
  const writes: any[] = [], requests: string[] = []
  prisma.whatsAppConnection.upsert = (async (args: any) => { writes.push(args); return { id: 'connection-1', ...args.create } }) as any
  prisma.whatsAppConnection.update = (async (args: any) => ({ id: 'connection-1', ...args.data })) as any
  prisma.hostedSignupRequest.findFirst = (async () => ({ id: 'signup-1', label: 'Clinic Label', pinCiphertext: encryptConnectionToken('123456'), status: 'PENDING', createdAt: new Date() })) as any
  let signupUpdate: any
  prisma.hostedSignupRequest.update = (async (args: any) => { signupUpdate = args; return args.data }) as any
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    const value = String(url); requests.push(value)
    if (value.includes('/321/system_user_access_tokens')) {
      assert.equal(init.method, 'POST')
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer system-token')
      const form = new URLSearchParams(String(init.body))
      assert.equal(form.get('fetch_only'), 'true')
      assert.equal(form.get('appsecret_proof'), crypto.createHmac('sha256', 'app-secret').update('system-token').digest('hex'))
      return Response.json({ access_token: 'bisu-token' })
    }
    if (value.includes('/456/phone_numbers')) return Response.json({ data: [{ id: '789', display_phone_number: '+91 99999 99999', verified_name: 'Clinic WhatsApp' }] })
    if (value.includes('/789/whatsapp_business_profile')) return Response.json({ data: [{ about: 'Always available', address: 'Main Street', description: 'Clinic profile', email: 'hello@clinic.test', profile_picture_url: 'https://example.test/profile.jpg', websites: ['https://clinic.test'], vertical: 'HEALTH' }] })
    if (value.includes('/456/subscribed_apps')) { assert.equal(init.method, 'POST'); return Response.json({ success: true }) }
    if (value.includes('/789/register')) {
      assert.deepEqual(JSON.parse(String(init.body)), { messaging_product: 'whatsapp', pin: '123456' })
      return Response.json({ success: true })
    }
    if (value.includes('/321?')) return Response.json({ id: '321', name: 'Clinic Business' })
    if (value.includes('/456?')) return Response.json({ id: '456', name: 'Clinic WABA' })
    throw new Error(`Unexpected request: ${value}`)
  }) as typeof fetch
  t.after(() => {
    globalThis.fetch = originalFetch
    prisma.whatsAppConnection.upsert = originalUpsert
    prisma.whatsAppConnection.update = originalConnectionUpdate
    prisma.hostedSignupRequest.findFirst = originalSignupFind
    prisma.hostedSignupRequest.update = originalSignupUpdate
    for (const [name, value] of Object.entries({ META_SYSTEM_TOKEN: originalEnv.system, META_APP_SECRET: originalEnv.secret, META_TOKEN_ENCRYPTION_KEY: originalEnv.key })) value === undefined ? delete process.env[name] : process.env[name] = value
  })

  const result = await captureHostedSignupEvent({ event: 'PARTNER_ADDED', waba_info: { waba_id: '456', owner_business_id: '321' } })
  assert.equal(result, true)
  assert.equal(writes[0].create.metaBusinessId, '321')
  assert.equal(writes[0].create.label, 'Clinic Label')
  assert.equal(writes[0].create.metaBusinessName, 'Clinic Business')
  assert.equal(writes[0].create.wabaId, '456')
  assert.equal(writes[0].create.wabaName, 'Clinic WABA')
  assert.equal(writes[0].create.phoneNumberId, '789')
  assert.equal(writes[0].create.profileEmail, 'hello@clinic.test')
  assert.equal(writes[0].create.profilePictureUrl, 'https://example.test/profile.jpg')
  assert.deepEqual(writes[0].create.profileWebsites, ['https://clinic.test'])
  assert.match(writes[0].create.tokenCiphertext, /^v1\./)
  assert.ok(requests.filter(url => url.includes('/456')).every(url => url.includes('appsecret_proof=')))
  assert.ok(requests.some(url => url.includes('/subscribed_apps')))
  assert.ok(requests.some(url => url.includes('/321/system_user_access_tokens')))
  assert.ok(requests.some(url => url.includes('/789/register')))
  assert.equal(signupUpdate.data.status, 'COMPLETED')
  assert.equal(signupUpdate.data.pinCiphertext, '')
})

test('every valid Meta webhook change is audited in the database', async t => {
  const originalCreate = prisma.metaWebhookEvent.create, originalUpdate = prisma.metaWebhookEvent.update
  const originalUpdateMany = prisma.metaWebhookEvent.updateMany, originalFindUnique = prisma.metaWebhookEvent.findUnique
  const originalFindMany = prisma.metaWebhookEvent.findMany
  const oldSecret = process.env.META_APP_SECRET
  process.env.META_APP_SECRET = 'webhook-secret'
  let created: any, updated: any
  prisma.metaWebhookEvent.create = (async (args: any) => { created = args; return { id: 'audit-1', ...args.data } }) as any
  prisma.metaWebhookEvent.update = (async (args: any) => { updated = args; return { id: 'audit-1', ...args.data } }) as any
  prisma.metaWebhookEvent.updateMany = (async () => ({ count: 1 })) as any
  prisma.metaWebhookEvent.findMany = (async () => []) as any
  prisma.metaWebhookEvent.findUnique = (async () => ({ id: 'audit-1', attempts: 1, ...created.data })) as any
  const app = express()
  app.use('/webhooks/whatsapp', express.raw({ type: 'application/json' }))
  app.use('/webhooks', createWebhookRouter(() => {}))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => {
    prisma.metaWebhookEvent.create = originalCreate; prisma.metaWebhookEvent.update = originalUpdate
    prisma.metaWebhookEvent.updateMany = originalUpdateMany; prisma.metaWebhookEvent.findUnique = originalFindUnique
    prisma.metaWebhookEvent.findMany = originalFindMany
    oldSecret === undefined ? delete process.env.META_APP_SECRET : process.env.META_APP_SECRET = oldSecret
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '456', changes: [{ field: 'unknown_future_event', value: { event: 'NEW_EVENT', metadata: { phone_number_id: '789' } } }] }] })
  const signature = `sha256=${crypto.createHmac('sha256', 'webhook-secret').update(payload).digest('hex')}`
  const address = server.address() as { port: number }
  const response = await fetch(`http://127.0.0.1:${address.port}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature }, body: payload })
  assert.equal(response.status, 200)
  assert.equal(created.data.field, 'unknown_future_event')
  assert.equal(created.data.event, 'NEW_EVENT')
  assert.equal(created.data.wabaId, '456')
  assert.equal(created.data.phoneNumberId, '789')
  for (let attempt = 0; attempt < 20 && updated?.data?.status !== 'PROCESSED'; attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(updated.data.status, 'PROCESSED')
})
