import { makePgn, parsePgn } from "chessops/pgn";
import type { OpeningLine } from "@/bindings";

export function openingLinePgn(
    opening: OpeningLine,
    orientation: "white" | "black" = "white",
): string {
    const game = parsePgn(opening.pgn)[0];
    if (!game?.moves.children.length) throw new Error("This opening has no moves.");
    game.headers.set("Event", opening.name);
    game.headers.set("ECO", opening.eco);
    game.headers.set("Orientation", orientation);
    return makePgn(game);
}
