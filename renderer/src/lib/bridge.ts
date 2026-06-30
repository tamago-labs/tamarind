export interface Pkg {
  name: string
  productName: string
  version: string
  [key: string]: unknown
}

export interface BridgeAPI {
  pkg(): Pkg
  applyUpdate(): Promise<void>
  appAfterUpdate(): Promise<void>
  startWorker(specifier: string): Promise<boolean>
  onWorkerStdout(specifier: string, listener: (data: Uint8Array) => void): () => void
  onWorkerStderr(specifier: string, listener: (data: Uint8Array) => void): () => void
  onWorkerIPC(specifier: string, listener: (data: Uint8Array) => void): () => void
  onWorkerExit(specifier: string, listener: (code: number | null) => void): () => void
  writeWorkerIPC(specifier: string, data: string | Uint8Array): Promise<void>
}

export const bridge: BridgeAPI = window.bridge

declare global {
  interface Window {
    bridge: BridgeAPI
  }
}
