import { prisma } from '../db.js'
import { decryptConnectionToken, encryptConnectionToken } from './connection-token.js'
import { appSecretProof, metaErrorMessage, required } from './meta.js'

const graphVersion = () => process.env.META_GRAPH_API_VERSION || 'v26.0'

async function graph(path: string, token: string, init: RequestInit = {}) {
  const separator = path.includes('?') ? '&' : '?'
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}${path}${separator}appsecret_proof=${appSecretProof(token)}`, {
    signal: AbortSignal.timeout(30000), ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  const body: any = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(metaErrorMessage(body.error))
  return body
}

async function businessToken(metaBusinessId: string) {
  const systemToken = required('META_SYSTEM_TOKEN').trim()
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${metaBusinessId}/system_user_access_tokens`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${systemToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ appsecret_proof: appSecretProof(systemToken), fetch_only: 'true' }),
  })
  const body: any = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) throw new Error(metaErrorMessage(body.error) || 'Meta did not return the customer business token')
  return String(body.access_token)
}

async function businessName(id: string, token: string) {
  return String((await graph(`/${id}?fields=name`, token)).name || '') || null
}

async function businessProfile(phoneNumberId: string, token: string) {
  const fields = 'about,address,description,email,profile_picture_url,websites,vertical'
  const body = await graph(`/${phoneNumberId}/whatsapp_business_profile?fields=${fields}`, token)
  const profile = Array.isArray(body.data) ? body.data[0] ?? {} : {}
  return {
    profileAbout: String(profile.about || '') || null, profileAddress: String(profile.address || '') || null,
    profileDescription: String(profile.description || '') || null, profileEmail: String(profile.email || '') || null,
    profilePictureUrl: String(profile.profile_picture_url || '') || null,
    profileWebsites: Array.isArray(profile.websites) ? profile.websites.map(String).filter(Boolean) : [],
    profileVertical: String(profile.vertical || '') || null,
  }
}

export async function captureHostedSignupEvent(value: any) {
  if (value?.event !== 'PARTNER_ADDED') return false
  const wabaId = String(value.waba_info?.waba_id || '')
  const metaBusinessId = String(value.waba_info?.owner_business_id || '')
  if (!/^\d+$/.test(wabaId)) throw new Error('Hosted Signup account_update is missing a valid WABA ID')
  if (!/^\d+$/.test(metaBusinessId)) throw new Error('Hosted Signup account_update is missing a valid business portfolio ID')

  let signup: Awaited<ReturnType<typeof prisma.hostedSignupRequest.findFirst>> = null
  try {
    signup = await prisma.hostedSignupRequest.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } })
    if (!signup) throw new Error('PARTNER_ADDED has no pending Hosted Signup request with a saved registration PIN')
    const pin = decryptConnectionToken(signup.pinCiphertext)
    const token = await businessToken(metaBusinessId)
    const waba = await graph(`/${wabaId}?fields=id,name`, token)
    const metaBusinessName = await businessName(metaBusinessId, token)
    const phones = await graph(`/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`, token)
    if (!Array.isArray(phones.data) || !phones.data.length) throw new Error(`Hosted Signup WABA ${wabaId} has no phone numbers yet`)
    await graph(`/${wabaId}/subscribed_apps`, token, { method: 'POST', body: JSON.stringify({}) })

    let captured = 0
    for (const phone of phones.data) {
      const phoneNumberId = String(phone.id || '')
      if (!/^\d+$/.test(phoneNumberId)) continue
      const displayPhoneNumber = String(phone.display_phone_number || '') || null
      const verifiedName = String(phone.verified_name || '') || null
      const profile = await businessProfile(phoneNumberId, token)
      const pending = await prisma.whatsAppConnection.upsert({
      where: { phoneNumberId },
      create: {
        label: signup.label,
        metaBusinessId, metaBusinessName, wabaId, wabaName: String(waba.name || '') || null,
        phoneNumberId, displayPhoneNumber, verifiedName, ...profile,
        tokenCiphertext: encryptConnectionToken(token), status: 'PENDING',
      },
      update: {
        metaBusinessId, metaBusinessName, wabaId, wabaName: String(waba.name || '') || null,
        displayPhoneNumber, verifiedName, ...profile, tokenCiphertext: encryptConnectionToken(token),
        errorMessage: null,
      },
      })
      try {
        if (pending.status === 'ACTIVE') { captured++; continue }
        await graph(`/${phoneNumberId}/register`, token, {
          method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
        })
        await prisma.whatsAppConnection.update({ where: { id: pending.id }, data: { status: 'ACTIVE', connectedAt: new Date() } })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Phone registration failed'
        await prisma.whatsAppConnection.update({ where: { id: pending.id }, data: { status: 'ERROR', errorMessage: message } }).catch(() => {})
        throw error
      }
      captured++
    }
    if (!captured) throw new Error(`Hosted Signup WABA ${wabaId} returned no valid phone-number IDs`)
    await prisma.hostedSignupRequest.update({ where: { id: signup.id }, data: { status: 'COMPLETED', wabaId, metaBusinessId, completedAt: new Date(), pinCiphertext: '' } })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Hosted Signup processing failed'
    // Preserve the encrypted PIN so a retried Meta webhook can recover from a transient API failure.
    if (signup) await prisma.hostedSignupRequest.update({ where: { id: signup.id }, data: { wabaId, metaBusinessId, errorMessage: message.slice(0, 1000) } }).catch(() => {})
    throw error
  }
}
