import test from 'node:test'
import assert from 'node:assert/strict'
import { constants, createCipheriv, createDecipheriv, createHmac, generateKeyPairSync, publicEncrypt, randomBytes } from 'node:crypto'
import { appointmentFlow, blankFlow, connectFormAnswers, validateFlowInput, validateFlowJson, type FlowInput } from '../../shared/whatsapp-flows.js'
import { decryptFlow, encryptFlow } from '../services/flow-crypto.js'
import { handleBookingExchange, flowCompletionBody, validateBookingDetails } from '../services/flow-booking.js'
import { prisma } from '../db.js'
import { flowDataEndpoint } from '../routes/flow-endpoint.js'
import { whatsappFlowsRouter } from '../routes/whatsapp-flows.js'
import { flowForm, flowTokenHash, uploadFlow, downloadFlowJson } from '../services/native-flows.js'

function replaceMethod(t: any, target: any, name: string, replacement: any) { const original = target[name]; target[name] = replacement; t.after(() => { target[name] = original }) }

const draft = (): FlowInput => ({ name: 'Appointments', categories: ['APPOINTMENT_BOOKING'], flowJson: appointmentFlow(), endpointMode: 'APPOINTMENT', endpointUri: '' })
test('Meta Flow form fields use the documented multipart encoding', () => {
  const form = flowForm({ name: 'Patient intake', categories: ['CONTACT_US', 'OTHER'], endpoint_uri: 'https://example.com/flows' })
  assert.equal(form.get('name'), 'Patient intake')
  assert.equal(form.get('categories'), '["CONTACT_US","OTHER"]')
  assert.equal(form.get('endpoint_uri'), 'https://example.com/flows')
})
test('guided multi-screen forms carry answers forward and retain custom payload values', () => {
  const doc = blankFlow(), first = doc.screens[0], second = structuredClone(first)
  second.id = 'SECOND'; doc.screens.push(second)
  first.layout.children[0].children.unshift({ type: 'TextInput', name: 'name', label: 'Name' })
  first.layout.children[0].children.at(-1)['on-click-action'] = { name: 'navigate', next: { type: 'screen', name: 'SECOND' }, payload: { campaign: 'welcome' } }
  connectFormAnswers(doc)
  assert.equal(first.layout.children[0].children.at(-1)['on-click-action'].payload.name, '${form.name}')
  assert.equal(first.layout.children[0].children.at(-1)['on-click-action'].payload.campaign, 'welcome')
  assert.equal(second.data.name.type, 'string')
  assert.equal(second.layout.children[0].children.at(-1)['on-click-action'].payload.name, '${data.name}')
  first.layout.children[0].children.shift(); connectFormAnswers(doc)
  assert.equal(first.layout.children[0].children.at(-1)['on-click-action'].payload.name, undefined)
})
test('Flow JSON structural validation preserves advanced components and protects booking bindings', () => {
  assert.deepEqual(validateFlowJson(blankFlow()), [])
  assert.deepEqual(validateFlowJson(appointmentFlow()), [])
  assert.equal(validateFlowInput(draft()).name, 'Appointments')
  const custom = blankFlow(); custom.screens[0].layout.children.push({ type: 'FutureMetaComponent', arbitrary: { nested: [1, 2] } })
  assert.deepEqual(validateFlowJson(custom), [])
  const changed = draft(); changed.flowJson.screens[0].layout.children[0].children[1].label = 'Your full name'
  assert.doesNotThrow(() => validateFlowInput(changed))
  changed.flowJson.screens[0].layout.children[0].children[1].name = 'wrong_mapping'
  assert.throws(() => validateFlowInput(changed), /connected fields/)
  assert.throws(() => validateFlowInput({ ...draft(), endpointMode: 'NONE' }), /backend endpoint/)
  assert.throws(() => validateFlowInput({ ...draft(), endpointMode: 'EXTERNAL', endpointUri: 'http://localhost' }), /HTTPS/)
  const broken = blankFlow(); broken.screens.push(structuredClone(broken.screens[0])); assert.match(validateFlowJson(broken).join(' '), /Duplicate/)
  broken.routing_model = { WELCOME: ['MISSING'] }; assert.match(validateFlowJson(broken).join(' '), /Invalid route/)
  assert.throws(() => validateBookingDetails({ name: 'Alex', age: '1e2', idLast4: '1234', slotId: 'one' }))
  assert.deepEqual(validateBookingDetails({ name: ' Alex ', age: '0', idLast4: '0012', slotId: 'one' }), { name: 'Alex', age: 0, idLast4: '0012', slotId: 'one' })
})

