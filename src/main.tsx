import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import posthog from 'posthog-js'
import './index.css'
import App from '@/App.tsx'
import { applyUiV2 } from '@/lib/ui-v2'

// Before the first render, so the new look applies from the first paint
applyUiV2()

if (import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST ?? 'https://app.posthog.com',
    person_profiles: 'identified_only',
    defaults: '2026-05-30',
    capture_pageview: true,
    capture_pageleave: true,
  })
}

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
})

// A data router, so a page can hold back a navigation (useBlocker): the
// invoice editor asks before unsaved changes are left (PRO-184). The app's
// own <Routes> sit under one catch-all route.
const router = createBrowserRouter([{ path: '*', element: <App /> }])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
