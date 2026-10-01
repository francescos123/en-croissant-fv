import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { makePgn } from "chessops/pgn";
import { useSetAtom, useStore } from "jotai";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR, { useSWRConfig } from "swr";
import { commands } from "@/bindings";
import {
  type Directory,
  type FileMetadata,
  processEntriesRecursively,
} from "@/components/files/file";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { parsePGN } from "@/utils/chess";
import { openFile } from "@/utils/files";
import { getDocumentDir } from "@/utils/directories";
import { findAttachments, mergeRepertoireLine, readRepertoireGames } from "@/utils/repertoireMerge";
import { getTabFile, getTabGameNumber } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";
import { readTabTree, replaceTabTree } from "./TreeStateContext";

function repertoires(entries: (Directory | FileMetadata)[]): FileMetadata[] {
  return entries.flatMap((entry) =>
    entry.type === "directory"
      ? repertoires(entry.children)
      : entry.metadata.type === "repertoire"
        ? [entry]
        : [],
  );
}

export default function AddToRepertoireModal({
  sourcePgn,
  onClose,
}: {
  sourcePgn: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const directory = useSWR("repertoire-document-dir", getDocumentDir);
  const documentDir = directory.data;
  const atomStore = useStore();
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const { mutate } = useSWRConfig();
  const [path, setPath] = useState<string | null>(null);
  const [gameIndex, setGameIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [done, setDone] = useState<number | null>(null);
  const files = useSWR(
    documentDir ? ["repertoire-picker", documentDir] : null,
    async ([, dir]) => repertoires(await processEntriesRecursively(dir, await readDir(dir))),
    { revalidateOnFocus: false },
  );
  const target = useSWR(
    path ? ["repertoire-to-merge", path] : null,
    ([, file]) => readTextFile(file),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const file = files.data?.find((f) => f.path === path);
  const preview = useMemo(() => {
    if (target.data === undefined) return null;
    let games: ReturnType<typeof readRepertoireGames> | undefined;
    try {
      games = readRepertoireGames(target.data);
      const attachments = findAttachments(sourcePgn, target.data, gameIndex);
      const selected =
        choice === null
          ? attachments.length === 1
            ? attachments[0]
            : undefined
          : attachments[Number(choice)];
      const result = selected
        ? mergeRepertoireLine(sourcePgn, target.data, gameIndex, selected)
        : undefined;
      return { games, attachments, selected, result, error: "" };
    } catch (e) {
      return { games, error: String(e instanceof Error ? e.message : e) };
    }
  }, [sourcePgn, target.data, gameIndex, choice]);

  function assertTabsSaved() {
    const tabs = atomStore.get(tabsAtom).filter((tab) => getTabFile(tab)?.path === path);
    if (tabs.some((tab) => readTabTree(tab.value)?.dirty)) {
      throw new Error(t("Repertoire.Unsaved"));
    }
    return tabs;
  }

  async function addLine() {
    if (
      !file ||
      !preview?.result ||
      !preview.selected ||
      target.data === undefined ||
      saving.current
    )
      return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      assertTabsSaved();
      // Parse before writing so an unreadable result never replaces a repertoire.
      const updated = await parsePGN(makePgn(readRepertoireGames(preview.result.pgn)[gameIndex]));
      const openTabs = assertTabsSaved();
      unwrap(await commands.saveRepertoireMerge(file.path, target.data, preview.result.pgn));
      for (const tab of openTabs) {
        if (getTabGameNumber(tab) !== gameIndex) continue;
        const previous = readTabTree(tab.value);
        let position = previous?.position ?? updated.position;
        let node = updated.root;
        if (
          !position.every((index) => {
            const next = node.children[index];
            if (!next) return false;
            node = next;
            return true;
          })
        )
          position = updated.position;
        replaceTabTree(tab.value, {
          ...updated,
          position,
          dirty: false,
        });
      }
      setDone(preview.result.added);
      await Promise.all([
        target.mutate(preview.result.pgn, false),
        mutate(["file-directory", documentDir]),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      opened
      onClose={() => {
        if (!saving.current) onClose();
      }}
      title={t("Repertoire.Add")}
      size="lg"
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      withCloseButton={!busy}
    >
      <Stack>
        <Text size="sm">{t("Repertoire.LineDescription")}</Text>
        <ScrollArea.Autosize mah={100}>
          <Text size="sm">{sourcePgn.replace(/^\[.*\]\s*$/gm, "").trim()}</Text>
        </ScrollArea.Autosize>
        {(directory.isLoading || files.isLoading) && <Loader size="sm" />}
        {(directory.error || files.error) && <Alert color="red">{t("Repertoire.LoadError")}</Alert>}
        {files.data?.length === 0 && <Text size="sm">{t("Repertoire.Empty")}</Text>}
        <Select
          label={t("Repertoire.Destination")}
          placeholder={t("Repertoire.Choose")}
          searchable
          disabled={busy || done !== null}
          value={path}
          data={(files.data ?? []).map((f) => ({
            value: f.path,
            label:
              documentDir && f.path.startsWith(`${documentDir}/`)
                ? f.path.slice(documentDir.length + 1).replace(/\.pgn$/i, "")
                : f.name,
          }))}
          onChange={(value) => {
            setPath(value);
            setGameIndex(0);
            setChoice(null);
            setError("");
          }}
        />
        {target.isLoading && <Loader size="sm" />}
        {target.error && <Alert color="red">{t("Repertoire.LoadError")}</Alert>}
        {preview?.games && preview.games.length > 1 && (
          <Select
            label={t("Repertoire.Game")}
            value={String(gameIndex)}
            disabled={busy || done !== null}
            data={preview.games.map((game, i) => ({
              value: String(i),
              label: `${i + 1}. ${game.headers.get("Event") || "Game"}`,
            }))}
            onChange={(value) => {
              setGameIndex(Number(value));
              setChoice(null);
              setError("");
            }}
          />
        )}
        {done === null && preview?.error && <Alert color="red">{preview.error}</Alert>}
        {done === null && preview?.attachments?.length === 0 && (
          <Alert color="yellow">{t("Repertoire.NoMatch")}</Alert>
        )}
        {done === null && preview?.attachments && preview.attachments.length > 1 && (
          <Select
            label={t("Repertoire.Attachment")}
            description={t("Repertoire.Multiple")}
            value={choice}
            disabled={busy}
            data={preview.attachments.map((a, i) => ({
              value: String(i),
              label: `${a.label} — ${t("Repertoire.AfterPly", { count: a.sourcePly })}`,
            }))}
            onChange={setChoice}
          />
        )}
        {done === null && preview?.selected && (
          <Text size="sm">{t("Repertoire.AttachAt", { position: preview.selected.label })}</Text>
        )}
        {done === null && preview?.result && (
          <Text size="sm">
            {preview.result.added
              ? t("Repertoire.Preview", {
                  count: preview.result.added,
                  skipped: preview.result.skipped,
                })
              : t("Repertoire.AlreadyExists")}
          </Text>
        )}
        {error && <Alert color="red">{error}</Alert>}
        {done !== null ? (
          <>
            <Alert color="green">{t("Repertoire.Success", { count: done })}</Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                {t("Common.Close", { defaultValue: "Close" })}
              </Button>
              <Button
                onClick={async () => {
                  try {
                    if (file)
                      await openFile(file, setTabs, setActiveTab, { gameNumber: gameIndex });
                    await navigate({ to: "/" });
                    onClose();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                {t("Repertoire.Open")}
              </Button>
            </Group>
          </>
        ) : (
          <Button
            loading={busy}
            disabled={!preview?.result?.added || target.isLoading || Boolean(target.error)}
            onClick={addLine}
          >
            {t("Repertoire.Add")}
          </Button>
        )}
      </Stack>
    </Modal>
  );
}