test('Meta encryption round trip, tamper detection, signature and ping', async t => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const key = randomBytes(16), iv = randomBytes(16), cipher = createCipheriv('aes-128-gcm', key, iv)
  const body = { encrypted_aes_key: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'), initial_vector: iv.toString('base64'), encrypted_flow_data: Buffer.concat([cipher.update(JSON.stringify({ action: 'ping' })), cipher.final(), cipher.getAuthTag()]).toString('base64') }
  assert.deepEqual(decryptFlow(body, privateKey).data, { action: 'ping' })
  const response = { data: { status: 'active' } }, encrypted = Buffer.from(encryptFlow(response, key, iv), 'base64')
  const decipher = createDecipheriv('aes-128-gcm', key, Buffer.from(iv.map(byte => byte ^ 255)))
  decipher.setAuthTag(encrypted.subarray(-16))
  assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString()), response)
  const damaged = Buffer.from(body.encrypted_flow_data, 'base64'); damaged[0] ^= 1
  assert.throws(() => decryptFlow({ ...body, encrypted_flow_data: damaged.toString('base64') }, privateKey))
  const old = { secret: process.env.META_APP_SECRET, key: process.env.WHATSAPP_FLOW_PRIVATE_KEY }
  process.env.META_APP_SECRET = 'test-signing-secret'; process.env.WHATSAPP_FLOW_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  t.after(() => { for (const [name, value] of Object.entries({ META_APP_SECRET: old.secret, WHATSAPP_FLOW_PRIVATE_KEY: old.key })) { if (value === undefined) delete process.env[name]; else process.env[name] = value } })
  const raw = Buffer.from(JSON.stringify(body)); let code = 200, result: any
  const res: any = { setHeader() {}, status(value: number) { code = value; return this }, type() { return this }, send(value: any) { result = value; return this }, sendStatus(value: number) { code = value; return this } }
  await flowDataEndpoint({ body: raw, header: () => 'sha256=bad' } as any, res); assert.equal(code, 432)
  code = 200
  await flowDataEndpoint({ body: raw, header: () => `sha256=${createHmac('sha256', 'test-signing-secret').update(raw).digest('hex')}` } as any, res)
  assert.equal(code, 200); assert.equal(result, encryptFlow(response, key, iv))
})

test('appointment endpoint validates sessions, persists confirmation once, handles stale slots and distrusts completion payloads', async t => {
  const token = randomBytes(32).toString('base64url')
  let session: any = { id: 'session', tokenHash: flowTokenHash(token), contactId: 'contact', conversationId: 'conversation', expiresAt: new Date(Date.now() + 60000), selection: null, result: null, flow: { endpointMode: 'APPOINTMENT', status: 'PUBLISHED' } }
  let slots = [{ id: 'slot', startsAt: new Date(Date.now() + 86400000) }], bookings = 0, patientWrites = 0
  replaceMethod(t, prisma.whatsAppFlowSession, 'findUnique', async () => session)
  replaceMethod(t, prisma.whatsAppFlowSession, 'findUniqueOrThrow', async () => session)
  replaceMethod(t, prisma.whatsAppFlowSession, 'updateMany', async (args: any) => { Object.assign(session, args.data); return { count: 1 } })
  replaceMethod(t, prisma.whatsAppFlowSession, 'update', async (args: any) => { Object.assign(session, args.data); return session })
  replaceMethod(t, prisma.appointmentSlot, 'findMany', async () => slots)
  replaceMethod(t, prisma.appointmentSlot, 'findFirst', async () => slots[0] || null)
  replaceMethod(t, prisma.patient, 'upsert', async () => { patientWrites++; return { id: 'patient' } as any })
  replaceMethod(t, prisma.appointment, 'create', async () => { bookings++; return { reference: 'APT-ONE' } as any })
  replaceMethod(t, prisma, '$transaction', async (fn: any) => fn({ ...prisma, $queryRaw: async () => [] }))
  await assert.rejects(handleBookingExchange({ action: 'INIT', flow_token: 'bad' }), /no longer available/)
  session.expiresAt = new Date(0)
  await assert.rejects(handleBookingExchange({ action: 'INIT', flow_token: token }), /expired/)
  session.expiresAt = new Date(Date.now() + 60000)
  assert.equal((await handleBookingExchange({ action: 'INIT', flow_token: token }) as any).data.slots.length, 1)
  assert.equal(await flowCompletionBody({ interactive: { nfm_reply: { response_json: JSON.stringify({ flow_token: token, appointment_reference: 'FAKE' }) } } }, 'contact'), 'Booking form closed without a confirmed appointment')
  assert.equal(session.result, null)
  const reviewed: any = await handleBookingExchange({ action: 'data_exchange', screen: 'APPOINTMENT', flow_token: token, data: { name: 'Alex', age: '25', idLast4: '0012', slotId: 'slot' } })
  assert.equal(reviewed.screen, 'REVIEW'); assert.equal(bookings, 0); assert.equal(patientWrites, 0)
  const confirm = { action: 'data_exchange', screen: 'REVIEW', flow_token: token, data: { selection: reviewed.data.selection } }
  const result = await handleBookingExchange(confirm)
  assert.equal((result as any).data.extension_message_response.params.appointment_reference, 'APT-ONE')
  assert.deepEqual(await handleBookingExchange(confirm), result); assert.equal(bookings, 1)
  assert.equal(await flowCompletionBody({ interactive: { nfm_reply: { response_json: JSON.stringify({ flow_token: token }) } } }, 'other-contact'), 'Flow response received (unrecognized session)')
  const body = await flowCompletionBody({ interactive: { nfm_reply: { response_json: JSON.stringify({ flow_token: token, appointment_reference: 'FAKE' }) } } }, 'contact')
  assert.match(body, /APT-ONE/); assert.doesNotMatch(body, /FAKE/)
  session = { ...session, result: null, selection: { key: 'selected', slotId: 'slot' } }; slots = []
  assert.equal((await handleBookingExchange({ ...confirm, data: { selection: 'selected' } }) as any).screen, 'REVIEW'); assert.equal(bookings, 1)
  assert.equal((await handleBookingExchange({ action: 'BACK', flow_token: token }) as any).data.available, false)
})

