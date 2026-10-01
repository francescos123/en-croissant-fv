import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { startingPosition } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { findAttachments, mergeRepertoireLine, readRepertoireGames } from "../repertoireMerge";

const source = "1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Bc4 Bc5 *";
function merge(from: string, into: string, index = 0) {
    return mergeRepertoireLine(from, into, index, findAttachments(from, into, index)[0]);
}
function fenAfter(pgn: string) {
    const game = readRepertoireGames(pgn)[0];
    const pos = startingPosition(game.headers).unwrap();
    for (const node of game.moves.mainline()) pos.play(parseSan(pos, node.san)!);
    return makeFen(pos.toSetup());
}

test("shares existing moves, appends variations, and preserves target annotations and headers", () => {
    const target =
        '[Event "My Scotch"]\n[Orientation "black"]\n[Custom "keep me"]\n\n1. e4 {keep comment} e5 2. Nf3 Nc6 3. Bc4 $1 (3. Bb5 a6) *';
    const result = merge(source, target);
    expect(result.added).toBe(4);
    const game = readRepertoireGames(result.pgn)[0];
    expect(game.headers.get("Custom")).toBe("keep me");
    expect(game.headers.get("Orientation")).toBe("black");
    expect(game.moves.children[0].data.comments).toEqual(["keep comment"]);
    const branches = game.moves.children[0].children[0].children[0].children[0].children;
    expect(branches.map((n) => n.data.san)).toEqual(["Bc4", "Bb5", "d4"]);
    expect(branches[0].data.nags).toEqual([1]);
    expect(merge(source, result.pgn).added).toBe(0);
});

test("adds only through the selected endpoint and preserves source comments on new moves", () => {
    const result = merge("1. e4 {idea} e5 *", "*");
    expect(result.added).toBe(2);
    expect([...readRepertoireGames(result.pgn)[0].moves.mainline()].map((n) => n.san)).toEqual([
        "e4",
        "e5",
    ]);
    expect(result.pgn).toContain("{ idea }");
});

test("matches a FEN-only repertoire and ignores differing move counters", () => {
    const fen = fenAfter("1. e4 e5 2. Nf3 Nc6 *").split(" ").slice(0, 4).join(" ") + " 30 42";
    const target = `[SetUp "1"]\n[FEN "${fen}"]\n\n*`;
    const result = merge(source, target);
    expect(result.skipped).toBe(4);
    expect(result.added).toBe(4);
    expect([...readRepertoireGames(result.pgn)[0].moves.mainline()].map((n) => n.san)).toEqual([
        "d4",
        "exd4",
        "Bc4",
        "Bc5",
    ]);
});

test("respects a marked training start and keeps its path stable", () => {
    const target = '[Start "[0,0,0,0]"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *';
    const result = merge(source, target);
    expect(result.skipped).toBe(4);
    expect(readRepertoireGames(result.pgn)[0].headers.get("Start")).toBe("[0,0,0,0]");
    expect(findAttachments("1. d4 d5 *", target)).toEqual([]);
});

test("finds transpositions and lets the caller choose between matching branches", () => {
    const fen = fenAfter("1. Nf3 Nf6 2. d4 d5 *");
    const from = `[FEN "${fen}"]\n\n3. c4 *`;
    const target = "1. Nf3 (1. d4 d5 2. Nf3 Nf6) Nf6 2. d4 d5 *";
    const options = findAttachments(from, target);
    expect(options).toHaveLength(2);
    const result = mergeRepertoireLine(from, target, 0, options[1]);
    expect(result.added).toBe(1);
    expect(
        readRepertoireGames(result.pgn)[0].moves.children[0].children[0].children[0].children[0]
            .children,
    ).toHaveLength(0);
});

test("does not conflate side to move or castling rights", () => {
    const fen = fenAfter("1. e4 e5 *");
    expect(findAttachments(source, `[FEN "${fen.replace(" w ", " b ")}"]\n\n*`)).toEqual([]);
    expect(findAttachments(source, `[FEN "${fen.replace(" KQkq ", " - ")}"]\n\n*`)).toEqual([]);
});

test("rejects invalid training starts and illegal target moves without modifying input", () => {
    expect(() => findAttachments(source, '[Start "[9]"]\n\n1. e4 *')).toThrow(
        "invalid training start",
    );
    expect(() => findAttachments(source, '[Start "oops"]\n\n1. e4 *')).toThrow(
        "invalid training start",
    );
    expect(() => findAttachments(source, "1. e4 e5 2. Bh6 *")).toThrow("Illegal move");
});

test("preserves other games in a multi-game repertoire", () => {
    const target = '[Event "One"]\n\n1. d4 d5 *\n\n[Event "Two"]\n\n1. e4 *';
    const result = merge(source, target, 1);
    const games = readRepertoireGames(result.pgn);
    expect(games).toHaveLength(2);
    expect([...games[0].moves.mainline()].map((n) => n.san)).toEqual(["d4", "d5"]);
    expect(games[1].headers.get("Event")).toBe("Two");
});

test("legal en-passant rights matter when matching a position", () => {
    const fen = fenAfter("1. e4 a6 2. e5 d5 *");
    expect(fen.split(" ")[3]).toBe("d6");
    const from = `[FEN "${fen}"]\n\n3. exd6 *`;
    const withoutEp = fen.replace(" d6 ", " - ");
    expect(findAttachments(from, `[FEN "${withoutEp}"]\n\n*`)).toEqual([]);
});
