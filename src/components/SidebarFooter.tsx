import { LayoutDashboard, Settings } from 'lucide-react';
import { useApp } from '../useAppController';
import { AccountBadge } from './AccountBadge';

/** Shared sidebar footer (Dashboard + Settings + account), shown in both Workspace and Library modes. */
export function SidebarFooter() {
  const { t, setDashboardOpen, setSettingsOpen } = useApp();
  return (
    <div className="sidebar-footer">
      <button className="sidebar-settings" onClick={() => setDashboardOpen(true)}>
        <LayoutDashboard size={16} />
        <span>{t.dashboardFolder}</span>
      </button>
      <button className="sidebar-settings" onClick={() => setSettingsOpen(true)}>
        <Settings size={16} />
        <span>{t.settings}</span>
      </button>
      <AccountBadge />
    </div>
  );
}
