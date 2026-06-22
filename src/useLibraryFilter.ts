import { useState } from 'react';

/**
 * Shared Library filter selection (facet + category/version chips + search), lifted above the
 * Inventory and Clean tabs so the Clean scan can be scoped to exactly what the user has filtered.
 */
export function useLibraryFilter() {
  const [facet, setFacetState] = useState<'folder' | 'id' | 'status'>('folder');
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [selectedVersions, setSelectedVersions] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

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
