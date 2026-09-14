import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { templatesRouter } from '../routes/templates.js'
import { prisma } from '../db.js'

test('template routes validate and upload with mocked Meta, without database or external requests', async t => {
  const originalFetch = globalThis.fetch
  const originalFindUnique = prisma.messageTemplate.findUnique, originalUpsert = prisma.messageTemplate.upsert, originalUpdate = prisma.messageTemplate.update
  const originalFindMany = prisma.messageTemplate.findMany
  const originalEnv = { token: process.env.WHATSAPP_ACCESS_TOKEN, app: process.env.META_APP_ID, waba: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID, phone: process.env.WHATSAPP_PHONE_NUMBER_ID }
  Object.assign(process.env, { WHATSAPP_ACCESS_TOKEN: 'test-token', META_APP_ID: '123', WHATSAPP_BUSINESS_ACCOUNT_ID: '456', WHATSAPP_PHONE_NUMBER_ID: '789' })
  const app = express().use(express.json()).use('/api/templates', templatesRouter)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }, baseUrl = `http://127.0.0.1:${address.port}/api/templates`
  const requests: Array<{ url: string; init: RequestInit }> = []
  let mode = 'success', stored: any, page = 0
  prisma.messageTemplate.findUnique = (async () => null) as any
  prisma.messageTemplate.upsert = (async (args: any) => { stored = args; return { id: 'local-1', ...args.create } }) as any
  prisma.messageTemplate.update = (async (args: any) => { stored = args; return { id: 'local-1', ...args.data } }) as any
  prisma.messageTemplate.findMany = (async () => []) as any
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    if (!String(url).startsWith('https://graph.facebook.com/')) return originalFetch(url, init)
    requests.push({ url: String(url), init })
    if (mode === 'incomplete') return Response.json({})
    if (mode === 'rejected') return Response.json({ error: { error_user_msg: 'Invalid sample', code: 100 } }, { status: 400 })
    if (mode === 'sync') return Response.json({ data: [{ id: String(++page), name: `page_${page}`, language: 'en_US', category: 'UTILITY', status: 'APPROVED', components: [] }], ...(page === 1 ? { paging: { next: 'ignored', cursors: { after: 'cursor_1' } } } : {}) })
    if (String(url).includes('/uploads?')) return Response.json({ id: 'upload:session?sig=test' })
    if (String(url).includes('/upload:')) {
      let bytes = 0
      for await (const chunk of init.body as any) bytes += chunk.length
      assert.ok(bytes > 0)
      return Response.json({ h: '4:review-handle' })
    }
    if (String(url).endsWith('/media')) return Response.json({ id: '987654' })
    if (String(url).endsWith('/meta-1')) return Response.json({ success: true })
    return Response.json({ id: 'meta-1', status: 'PENDING', category: 'MARKETING' })
  }) as typeof fetch
  const request = (path: string, data: any, method = 'POST') => originalFetch(baseUrl + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  const png = () => { const form = new FormData(); form.set('file', new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0])], { type: 'image/png' }), 'sample.png'); return form }
  const draft = { name: 'order_ready', language: 'en_US', category: 'UTILITY', body: 'Your order is ready.', examples: [], parameterLabels: [], buttons: [] }
  try {
    await t.test('invalid templates never reach Meta', async () => {
      const response = await request('/', { ...draft, name: 'Bad name' })
      assert.equal(response.status, 400)
      assert.equal((await response.json()).field, 'name')
      assert.equal(requests.length, 0)
    })
    await t.test('creation persists the category returned by Meta', async () => {
      const response = await request('/', draft)
      assert.equal(response.status, 201)
      assert.equal(stored.create.category, 'MARKETING')
    })
    await t.test('duplicate names return a conflict before another submission', async () => {
      prisma.messageTemplate.findUnique = (async () => ({ id: 'local-1' })) as any
      const count = requests.length
      assert.equal((await request('/', draft)).status, 409)
      assert.equal(requests.length, count)
    })
    await t.test('edit transitions to pending and clears an old rejection', async () => {
      prisma.messageTemplate.findUnique = (async () => ({ id: 'local-1', metaTemplateId: 'meta-1', name: draft.name, language: draft.language, category: draft.category, status: 'REJECTED' })) as any
      assert.equal((await request('/local-1', draft, 'PUT')).status, 200)
      assert.equal(stored.data.status, 'PENDING')
      assert.equal(stored.data.rejectionReason, null)
      assert.equal((await request('/local-1', { ...draft, language: 'hi' }, 'PUT')).status, 400)
    })
    await t.test('review upload uses resumable OAuth upload and returns a handle', async () => {
      const response = await originalFetch(baseUrl + '/media/example', { method: 'POST', body: png() })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { handle: '4:review-handle', type: 'IMAGE' })
      assert.ok(requests.at(-2)!.url.includes('file_name=sample.png'))
      assert.equal((requests.at(-1)!.init.headers as any).Authorization, 'OAuth test-token')
      assert.equal((requests.at(-1)!.init.headers as any).file_offset, '0')
    })
    await t.test('delivery upload uses the phone media endpoint and returns an ID', async () => {
      const response = await originalFetch(baseUrl + '/media/send', { method: 'POST', body: png() })
      assert.deepEqual(await response.json(), { mediaId: '987654', type: 'IMAGE' })
      assert.ok(requests.at(-1)!.url.endsWith('/789/media'))
      const body = requests.at(-1)!.init.body as FormData
      assert.equal(body.get('messaging_product'), 'whatsapp')
    })
    await t.test('missing files, spoofed files and malformed multipart return JSON errors', async () => {
      assert.equal((await originalFetch(baseUrl + '/media/example', { method: 'POST', body: new FormData() })).status, 400)
      const fake = new FormData(); fake.set('file', new Blob(['not a PNG'], { type: 'image/png' }), 'fake.png')
      const before = requests.length
      const response = await originalFetch(baseUrl + '/media/example', { method: 'POST', body: fake })
      assert.equal(response.status, 400)
      assert.match((await response.json()).error, /contents/)
      assert.equal(requests.length, before)
      const wrong = new FormData(); wrong.set('wrong', new Blob(['file']), 'file.png')
      assert.equal((await originalFetch(baseUrl + '/media/example', { method: 'POST', body: wrong })).status, 400)
    })
    await t.test('incomplete successful Meta responses are errors, not successful uploads', async () => {
      mode = 'incomplete'
      const response = await originalFetch(baseUrl + '/media/example', { method: 'POST', body: png() })
      assert.equal(response.status, 400)
      assert.match((await response.json()).error, /incomplete/)
    })
    await t.test('Meta rejection details are surfaced to the editor', async () => {
      mode = 'rejected'
      const response = await originalFetch(baseUrl + '/media/example', { method: 'POST', body: png() })
      assert.equal(response.status, 400)
      assert.match((await response.json()).error, /Invalid sample/)
    })
    await t.test('template synchronization follows all pages using cursors', async () => {
      mode = 'sync'
      assert.equal((await originalFetch(baseUrl + '?sync=true')).status, 200)
      assert.equal(page, 2)
      assert.ok(requests.at(-1)!.url.includes('after=cursor_1'))
    })
  } finally {
    globalThis.fetch = originalFetch
    prisma.messageTemplate.findUnique = originalFindUnique
    prisma.messageTemplate.upsert = originalUpsert
    prisma.messageTemplate.update = originalUpdate
    prisma.messageTemplate.findMany = originalFindMany
    for (const [key, value] of Object.entries({ WHATSAPP_ACCESS_TOKEN: originalEnv.token, META_APP_ID: originalEnv.app, WHATSAPP_BUSINESS_ACCOUNT_ID: originalEnv.waba, WHATSAPP_PHONE_NUMBER_ID: originalEnv.phone })) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
