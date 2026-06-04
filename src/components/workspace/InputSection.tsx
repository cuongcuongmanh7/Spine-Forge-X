import { FileText, FolderOpen, RotateCw, Trash2 } from 'lucide-react';
import { Section } from '../common';
import { useApp } from '../../useAppController';

export function InputSection() {
  const {
    t,
    merged,
    updateInputPath,
    files,
    skippedFiles,
    removeFile,
    scanInput,
    chooseInputFolder,
    chooseInputFiles,
    isChoosingInputFolder,
    isChoosingInputFiles,
    isScanning
  } = useApp();

  return (
    <Section title={t.inputFiles}>
      <div className="form-row">
        <label>{t.inputPath}</label>
        <input
          value={merged.inputPath}
          onChange={(event) => updateInputPath(event.target.value)}
          placeholder="D:\Project\SpineAssets"
        />
        <button className="icon-button" title={t.browseFolder} disabled={isChoosingInputFolder || isScanning} onClick={chooseInputFolder}>
          {isChoosingInputFolder ? <RotateCw className="spin" size={18} /> : <FolderOpen size={18} />}
        </button>
        <button className="icon-button" title={t.scan} disabled={isScanning || !merged.inputPath.trim()} onClick={scanInput}>
          <RotateCw className={isScanning ? 'spin' : undefined} size={18} />
        </button>
      </div>
      <div className="button-row offset-row">
        <button className="secondary-button" disabled={isChoosingInputFolder || isScanning} onClick={chooseInputFolder}>
          {isChoosingInputFolder ? <RotateCw className="spin" size={18} /> : <FolderOpen size={18} />}
          {t.browseFolder}
        </button>
        <button className="secondary-button" disabled={isChoosingInputFiles} onClick={chooseInputFiles}>
          {isChoosingInputFiles ? <RotateCw className="spin" size={18} /> : <FileText size={18} />}
          {t.browseFiles}
        </button>
      </div>
      <div className="file-summary">
        <span>{files.length} {t.spineFiles}</span>
        <span>{skippedFiles.length} {t.skipped}</span>
      </div>
      {files.length > 0 && (
        <div className="file-list">
          {files.map((file) => (
            <div className="file-item" key={file}>
              <FileText size={16} />
              <span title={file}>{file}</span>
              <button className="ghost-icon" title={t.remove} onClick={() => removeFile(file)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
