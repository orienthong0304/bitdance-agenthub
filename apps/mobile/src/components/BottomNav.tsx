export type TabId = 'status' | 'conversations' | 'approvals' | 'settings'

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'status', label: '状态' },
  { id: 'conversations', label: '会话' },
  { id: 'approvals', label: '审批' },
  { id: 'settings', label: '设置' },
]

export function BottomNav({
  activeTab,
  onChange,
}: {
  activeTab: TabId
  onChange: (tab: TabId) => void
}) {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={activeTab === tab.id ? 'nav-item active' : 'nav-item'}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
