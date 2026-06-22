import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRightLeft,
  Bell,
  FilePlus2,
  FolderClosed,
  Image as ImageIcon,
  Package,
  Pencil,
  Trash2,
  type LucideIcon
} from 'lucide-react';
import { useApp } from '../useAppController';
import { formatDateTime } from '../time';
import type { Translations } from '../i18n';
import type { DriveNotification } from '../useDriveNotifications';
import './NotificationBell.css';

const ICONS: Record<string, LucideIcon> = {
  edit: Pencil,
  rename: ArrowRightLeft,
  add: FilePlus2,
  delete: Trash2
};

/** Action verb. Images get a distinct "updated" (we can't tell add vs edit apart); exports get
 *  "exported" regardless of the underlying edit. */
function verbOf(t: Translations, n: DriveNotification): string {
  if (n.kind === 'export') return t.driveVerbExport;
  if (n.kind === 'image' && n.action === 'edit') return t.driveVerbImageUpdate;
  return { edit: t.driveVerbEdit, rename: t.driveVerbRename, add: t.driveVerbAdd, delete: t.driveVerbDelete }[n.action];
}

/** Structured one-line message: bold actor + verb + bold file (or "N files" / "old → new"). The
 *  folder is rendered separately (see the item layout), not inline. */
function NotiLine({ t, n }: { t: Translations; n: DriveNotification }) {
  const actor = n.actorName || t.notificationsSomeone;
  const noun = n.kind === 'image' ? t.driveNotiImages : t.driveNotiFiles;
  let detail: ReactNode;
  if (n.count > 1) {
    detail = (
      <b className="noti-file">
        {n.count} {noun}
      </b>
    );
  } else if (n.action === 'rename') {
    detail = (
      <>
        <b className="noti-file">{n.oldName}</b> → <b className="noti-file">{n.newName}</b>
      </>
    );
  } else {
    detail = <b className="noti-file">{n.name}</b>;
  }
  return (
    <>
      <b className="noti-actor">{actor}</b> {verbOf(t, n)} {detail}
    </>
  );
}

/** Plain-text version of the line for the hover tooltip / accessibility. */
function notiPlain(t: Translations, n: DriveNotification): string {
  const actor = n.actorName || t.notificationsSomeone;
  const noun = n.kind === 'image' ? t.driveNotiImages : t.driveNotiFiles;
  const detail =
    n.count > 1
      ? `${n.count} ${noun}`
      : n.action === 'rename'
        ? `${n.oldName ?? ''} → ${n.newName ?? ''}`
        : (n.name ?? '');
  return `${actor} ${verbOf(t, n)} ${detail}`;
}

/**
 * Top-bar bell: shows Drive-change notifications (who edited/renamed/uploaded/deleted what), with an
 * unread badge. Opening the panel marks everything read. The store + persistence live in
 * `useDriveNotifications`; this is the presentation only.
 */
export function NotificationBell() {
  const { t, notifications, notificationsUnread, markNotificationsRead, clearNotifications } = useApp();
  const [open, setOpen] = useState(false);

  // Opening the panel (or new arrivals while it's open) marks notifications as read.
  useEffect(() => {
    if (open) markNotificationsRead();
  }, [open, notificationsUnread, markNotificationsRead]);

  return (
    <div className="noti-bell">
      <button
        className="noti-bell-button"
        aria-label={t.notificationsTitle}
        title={t.notificationsTitle}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={15} />
        {notificationsUnread > 0 && (
          <span className="noti-badge" aria-hidden="true">
            {notificationsUnread > 9 ? '9+' : notificationsUnread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="noti-backdrop" onClick={() => setOpen(false)} />
          <div className="noti-panel" role="dialog" aria-label={t.notificationsTitle}>
            <div className="noti-panel-header">
              <span>{t.notificationsTitle}</span>
              {notifications.length > 0 && (
                <button className="noti-clear" onClick={clearNotifications}>
                  {t.notificationsClear}
                </button>
              )}
            </div>
            <div className="noti-list">
              {notifications.length === 0 ? (
                <div className="noti-empty">{t.notificationsEmpty}</div>
              ) : (
                notifications.map((n) => {
                  const Icon = n.kind === 'image' ? ImageIcon : n.kind === 'export' ? Package : ICONS[n.action];
                  const folderPath = n.folder ? n.folder.replace(/\//g, '\\') : '';
                  return (
                    <div className={`noti-item${n.read ? '' : ' unread'}`} key={n.id}>
                      <Icon size={14} className="noti-item-icon" />
                      <div className="noti-item-body">
                        <div className="noti-item-text" title={notiPlain(t, n)}>
                          <NotiLine t={t} n={n} />
                        </div>
                        {folderPath && (
                          <div className="noti-item-folder" title={folderPath}>
                            <FolderClosed size={11} aria-hidden="true" />
                            <span>{folderPath}</span>
                          </div>
                        )}
                        <div className="noti-item-time">{formatDateTime(n.at)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
