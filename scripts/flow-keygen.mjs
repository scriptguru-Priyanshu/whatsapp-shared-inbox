import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const folder = resolve('.secrets')
const privatePath = resolve(folder, 'whatsapp-flow-private.pem')
const publicPath = resolve(folder, 'whatsapp-flow-public.pem')
if (existsSync(privatePath) || existsSync(publicPath)) throw new Error('Flow keys already exist. Keep them; key rotation requires a separate planned change.')
mkdirSync(folder, { recursive: true, mode: 0o700 })
const passphrase = process.env.WHATSAPP_FLOW_KEY_PASSPHRASE
const pair = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem', ...(passphrase ? { cipher: 'aes-256-cbc', passphrase } : {}) } })
writeFileSync(privatePath, pair.privateKey, { mode: 0o600, flag: 'wx' })
writeFileSync(publicPath, pair.publicKey, { mode: 0o644, flag: 'wx' })
console.log('Keys created in .secrets. Set WHATSAPP_FLOW_PRIVATE_KEY_FILE=.secrets/whatsapp-flow-private.pem, restart the backend, then register the public key in WhatsApp Flows setup.')
