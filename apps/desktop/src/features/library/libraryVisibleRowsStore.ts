import { batch, type Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { LibraryListItem } from "./libraryViewTypes";

interface LibraryVisibleRowsState {
  byId: Record<string, LibraryListItem>;
  order: string[];
}

export type LibraryVisibleRowPatch = Partial<Omit<LibraryListItem, "id">>;

export interface LibraryVisibleRowsStore {
  rows: Accessor<LibraryListItem[]>;
  replace: (rows: readonly LibraryListItem[]) => void;
  patch: (id: string, patch: LibraryVisibleRowPatch) => boolean;
  clear: () => void;
}

const emptyState = (): LibraryVisibleRowsState => ({ byId: {}, order: [] });

const snapshotForRows = (rows: readonly LibraryListItem[]): LibraryVisibleRowsState => {
  const byId = rows.reduce<Record<string, LibraryListItem>>((result, row) => {
    result[row.id] = row;
    return result;
  }, {});
  return { byId, order: rows.map((row) => row.id) };
};

export function createLibraryVisibleRowsStore(): LibraryVisibleRowsStore {
  const [state, setState] = createStore<LibraryVisibleRowsState>(emptyState());
  const rows = (): LibraryListItem[] =>
    state.order.reduce<LibraryListItem[]>((result, id) => {
      const row = state.byId[id];
      if (row) result.push(row);
      return result;
    }, []);

  const replace = (nextRows: readonly LibraryListItem[]): void => {
    const next = snapshotForRows(nextRows);
    batch(() => {
      setState("byId", reconcile(next.byId, { merge: true }));
      setState("order", reconcile(next.order));
    });
  };

  const patch = (id: string, nextPatch: LibraryVisibleRowPatch): boolean => {
    if (state.byId[id] === undefined) return false;
    setState("byId", id, nextPatch);
    return true;
  };

  const clear = (): void => {
    setState(reconcile(emptyState()));
  };

  return { rows, replace, patch, clear };
}
