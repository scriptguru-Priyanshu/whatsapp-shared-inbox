import { type Component, type TemplateDraft, type ButtonDraft, inferParameterFormat, variableKeys } from '../../shared/templates.js'
import type { ApiTemplate } from '../api.js'

export const emptyDraft = (): TemplateDraft => ({ name: '', language: 'en_US', category: 'UTILITY', kind: 'STANDARD', parameterFormat: 'NAMED', header: { type: 'NONE', text: '', example: '' }, body: '', examples: [], parameterLabels: [], footer: '', buttons: [] })
export function component(components: Component[], type: string) { return components.find(c => String(c.type).toUpperCase() === type) }
export function examplesFor(c?: Component): string[] {
  if (!c) return []
  const keys = variableKeys(c.text)
  const named = c.example?.body_text_named_params || c.example?.header_text_named_params
  if (named) return keys.map(k => named.find((v: Component) => v.param_name === k)?.example || '')
  const positional = c.example?.body_text?.[0] || c.example?.header_text || []
  return keys.map((_, i) => typeof positional[i] === 'string' ? positional[i] : '')
}
export function buttonsFor(c?: Component): ButtonDraft[] {
  return (c?.buttons || []).map((b: Component) => {
    const prefix = String(b.url || '').replace('{{1}}', '')
    const example = Array.isArray(b.example) ? String(b.example[0] || '') : String(b.example || '')
    return { type: String(b.type).toUpperCase(), text: b.text || '', value: b.url || b.phone_number || '', example: b.url && example.startsWith(prefix) ? example.slice(prefix.length) : example, flowId: b.flow_id || undefined, flowName: b.flow_name || undefined, flowJson: b.flow_json || undefined, flowAction: b.flow_action || 'navigate', navigateScreen: b.navigate_screen || '' }
  })
}
export function draftFromTemplate(template: ApiTemplate): TemplateDraft {
  const cs = template.components, header = component(cs, 'HEADER'), body = component(cs, 'BODY'), footer = component(cs, 'FOOTER'), carousel = component(cs, 'CAROUSEL'), offer = component(cs, 'LIMITED_TIME_OFFER')
  const buttons = buttonsFor(component(cs, 'BUTTONS'))
  const productKind = buttons.find(b => ['CATALOG', 'MPM', 'SPM'].includes(b.type))?.type
  const draft: TemplateDraft = { ...emptyDraft(), name: template.name, language: template.language, category: template.category, parameterFormat: inferParameterFormat(cs), kind: carousel ? (component(carousel.cards[0]?.components || [], 'HEADER')?.format?.toUpperCase() === 'PRODUCT' ? 'PRODUCT_CAROUSEL' : 'CAROUSEL') : offer ? 'LIMITED_TIME_OFFER' : productKind as TemplateDraft['kind'] || 'STANDARD', header: header ? { type: String(header.format).toUpperCase() as any, text: header.text || '', example: header.example?.header_handle?.[0] || examplesFor(header)[0] || '' } : { type: 'NONE' }, body: body?.text || '', examples: examplesFor(body), parameterLabels: variableKeys(body?.text).map((k, i) => template.parameterLabels?.[i] || (/^\d+$/.test(k) ? `Field ${k}` : k.replaceAll('_', ' '))), footer: footer?.text || '', buttons }
  if (carousel) draft.carousel = { cards: carousel.cards.map((card: Component) => { const h = component(card.components, 'HEADER'), b = component(card.components, 'BODY'); return { headerType: h?.format.toUpperCase(), headerExample: h?.example?.header_handle?.[0] || '', body: b?.text || '', examples: examplesFor(b), buttons: buttonsFor(component(card.components, 'BUTTONS')) } }) }
  if (offer) draft.limitedTimeOffer = { text: offer.limited_time_offer.text, hasExpiration: offer.limited_time_offer.has_expiration === true }
  if (template.category === 'AUTHENTICATION') {
    const otp = component(cs, 'BUTTONS')?.buttons?.[0] || {}, app = otp.supported_apps?.[0] || otp
    draft.buttons = []
    draft.authentication = { otpType: otp.otp_type || 'COPY_CODE', codeExpirationMinutes: footer?.code_expiration_minutes, addSecurityRecommendation: body?.add_security_recommendation === true, packageName: app.package_name || '', signatureHash: app.signature_hash || '', zeroTapTermsAccepted: otp.zero_tap_terms_accepted === true, buttonText: otp.text || 'Copy code', autofillText: otp.autofill_text || 'Autofill' }
  }
  return draft
}
export function unsupportedTemplateReason(template?: ApiTemplate) {
  if (!template) return ''
  const otp = component(template.components, 'BUTTONS')?.buttons?.find((b: Component) => String(b.type).toUpperCase() === 'OTP')
  if (otp?.supported_apps?.length > 1) return 'This authentication template supports multiple Android apps. Manage it in WhatsApp Manager to preserve all app configurations.'
  const visit = (cs: Component[]): boolean => cs.some(c => {
    const type = String(c.type).toUpperCase()
    if (!['HEADER', 'BODY', 'FOOTER', 'BUTTONS', 'CAROUSEL', 'LIMITED_TIME_OFFER'].includes(type)) return true
    if (type === 'HEADER' && !['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION', 'PRODUCT'].includes(String(c.format).toUpperCase())) return true
    if (type === 'BUTTONS' && (c.buttons || []).some((b: Component) => !['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE', 'FLOW', 'CATALOG', 'MPM', 'SPM', 'OTP'].includes(String(b.type).toUpperCase()))) return true
    return type === 'CAROUSEL' && (c.cards || []).some((card: Component) => visit(card.components))
  })
  return visit(template.components) ? 'This template uses a specialized Meta component that this Cloud API editor cannot safely edit. Open it in WhatsApp Manager.' : ''
}
