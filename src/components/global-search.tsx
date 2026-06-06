'use client'

import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSearchStore } from '@/stores/search-store'

import { SearchResultItem } from './search-result-item'

export function GlobalSearch() {
  const isOpen = useSearchStore((s) => s.isOpen)
  const closeSearch = useSearchStore((s) => s.closeSearch)
  const query = useSearchStore((s) => s.query)
  const setQuery = useSearchStore((s) => s.setQuery)
  const hits = useSearchStore((s) => s.hits)
  const loading = useSearchStore((s) => s.loading)
  const error = useSearchStore((s) => s.error)
  const jumpToHit = useSearchStore((s) => s.jumpToHit)

  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setActive(0)
      // Defer focus until after the modal opens
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isOpen])

  // Reset active index when hits change
  useEffect(() => { setActive(0) }, [hits])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(hits.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault()
      jumpToHit(hits[active])
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) closeSearch() }}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogTitle className="sr-only">Search messages</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search messages… (⌘K)"
            className="border-0 focus-visible:ring-0"
            maxLength={200}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {error && (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Search failed. {error}
            </p>
          )}
          {!error && query.trim().length < 2 && (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Type at least 2 characters to search.
            </p>
          )}
          {!error && query.trim().length >= 2 && hits.length === 0 && !loading && (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No messages match.
            </p>
          )}
          {hits.length > 0 && (
            <ul role="listbox">
              {hits.map((hit, i) => (
                <SearchResultItem
                  key={hit.messageId}
                  hit={hit}
                  active={i === active}
                  onClick={() => jumpToHit(hit)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
          {loading ? 'Searching…' : `${hits.length} result${hits.length === 1 ? '' : 's'}`}
        </div>
      </DialogContent>
    </Dialog>
  )
}