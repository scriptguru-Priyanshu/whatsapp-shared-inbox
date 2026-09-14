import { constants, createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, privateDecrypt } from 'node:crypto'
import { readFileSync } from 'node:fs'

export function flowPrivateKey() {
  const pem = process.env.WHATSAPP_FLOW_PRIVATE_KEY || (process.env.WHATSAPP_FLOW_PRIVATE_KEY_FILE ? readFileSync(process.env.WHATSAPP_FLOW_PRIVATE_KEY_FILE, 'utf8') : '')
  if (!pem) throw new Error('Configure the WhatsApp Flow private key')
  const key = createPrivateKey({ key: pem.replace(/\\n/g, '\n'), passphrase: process.env.WHATSAPP_FLOW_KEY_PASSPHRASE })
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('Flows require an RSA key of at least 2048 bits')
  return key
}
export function flowPublicKey() { return createPublicKey(flowPrivateKey()).export({ type: 'spki', format: 'pem' }).toString() }
export function decryptFlow(body: any, privateKey = flowPrivateKey()) {
  for (const field of ['encrypted_aes_key', 'encrypted_flow_data', 'initial_vector']) if (typeof body?.[field] !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body[field])) throw new Error('Invalid encrypted request')
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(body.encrypted_aes_key, 'base64'))
  const iv = Buffer.from(body.initial_vector, 'base64'), encrypted = Buffer.from(body.encrypted_flow_data, 'base64')
  if (key.length !== 16 || iv.length !== 16 || encrypted.length <= 16) throw new Error('Invalid encrypted request')
  const decipher = createDecipheriv('aes-128-gcm', key, iv)
  decipher.setAuthTag(encrypted.subarray(-16))
  const data = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'))
  return { data, key, iv }
}
export function encryptFlow(data: unknown, key: Buffer, iv: Buffer) {
  const cipher = createCipheriv('aes-128-gcm', key, Buffer.from(iv.map(byte => byte ^ 0xff)))
  return Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64')
}
