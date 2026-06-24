import { usePersistentState, usePersistentSet } from './usePersistentState';

/**
 * Shared Library filter selection (facet + category/version chips + search + invert), lifted above
 * the Inventory and Clean tabs so the Clean scan can be scoped to exactly what the user has filtered.
 * State is persisted to localStorage so it survives the Library view unmounting on a tab switch
 * (inventory → workspace → inventory).
 *
 * Keys are namespaced per library (`libraryFilter.<id>.*`) so each imported folder remembers its own
 * filter setup: switching to a fresh library starts clean ("auto reset"), switching back restores the
 * previous selection. The hook is meant to be remounted (via a React `key`) when the active library
 * changes — `usePersistentState` only reads localStorage on mount, so a stable mount per library id
 * is what reloads the right namespace.
 */
export function useLibraryFilter(libraryId: string | null) {
  const ns = `libraryFilter.${libraryId ?? 'none'}`;
  const [facet, setFacetState] = usePersistentState<'folder' | 'id' | 'status'>(`${ns}.facet`, 'folder');
  const [selectedCats, setSelectedCats] = usePersistentSet(`${ns}.cats`);
  const [selectedVersions, setSelectedVersions] = usePersistentSet(`${ns}.versions`);
  const [query, setQuery] = usePersistentState(`${ns}.query`, '');
  const [invert, setInvert] = usePersistentState(`${ns}.invert`, false);

  function setFacet(next: 'folder' | 'id' | 'status') {
    setFacetState(next);
    // Category keys differ per facet, so a stale selection would filter everything out.
    setSelectedCats(new Set());
  }

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return {
    facet,
    setFacet,
    selectedCats,
    toggleCat: (key: string) => toggle(setSelectedCats, key),
    selectedVersions,
    toggleVersion: (key: string) => toggle(setSelectedVersions, key),
    query,
    setQuery,
    invert,
    setInvert
  };
}

export type LibraryFilterApi = ReturnType<typeof useLibraryFilter>;
