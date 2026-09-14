import { TEMPLATE_LANGUAGES } from './template-languages.js'

export type HeaderType = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION' | 'PRODUCT'
export type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE' | 'FLOW' | 'CATALOG' | 'MPM' | 'SPM'
export type TemplateKind = 'STANDARD' | 'PRODUCT_CAROUSEL' | 'CAROUSEL' | 'CATALOG' | 'MPM' | 'SPM' | 'LIMITED_TIME_OFFER'
export type ParameterFormat = 'POSITIONAL' | 'NAMED'
export type HeaderDraft = { type: HeaderType; text?: string; example?: string }
export type ButtonDraft = { type: ButtonType; text: string; value?: string; example?: string; flowId?: string; flowName?: string; flowJson?: string; flowAction?: 'navigate' | 'data_exchange'; navigateScreen?: string }
export type CardDraft = { headerType: 'IMAGE' | 'VIDEO' | 'PRODUCT'; headerExample: string; body: string; examples: string[]; buttons: ButtonDraft[] }
export type TemplateDraft = {
  name: string; language: string; category: string; kind?: TemplateKind; parameterFormat?: ParameterFormat;
  header?: HeaderDraft; body: string; examples: string[]; parameterLabels: string[]; footer?: string; buttons: ButtonDraft[];
  carousel?: { cards: CardDraft[] };
  limitedTimeOffer?: { text: string; hasExpiration: boolean };
  authentication?: { otpType: 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP'; codeExpirationMinutes?: number; addSecurityRecommendation: boolean; packageName?: string; signatureHash?: string; zeroTapTermsAccepted?: boolean; buttonText?: string; autofillText?: string };
}
// Meta's wire format varies by template family. Keep it at the API boundary.
export type Component = Record<string, any>
export class TemplateValidationError extends Error {
  constructor(public field: string, message: string) { super(message); this.name = 'TemplateValidationError' }
}
function fail(field: string, message: string): never { throw new TemplateValidationError(field, message) }
const str = (v: unknown) => typeof v === 'string' ? v.trim() : ''
function text(value: unknown, field: string, max: number, optional = false) {
  const s = str(value)
  if (!s && !optional) fail(field, 'This field is required')
  if (s.length > max) fail(field, `Use at most ${max} characters`)
  return s
}
export function variableKeys(value = ''): string[] {
  return [...new Set([...value.matchAll(/\{\{([^{}]+)\}\}/g)].map(m => m[1]))]
}
export function inferParameterFormat(components: Component[]): ParameterFormat {
  return components.some(c => ['BODY', 'HEADER'].includes(String(c.type).toUpperCase()) && variableKeys(c.text).some(k => !/^\d+$/.test(k)) || String(c.type).toUpperCase() === 'CAROUSEL' && (c.cards || []).some((card: Component) => inferParameterFormat(card.components || []) === 'NAMED')) ? 'NAMED' : 'POSITIONAL'
}
function variables(value: string, format: ParameterFormat, field: string, max = Infinity) {
  const keys = variableKeys(value)
  if (/[{}]/.test(value.replace(/\{\{([^{}]+)\}\}/g, ''))) fail(field, 'Use complete variable placeholders, such as {{1}} or {{first_name}}')
  if (keys.length > max) fail(field, `At most ${max} variable is allowed here`)
  if (format === 'NAMED' && keys.some(k => !/^[a-z][a-z0-9_]*$/.test(k))) fail(field, 'Variable names must start with a letter and use lowercase letters, numbers and underscores only')
  if (format === 'POSITIONAL' && keys.some((k, i) => k !== String(i + 1))) fail(field, 'Number variables in order: {{1}}, {{2}}, {{3}}')
  return keys
}
function sample(keys: string[], values: unknown, format: ParameterFormat, kind: 'body' | 'header', field: string) {
  if (!Array.isArray(values) || values.length !== keys.length || values.some(v => !str(v))) fail(field, `Provide a nonempty example for each of the ${keys.length} variable(s)`)
  const examples = values.map(v => text(v, field, 1024))
  return format === 'NAMED'
    ? { [`${kind}_text_named_params`]: keys.map((k, i) => ({ param_name: k, example: examples[i] })) }
    : { [`${kind}_text`]: kind === 'body' ? [examples] : examples }
}
function bodyComponent(value: unknown, examples: unknown, format: ParameterFormat, field: string, max: number): Component {
  const valueText = text(value, field, max), keys = variables(valueText, format, field)
  if (/^\{\{/.test(valueText) || /\}\}$/.test(valueText)) fail(field, 'Add words before the first variable and after the last variable')
  if (/\}\}\s*\{\{/.test(valueText)) fail(field, 'Add words between adjacent variables')
  if (/\t| {5}/.test(valueText)) fail(field, 'Remove tabs and runs of more than four spaces')
  return { type: 'BODY', text: valueText, ...(keys.length ? { example: sample(keys, examples, format, 'body', `${field}.examples`) } : {}) }
}
function headerComponent(header: HeaderDraft | undefined, format: ParameterFormat): Component | null {
  if (!header || header.type === 'NONE') return null
  if (header.type === 'TEXT') {
    const value = text(header.text, 'header.text', 60), keys = variables(value, format, 'header.text', 1)
    if (/[\n\r\t*~`]/.test(value) || /_(?![^{}]*\}\})/.test(value.replace(/\{\{[^}]+\}\}/g, ''))) fail('header.text', 'Text headers use a single line without Markdown formatting')
    return { type: 'HEADER', format: 'TEXT', text: value, ...(keys.length ? { example: sample(keys, [header.example], format, 'header', 'header.example') } : {}) }
  }
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.type)) {
    const handle = text(header.example, 'header.example', 16384)
    if (/^https?:\/\//i.test(handle)) fail('header.example', 'Upload a review sample; a public URL is not a resumable upload handle')
    return { type: 'HEADER', format: header.type, example: { header_handle: [handle] } }
  }
  if (['LOCATION', 'PRODUCT'].includes(header.type)) return { type: 'HEADER', format: header.type }
  return fail('header.type', 'Unsupported header format for Cloud API')
}
export function groupButtons(buttons: ButtonDraft[]) {
  // Preserve the user's order within each group, including URL parameter indexes.
  return [...buttons.filter(b => b.type === 'QUICK_REPLY'), ...buttons.filter(b => b.type !== 'QUICK_REPLY')]
}
export function buildButtons(input: ButtonDraft[], field = 'buttons', carousel = false): Component[] {
  if (!Array.isArray(input) || input.some(b => !b || typeof b !== 'object')) fail(field, 'Buttons must be a list of objects')
  if (input.length > (carousel ? 2 : 10)) fail(field, `At most ${carousel ? 2 : 10} buttons are allowed`)
  const allowed = carousel ? ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'] : ['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE', 'FLOW', 'CATALOG', 'MPM', 'SPM']
  const limits: Record<string, number> = { URL: 2, PHONE_NUMBER: 1, COPY_CODE: 1, FLOW: 1, CATALOG: 1, MPM: 1, SPM: 1 }
  for (const [type, limit] of Object.entries(limits)) if (input.filter(b => b?.type === type).length > limit) fail(field, `At most ${limit} ${type.toLowerCase().replaceAll('_', ' ')} button(s) are allowed`)
  if (input.some(b => ['CATALOG', 'MPM', 'SPM'].includes(b?.type)) && input.length !== 1) fail(field, 'Product and catalog buttons cannot be combined with other buttons')
  const labels = input.filter(b => b?.type !== 'COPY_CODE').map(b => str(b?.text).toLowerCase())
  if (new Set(labels).size !== labels.length) fail(field, 'Give each button different text')
  return groupButtons(input).map((b, i) => {
    const path = `${field}.${i}`
    if (!b || !allowed.includes(b.type)) fail(path, 'Unsupported button type')
    if (b.type === 'COPY_CODE') return { type: b.type, example: text(b.example, `${path}.example`, 20) }
    const label = text(b.text, `${path}.text`, 25)
    if (/[\r\n]/.test(label)) fail(`${path}.text`, 'Use a single-line button label')
    if (b.type === 'QUICK_REPLY') return { type: b.type, text: label }
    if (b.type === 'PHONE_NUMBER') {
      const phone = str(b.value).replace(/[\s()-]/g, '')
      if (!/^\+?[1-9]\d{6,19}$/.test(phone)) fail(`${path}.value`, 'Use an international phone number, including its country code')
      return { type: b.type, text: label, phone_number: phone }
    }
    if (b.type === 'URL') {
      const url = text(b.value, `${path}.value`, 2000), keys = variableKeys(url)
      if (keys.length && (keys.length !== 1 || keys[0] !== '1' || !url.endsWith('{{1}}') || url.split('{{1}}').length !== 2)) fail(`${path}.value`, 'A URL supports only {{1}}, once, at the end')
      if (/[{}]/.test(url.replace('{{1}}', ''))) fail(`${path}.value`, 'Invalid URL variable')
      try { const parsed = new URL(url.replace('{{1}}', 'sample')); if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error() }
      catch { fail(`${path}.value`, 'Enter a valid HTTP or HTTPS URL without credentials') }
      const example = keys.length ? url.replace('{{1}}', text(b.example, `${path}.example`, 2000)) : ''
      if (example.length > 2000) fail(`${path}.example`, 'The URL including its example cannot exceed 2000 characters')
      return { type: b.type, text: label, url, ...(keys.length ? { example: [example] } : {}) }
    }
    if (b.type === 'FLOW') {
      const flowId = str(b.flowId), flowName = str(b.flowName), flowJson = str(b.flowJson)
      if ([flowId, flowName, flowJson].filter(Boolean).length !== 1) fail(path, 'Provide exactly one Flow ID, Flow name, or Flow JSON')
      if (flowId && !/^\d+$/.test(flowId)) fail(`${path}.flowId`, 'Flow IDs contain digits only')
      if (flowJson) { try { const json = JSON.parse(flowJson); if (!json.version || !Array.isArray(json.screens)) throw new Error() } catch { fail(`${path}.flowJson`, 'Enter valid Flow JSON with version and screens') } }
      const action = b.flowAction || 'navigate'
      if (!['navigate', 'data_exchange'].includes(action)) fail(path, 'Choose navigate or data exchange')
      return { type: b.type, text: label, ...(flowId ? { flow_id: flowId } : flowName ? { flow_name: flowName } : { flow_json: flowJson }), flow_action: action, ...(action === 'navigate' ? { navigate_screen: text(b.navigateScreen, `${path}.navigateScreen`, 80) } : {}) }
    }
    const fixed: Record<string, string> = { CATALOG: 'View catalog', MPM: 'View items', SPM: 'View' }
    return { type: b.type, text: fixed[b.type] }
  })
}
export function buildTemplate(input: TemplateDraft) {
  if (!input || typeof input !== 'object') fail('template', 'Provide a template')
  if (!Array.isArray(input.buttons) || input.buttons.some(b => !b || typeof b !== 'object')) fail('buttons', 'Buttons must be a list of objects')
  const name = text(input.name, 'name', 512)
  if (!/^[a-z0-9_]+$/.test(name)) fail('name', 'Use lowercase letters, numbers and underscores')
  if (!TEMPLATE_LANGUAGES.some(([code]) => code === input.language)) fail('language', 'Select a supported WhatsApp language')
  const category = input.category
  if (!['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(category)) fail('category', 'Choose a template category')
  const format = input.parameterFormat || 'POSITIONAL'
  if (!['POSITIONAL', 'NAMED'].includes(format)) fail('parameterFormat', 'Choose positional or named variables')
  const components: Component[] = []
  if (category === 'AUTHENTICATION') {
    if (input.header && input.header.type !== 'NONE' || str(input.body) || str(input.footer) || input.buttons?.length || input.carousel || input.limitedTimeOffer) fail('authentication', 'Authentication templates use fixed content; remove custom components')
    const auth = input.authentication
    if (!auth || !['COPY_CODE', 'ONE_TAP', 'ZERO_TAP'].includes(auth.otpType)) fail('authentication.otpType', 'Choose an OTP delivery method')
    components.push({ type: 'BODY', add_security_recommendation: auth.addSecurityRecommendation !== false })
    if (auth.codeExpirationMinutes !== undefined) {
      if (!Number.isInteger(auth.codeExpirationMinutes) || auth.codeExpirationMinutes < 1 || auth.codeExpirationMinutes > 90) fail('authentication.codeExpirationMinutes', 'Expiration must be 1–90 minutes')
      components.push({ type: 'FOOTER', code_expiration_minutes: auth.codeExpirationMinutes })
    }
    const button: Component = { type: 'OTP', otp_type: auth.otpType, text: text(auth.buttonText || 'Copy code', 'authentication.buttonText', 25) }
    if (auth.otpType !== 'COPY_CODE') {
      const packageName = text(auth.packageName, 'authentication.packageName', 224), hash = text(auth.signatureHash, 'authentication.signatureHash', 11)
      if (!/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(packageName) || !/^[A-Za-z0-9+/]{11}$/.test(hash)) fail('authentication', 'Enter a valid Android package name and 11-character app signature hash')
      button.autofill_text = text(auth.autofillText || 'Autofill', 'authentication.autofillText', 25)
      button.supported_apps = [{ package_name: packageName, signature_hash: hash }]
      if (auth.otpType === 'ZERO_TAP') {
        if (auth.zeroTapTermsAccepted !== true) fail('authentication.zeroTapTermsAccepted', 'Accept the zero-tap terms before submitting')
        button.zero_tap_terms_accepted = true
      }
    }
    components.push({ type: 'BUTTONS', buttons: [button] })
  } else {
    const kind = input.kind || (input.carousel ? 'CAROUSEL' : 'STANDARD')
    if (!['STANDARD', 'CAROUSEL', 'PRODUCT_CAROUSEL', 'CATALOG', 'MPM', 'SPM', 'LIMITED_TIME_OFFER'].includes(kind)) fail('kind', 'Choose a supported template format')
    if (kind !== 'STANDARD' && category !== 'MARKETING') fail('category', 'This format requires the marketing category')
    if (!['CAROUSEL', 'PRODUCT_CAROUSEL'].includes(kind) && input.carousel) fail('carousel', 'Remove carousel cards from this format')
    if (kind !== 'LIMITED_TIME_OFFER' && input.limitedTimeOffer) fail('limitedTimeOffer', 'Remove the offer from this format')
    if (input.header?.type === 'PRODUCT' && kind !== 'SPM') fail('header', 'Product headers are used by single-product templates')
    if (['CAROUSEL', 'PRODUCT_CAROUSEL'].includes(kind) && input.header && input.header.type !== 'NONE') fail('header', 'Carousel headers belong to the cards')
    if (kind === 'CATALOG' && input.header && input.header.type !== 'NONE') fail('header', 'Catalog templates do not have custom headers')
    if (kind === 'MPM' && input.header && !['NONE', 'TEXT'].includes(input.header.type)) fail('header', 'Multi-product templates support text headers')
    if (kind === 'LIMITED_TIME_OFFER' && input.header && !['NONE', 'IMAGE', 'VIDEO'].includes(input.header.type)) fail('header', 'Offer templates support image or video headers')
    const header = headerComponent(kind === 'SPM' ? { type: 'PRODUCT' } : input.header, format)
    if (header) components.push(header)
    if (kind === 'LIMITED_TIME_OFFER') components.push({ type: 'LIMITED_TIME_OFFER', limited_time_offer: { text: text(input.limitedTimeOffer?.text, 'limitedTimeOffer.text', 16), has_expiration: input.limitedTimeOffer?.hasExpiration === true } })
    const body = bodyComponent(input.body, input.examples, format, 'body', kind === 'SPM' ? 160 : kind === 'LIMITED_TIME_OFFER' ? 600 : 1024)
    components.push(body)
    const keys = variableKeys(body.text)
    if (!Array.isArray(input.parameterLabels) || input.parameterLabels.length !== keys.length || input.parameterLabels.some(v => !str(v))) fail('parameterLabels', 'Give every body variable a descriptive label')
    const footer = text(input.footer, 'footer', 60, true)
    if (footer) {
      if (['CAROUSEL', 'PRODUCT_CAROUSEL', 'LIMITED_TIME_OFFER'].includes(kind)) fail('footer', 'This format does not support a footer')
      if (/[{}\n\r\t*~`_]/.test(footer)) fail('footer', 'Footers are plain text without variables, line breaks or Markdown')
      components.push({ type: 'FOOTER', text: footer })
    }
    if (kind === 'CAROUSEL' || kind === 'PRODUCT_CAROUSEL') {
      const cards = input.carousel?.cards
      if (!Array.isArray(cards) || cards.length < 2 || cards.length > 10) fail('carousel.cards', 'Add between 2 and 10 cards')
      if (kind === 'PRODUCT_CAROUSEL' && cards.length !== 2) fail('carousel.cards', 'Define exactly two product cards; select up to ten products when sending')
      if (input.buttons?.length) fail('buttons', 'Put carousel buttons on each card')
      let shape = ''
      components.push({ type: 'CAROUSEL', cards: cards.map((card, i) => {
        const path = `carousel.cards.${i}`
        if (!card || !(kind === 'PRODUCT_CAROUSEL' ? ['PRODUCT'] : ['IMAGE', 'VIDEO']).includes(card.headerType)) fail(path, 'Choose an image or video header')
        const header = headerComponent({ type: card.headerType, example: card.headerExample }, format)!
        const buttons = buildButtons(card.buttons, `${path}.buttons`, kind !== 'PRODUCT_CAROUSEL')
        if (kind === 'PRODUCT_CAROUSEL' && (str(card.body) || buttons.length !== 1 || !['SPM', 'URL'].includes(buttons[0].type))) fail(path, 'Product cards use one View product or website button, with no custom body')
        const current = `${card.headerType}:${Boolean(str(card.body))}:${buttons.map(b => b.type).join(',')}`
        if (i && current !== shape) fail(path, 'All cards must have the same header type, body presence, and button layout')
        shape = current
        return { components: [header, ...(str(card.body) ? [bodyComponent(card.body, card.examples || [], format, `${path}.body`, 160)] : []), ...(buttons.length ? [{ type: 'BUTTONS', buttons }] : [])] }
      }) })
    } else {
      const fixed: Partial<Record<TemplateKind, ButtonDraft>> = { CATALOG: { type: 'CATALOG', text: 'View catalog' }, MPM: { type: 'MPM', text: 'View items' }, SPM: { type: 'SPM', text: 'View' } }
      if (fixed[kind] && input.buttons?.length && (input.buttons.length !== 1 || input.buttons[0].type !== kind)) fail('buttons', 'This format has a fixed product button')
      const buttons = buildButtons(fixed[kind] ? [fixed[kind]!] : input.buttons || [])
      if (kind === 'STANDARD' && buttons.some(b => ['CATALOG', 'MPM', 'SPM'].includes(b.type))) fail('kind', 'Choose the matching product or catalog format')
      if (category !== 'MARKETING' && buttons.some(b => b.type === 'COPY_CODE')) fail('buttons', 'Coupon codes require a marketing template')
      if (kind === 'LIMITED_TIME_OFFER') {
        if (!buttons.some(b => b.type === 'URL') || buttons.some(b => !['URL', 'COPY_CODE'].includes(b.type)) || buttons.filter(b => b.type === 'URL').length > 1) fail('buttons', 'Offers use one website button and an optional copy-code button')
        const coupon = buttons.find(b => b.type === 'COPY_CODE')
        if (coupon && coupon.example.length > 15) fail('buttons', 'Offer codes have a maximum of 15 characters')
        buttons.sort((a, b) => a.type === b.type ? 0 : a.type === 'COPY_CODE' ? -1 : 1)
      }
      if (buttons.length) components.push({ type: 'BUTTONS', buttons })
    }
  }
  return { name, language: input.language, category, parameter_format: category === 'AUTHENTICATION' ? 'POSITIONAL' : format, components }
}

export const MEDIA_RULES = {
  IMAGE: { accept: 'image/jpeg,image/png', maxBytes: 5 * 1024 * 1024, hint: 'JPEG or PNG, up to 5 MB' },
  VIDEO: { accept: 'video/mp4', maxBytes: 16 * 1024 * 1024, hint: 'MP4 with H.264 video and AAC audio, up to 16 MB' },
  DOCUMENT: { accept: 'application/pdf', maxBytes: 100 * 1024 * 1024, hint: 'PDF, up to 100 MB' },
} as const
export function mediaFileError(type: string, file: { type: string; size: number }) {
  const rule = MEDIA_RULES[type as keyof typeof MEDIA_RULES]
  if (!rule || !rule.accept.split(',').includes(file.type)) return 'Choose a file matching the selected header type'
  if (!file.size || file.size > rule.maxBytes) return rule.hint
  return ''
}
