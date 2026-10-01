import { createContext, useEffect, useRef } from "react";
import { createTreeStore, type TreeStore } from "@/state/store/tree";
import { createDebouncedSessionStorage } from "@/state/store/debouncedStorage";
import type { TreeState } from "@/utils/treeReducer";

const mountedTrees = new Map<string, TreeStore>();
const tabStorage = createDebouncedSessionStorage<TreeState>();

export function readTabTree(id: string): TreeState | undefined {
  const live = mountedTrees.get(id)?.getState();
  if (live) return live;
  const stored = tabStorage.getItem(id);
  return stored && "state" in stored ? stored.state : undefined;
}

export function replaceTabTree(id: string, tree: TreeState) {
  const store = mountedTrees.get(id);
  if (store) store.setState(tree);
  else tabStorage.setItem(id, { version: 0, state: tree });
}

export const TreeStateContext = createContext<TreeStore | null>(null);

export function TreeStateProvider({
  id,
  initial,
  children,
}: {
  id?: string;
  initial?: TreeState;
  children: React.ReactNode;
}) {
  const store = useRef(createTreeStore(id, initial)).current;

  useEffect(() => {
    if (!id) return;
    mountedTrees.set(id, store);
    return () => {
      mountedTrees.delete(id);
    };
  }, [id, store]);

  return <TreeStateContext.Provider value={store}>{children}</TreeStateContext.Provider>;
}
