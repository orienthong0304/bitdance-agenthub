import { ArtifactPreviewPanel } from '@/components/artifact-preview-panel'
import { FileExplorerPanel } from '@/components/file-explorer-panel'
import { MainView } from '@/components/main-view'
import { MessageHighlightLayer } from '@/components/message-highlight-layer'
import { SelectionPopover } from '@/components/selection-popover'
import { Sidebar } from '@/components/sidebar'

export default function Home() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <MainView />
      <FileExplorerPanel />
      <ArtifactPreviewPanel />
      <SelectionPopover />
      <MessageHighlightLayer />
    </div>
  )
}
