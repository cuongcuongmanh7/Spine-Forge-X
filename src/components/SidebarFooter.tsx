import { LayoutDashboard, Settings } from 'lucide-react';
import { useApp } from '../useAppController';
import { AccountBadge } from './AccountBadge';

/** Shared sidebar footer (account + Dashboard + Settings), shown in both Workspace and Library modes. */
export function SidebarFooter() {
  const { t, setDashboardOpen, setSettingsOpen } = useApp();
  return (
    <div className="sidebar-footer">
      <AccountBadge />
      <button className="sidebar-settings" onClick={() => setDashboardOpen(true)}>
        <LayoutDashboard size={16} />
        <span>{t.dashboardFolder}</span>
      </button>
      <button className="sidebar-settings" onClick={() => setSettingsOpen(true)}>
        <Settings size={16} />
        <span>{t.settings}</span>
      </button>
    </div>
  );
}
