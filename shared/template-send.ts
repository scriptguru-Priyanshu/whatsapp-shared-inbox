import { type Component, variableKeys, TemplateValidationError } from './templates.js'

export type HeaderMediaInput =
  | { kind: 'id' | 'link'; value: string }
  | { kind: 'location'; latitude: number; longitude: number; name: string; address: string }
  | { kind: 'product'; catalogId: string; productRetailerId: string }
export type SendOptions = {
  headerMedia?: HeaderMediaInput; headerText?: string;
  buttons?: Record<string, { couponCode?: string; flowToken?: string; flowData?: Record<string, unknown>; thumbnailProductRetailerId?: string; sections?: Array<{ title: string; productIds: string[] }> }>;
  expirationTimeMs?: number;
  cards?: Array<{ parameters: string[]; headerMedia?: HeaderMediaInput; headerText?: string }>;
}
const upper = (v: unknown) => String(v || '').toUpperCase()
const required = (value: unknown, field: string, max = 1024) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TemplateValidationError(field, `Provide ${field} (${max} characters maximum)`)
  return value.trim()
}
export function templateSendFields(components: Component[], authentication = false) {
  if (authentication) return [{ key: 'otp', label: 'Verification code' }]
  const body = components.find(c => upper(c.type) === 'BODY')
  const fields = variableKeys(body?.text).map(key => ({ key, label: `Body: ${key}` }))
  const buttons = components.find(c => upper(c.type) === 'BUTTONS')?.buttons || []
  buttons.forEach((button: Component, i: number) => { if (upper(button.type) === 'URL' && String(button.url).includes('{{1}}')) fields.push({ key: `url_${i}`, label: `Website value: ${button.text}` }) })
  return fields
}
export function supportsAutomaticTemplate(template: { components: Component[]; category: string }) {
  return template.category === 'AUTHENTICATION' || !template.components.some(c => {
    const type = upper(c.type)
    if (type === 'CAROUSEL' || type === 'LIMITED_TIME_OFFER') return true
    if (type === 'HEADER') return upper(c.format) !== 'TEXT' || variableKeys(c.text).length > 0
    return type === 'BUTTONS' && (c.buttons || []).some((b: Component) => !['URL', 'PHONE_NUMBER', 'QUICK_REPLY'].includes(upper(b.type)))
  })
}
function mediaParameter(header: Component, media?: HeaderMediaInput): Component {
  const format = upper(header.format)
  if (format === 'LOCATION') {
    if (media?.kind !== 'location' || !Number.isFinite(media.latitude) || !Number.isFinite(media.longitude) || Math.abs(media.latitude) > 90 || Math.abs(media.longitude) > 180) throw new TemplateValidationError('header', 'Provide valid location coordinates')
    return { type: 'location', location: { latitude: media.latitude, longitude: media.longitude, name: required(media.name, 'location name'), address: required(media.address, 'location address') } }
  }
  if (format === 'PRODUCT') {
    if (media?.kind !== 'product') throw new TemplateValidationError('header', 'Choose a catalog product')
    return { type: 'product', product: { catalog_id: required(media.catalogId, 'catalog ID'), product_retailer_id: required(media.productRetailerId, 'product retailer ID') } }
  }
  if (!['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) throw new TemplateValidationError('header', 'This header is not supported by Cloud API')
  if (!media || !['id', 'link'].includes(media.kind) || !('value' in media)) throw new TemplateValidationError('header', 'Upload delivery media or enter its public HTTPS URL')
  const value = required(media.value, 'header media', 2000)
  if (media.kind === 'id' && !/^\d+$/.test(value)) throw new TemplateValidationError('header', 'Use a WhatsApp media ID, not a template review handle')
  if (media.kind === 'link') {
    try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error() }
    catch { throw new TemplateValidationError('header', 'Use a public HTTPS media URL without credentials') }
  }
  return { type: format.toLowerCase(), [format.toLowerCase()]: { [media.kind]: value } }
}
function textParameter(key: string, value: string) { return { type: 'text', text: value, ...(/^\d+$/.test(key) ? {} : { parameter_name: key }) } }

export function buildSendComponents(components: Component[], parameters: string[], options: SendOptions = {}, authentication = false): Component[] {
  const fields = templateSendFields(components, authentication)
  if (!Array.isArray(parameters) || parameters.length !== fields.length) throw new TemplateValidationError('parameters', `Provide exactly ${fields.length} parameter values`)
  parameters = parameters.map((v, i) => required(v, fields[i].label, authentication ? 15 : 1024))
  if (authentication) return [{ type: 'body', parameters: [{ type: 'text', text: parameters[0] }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: parameters[0] }] }]
  const result: Component[] = []
  const header = components.find(c => upper(c.type) === 'HEADER')
  if (header) {
    if (upper(header.format) === 'TEXT') {
      const keys = variableKeys(header.text)
      if (keys.length) {
        const value = required(options.headerText, 'header text', 60)
        if (header.text.replace(`{{${keys[0]}}}`, value).length > 60) throw new TemplateValidationError('header', 'The rendered header exceeds 60 characters')
        result.push({ type: 'header', parameters: [textParameter(keys[0], value)] })
      }
    } else result.push({ type: 'header', parameters: [mediaParameter(header, options.headerMedia)] })
  }
  const body = components.find(c => upper(c.type) === 'BODY'), keys = variableKeys(body?.text)
  if (keys.length) result.push({ type: 'body', parameters: keys.map((k, i) => textParameter(k, parameters[i])) })
  const buttons = components.find(c => upper(c.type) === 'BUTTONS')?.buttons || []
  let urlIndex = keys.length
  buttons.forEach((button: Component, i: number) => {
    const type = upper(button.type), input = options.buttons?.[i] || {}
    let params: Component[] | undefined
    if (type === 'URL' && String(button.url).includes('{{1}}')) {
      const value = parameters[urlIndex++]
      if (button.url.replace('{{1}}', value).length > 2000) throw new TemplateValidationError('buttons', 'The rendered website URL exceeds 2000 characters')
      params = [{ type: 'text', text: value }]
    }
    if (type === 'COPY_CODE') params = [{ type: 'coupon_code', coupon_code: required(input.couponCode, 'coupon code', components.some(c => upper(c.type) === 'LIMITED_TIME_OFFER') ? 15 : 20) }]
    if (type === 'FLOW') params = [{ type: 'action', action: { flow_token: required(input.flowToken, 'Flow token'), ...(input.flowData ? { flow_action_data: input.flowData } : {}) } }]
    if (type === 'CATALOG' && input.thumbnailProductRetailerId) params = [{ type: 'action', action: { thumbnail_product_retailer_id: required(input.thumbnailProductRetailerId, 'thumbnail product') } }]
    if (type === 'MPM') {
      if (!Array.isArray(input.sections) || !input.sections.length || input.sections.length > 10 || input.sections.reduce((n, s) => n + (s.productIds?.length || 0), 0) > 30) throw new TemplateValidationError('buttons', 'Use 1–10 catalog sections with at most 30 products in total')
      const sections = input.sections.map(section => {
        if (!Array.isArray(section.productIds) || !section.productIds.length) throw new TemplateValidationError('buttons', 'Add products to every section')
        return { title: required(section.title, 'section title', 24), product_items: section.productIds.map(id => ({ product_retailer_id: required(id, 'product retailer ID') })) }
      })
      params = [{ type: 'action', action: { thumbnail_product_retailer_id: required(input.thumbnailProductRetailerId, 'thumbnail product retailer ID'), sections } }]
    }
    if (!['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE', 'FLOW', 'CATALOG', 'MPM', 'SPM'].includes(type)) throw new TemplateValidationError('buttons', `Unsupported delivery button: ${type}`)
    if (params) result.push({ type: 'button', sub_type: type.toLowerCase(), index: String(i), parameters: params })
  })
  const offer = components.find(c => upper(c.type) === 'LIMITED_TIME_OFFER')
  if (offer?.limited_time_offer?.has_expiration) {
    if (!Number.isSafeInteger(options.expirationTimeMs) || options.expirationTimeMs! <= Date.now()) throw new TemplateValidationError('expiration', 'Choose a future offer expiration')
    result.push({ type: 'limited_time_offer', parameters: [{ type: 'limited_time_offer', limited_time_offer: { expiration_time_ms: options.expirationTimeMs } }] })
  }
  const carousel = components.find(c => upper(c.type) === 'CAROUSEL')
  if (carousel) {
    const product = upper(carousel.cards[0]?.components?.find((c: Component) => upper(c.type) === 'HEADER')?.format) === 'PRODUCT'
    if (!Array.isArray(options.cards) || (product ? options.cards.length < 2 || options.cards.length > 10 : options.cards.length !== carousel.cards.length)) throw new TemplateValidationError('cards', 'Provide media and values for every approved carousel card')
    result.push({ type: 'carousel', cards: options.cards!.map((card, i) => ({ card_index: i, components: buildSendComponents(carousel.cards[product ? i % carousel.cards.length : i].components, card.parameters, card) })) })
  }
  return result
}