test('Flow lifecycle refuses stale edits and non-admin changes, retains Meta validation and protects remote assets', async t => {
  let flow: any = { id: 'local', metaFlowId: '123', name: 'Form', categories: ['OTHER'], flowJson: blankFlow(), endpointMode: 'NONE', endpointUri: '', status: 'DRAFT', revision: 2, syncedRevision: 2, validationErrors: [], remoteDetails: {} }
  let remoteStatus = 'DRAFT', uploadErrors: any[] = [], graphCalls: string[] = [], uploadForm: FormData | undefined, unsafeAsset = false
  const oldToken = process.env.META_SYSTEM_TOKEN; process.env.META_SYSTEM_TOKEN = 'fake'
  t.after(() => { if (oldToken === undefined) delete process.env.META_SYSTEM_TOKEN; else process.env.META_SYSTEM_TOKEN = oldToken })
  replaceMethod(t, prisma.whatsAppFlow, 'findUniqueOrThrow', async () => ({ ...flow }))
  replaceMethod(t, prisma.whatsAppFlow, 'updateMany', async () => ({ count: 1 }))
  replaceMethod(t, prisma.whatsAppFlow, 'update', async (args: any) => { flow = { ...flow, ...args.data, ...(args.data.revision?.increment ? { revision: flow.revision + 1 } : {}) }; return { ...flow } })
  replaceMethod(t, globalThis, 'fetch', async (url: any, init: any = {}) => {
    graphCalls.push(String(url))
    if (init.method === 'DELETE') return Response.json({ success: true })
    if (String(url).startsWith('https://scontent.xx.fbcdn.net/')) return Response.json(flow.flowJson)
    if (String(url).endsWith('/assets') && (!init.method || init.method === 'GET')) return Response.json({ data: [{ asset_type: 'FLOW_JSON', download_url: unsafeAsset ? 'https://127.0.0.1/private' : 'https://scontent.xx.fbcdn.net/flow.json' }] })
    if (init.body instanceof FormData) { uploadForm = init.body; return Response.json({ success: true, validation_errors: uploadErrors }) }
    if (!init.method || init.method === 'GET') return Response.json({ id: '123', status: remoteStatus, validation_errors: [] })
    return Response.json({ success: true })
  })
  const invoke = async (path: string, method: string, body: any, role = 'ADMIN') => {
    const layer = (whatsappFlowsRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method.toLowerCase()])
    assert.ok(layer, `${method} ${path}`)
    let status = 200, data: any
    const req = { params: { id: 'local' }, body, user: { id: 'agent', role } }, res: any = { status(code: number) { status = code; return this }, json(value: any) { data = value; return this } }
    for (const handler of layer.route.stack) { let next = false; await handler.handle(req, res, () => { next = true }); if (!next) break }
    return { status, data }
  }
  assert.equal((await invoke('/:id', 'PUT', { ...flow, revision: 1 })).status, 409)
  assert.equal((await invoke('/:id', 'PUT', flow, 'AGENT')).status, 403)
  assert.equal(graphCalls.length, 0)
  uploadErrors = [{ message: 'Unsupported property', line_start: 4 }]
  const invalid = await uploadFlow(flow)
  assert.equal(invalid.syncedRevision, null); assert.equal((invalid.validationErrors as any[]).length, 1)
  assert.equal(uploadForm?.get('asset_type'), 'FLOW_JSON'); assert.equal(uploadForm?.get('name'), 'flow.json')
  assert.deepEqual(JSON.parse(await (uploadForm?.get('file') as Blob).text()), flow.flowJson)
  assert.equal((await invoke('/:id/publish', 'POST', { revision: 2, confirm: true })).status, 409)
  uploadErrors = []; await uploadFlow(flow)
  assert.equal((await invoke('/:id/publish', 'POST', { revision: 2, confirm: false })).status, 400)
  assert.equal((await invoke('/:id/publish', 'POST', { revision: 2, confirm: true })).status, 200)
  assert.equal(flow.status, 'PUBLISHED')
  assert.equal((await invoke('/:id', 'PUT', flow)).status, 409)
  remoteStatus = 'PUBLISHED'
  const before = graphCalls.length
  await assert.rejects(uploadFlow(flow), /cannot be edited/)
  assert.equal(graphCalls.length, before + 1)
  unsafeAsset = true
  await assert.rejects(downloadFlowJson('123'), /unsupported asset host/)
})
