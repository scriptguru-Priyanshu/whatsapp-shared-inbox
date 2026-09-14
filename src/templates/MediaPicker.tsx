import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { MEDIA_RULES, mediaFileError } from '../../shared/templates'

export function MediaPicker({ type, value, onChange, onBusy, onPreview, delivery = false }: { type: keyof typeof MEDIA_RULES; value?: string; onChange: (value: string) => void; onBusy: (busy: boolean) => void; onPreview?: (url: string) => void; delivery?: boolean }) {
  const [preview, setPreview] = useState(''), [filename, setFilename] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const generation = useRef(0), input = useRef<HTMLInputElement>(null)
  useEffect(() => { generation.current++; setPreview(''); setFilename(''); setError(''); return () => { generation.current++ } }, [type])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const upload = async (file: File) => {
    const invalid = mediaFileError(type, file)
    if (invalid) { onChange(''); onPreview?.(''); setPreview(''); setFilename(''); setError(invalid); if (input.current) input.current.value = ''; return }
    const request = ++generation.current
    setBusy(true); onBusy(true); setError('')
    // Clear the previous handle before replacement so a failed upload cannot submit stale media.
    onChange(''); onPreview?.(''); setPreview(''); setFilename('')
    try {
      const value = delivery ? (await api.uploadSendMedia(file)).mediaId : (await api.uploadTemplateExampleMedia(file)).handle
      if (request !== generation.current) return
      const url = URL.createObjectURL(file)
      onChange(value); setFilename(file.name); setPreview(url); onPreview?.(url)
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : 'Upload failed') }
    finally { if (request === generation.current) { setBusy(false); onBusy(false); if (input.current) input.current.value = '' } }
  }
  return <div className="template-media">
    <label>{delivery ? 'Delivery media' : 'Sample for Meta review'}<input ref={input} type="file" accept={MEDIA_RULES[type].accept} disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file) }} /></label>
    <small>{MEDIA_RULES[type].hint}. {delivery ? 'This file will be sent to the recipient.' : 'This sample is reviewed by Meta. Choose delivery media when sending.'}</small>
    <p aria-live="polite">{busy ? 'Uploading…' : filename || (value ? 'Previously uploaded sample' : 'No file uploaded')}</p>
    {preview && (type === 'IMAGE' ? <img src={preview} alt="Header sample" /> : type === 'VIDEO' ? <video src={preview} controls /> : <a href={preview} target="_blank" rel="noreferrer">Preview PDF</a>)}
    {error && <p role="alert" className="template-error">{error}</p>}
  </div>
}
