import { Chess } from "chessops";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parsePgn } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import { openingLinePgn } from "../openingLine";

const haxo = {
    name: "Scotch Game: Haxo Gambit",
    eco: "C44",
    pgn: "1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Bc4 Bc5",
};

test("an opening line starts at the initial board and preserves every move", () => {
    const pgn = openingLinePgn(haxo);
    const game = parsePgn(pgn)[0];
    expect(game.headers.get("FEN")).toBeUndefined();
    expect(game.headers.get("Start")).toBeUndefined();
    expect(game.headers.get("Event")).toBe(haxo.name);
    expect(game.headers.get("ECO")).toBe("C44");
    const position = Chess.default();
    expect(makeFen(position.toSetup())).toBe(INITIAL_FEN);
    const moves: string[] = [];
    for (const node of game.moves.mainline()) {
        const move = parseSan(position, node.san);
        expect(move).toBeDefined();
        position.play(move!);
        moves.push(node.san);
    }
    expect(moves).toEqual(["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Bc4", "Bc5"]);
    expect(makeFen(position.toSetup())).toBe(
        "r1bqk1nr/pppp1ppp/2n5/2b5/2BpP3/5N2/PPP2PPP/RNBQK2R w KQkq - 2 5",
    );
});

test("a black repertoire keeps its orientation when saved and reopened", () => {
    const game = parsePgn(openingLinePgn(haxo, "black"))[0];
    expect(game.headers.get("Orientation")).toBe("black");
    expect([...game.moves.mainline()]).toHaveLength(8);
});

test("position-only entries cannot create empty opening repertoires", () => {
    expect(() => openingLinePgn({ ...haxo, pgn: "*" })).toThrow("no moves");
});
