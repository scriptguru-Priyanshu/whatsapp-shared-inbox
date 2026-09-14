import multer from 'multer'
import { tmpdir } from 'node:os'
import { open, unlink } from 'node:fs/promises'
import { createReadStream, openAsBlob } from 'node:fs'
import type { RequestHandler } from 'express'
import { mediaFileError } from '../../shared/templates.js'
import { metaErrorMessage, required } from './meta.js'

const upload = multer({ dest: tmpdir(), limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 1, fieldSize: 128 }, fileFilter: (_req, file, callback) => {
  if (!['image/jpeg', 'image/png', 'video/mp4', 'application/pdf'].includes(file.mimetype)) return callback(new Error('Unsupported file type'))
  callback(null, true)
} }).single('file')
let activeUploads = 0
// Disk-backed uploads avoid holding a 100 MB PDF per request in server memory.
export const receiveTemplateMedia: RequestHandler = (req, res, next) => {
  if (activeUploads >= 4) { res.setHeader('Retry-After', '10'); res.status(429).json({ error: 'Media uploads are busy. Please retry in a few seconds.' }); return }
  activeUploads++
  let released = false
  const release = () => { if (!released) { activeUploads--; released = true } }
  res.once('finish', release)
  res.once('close', release)
  upload(req, res, error => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The maximum upload size is 100 MB' : 'Upload one file in the file field' })
    next()
  })
}
export async function validateUploadedMedia(file: Express.Multer.File) {
  const type = ({ 'image/jpeg': 'IMAGE', 'image/png': 'IMAGE', 'video/mp4': 'VIDEO', 'application/pdf': 'DOCUMENT' } as Record<string, string>)[file.mimetype]
  const error = mediaFileError(type, { type: file.mimetype, size: file.size })
  if (error) throw new Error(error)
  const handle = await open(file.path, 'r')
  const bytes = Buffer.alloc(16)
  try { await handle.read(bytes, 0, 16, 0) } finally { await handle.close() }
  const matches = file.mimetype === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    : file.mimetype === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : file.mimetype === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
        : bytes.subarray(4, 8).toString() === 'ftyp'
  if (!matches) throw new Error('The file contents do not match its file type')
  return type
}
async function result(response: Response, key: string) {
  const json: any = await response.json().catch(() => null)
  if (!response.ok) throw new Error(metaErrorMessage(json?.error))
  if (typeof json?.[key] !== 'string' || !json[key]) throw new Error('Meta returned an incomplete upload response. Please upload again.')
  return json[key] as string
}
export async function uploadReviewSample(file: Express.Multer.File, fetcher: typeof fetch = fetch) {
  const base = `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v26.0'}`
  const token = required('META_SYSTEM_TOKEN')
  const query = new URLSearchParams({ file_length: String(file.size), file_type: file.mimetype, file_name: file.originalname })
  const id = await result(await fetcher(`${base}/${required('META_APP_ID')}/uploads?${query}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }), 'id')
  if (!id.startsWith('upload:')) throw new Error('Meta returned an invalid upload session')
  const stream = createReadStream(file.path)
  try {
    return await result(await fetcher(`${base}/${id}`, { method: 'POST', headers: { Authorization: `OAuth ${token}`, 'Content-Type': file.mimetype, file_offset: '0' }, body: stream as unknown as BodyInit, duplex: 'half', signal: AbortSignal.timeout(120000) } as RequestInit), 'h')
  } finally { stream.destroy() }
}
export async function uploadMessageMedia(file: Express.Multer.File) {
  const form = new FormData()
  form.set('messaging_product', 'whatsapp')
  form.set('type', file.mimetype)
  form.set('file', await openAsBlob(file.path, { type: file.mimetype }), file.originalname)
  return result(await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v26.0'}/${required('WHATSAPP_PHONE_NUMBER_ID')}/media`, { method: 'POST', headers: { Authorization: `Bearer ${required('META_SYSTEM_TOKEN')}` }, body: form, signal: AbortSignal.timeout(120000) }), 'id')
}
export const removeUpload = (file?: Express.Multer.File) => file ? unlink(file.path).catch(() => undefined) : Promise.resolve()
