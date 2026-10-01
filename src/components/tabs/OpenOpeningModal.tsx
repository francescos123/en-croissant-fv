import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useLoaderData } from "@tanstack/react-router";
import { useSetAtom, useStore } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { commands, type OpeningLine } from "@/bindings";
import { activeTabAtom, addRecentFileAtom, tabFamily, tabsAtom } from "@/state/atoms";
import { createFile } from "@/utils/files";
import { openingLinePgn } from "@/utils/openingLine";
import { createTab, type GameOrigin } from "@/utils/tabs";

export default function OpenOpeningModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/" });
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const store = useStore();
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query.trim(), 200);
  const [selected, setSelected] = useState<OpeningLine | null>(null);
  const [save, setSave] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<"white" | "black">("white");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const {
    data,
    error: searchError,
    isLoading,
    mutate,
  } = useSWR(
    opened && debouncedQuery ? ["opening-lines", debouncedQuery] : null,
    ([, search]) => commands.searchOpeningLines(search),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const searching = isLoading || query.trim() !== debouncedQuery;

  function selectOpening(opening: OpeningLine) {
    setSelected(opening);
    setName(
      opening.name
        .replace(/[\\/:*?"<>|]+/g, " - ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    setError("");
  }

  async function openLine() {
    if (!selected || busy) return;
    if (save && !name.trim()) {
      setError(t("Common.RequireName"));
      return;
    }
    if (save && /[\\/:*?"<>|]/.test(name)) {
      setError(t("Openings.InvalidName"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const pgn = openingLinePgn(selected, color);
      let gameOrigin: GameOrigin = { kind: "none" };
      if (save) {
        const result = await createFile({
          filename: name.trim(),
          filetype: "repertoire",
          pgn,
          dir: documentDir,
        });
        if (result.isErr) throw result.error;
        gameOrigin = { kind: "file", file: result.value, gameNumber: 0 };
      }
      const id = await createTab({
        tab: { name: save ? name.trim() : selected.name, type: "analysis" },
        setTabs,
        setActiveTab,
        pgn,
        gameOrigin,
      });
      if (gameOrigin.kind === "file") {
        store.set(tabFamily(id), "practice");
        store.set(addRecentFileAtom, {
          name: name.trim(),
          path: gameOrigin.file.path,
          type: "repertoire",
        });
      } else {
        store.set(tabFamily(id), "analysis");
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t("Openings.Title")}
      size="lg"
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
    >
      <Stack>
        <TextInput
          label={t("Openings.Search")}
          placeholder={t("Openings.SearchPlaceholder")}
          description={t("Openings.Description")}
          value={query}
          disabled={busy}
          data-autofocus
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelected(null);
            setError("");
          }}
          rightSection={searching ? <Loader size="xs" /> : null}
        />
        {searchError && (
          <Alert color="red" title={t("Openings.SearchError")}>
            <Button size="xs" variant="subtle" onClick={() => mutate()}>
              {t("Openings.Retry")}
            </Button>
          </Alert>
        )}
        {!searching && !searchError && query.trim() && data?.length === 0 && (
          <Text size="sm" c="dimmed" role="status">
            {t("Openings.NoResults")}
          </Text>
        )}
        {!searching && !searchError && data && data.length > 0 && (
          <ScrollArea.Autosize mah={230}>
            <Stack gap={2}>
              {data.map((opening) => (
                <UnstyledButton
                  key={opening.name}
                  disabled={busy}
                  aria-pressed={selected?.name === opening.name}
                  onClick={() => selectOpening(opening)}
                  px="sm"
                  py="xs"
                  style={{
                    borderRadius: "var(--mantine-radius-sm)",
                    background:
                      selected?.name === opening.name
                        ? "var(--mantine-color-default-hover)"
                        : undefined,
                  }}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm">{opening.name}</Text>
                    <Text size="xs" c="dimmed">
                      {opening.eco}
                    </Text>
                  </Group>
                </UnstyledButton>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
        {!searching && data?.length === 50 && (
          <Text size="xs" c="dimmed">
            {t("Openings.RefineSearch")}
          </Text>
        )}
        {selected && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {t("Openings.Moves")}
            </Text>
            <Text size="sm">{selected.pgn}</Text>
          </Stack>
        )}
        <Checkbox
          label={t("Openings.SaveRepertoire")}
          checked={save}
          disabled={busy}
          onChange={(event) => setSave(event.currentTarget.checked)}
        />
        {save && (
          <>
            <TextInput
              label={t("Common.Name")}
              value={name}
              disabled={busy}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setError("");
              }}
            />
            <Stack gap={4}>
              <Text size="sm">{t("Home.Card.NewRepertoire.Color")}</Text>
              <SegmentedControl
                disabled={busy}
                value={color}
                onChange={(value) => setColor(value as "white" | "black")}
                data={[
                  { label: t("Common.WHITE"), value: "white" },
                  { label: t("Common.BLACK"), value: "black" },
                ]}
              />
            </Stack>
          </>
        )}
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <Button disabled={!selected || searching} loading={busy} onClick={openLine}>
          {save ? t("Openings.CreateRepertoire") : t("Openings.OpenLine")}
        </Button>
      </Stack>
    </Modal>
  );
}
