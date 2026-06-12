// Locale registry + message helpers. The copy itself lives in ./vi and ./en
// (split out so neither single file dominates); ./types derives the key set
// from `vi`. Public API is unchanged — importers still `import … from './i18n'`.
import type { Language } from '../types';
import { en } from './en';
import { vi } from './vi';

export type { Translations } from './types';
import type { Translations } from './types';

export const copy = { vi, en };

export function getCopy(language: Language): Translations {
  return copy[language];
}

export function formatMessage(template: string, completed: number, total: number) {
  return template.replace('{completed}', String(completed)).replace('{total}', String(total));
}

export function formatSummary(template: string, completed: number, failed: number, skipped: number) {
  return template
    .replace('{completed}', String(completed))
    .replace('{failed}', String(failed))
    .replace('{skipped}', String(skipped));
}
