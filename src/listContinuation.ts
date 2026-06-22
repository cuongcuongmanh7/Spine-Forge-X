/**
 * Markdown-ish list continuation for a multi-line text input. Given the value and caret position
 * when Enter is pressed, returns the new value + caret if the caret sits on an ordered ("1. ") or
 * unordered ("- "/"* "/"+ ") list item, else null (let the textarea insert a plain newline).
 * Pressing Enter on an empty list item ends the list (clears the bare marker) instead of continuing.
 *
 * Kept in its own module (not the component file) so React Fast Refresh stays happy — a component
 * module that also exports plain functions makes HMR bail and serve a stale handler.
 */
export function continueList(value: string, caret: number): { value: string; caret: number } | null {
  const before = value.slice(0, caret);
  const after = value.slice(caret);
  const lineStart = before.lastIndexOf('\n') + 1;
  const line = before.slice(lineStart);

  const ordered = line.match(/^(\s*)(\d+)([.)])(\s+)(.*)$/);
  const unordered = line.match(/^(\s*)([-*+])(\s+)(.*)$/);
  if (!ordered && !unordered) return null;

  const content = (ordered ? ordered[5] : unordered![4]).trim();
  if (content === '') {
    // Empty item → end the list: drop the bare marker, keep the caret where the line began.
    return { value: before.slice(0, lineStart) + after, caret: lineStart };
  }

  const marker = ordered
    ? `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]}${ordered[4]}`
    : `${unordered![1]}${unordered![2]}${unordered![3]}`;
  const inserted = `\n${marker}`;
  return { value: before + inserted + after, caret: before.length + inserted.length };
}
