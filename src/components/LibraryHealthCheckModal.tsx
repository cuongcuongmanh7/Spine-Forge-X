import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, Check, ClipboardCopy, RotateCw, Save, X } from 'lucide-react';
import { useApp } from '../useAppController';
import type { HealthReport, LibraryEntry } from '../config';
import './LibraryHealthCheckModal.css';

/** Human-readable byte size (B / KB / MB). */
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A markdown rendering of the report — handed to the AI via clipboard or a saved file. */
function buildHealthMarkdown(r: HealthReport, entry: LibraryEntry): string {
  const lines: string[] = [];
  lines.push(`# Export health check — ${r.relPath}`);
  lines.push('');
  lines.push(`- Status: ${r.ok ? 'OK' : 'PROBLEMS'}`);
  lines.push(`- .spine: ${r.spineFile}`);
  lines.push(`- Folder: ${r.folder}`);
  lines.push(`- Editor version: ${r.editorVersion ?? '?'}`);
  lines.push(`- Detected runtime: ${r.detectedVersion ?? '?'}`);
  lines.push(`- Skeleton: ${r.skeletonPath ?? '(none)'} [${r.skeletonFormat ?? '?'}, ${fmtBytes(r.skeletonBytes)}]`);
  lines.push(`- Atlas: ${r.atlasPath ?? '(none)'}`);
  lines.push(`- Animations (${entry.animations.length}): ${entry.animations.join(', ') || '(none read)'}`);
  lines.push(`- Skins (${entry.skins.length}): ${entry.skins.join(', ') || '(none read)'}`);
  lines.push('');
  if (r.problems.length) {
    lines.push('## Problems');
    for (const p of r.problems) lines.push(`- ${p}`);
    lines.push('');
  }
  lines.push('## Texture pages');
  if (r.pages.length === 0) lines.push('- (none)');
  for (const p of r.pages) lines.push(`- ${p.exists ? 'OK' : 'MISSING'} · ${p.name} (${fmtBytes(p.bytes)})`);
  lines.push('');
  lines.push('## Files in export');
  for (const f of r.exportFiles) lines.push(`- ${f}`);
  lines.push('');
  if (r.skeletonHeader) {
    lines.push('## Skeleton header');
    lines.push('```');
    lines.push(r.skeletonHeader);
    lines.push('```');
    lines.push('');
  }
  if (r.atlasContent) {
    lines.push('## Atlas content');
    lines.push('```');
    lines.push(r.atlasContent);
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

/** One pass/fail check row. */
function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className={`health-row ${ok ? 'ok' : 'bad'}`}>
      {ok ? <Check size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
      <span className="health-row-label">{label}</span>
      <span className="health-row-detail" title={detail}>
        {detail}
      </span>
    </li>
  );
}

/**
 * Export health-check modal: runs `health_check_entry` for one unit and lists every check
 * (export folder / skeleton / atlas / runtime / each texture page) with pass/fail + reason.
 * "Copy for AI" / "Save report" emit a markdown dump for deeper investigation.
 */
export function LibraryHealthCheckModal({ entry, onClose }: { entry: LibraryEntry; onClose: () => void }) {
  const { t, pushToast } = useApp();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = entry.relPath.replace(/\\/g, '/').split('/').pop() || entry.spineFile;

  useEffect(() => {
    let alive = true;
    invoke<HealthReport>('health_check_entry', {
      folder: entry.folder,
      spineFile: entry.spineFile,
      relPath: entry.relPath,
      editorVersion: entry.version
    })
      .then((r) => alive && setReport(r))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [entry]);

  async function copyForAi() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(buildHealthMarkdown(report, entry));
      pushToast(t.healthCopied, 'success');
    } catch (e) {
      pushToast(`${t.healthSaveFailed}: ${String(e)}`, 'error');
    }
  }

  async function saveReport() {
    if (!report) return;
    const sep = entry.folder.includes('\\') ? '\\' : '/';
    const path = `${entry.folder}${sep}health-report.md`;
    try {
      await invoke('write_text_file', { path, content: buildHealthMarkdown(report, entry) });
      pushToast(t.healthSaved.replace('{path}', path), 'success');
      await invoke('open_path', { path }).catch(() => {});
    } catch (e) {
      pushToast(`${t.healthSaveFailed}: ${String(e)}`, 'error');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal health-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="detail-title">
            <h2 title={entry.spineFile}>{t.healthCheckTitle}: {name}</h2>
            {report?.detectedVersion && <span className="stat-chip">{report.detectedVersion}</span>}
          </div>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body health-body">
          {!report && !error && (
            <div className="health-status" role="status" aria-live="polite">
              <RotateCw size={20} className="spin" aria-hidden="true" />
              <span>{t.healthChecking}</span>
            </div>
          )}
          {error && (
            <div className="health-status error" role="alert">
              <AlertTriangle size={20} aria-hidden="true" />
              <div>
                <strong>{t.healthCheckFailed}</strong>
                <p>{error}</p>
              </div>
            </div>
          )}
          {report && (
            <>
              {report.ok ? (
                <div className="health-banner ok" role="status">
                  <Check size={16} aria-hidden="true" /> {t.healthOk}
                </div>
              ) : (
                <div className="health-banner bad" role="alert">
                  <strong>{t.healthProblemsTitle}</strong>
                  <ul>
                    {report.problems.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              <ul className="health-checks">
                <Row
                  ok={report.exportDirs.length > 0}
                  label={t.healthExportDirs}
                  detail={report.exportDirs.length ? report.exportDirs.join(', ') : `(${t.healthMissing})`}
                />
                <Row
                  ok={!!report.skeletonPath}
                  label={t.healthSkeleton}
                  detail={
                    report.skeletonPath
                      ? `${report.skeletonFormat ?? '?'} · ${fmtBytes(report.skeletonBytes)}`
                      : `(${t.healthMissing})`
                  }
                />
                <Row
                  ok={!!report.atlasPath}
                  label={t.healthAtlas}
                  detail={report.atlasPath ?? `(${t.healthMissing})`}
                />
                <Row
                  ok={!!report.detectedVersion && report.detectedVersion !== '4.x'}
                  label={t.healthVersion}
                  detail={`${report.editorVersion ?? '?'} → ${report.detectedVersion ?? '?'}`}
                />
                <Row
                  ok={entry.animations.length > 0}
                  label={t.healthAnimations}
                  detail={
                    entry.animations.length
                      ? `${entry.animations.length} · ${entry.animations.slice(0, 8).join(', ')}`
                      : t.healthNoAnims
                  }
                />
              </ul>

              <div className="health-section">
                <h3>
                  {t.healthPages} ({report.pages.filter((p) => p.exists).length}/{report.pages.length})
                </h3>
                <ul className="health-pages">
                  {report.pages.map((p, i) => (
                    <li key={i} className={p.exists && p.bytes > 0 ? 'ok' : 'bad'}>
                      {p.exists && p.bytes > 0 ? <Check size={13} /> : <AlertTriangle size={13} />}
                      <span className="health-page-name" title={p.path}>
                        {p.name}
                      </span>
                      <span className="health-page-size">{p.exists ? fmtBytes(p.bytes) : t.healthMissing}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {report.atlasContent && (
                <details className="health-section">
                  <summary>{t.healthAtlasContent}</summary>
                  <pre className="health-pre">{report.atlasContent}</pre>
                </details>
              )}
              {report.skeletonHeader && (
                <details className="health-section">
                  <summary>{t.healthSkeletonHeader}</summary>
                  <pre className="health-pre">{report.skeletonHeader}</pre>
                </details>
              )}
              <details className="health-section">
                <summary>{t.healthExportFiles}</summary>
                <pre className="health-pre">{report.exportFiles.join('\n')}</pre>
              </details>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="secondary-button" disabled={!report} onClick={copyForAi}>
            <ClipboardCopy size={15} /> {t.healthCopyForAi}
          </button>
          <button className="primary-button" disabled={!report} onClick={saveReport}>
            <Save size={15} /> {t.healthSaveReport}
          </button>
        </div>
      </div>
    </div>
  );
}
