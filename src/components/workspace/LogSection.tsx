import { Save, Terminal } from 'lucide-react';
import { Section } from '../common';
import { useApp } from '../../useAppController';

export function LogSection() {
  const { t, logs, setLogs, saveLogToFile } = useApp();

  return (
    <Section title={t.logResults} defaultOpen={false}>
      <div className="log-toolbar">
        <span><Terminal size={16} /> {t.conversionLog}</span>
        <div>
          <button className="ghost-button" onClick={() => setLogs([])}>{t.clear}</button>
          <button className="ghost-button" onClick={saveLogToFile}>
            <Save size={14} />
            {t.save}
          </button>
        </div>
      </div>
      <pre className="log-view">{logs.join('\n')}</pre>
    </Section>
  );
}
