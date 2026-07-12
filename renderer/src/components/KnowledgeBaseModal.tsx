import { useState, useEffect } from 'react'
import { FileText, Globe, Plus, Search, Trash2, X } from 'lucide-react'
import { BaseModal } from './BaseModal'
import { bridge } from '../lib/bridge'
import type { RagDocument, PreDataCategory } from '../lib/bridge'

interface KnowledgeBaseModalProps {
  open: boolean
  onClose: () => void
}

type ViewMode = 'browse' | 'add-text' | 'add-url' | 'add-url-preview' | 'search'

export function KnowledgeBaseModal({ open, onClose }: KnowledgeBaseModalProps) {
  const [documents, setDocuments] = useState<RagDocument[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('browse')
  const [modelStatus, setModelStatus] = useState<'unloaded' | 'loading' | 'ready'>('unloaded')
  const [preDataCategories, setPreDataCategories] = useState<PreDataCategory[]>([])
  const [isImportingPreData, setIsImportingPreData] = useState(false)

  // Add form state
  const [textContent, setTextContent] = useState('')
  const [docName, setDocName] = useState('')
  const [urlContent, setUrlContent] = useState('')
  const [isIngesting, setIsIngesting] = useState(false)
  const [ingestProgress, setIngestProgress] = useState('')

  // URL preview state
  const [urlPreview, setUrlPreview] = useState<{
    url: string
    content: string
    charCount: number
  } | null>(null)
  const [fetchError, setFetchError] = useState('')

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ content: string; score: number }[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // Load documents and auto-load embedding model when modal opens
  useEffect(() => {
    if (open) {
      loadDocuments()
      loadPreDataCategories()
      if (modelStatus === 'unloaded') {
        handleLoadModel()
      }
    }
  }, [open])

  async function loadDocuments() {
    const docs = await bridge.rag.list()
    setDocuments(docs)
  }

  async function loadPreDataCategories() {
    const categories = await bridge.rag.predata.categories()
    setPreDataCategories(categories)
  }

  async function handleLoadModel() {
    setModelStatus('loading')
    await bridge.rag.model.load()
    setModelStatus('ready')
  }

  async function handleImportPreData(categoryId: string) {
    setIsImportingPreData(true)
    await bridge.rag.predata.import({ categoryId })
    await loadPreDataCategories()
    await loadDocuments()
    setIsImportingPreData(false)
  }

  async function handleAddText() {
    if (!textContent.trim() || !docName.trim()) return

    setIsIngesting(true)
    if (modelStatus !== 'ready') {
      setIngestProgress('Loading embedding model...')
      await handleLoadModel()
    }

    setIngestProgress('Ingesting document...')
    await bridge.rag.ingest({
      name: docName,
      content: textContent,
      source: 'text'
    })

    setIsIngesting(false)
    setIngestProgress('')
    setTextContent('')
    setDocName('')
    setViewMode('browse')
    await loadDocuments()
  }

  async function handleFetchUrl() {
    if (!urlContent.trim()) return

    setIsIngesting(true)
    setFetchError('')
    setIngestProgress('Fetching URL content...')

    try {
      const fetchResult = await bridge.rag.fetchUrl({ url: urlContent })

      if (!fetchResult.success || !fetchResult.content) {
        setFetchError(
          fetchResult.error ||
            'Unable to fetch content from this URL. The server may be blocking automated requests.'
        )
        return
      }

      setUrlPreview({
        url: urlContent,
        content: fetchResult.content,
        charCount: fetchResult.content.length
      })
      setViewMode('add-url-preview')
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch URL')
    } finally {
      setIsIngesting(false)
      setIngestProgress('')
    }
  }

  async function handleConfirmAddUrl() {
    if (!urlPreview) return

    setIsIngesting(true)
    try {
      if (modelStatus !== 'ready') {
        setIngestProgress('Loading embedding model...')
        await handleLoadModel()
      }

      setIngestProgress('Ingesting document...')
      const urlName = new URL(urlPreview.url).hostname
      const result = await bridge.rag.ingest({
        name: urlName,
        content: urlPreview.content,
        source: 'url'
      })

      if (!result.success) {
        setIngestProgress(result.error || 'Ingest failed')
        return
      }

      setUrlContent('')
      setUrlPreview(null)
      setViewMode('browse')
      await loadDocuments()
    } catch (err) {
      setIngestProgress(err instanceof Error ? err.message : 'Ingest failed')
    } finally {
      setIsIngesting(false)
      setIngestProgress('')
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return

    setIsSearching(true)
    if (modelStatus !== 'ready') {
      await handleLoadModel()
    }

    const result = await bridge.rag.search({ query: searchQuery, topK: 5 })
    if (result.success && result.results) {
      setSearchResults(result.results)
      setViewMode('search')
    }
    setIsSearching(false)
  }

  function handleClearSearch() {
    setSearchQuery('')
    setSearchResults([])
    setViewMode('browse')
  }

  async function handleDeleteDocument(id: string) {
    await bridge.rag.delete({ id })
    await loadDocuments()
  }

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title='Knowledge Base Management'
      variant='canvas'
      className='h-[80vh] w-[80vw] max-w-none'
    >
      <div className='flex h-full flex-col'>
        {/* Row 1: Search bar */}
        <div className='border-b border-gray-200 px-4 py-3'>
          <div className='flex gap-2'>
            <div className='relative flex-1'>
              <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400' />
              <input
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder='Search Knowledge Base...'
                className='w-full rounded-md border border-gray-300 py-2 pl-10 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
              />
              {searchQuery && (
                <button
                  onClick={handleClearSearch}
                  className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600'
                >
                  <X className='h-4 w-4' />
                </button>
              )}
            </div>
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
              className='rounded-md bg-tamarind-700 px-4 py-2 text-sm font-medium text-white hover:bg-tamarind-800 disabled:opacity-50'
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {/* Row 2: Buttons + Pre-data (hidden in search mode) */}
        {viewMode !== 'search' && (
          <div className='flex items-center gap-3 border-b border-gray-200 px-4 py-2'>
            <button
              onClick={() => setViewMode('add-text')}
              disabled={isIngesting}
              className='flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50'
            >
              <Plus className='h-3.5 w-3.5' />
              Add Text
            </button>
            <button
              onClick={() => setViewMode('add-url')}
              disabled={isIngesting}
              className='flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50'
            >
              <Globe className='h-3.5 w-3.5' />
              Add URL
            </button>

            {preDataCategories.length > 0 && (
              <>
                <div className='h-4 w-px bg-gray-300' />
                <span className='text-[10px] text-gray-500'>Pre-loaded:</span>
                {preDataCategories.map((cat) => (
                  <div
                    key={cat.id}
                    className='flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1'
                  >
                    <span className='text-xs'>{cat.id.includes('FIFA') ? '⚽' : '📚'}</span>
                    <span className='text-[10px] text-gray-600'>{cat.name}</span>
                    {cat.imported ? (
                      <span className='text-[10px] text-green-600'>✓</span>
                    ) : (
                      <button
                        onClick={() => handleImportPreData(cat.id)}
                        disabled={isImportingPreData}
                        className='text-[10px] text-blue-600 hover:text-blue-800 disabled:opacity-50'
                      >
                        Import
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Row 3: Content area */}
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          {/* Search results mode */}
          {viewMode === 'search' && (
            <div className='flex-1 overflow-auto p-4'>
              <div className='mb-3 flex items-center justify-between'>
                <p className='text-xs font-medium text-gray-700'>
                  Search Results ({searchResults.length})
                </p>
                <button
                  onClick={handleClearSearch}
                  className='text-xs text-blue-600 hover:text-blue-800'
                >
                  Back to documents
                </button>
              </div>
              {searchResults.length > 0 ? (
                <div className='space-y-2'>
                  {searchResults.map((result, i) => (
                    <div key={i} className='rounded-md border border-gray-200 p-3'>
                      <p className='mb-1 text-[10px] font-medium text-gray-500'>
                        Score: {result.score.toFixed(3)}
                      </p>
                      <p className='text-xs text-gray-700'>{result.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className='py-8 text-center text-xs text-gray-400'>No results found</p>
              )}
            </div>
          )}

          {/* Add text mode */}
          {viewMode === 'add-text' && (
            <div className='flex-1 overflow-auto p-4'>
              <div className='mx-auto max-w-xl'>
                <h3 className='mb-3 text-xs font-medium text-gray-700'>Add Text Document</h3>
                <input
                  type='text'
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  placeholder='Document name'
                  className='mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-xs'
                />
                <textarea
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder='Paste your text content here...'
                  rows={10}
                  className='w-full rounded-md border border-gray-300 px-3 py-2 text-xs'
                />
                <div className='mt-3 flex gap-2'>
                  <button
                    onClick={handleAddText}
                    disabled={isIngesting || !textContent.trim() || !docName.trim()}
                    className='rounded-md bg-tamarind-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-tamarind-800 disabled:opacity-50'
                  >
                    {isIngesting ? ingestProgress : 'Add Document'}
                  </button>
                  <button
                    onClick={() => setViewMode('browse')}
                    className='rounded-md border border-gray-300 px-4 py-1.5 text-xs text-gray-700 hover:bg-gray-50'
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add URL mode */}
          {viewMode === 'add-url' && (
            <div className='flex-1 overflow-auto p-4'>
              <div className='mx-auto max-w-xl'>
                <h3 className='mb-3 text-xs font-medium text-gray-700'>Add URL Content</h3>
                <input
                  type='url'
                  value={urlContent}
                  onChange={(e) => setUrlContent(e.target.value)}
                  placeholder='https://example.com/article'
                  className='w-full rounded-md border border-gray-300 px-3 py-2 text-xs'
                />

                {/* Warning message */}
                <div className='mt-2 rounded-md border border-amber-200 bg-amber-50 p-2'>
                  <p className='text-[10px] text-amber-700'>
                    ⚠️ Some websites may block automated requests. If fetching fails, try copying
                    the content manually using "Add Text" instead.
                  </p>
                </div>

                {/* Error message */}
                {fetchError && (
                  <div className='mt-2 rounded-md border border-red-200 bg-red-50 p-2'>
                    <p className='text-[10px] text-red-700'>⚠️ {fetchError}</p>
                  </div>
                )}

                <div className='mt-3 flex gap-2'>
                  <button
                    onClick={handleFetchUrl}
                    disabled={isIngesting || !urlContent.trim()}
                    className='rounded-md bg-tamarind-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-tamarind-800 disabled:opacity-50'
                  >
                    {isIngesting ? ingestProgress : 'Fetch'}
                  </button>
                  <button
                    onClick={() => {
                      setFetchError('')
                      setViewMode('browse')
                    }}
                    className='rounded-md border border-gray-300 px-4 py-1.5 text-xs text-gray-700 hover:bg-gray-50'
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {viewMode === 'add-url-preview' && urlPreview && (
            <div className='flex-1 overflow-auto p-4'>
              <div className='mx-auto max-w-xl'>
                <h3 className='mb-3 text-xs font-medium text-gray-700'>
                  Add URL Content - Preview
                </h3>
                <p className='mb-2 text-[10px] text-gray-500'>URL: {urlPreview.url}</p>

                <div className='rounded-md border border-gray-200 bg-gray-50 p-3'>
                  <p className='mb-1 text-[10px] font-medium text-gray-600'>Content Preview:</p>
                  <p className='text-xs text-gray-700 line-clamp-6'>{urlPreview.content}</p>
                  <p className='mt-2 text-[10px] text-gray-500'>
                    Full content: {urlPreview.charCount?.toLocaleString() ?? '0'} characters
                  </p>
                </div>

                <div className='mt-3 flex gap-2'>
                  <button
                    onClick={handleConfirmAddUrl}
                    disabled={isIngesting}
                    className='rounded-md bg-tamarind-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-tamarind-800 disabled:opacity-50'
                  >
                    {isIngesting ? ingestProgress : 'Add to Knowledge Base'}
                  </button>
                  <button
                    onClick={() => setViewMode('add-url')}
                    className='rounded-md border border-gray-300 px-4 py-1.5 text-xs text-gray-700 hover:bg-gray-50'
                  >
                    Back
                  </button>
                  <button
                    onClick={() => {
                      setUrlContent('')
                      setUrlPreview(null)
                      setFetchError('')
                      setViewMode('browse')
                    }}
                    className='rounded-md border border-gray-300 px-4 py-1.5 text-xs text-gray-700 hover:bg-gray-50'
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Browse mode - Document table */}
          {viewMode === 'browse' && (
            <div className='flex-1 overflow-auto p-4'>
              <div className='mb-2 flex items-center justify-between'>
                <p className='text-xs font-medium text-gray-700'>Documents ({documents.length})</p>
              </div>
              {documents.length > 0 ? (
                <table className='w-full'>
                  <thead>
                    <tr className='border-b border-gray-200 text-left'>
                      <th className='pb-1.5 pr-3 text-[10px] font-medium text-gray-500'></th>
                      <th className='pb-1.5 pr-3 text-[10px] font-medium text-gray-500'>Name</th>
                      <th className='pb-1.5 pr-3 text-[10px] font-medium text-gray-500'>Type</th>
                      <th className='pb-1.5 pr-3 text-[10px] font-medium text-gray-500'>Added</th>
                      <th className='pb-1.5 text-[10px] font-medium text-gray-500'></th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => (
                      <tr key={doc.id} className='border-b border-gray-100 hover:bg-gray-50'>
                        <td className='py-1.5 pr-3'>
                          {doc.source === 'url' ? (
                            <Globe className='h-3.5 w-3.5 text-gray-400' />
                          ) : (
                            <FileText className='h-3.5 w-3.5 text-gray-400' />
                          )}
                        </td>
                        <td className='py-1.5 pr-3 text-xs font-medium text-gray-700'>
                          {doc.name}
                        </td>
                        <td className='py-1.5 pr-3'>
                          <span className='inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600'>
                            {doc.source === 'url' ? 'URL' : 'Text'}
                          </span>
                        </td>
                        <td className='py-1.5 pr-3 text-[10px] text-gray-500'>
                          {new Date(doc.createdAt).toLocaleDateString()}
                        </td>
                        <td className='py-1.5'>
                          <button
                            onClick={() => handleDeleteDocument(doc.id)}
                            className='text-gray-400 hover:text-red-500'
                          >
                            <Trash2 className='h-3.5 w-3.5' />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className='py-8 text-center'>
                  <p className='text-xs text-gray-400'>No documents yet</p>
                  <p className='mt-1 text-[10px] text-gray-400'>
                    Click "Add Text" or "Add URL" to get started
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row 4: Status footer */}
        <div className='flex items-center justify-between border-t border-gray-200 px-4 py-2'>
          <span className='text-[10px] text-gray-500'>Total: {documents.length} documents</span>
          <span
            className={`text-[10px] ${
              modelStatus === 'ready'
                ? 'text-green-600'
                : modelStatus === 'loading'
                  ? 'text-amber-600'
                  : 'text-gray-400'
            }`}
          >
            Embedding Model:{' '}
            {modelStatus === 'ready'
              ? 'Ready'
              : modelStatus === 'loading'
                ? 'Loading... (first time may take 5-10 min)'
                : 'Unloaded'}
          </span>
        </div>
      </div>
    </BaseModal>
  )
}
