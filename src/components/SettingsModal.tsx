import { useEffect } from 'react';
import { AlertTriangle, FolderOpen, RotateCw, Search, X } from 'lucide-react';
import { Section, FieldStatus, Hint } from './common';
import { useApp } from '../useAppController';

export function SettingsModal() {
  const {
    t,
    language,
    setLanguage,
    theme,
    setTheme,
    merged,
    updateAppConfig,
    validation,
    maxMemoryValid,
    isAutoDetecting,
    autoDetectSpine,
    setSettingsOpen,
    syncEnabled,
    syncFolder,
    syncSpineRoot,
    syncLastSyncedAt,
    syncStatus,
    syncNeedsSpineRoot,
    setSyncEnabled,
    chooseSyncFolder,
    chooseSpineRoot,
    syncNow
  } = useApp();

  const syncStatusLabel =
    syncStatus === 'synced'
      ? t.syncStatusSynced
      : syncStatus === 'pending'
        ? t.syncStatusPending
        : syncStatus === 'syncing'
          ? t.syncStatusSyncing
          : syncStatus === 'error'
            ? t.syncStatusError
            : t.syncStatusIdle;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSettingsOpen]);

  return (
    <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{t.settings}</h2>
          <button className="modal-close" title={t.closeSettings} aria-label={t.closeSettings} onClick={() => setSettingsOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <Section title={t.appearance}>
            <div className="header-controls settings-controls">
              <label className="segmented-label">
                <span>{t.language}</span>
                <span className="segmented-control">
                  <button className={language === 'vi' ? 'active' : ''} onClick={() => setLanguage('vi')}>VI</button>
                  <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button>
                </span>
              </label>
              <label className="segmented-label">
                <span>{t.theme}</span>
                <span className="segmented-control">
                  <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>{t.light}</button>
                  <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>{t.dark}</button>
                </span>
              </label>
            </div>
          </Section>

          <Section title={t.behavior}>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={merged.runInBackground}
                onChange={(event) => updateAppConfig('runInBackground', event.target.checked)}
              />
              {t.runInBackground}
              <Hint text={t.runInBackgroundHelp} />
            </label>
          </Section>

          <Section title={t.syncTitle} defaultOpen={false}>
            <label className="checkbox-line">
              <input type="checkbox" checked={syncEnabled} onChange={(event) => setSyncEnabled(event.target.checked)} />
              {t.syncEnable}
              <Hint text={t.syncEnableHelp} />
            </label>
            {syncEnabled && (
              <>
                <div className="form-row">
                  <label>{t.syncFolder}</label>
                  <input value={syncFolder} readOnly placeholder={t.syncFolderPlaceholder} />
                  <button className="icon-button" title={t.syncChooseFolder} aria-label={t.syncChooseFolder} onClick={() => void chooseSyncFolder()}>
                    <FolderOpen size={18} />
                  </button>
                </div>
                <div className="form-row">
                  <label>
                    {t.syncSpineRoot}
                    <Hint text={t.syncSpineRootHelp} />
                  </label>
                  <input value={syncSpineRoot} readOnly placeholder={t.syncSpineRootPlaceholder} />
                  <button className="icon-button" title={t.syncChooseSpineRoot} aria-label={t.syncChooseSpineRoot} onClick={() => void chooseSpineRoot()}>
                    <FolderOpen size={18} />
                  </button>
                </div>
                {syncNeedsSpineRoot && (
                  <div className="notice warning">
                    <AlertTriangle size={18} />
                    <span>{t.syncNeedsSpineRoot}</span>
                  </div>
                )}
                <div className="header-controls settings-controls">
                  <span className={`muted sync-status-text status-${syncStatus}`}>
                    {syncStatusLabel}
                    {syncLastSyncedAt && syncStatus !== 'error' ? ` · ${t.syncLastSynced}: ${new Date(syncLastSyncedAt).toLocaleString()}` : ''}
                  </span>
                  <button
                    className="secondary-button small"
                    disabled={!syncFolder || !syncSpineRoot || syncStatus === 'syncing'}
                    onClick={() => syncNow()}
                  >
                    <RotateCw className={syncStatus === 'syncing' ? 'spin' : undefined} size={15} />
                    {t.syncNow}
                  </button>
                </div>
              </>
            )}
          </Section>

          <Section title={t.executable}>
            <div className="notice warning">
              <AlertTriangle size={18} />
              <span>{t.executableNotice}</span>
            </div>
            <div className="form-row">
              <label>{t.executablePath}</label>
              <input
                value={merged.spinePath}
                onChange={(event) => updateAppConfig('spinePath', event.target.value)}
                placeholder="C:\Program Files\Spine\Spine.com"
              />
              <FieldStatus
                ok={Boolean(validation.spineOk)}
                warning={Boolean(validation.spineWarning)}
                message={
                  !merged.spinePath.trim()
                    ? t.executableEmpty
                    : validation.spineOk
                      ? t.executableValid
                      : validation.spineWarning
                        ? t.executableComWarning
                        : t.executableMissing
                }
              />
              <button className="icon-button" title={t.autoDetect} aria-label={t.autoDetect} disabled={isAutoDetecting} onClick={() => autoDetectSpine(false)}>
                {isAutoDetecting ? <RotateCw className="spin" size={18} /> : <Search size={18} />}
              </button>
            </div>
          </Section>

          <Section title={t.advancedRuntime} defaultOpen={false}>
            <div className="form-grid">
              <label className="slider-field">
                <span className="slider-field-head">
                  <span className="slider-field-label">
                    {t.parallelJobs}
                    <Hint text={t.parallelJobsHelp} />
                  </span>
                  <span className="slider-value">{merged.parallelJobs}</span>
                </span>
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={merged.parallelJobs}
                  onChange={(event) => updateAppConfig('parallelJobs', Number(event.target.value))}
                />
                <span className="slider-scale" aria-hidden="true">
                  <span>1</span>
                  <span>8</span>
                </span>
              </label>
              <label>
                {t.maxMemory}
                <input
                  className={maxMemoryValid ? undefined : 'field-invalid'}
                  value={merged.maxMemory}
                  placeholder="512m"
                  onChange={(event) => updateAppConfig('maxMemory', event.target.value)}
                />
                {!maxMemoryValid && <small className="field-error-text">{t.maxMemoryInvalid}</small>}
              </label>
              <label>
                {t.timeoutSeconds}
                <input
                  type="number"
                  min={30}
                  value={merged.timeoutSeconds}
                  onChange={(event) => updateAppConfig('timeoutSeconds', Number(event.target.value))}
                />
              </label>
            </div>
          </Section>

          <Section title={t.libraryThresholdsTitle} defaultOpen={false}>
            <div className="form-grid">
              <label>
                {t.libraryImageFolderWarn}
                <input
                  type="number"
                  min={1}
                  value={merged.libraryImageFolderWarnMB}
                  onChange={(event) => updateAppConfig('libraryImageFolderWarnMB', Number(event.target.value))}
                />
              </label>
              <label>
                {t.librarySpineFileWarn}
                <input
                  type="number"
                  min={1}
                  value={merged.librarySpineFileWarnMB}
                  onChange={(event) => updateAppConfig('librarySpineFileWarnMB', Number(event.target.value))}
                />
              </label>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
