import { ArtifactPreviewPanel } from '@/components/artifact-preview-panel'
import { ChatPanel } from '@/components/chat-panel'
import { Sidebar } from '@/components/sidebar'

export default function Home() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <ChatPanel />
      <ArtifactPreviewPanel />
    </div>
  )
}
