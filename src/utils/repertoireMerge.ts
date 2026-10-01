import { makeUci } from "chessops";
import type { Position } from "chessops/chess";
import { makeFen } from "chessops/fen";
import {
    ChildNode,
    type Game,
    makePgn,
    type Node,
    type PgnNodeData,
    PgnParser,
    startingPosition,
} from "chessops/pgn";
import { makeSan, parseSan } from "chessops/san";

export type Attachment = { path: number[]; sourcePly: number; label: string };
type Located = { node: Node<PgnNodeData>; position: Position; path: number[]; label: string };

export function readRepertoireGames(pgn: string): Game<PgnNodeData>[] {
    const games: Game<PgnNodeData>[] = [];
    const parser = new PgnParser((game, error) => {
        if (error) throw new Error("This PGN is too large or could not be read safely.");
        games.push(game);
    });
    parser.parse(pgn);
    if (!games.length) throw new Error("No game found in this repertoire.");
    return games;
}

// Ignore move counters, but keep turn, castling and legal en-passant rights.
export function positionKey(position: Position): string {
    return `${position.rules}:${makeFen(position.toSetup()).split(" ").slice(0, 4).join(" ")}`;
}

function locate(game: Game<PgnNodeData>): Located[] {
    const root = startingPosition(game.headers).unwrap();
    if (root.rules !== "chess") throw new Error("Only standard chess repertoires are supported.");
    const nodes: Located[] = [];
    const stack: Located[] = [
        { node: game.moves, position: root, path: [], label: "Starting position" },
    ];
    while (stack.length) {
        const current = stack.pop()!;
        nodes.push(current);
        for (let i = current.node.children.length - 1; i >= 0; i--) {
            const child = current.node.children[i];
            const position = current.position.clone();
            const move = parseSan(position, child.data.san);
            if (!move) throw new Error(`Illegal move in repertoire: ${child.data.san}`);
            const notation = `${position.fullmoves}${position.turn === "white" ? "." : "..."} ${makeSan(position, move)}`;
            position.play(move);
            stack.push({
                node: child,
                position,
                path: [...current.path, i],
                label: `${current.path.length ? `${current.label} ` : ""}${notation}`,
            });
        }
    }
    return nodes;
}

function startPath(game: Game<PgnNodeData>, nodes: Located[]): number[] {
    let path: unknown;
    try {
        path = JSON.parse(game.headers.get("Start") || "[]");
    } catch {
        throw new Error(
            "This repertoire has an invalid training start. Open it and mark a valid start first.",
        );
    }
    if (
        !Array.isArray(path) ||
        !path.every((n) => Number.isInteger(n) && n >= 0) ||
        !nodes.some((n) => JSON.stringify(n.path) === JSON.stringify(path))
    ) {
        throw new Error(
            "This repertoire has an invalid training start. Open it and mark a valid start first.",
        );
    }
    return path;
}

function sourceLine(pgn: string) {
    const games = readRepertoireGames(pgn);
    if (games.length !== 1) throw new Error("Select a single line to add.");
    const game = games[0];
    const nodes = locate(game);
    if (nodes.some((n) => n.node.children.length > 1))
        throw new Error("Select one variation to add.");
    if (nodes.length < 2) throw new Error("This line has no moves to add.");
    return { nodes, moves: [...game.moves.mainline()] };
}

export function findAttachments(sourcePgn: string, targetPgn: string, gameIndex = 0): Attachment[] {
    const source = sourceLine(sourcePgn);
    const game = readRepertoireGames(targetPgn)[gameIndex];
    if (!game) throw new Error("The selected repertoire game no longer exists.");
    const targets = locate(game);
    const start = startPath(game, targets);
    const insideStart = targets.filter((n) => start.every((v, i) => n.path[i] === v));
    const anchor = insideStart[0];
    const matches = (nodes: Located[]) =>
        source.nodes.flatMap((sourceNode, sourcePly) =>
            nodes
                .filter(
                    (target) => positionKey(target.position) === positionKey(sourceNode.position),
                )
                .map((target) => ({ path: target.path, sourcePly, label: target.label })),
        );
    // Prefer the repertoire's declared start; do not silently jump across branches.
    const atStart = matches([anchor]);
    if (atStart.length) return atStart;
    const shared = matches(insideStart);
    if (!shared.length) return [];
    // Use the earliest shared position in the selected line. Multiple target
    // branches at that position remain explicit choices in the dialog.
    return shared.filter((match) => match.sourcePly === shared[0].sourcePly);
}

export function mergeRepertoireLine(
    sourcePgn: string,
    targetPgn: string,
    gameIndex: number,
    attachment: Attachment,
) {
    const valid = findAttachments(sourcePgn, targetPgn, gameIndex).some(
        (a) =>
            a.sourcePly === attachment.sourcePly &&
            JSON.stringify(a.path) === JSON.stringify(attachment.path),
    );
    if (!valid) throw new Error("The selected attachment point is no longer available.");
    const source = sourceLine(sourcePgn);
    const games = readRepertoireGames(targetPgn);
    const game = games[gameIndex];
    const anchor = locate(game).find(
        (n) => JSON.stringify(n.path) === JSON.stringify(attachment.path),
    )!;
    let node = anchor.node;
    const position = anchor.position.clone();
    let added = 0;
    for (const data of source.moves.slice(attachment.sourcePly)) {
        const move = parseSan(position, data.san);
        if (!move) throw new Error(`Cannot add illegal move: ${data.san}`);
        const existing = node.children.find((child) => {
            const candidate = parseSan(position, child.data.san);
            return candidate && makeUci(candidate) === makeUci(move);
        });
        if (existing) node = existing;
        else {
            const child = new ChildNode<PgnNodeData>({
                ...structuredClone(data),
                san: makeSan(position, move),
            });
            node.children.push(child);
            node = child;
            added++;
        }
        position.play(move);
    }
    return { pgn: games.map(makePgn).join("\n\n"), added, skipped: attachment.sourcePly };
}
