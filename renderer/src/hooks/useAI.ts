// Module-scope singleton store for AI state. Mirrors the
// `useWorkerStatus.ts` pattern at [hooks/useWorkerStatus.ts] but
// pushes through `useSyncExternalStore` because AI state has more
// than just a status enum — progress / error / available list /
// active config all need to drive re-renders.
//
// Auto-bootstraps on first useAI() call: subscribes to bridge.models
// push channels and hydrates status / config from main. No
// <AIProvider/> wrapper needed because Tamarind's canvas is the only
// consumer and it should never be torn down.

import { useSyncExternalStore } from 'react'
import { bridge } from '../lib/bridge'
import {
  DEFAULT_AI_CONFIG,
  type AiConfig,
  type ModelEntry,
  type ModelErrorPayload,
  type ModelLoadProgress,
  type ModelStatus
} from '../ai/types'

interface AIState {
  status: ModelStatus | null
  progress: ModelLoadProgress | null
  error: ModelErrorPayload | null
  config: AiConfig
}

let snapshot: AIState = {
  status: null,
  progress: null,
  error: null,
  config: DEFAULT_AI_CONFIG
}

const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function set(p: Partial<AIState>): void {
  snapshot = { ...snapshot, ...p }
  emit()
}

let bootstrapped = false
let activeProgressTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Fire-and-forget hydration. Called once per process so the first
 * useAI() consumer gets the real status / config synchronously enough
 * to render the pill + modal. Subsequent calls (e.g. after a
 * `select()` finishes) re-fetch on demand.
 */
async function bootstrapOnce(): Promise<void> {
  if (bootstrapped) return
  bootstrapped = true

  // Probe status + config in parallel; don't block the UI on either.
  try {
    const s = await bridge.models.status()
    if (s.active.loaded) set({ progress: null })
    set({ status: s })
  } catch (err) {
    console.error('[useAI] initial status failed:', err)
  }
  try {
    const c = await bridge.ai.getConfig()
    set({ config: { ...c } })
  } catch (err) {
    console.error('[useAI] initial config failed:', err)
  }

  bridge.models.onProgress((p) => {
    set({ progress: p, error: null })
    // When load hits 100%, the modelId is set in main; refresh status
    // on the next tick so `isReady` flips to true.
    if (p.phase === 'loading' && p.percentage >= 100) {
      if (activeProgressTimer) clearTimeout(activeProgressTimer)
      activeProgressTimer = setTimeout(() => {
        void bridge.models
          .status()
          .then((s) => set({ status: s }))
          .catch((err) => console.error('[useAI] status refresh failed:', err))
      }, 100)
    }
  })
  bridge.models.onError((e) => {
    set({ error: e })
  })
}

export interface AIApi {
  status: ModelStatus | null
  progress: ModelLoadProgress | null
  error: ModelErrorPayload | null
  config: AiConfig
  isReady: boolean
  activeModel: ModelEntry | null
  refresh(): Promise<void>
  select(id: string): Promise<void>
  cancel(clearCache?: boolean): Promise<void>
  unload(): Promise<void>
  resetCache(id: string): Promise<{ success: boolean; deleted: string[]; error?: string }>
  setError(e: ModelErrorPayload | null): void
  setConfig(config: AiConfig): Promise<void>
}

/**
 * Renderer-side AI state + actions. Module-scope state is shared
 * across every component that calls this hook — there is no provider
 * to wrap in.
 */
export function useAI(): AIApi {
  const state = useSyncExternalStore(subscribe, () => snapshot)

  // Lazy bootstrap on first call. Safe under React StrictMode's
  // mount/unmount/mount because `bootstrapped` is module-scope.
  void bootstrapOnce()

  const refresh = async (): Promise<void> => {
    try {
      const s = await bridge.models.status()
      if (s.active.loaded) set({ progress: null })
      set({ status: s })
    } catch (err) {
      console.error('[useAI] refresh failed:', err)
    }
  }

  const select = async (id: string): Promise<void> => {
    set({ error: null, progress: { phase: 'loading', downloaded: 0, total: 0, percentage: 0 } })
    const r = await bridge.models.select(id)
    if (!r.success && r.error) {
      set({ error: { code: 'SELECT_FAILED', message: r.error, retryable: true }, progress: null })
    }
    await refresh()
  }

  const cancel = async (clearCache?: boolean): Promise<void> => {
    await bridge.models.cancel({ clearCache })
    await refresh()
  }

  const unload = async (): Promise<void> => {
    try {
      await bridge.ai.unload()
    } catch (err) {
      console.error('[useAI] unload failed:', err)
    }
    await refresh()
  }

  const resetCache = async (
    id: string
  ): Promise<{ success: boolean; deleted: string[]; error?: string }> => {
    const r = await bridge.models.resetCache(id)
    if (r.success) {
      set({ error: null, progress: null })
    }
    await refresh()
    return r
  }

  const setError = (e: ModelErrorPayload | null): void => {
    set({ error: e })
  }

  const setConfig = async (config: AiConfig): Promise<void> => {
    // Optimistic local update so the dropdown responds instantly;
    // persistence happens via the IPC (which validates ctx_size +
    // tools and writes <userData>/models.json).
    set({ config })
    try {
      await bridge.ai.setConfig(config)
    } catch (err) {
      console.error('[useAI] setConfig failed:', err)
      // Roll back on validation error: re-pull from main.
      try {
        const fresh = await bridge.ai.getConfig()
        set({ config: fresh })
      } catch {
        /* noop */
      }
    }
  }

  const activeModel: ModelEntry | null = state.status?.active.id
    ? (state.status.available.find((m) => m.id === state.status!.active.id) ?? null)
    : null

  return {
    status: state.status,
    progress: state.progress,
    error: state.error,
    config: state.config,
    isReady: !!state.status?.active.loaded,
    activeModel,
    refresh,
    select,
    cancel,
    unload,
    resetCache,
    setError,
    setConfig
  }
}
