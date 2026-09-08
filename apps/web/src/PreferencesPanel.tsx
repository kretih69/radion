import { useEffect, useMemo, useState } from "react";
import type { Tag } from "@radion2/shared";
import { savePreferences } from "./api";

type PreferencesPanelProps = {
  tags: Tag[];
  selectedTags: string[];
  onChange: (tags: string[]) => void;
};

export function PreferencesPanel({
  tags,
  selectedTags,
  onChange,
}: PreferencesPanelProps) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>(selectedTags);

  useEffect(() => {
    setDraft(selectedTags);
  }, [selectedTags]);

  const selectedSet = useMemo(() => new Set(draft), [draft]);

  const visibleTags = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? tags.filter((tag) => tag.name.toLowerCase().includes(q))
      : tags;
    return [...list].sort((a, b) => {
      const aSelected = selectedSet.has(a.name.toLowerCase()) ? 0 : 1;
      const bSelected = selectedSet.has(b.name.toLowerCase()) ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;
      return b.stationcount - a.stationcount;
    });
  }, [tags, query, selectedSet]);

  async function persist(next: string[]) {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await savePreferences(next);
      onChange(saved.tags);
      setDraft(saved.tags);
      setStatus(
        saved.tags.length
          ? `Saved ${saved.tags.length} preference${saved.tags.length === 1 ? "" : "s"}`
          : "Preferences cleared",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save preferences");
      setDraft(selectedTags);
    } finally {
      setSaving(false);
    }
  }

  function toggleTag(name: string) {
    const normalized = name.toLowerCase();
    const next = selectedSet.has(normalized)
      ? draft.filter((tag) => tag !== normalized)
      : [...draft, normalized];
    setDraft(next);
    void persist(next);
  }

  return (
    <section className="preferences" aria-label="My preferences">
      <header className="preferences__header">
        <h2>My Preferences</h2>
        <p>Pick genres you like. Selections are saved to your account.</p>
      </header>

      <div className="preferences__toolbar">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tags"
          aria-label="Search preference tags"
        />
        <span className="preferences__count">
          {draft.length} selected
          {saving ? " · Saving…" : ""}
        </span>
      </div>

      {status && <p className="preferences__status">{status}</p>}
      {error && <p className="preferences__error">{error}</p>}

      <div className="preferences__grid">
        {visibleTags.map((tag) => {
          const selected = selectedSet.has(tag.name.toLowerCase());
          return (
            <button
              key={tag.name}
              type="button"
              className={`preferences__chip ${selected ? "is-on" : ""}`}
              aria-pressed={selected}
              disabled={saving}
              onClick={() => toggleTag(tag.name)}
            >
              <span>{tag.name}</span>
              <em>{tag.stationcount}</em>
            </button>
          );
        })}
      </div>

      {visibleTags.length === 0 && (
        <p className="status-line">No tags match that search.</p>
      )}
    </section>
  );
}
