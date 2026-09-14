import { useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Link2, LoaderCircle, Smartphone, X } from 'lucide-react'
import { api, type WhatsAppConnection } from './api'

type FacebookLoginResponse = { authResponse?: { code?: string }; status?: string }
type FacebookSdk = {
  init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void
  login: (callback: (response: FacebookLoginResponse) => void, options: Record<string, unknown>) => void
}

declare global { interface Window { FB?: FacebookSdk } }

let facebookSdkPromise: Promise<FacebookSdk> | undefined

function loadFacebookSdk(appId: string, version: string) {
  if (window.FB) {
    window.FB.init({ appId, cookie: true, xfbml: false, version })
    return Promise.resolve(window.FB)
  }
  if (!facebookSdkPromise) facebookSdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('facebook-jssdk') as HTMLScriptElement | null
    const script = existing || document.createElement('script')
    script.id = 'facebook-jssdk'
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (!window.FB) return reject(new Error('Meta SDK loaded without exposing FB'))
      window.FB.init({ appId, cookie: true, xfbml: false, version })
      resolve(window.FB)
    }
    script.onerror = () => reject(new Error('Unable to load the Meta JavaScript SDK'))
    if (!existing) document.body.appendChild(script)
  })
  return facebookSdkPromise
}

export function EmbeddedSignup() {
  const [connections, setConnections] = useState<WhatsAppConnection[]>([])
  const [hostedUrl, setHostedUrl] = useState('')
  const [sdkConfig, setSdkConfig] = useState<{ appId: string; configId: string; graphApiVersion: string } | null>(null)
  const [error, setError] = useState('')
  const [showSetup, setShowSetup] = useState(false)
  const [label, setLabel] = useState('')
  const [pin, setPin] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void Promise.all([api.whatsappConnections(), api.embeddedSignupConfig()])
      .then(([items, config]) => {
        setConnections(items); setHostedUrl(config.hostedUrl)
        setSdkConfig({ appId: config.appId, configId: config.configId, graphApiVersion: config.graphApiVersion })
        void loadFacebookSdk(config.appId, config.graphApiVersion).catch(() => undefined)
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load WhatsApp onboarding'))
  }, [])

  const startSignup = async () => {
    if (!label.trim()) { setError('Enter a label for this business.'); return }
    if (!/^\d{6}$/.test(pin)) { setError('Enter a six-digit Cloud API registration PIN.'); return }
    setStarting(true); setError('')
    try {
      const config = await api.prepareEmbeddedSignup({ label: label.trim(), pin })
      setShowSetup(false); setPin('')
      window.location.assign(config.hostedUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start WhatsApp onboarding')
    } finally { setStarting(false) }
  }

  const startCoexistenceTest = async () => {
    if (!sdkConfig) return
    setStarting(true); setError('')
    try {
      const fb = await loadFacebookSdk(sdkConfig.appId, sdkConfig.graphApiVersion)
      fb.login(response => {
        setStarting(false)
        if (!response.authResponse) setError('Meta signup was cancelled or did not authorize the app.')
      }, {
        config_id: sdkConfig.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          version: 'v4',
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
          coex: true,
        },
      })
    } catch (cause) {
      setStarting(false)
      setError(cause instanceof Error ? cause.message : 'Unable to launch the Meta SDK')
    }
  }

  return <div className="templates max-w-5xl">
    <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-8">
        <div><h2 className="m-0 font-display text-lg font-bold">Connect a WhatsApp business</h2><p className="mb-0 mt-2 max-w-2xl text-xs leading-5 text-slate-500">Continue to Meta's hosted onboarding page. The clinic signs in with Meta and keeps ownership of its business account and phone number.</p></div>
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-relay-100 text-relay-600"><Link2 /></span>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button className={`new-template inline-flex h-[42px] items-center gap-2 ${!hostedUrl ? 'opacity-50' : ''}`} disabled={!hostedUrl} onClick={() => { setError(''); setShowSetup(true) }}>
          <ExternalLink className="size-4" /> Continue with Meta
        </button>
        <button className={`inline-flex h-[42px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 ${!sdkConfig || starting ? 'opacity-50' : ''}`} disabled={!sdkConfig || starting} onClick={() => void startCoexistenceTest()}>
          {starting ? <LoaderCircle className="size-4 animate-spin" /> : <Smartphone className="size-4" />} Test Coexistence with SDK
        </button>
      </div>
      <p className="mb-0 mt-3 text-[10px] text-slate-400">The first button keeps the hosted signup flow. The SDK test button requests WhatsApp Business App Coexistence only to verify that Meta exposes the existing-number flow; it does not create Relay's pending registration record.</p>
      {error && <p className="mb-0 mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    </div>
    <div className="template-card">
      <div className="flex items-center justify-between bg-slate-50 px-5 py-4"><b className="text-xs">Connected accounts</b><span className="text-[10px] text-slate-500">{connections.length} total</span></div>
      {connections.map(item => <div className="grid grid-cols-[42px_1.4fr_1fr_1fr] items-center gap-3 border-t border-slate-100 px-5 py-4 text-xs" key={item.id}>
        <span className="grid size-9 place-items-center overflow-hidden rounded-lg bg-green-50 text-green-600">{item.profilePictureUrl ? <img className="size-full object-cover" src={item.profilePictureUrl} alt="" /> : <Smartphone className="size-4" />}</span>
        <span><b className="block">{item.metaBusinessName || item.verifiedName || item.label}</b><small className="block text-slate-400">{item.displayPhoneNumber || item.label}</small>{item.profileEmail && <small className="block text-slate-400">{item.profileEmail}</small>}</span>
        <span><small className="block text-slate-400">{item.wabaName || 'WABA'} · {item.metaBusinessId || 'Business pending'}</small>{item.wabaId}</span>
        <span className={item.status === 'ACTIVE' ? 'text-green-700' : item.status === 'ERROR' ? 'text-red-600' : 'text-amber-600'}>{item.status === 'ACTIVE' && <CheckCircle2 className="mr-1 inline size-4" />}{item.status}{item.errorMessage && <small className="mt-1 block text-red-500">{item.errorMessage}</small>}</span>
      </div>)}
      {!connections.length && <div className="p-10 text-center text-xs text-slate-400">No businesses have completed Hosted Embedded Signup yet.</div>}
    </div>
    {showSetup && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><h3 className="m-0 text-lg font-bold">Prepare WhatsApp connection</h3><p className="mt-2 text-xs leading-5 text-slate-500">This six-digit PIN will be used by Relay to register your phone number with WhatsApp Cloud API after Meta completes Hosted Embedded Signup.</p></div><button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" onClick={() => setShowSetup(false)} aria-label="Close"><X className="size-5" /></button></div>
        <label className="mt-5 block text-xs font-semibold">Business label<input className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" value={label} maxLength={100} onChange={event => setLabel(event.target.value)} placeholder="Clinic A" autoFocus /></label>
        <label className="mt-4 block text-xs font-semibold">Cloud API registration PIN<input className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal tracking-[0.25em]" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" type="password" autoComplete="new-password" placeholder="••••••" /></label>
        <p className="mt-2 text-[10px] leading-4 text-slate-400">The PIN is encrypted while pending, is never sent to the browser again, and is erased after successful phone registration.</p>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
        <button className="new-template mt-5 inline-flex h-[42px] w-full items-center justify-center gap-2" disabled={starting} onClick={() => void startSignup()}>{starting ? <><LoaderCircle className="size-4 animate-spin" /> Saving…</> : <><ExternalLink className="size-4" /> Save and continue to Meta</>}</button>
      </div>
    </div>}
  </div>
}
