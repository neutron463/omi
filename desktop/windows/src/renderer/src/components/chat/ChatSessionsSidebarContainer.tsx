import { useChatSessions } from '../../hooks/useChatSessions'
import { ChatSessionsSidebar } from './ChatSessionsSidebar'

// Thin container: owns the `useChatSessions` state and renders the presentational
// sidebar. Mounted ONLY when `multiChatEnabled` is on, so the hook's initial
// session fetch never fires while the flag is off (behavior == today).
export function ChatSessionsSidebarContainer(): React.JSX.Element {
  const state = useChatSessions()
  return <ChatSessionsSidebar state={state} />
}
