import { usePersistentState, usePersistentSet } from './usePersistentState';

/**
 * Shared Library filter selection (facet + category/version chips + search), lifted above the
 * Inventory and Clean tabs so the Clean scan can be scoped to exactly what the user has filtered.
 * State is persisted to localStorage so it survives the Library view unmounting on a tab switch
 * (inventory → workspace → inventory).
 */
export function useLibraryFilter() {
  const [facet, setFacetState] = usePersistentState<'folder' | 'id' | 'status'>('libraryFilter.facet', 'folder');
  const [selectedCats, setSelectedCats] = usePersistentSet('libraryFilter.cats');
  const [selectedVersions, setSelectedVersions] = usePersistentSet('libraryFilter.versions');
  const [query, setQuery] = usePersistentState('libraryFilter.query', '');

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
    setQuery
  };
}

export type LibraryFilterApi = ReturnType<typeof useLibraryFilter>;
