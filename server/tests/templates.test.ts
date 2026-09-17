import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTemplate, TemplateValidationError, type TemplateDraft, type CardDraft, mediaFileError } from '../../shared/templates.js'
import { buildSendComponents, supportsAutomaticTemplate } from '../../shared/template-send.js'
import { draftFromTemplate } from '../../src/templates/drafts.js'

const base = (data: Partial<TemplateDraft> = {}): TemplateDraft => ({ name: 'order_ready', language: 'en_US', category: 'UTILITY', kind: 'STANDARD', body: 'Your order is ready.', examples: [], parameterLabels: [], buttons: [], ...data })
const imageCard = (): CardDraft => ({ headerType: 'IMAGE', headerExample: '4:review-handle', body: 'Meet our newest plant.', examples: [], buttons: [{ type: 'URL', text: 'Shop', value: 'https://example.com/{{1}}', example: 'plant' }] })
const rejects = (draft: TemplateDraft, field: string) => assert.throws(() => buildTemplate(draft), (error: unknown) => error instanceof TemplateValidationError && error.field.startsWith(field))

test('media review handles are sent only in creation examples; delivery requires media', () => {
  const payload = buildTemplate(base({ header: { type: 'IMAGE', example: '4:review-handle' } }))
  assert.deepEqual(payload.components[0], { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4:review-handle'] } })
  assert.throws(() => buildSendComponents(payload.components, []), /delivery media/)
  assert.throws(() => buildSendComponents(payload.components, [], { headerMedia: { kind: 'id', value: '4:review-handle' } }), /review handle/)
  assert.deepEqual(buildSendComponents(payload.components, [], { headerMedia: { kind: 'id', value: '123456789' } }), [{ type: 'header', parameters: [{ type: 'image', image: { id: '123456789' } }] }])
  assert.equal(supportsAutomaticTemplate(payload), false)
})

test('named header and body variables survive an edit round-trip and send with names', () => {
  const payload = buildTemplate(base({ parameterFormat: 'NAMED', header: { type: 'TEXT', text: 'Order {{order_id}}', example: '123' }, body: 'Hi {{first_name}}, your order is ready.', examples: ['Asha'], parameterLabels: ['Customer name'] }))
  assert.deepEqual(payload.components[0].example, { header_text_named_params: [{ param_name: 'order_id', example: '123' }] })
  assert.deepEqual(payload.components[1].example, { body_text_named_params: [{ param_name: 'first_name', example: 'Asha' }] })
  const draft = draftFromTemplate({ ...payload, id: 'local', status: 'APPROVED', updatedAt: '', rejectionReason: null, parameterLabels: ['Customer name'] })
  assert.deepEqual(buildTemplate(draft), payload)
  const sent = buildSendComponents(payload.components, ['Ravi'], { headerText: '456' })
  assert.deepEqual(sent[0].parameters, [{ type: 'text', text: '456', parameter_name: 'order_id' }])
  assert.deepEqual(sent[1].parameters, [{ type: 'text', text: 'Ravi', parameter_name: 'first_name' }])
})

test('literal parentheses remain text, malformed or mismatched variables fail before submission', () => {
  assert.equal(buildTemplate(base({ body: 'Order (pickup only) is ready.' })).components[0].text, 'Order (pickup only) is ready.')
  for (const body of ['Hi {{2}}, welcome.', 'Hi {{1}, welcome.', '{{1}} is ready.', 'Hi {{1}} {{2}}, welcome.']) rejects(base({ body, examples: ['Asha'], parameterLabels: ['Name'] }), 'body')
  rejects(base({ body: 'Hi {{1}}, welcome.', examples: [' '], parameterLabels: ['Name'] }), 'body.examples')
  rejects(base({ parameterFormat: 'NAMED', body: 'Hi {{FirstName}}, welcome.', examples: ['Asha'], parameterLabels: ['Name'] }), 'body')
})

test('text header supports one sample variable; footer rejects variables and overflow', () => {
  rejects(base({ header: { type: 'TEXT', text: 'Order {{1}}' } }), 'header.example')
  rejects(base({ header: { type: 'TEXT', text: 'Order {{1}} from {{2}}', example: '123' } }), 'header.text')
  rejects(base({ footer: '{{1}}' }), 'footer')
  rejects(base({ footer: 'x'.repeat(61) }), 'footer')
  rejects(base({ header: { type: 'IMAGE', example: 'https://example.com/sample.png' } }), 'header.example')
})

test('button grouping preserves CTA order and sends correct URL indexes', () => {
  const payload = buildTemplate(base({ buttons: [{ type: 'URL', text: 'Order', value: 'https://example.com/orders/{{1}}', example: '123/a?x=1' }, { type: 'QUICK_REPLY', text: 'Thanks' }, { type: 'PHONE_NUMBER', text: 'Call', value: '+919876543210' }, { type: 'URL', text: 'Track', value: 'https://example.com/track/{{1}}', example: 'abc' }] }))
  const buttons = payload.components.at(-1)!.buttons
  assert.deepEqual(buttons.map((b: any) => b.type), ['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'URL'])
  assert.equal(buttons[1].example[0], 'https://example.com/orders/123/a?x=1')
  const draft = draftFromTemplate({ ...payload, id: 'local', status: 'APPROVED', updatedAt: '', rejectionReason: null, parameterLabels: [] })
  assert.equal(draft.buttons[1].example, '123/a?x=1')
  const sent = buildSendComponents(payload.components, ['456', 'def'])
  assert.deepEqual(sent.map(c => c.index), ['1', '3'])
  assert.equal(sent[1].parameters[0].text, 'def')
})

test('button limits, malformed input, invalid URLs and duplicate labels are rejected', () => {
  rejects(base({ buttons: [null] as any }), 'buttons')
  rejects(base({ buttons: Array.from({ length: 11 }, (_, i) => ({ type: 'QUICK_REPLY', text: `Reply ${i}` })) }), 'buttons')
  rejects(base({ buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }, { type: 'QUICK_REPLY', text: 'yes' }] }), 'buttons')
  for (const value of ['javascript:alert(1)', 'https://example.com/{{2}}', 'https://example.com/{{1}}/more', 'https://user:password@example.com']) rejects(base({ buttons: [{ type: 'URL', text: 'Open', value, example: 'x' }] }), 'buttons')
})

test('media carousel includes the outer body, validates shape and sends every card', () => {
  const draft = base({ category: 'MARKETING', kind: 'CAROUSEL', carousel: { cards: [imageCard(), imageCard()] } })
  const payload = buildTemplate(draft)
  assert.deepEqual(payload.components.map(c => c.type), ['BODY', 'CAROUSEL'])
  assert.equal('card_index' in payload.components[1].cards[0], false)
  const sent = buildSendComponents(payload.components, [], { cards: [{ parameters: ['one'], headerMedia: { kind: 'id', value: '111' } }, { parameters: ['two'], headerMedia: { kind: 'link', value: 'https://example.com/two.png' } }] })
  assert.equal(sent[0].cards[1].card_index, 1)
  assert.equal(sent[0].cards[1].components[1].parameters[0].text, 'two')
  rejects({ ...draft, body: '' }, 'body')
  rejects({ ...draft, category: 'UTILITY' }, 'category')
  rejects({ ...draft, carousel: { cards: [imageCard()] } }, 'carousel')
  rejects({ ...draft, carousel: { cards: [imageCard(), { ...imageCard(), headerType: 'VIDEO' }] } }, 'carousel')
  assert.throws(() => buildSendComponents(payload.components, [], { cards: [] }), /every approved/)
})

test('product carousel defines two cards and can deliver ten products', () => {
  const card: CardDraft = { headerType: 'PRODUCT', headerExample: '', body: '', examples: [], buttons: [{ type: 'SPM', text: 'View' }] }
  const payload = buildTemplate(base({ category: 'MARKETING', kind: 'PRODUCT_CAROUSEL', carousel: { cards: [card, card] } }))
  const result = buildSendComponents(payload.components, [], { cards: Array.from({ length: 10 }, (_, i) => ({ parameters: [], headerMedia: { kind: 'product', catalogId: '123', productRetailerId: `sku-${i}` } })) })
  assert.equal(result[0].cards.length, 10)
  assert.equal(result[0].cards[9].components[0].parameters[0].product.product_retailer_id, 'sku-9')
})

test('offers enforce marketing, no footer, body/code limits and delivery expiry', () => {
  const draft = base({ category: 'MARKETING', kind: 'LIMITED_TIME_OFFER', limitedTimeOffer: { text: 'Weekend offer', hasExpiration: true }, buttons: [{ type: 'URL', text: 'Shop', value: 'https://example.com' }, { type: 'COPY_CODE', text: '', example: 'SAVE20' }] })
  const payload = buildTemplate(draft)
  assert.equal(payload.components.at(-1)!.buttons[0].type, 'COPY_CODE')
  rejects({ ...draft, footer: 'Offer ends soon' }, 'footer')
  rejects({ ...draft, body: 'x'.repeat(601) }, 'body')
  assert.throws(() => buildSendComponents(payload.components, [], { buttons: { 0: { couponCode: 'SAVE' } }, expirationTimeMs: 1 }), /future/)
  const sent = buildSendComponents(payload.components, [], { buttons: { 0: { couponCode: 'SAVE' } }, expirationTimeMs: Date.now() + 60000 })
  assert.equal(sent[0].parameters[0].coupon_code, 'SAVE')
  assert.equal(sent[1].type, 'limited_time_offer')
})

test('Flow template creation omits send-time tokens and validates references', () => {
  const draft = base({ buttons: [{ type: 'FLOW', text: 'Book', flowId: '123', flowAction: 'navigate', navigateScreen: 'BOOKING' }] })
  const payload = buildTemplate(draft)
  assert.equal(payload.components[1].buttons[0].flow_token, undefined)
  const sent = buildSendComponents(payload.components, [], { buttons: { 0: { flowToken: 'session-123', flowData: { patient: 'Asha' } } } })
  assert.deepEqual(sent[0].parameters[0].action, { flow_token: 'session-123', flow_action_data: { patient: 'Asha' } })
  assert.equal(supportsAutomaticTemplate(payload), true)
  rejects({ ...draft, buttons: [{ ...draft.buttons[0], flowName: 'Book' }] }, 'buttons')
})

test('catalog, MPM and single product creation/delivery have separate components', () => {
  const catalog = buildTemplate(base({ category: 'MARKETING', kind: 'CATALOG' }))
  assert.deepEqual(catalog.components.at(-1)!.buttons, [{ type: 'CATALOG', text: 'View catalog' }])
  const mpm = buildTemplate(base({ category: 'MARKETING', kind: 'MPM' }))
  const sent = buildSendComponents(mpm.components, [], { buttons: { 0: { thumbnailProductRetailerId: 'sku-1', sections: [{ title: 'Plants', productIds: ['sku-1', 'sku-2'] }] } } })
  assert.equal(sent[0].parameters[0].action.sections[0].product_items.length, 2)
  const spm = buildTemplate(base({ category: 'MARKETING', kind: 'SPM' }))
  assert.equal(spm.components[0].format, 'PRODUCT')
  assert.throws(() => buildSendComponents(spm.components, []), /catalog product/)
})

test('authentication uses fixed content, validates Android config and explicit zero-tap consent', () => {
  const draft = base({ category: 'AUTHENTICATION', body: '', authentication: { otpType: 'COPY_CODE', addSecurityRecommendation: true, codeExpirationMinutes: 10 } })
  assert.deepEqual(buildTemplate(draft).components[0], { type: 'BODY', add_security_recommendation: true })
  rejects({ ...draft, body: 'Custom code text' }, 'authentication')
  rejects({ ...draft, authentication: { ...draft.authentication!, codeExpirationMinutes: 0 } }, 'authentication')
  const zero = { ...draft, authentication: { ...draft.authentication!, otpType: 'ZERO_TAP' as const, packageName: 'com.example.app', signatureHash: 'AbcDef123+/' } }
  rejects(zero, 'authentication.zeroTapTermsAccepted')
  const payload = buildTemplate({ ...zero, authentication: { ...zero.authentication, zeroTapTermsAccepted: true } })
  assert.equal(payload.components.at(-1)!.buttons[0].zero_tap_terms_accepted, true)
  assert.equal(buildSendComponents(payload.components, ['123456'], {}, true)[1].parameters[0].text, '123456')
})

test('media sizes and MIME types match the selected format', () => {
  assert.equal(mediaFileError('IMAGE', { type: 'image/png', size: 5 * 1024 * 1024 }), '')
  assert.ok(mediaFileError('IMAGE', { type: 'image/png', size: 5 * 1024 * 1024 + 1 }))
  assert.ok(mediaFileError('VIDEO', { type: 'image/png', size: 100 }))
  assert.equal(mediaFileError('DOCUMENT', { type: 'application/pdf', size: 100 * 1024 * 1024 }), '')
})
