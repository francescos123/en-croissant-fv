import { expect, test } from "vitest";
import { createTreeStore } from "@/state/store/tree";
import { createDebouncedSessionStorage } from "@/state/store/debouncedStorage";
import { readTabTree, replaceTabTree } from "@/components/common/TreeStateContext";
import { getPGN } from "../chess";
import { findAttachments, mergeRepertoireLine, readRepertoireGames } from "../repertoireMerge";
import { defaultTree, type TreeState } from "../treeReducer";

test("right-click line extraction follows a side branch and stops at the clicked move", () => {
    const store = createTreeStore();
    store.getState().makeMoves({ payload: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"] });
    store.getState().goToMove([0, 0, 0, 0]);
    store.getState().makeMoves({ payload: ["d4", "exd4", "Bc4", "Bc5"] });
    const pgn = getPGN(store.getState().root, {
        headers: null,
        comments: true,
        extraMarkups: true,
        glyphs: true,
        variations: false,
        path: [0, 0, 0, 0, 1, 0],
    });
    const line = [...readRepertoireGames(pgn)[0].moves.mainline()].map((n) => n.san);
    expect(line).toEqual(["e4", "e5", "Nf3", "Nc6", "d4", "exd4"]);
    const result = mergeRepertoireLine(pgn, "*", 0, findAttachments(pgn, "*")[0]);
    expect(result.added).toBe(6);
});

test("updating an inactive tab replaces queued storage so stale moves cannot return", () => {
    const id = "merge-storage-test";
    const storage = createDebouncedSessionStorage<TreeState>();
    storage.setItem(id, { version: 0, state: { ...defaultTree(), dirty: true } });
    expect(readTabTree(id)?.dirty).toBe(true);
    const updated = defaultTree();
    updated.headers.event = "Updated repertoire";
    replaceTabTree(id, updated);
    expect(readTabTree(id)?.headers.event).toBe("Updated repertoire");
    expect(readTabTree(id)?.dirty).toBe(false);
    const reloaded = createTreeStore(id);
    expect(reloaded.getState().headers.event).toBe("Updated repertoire");
    storage.removeItem(id);
});
