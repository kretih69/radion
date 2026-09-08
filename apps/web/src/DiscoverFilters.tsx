import { useEffect, useRef, useState } from "react";
import type { Country, Language, Tag } from "@radion2/shared";

type FilterKey = "country" | "language" | "genre" | null;

type DiscoverFiltersProps = {
  countries: Country[];
  languages: Language[];
  tags: Tag[];
  countrycode: string;
  language: string;
  tag: string;
  onCountryChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onTagChange: (value: string) => void;
};

export function DiscoverFilters({
  countries,
  languages,
  tags,
  countrycode,
  language,
  tag,
  onCountryChange,
  onLanguageChange,
  onTagChange,
}: DiscoverFiltersProps) {
  const [openFilter, setOpenFilter] = useState<FilterKey>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenFilter(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const countryLabel =
    countries.find((item) => item.iso_3166_1 === countrycode)?.name ?? "Anywhere";
  const languageLabel = language || "Any";
  const genreLabel = tag || "All genres";

  function toggleFilter(key: Exclude<FilterKey, null>) {
    setOpenFilter((current) => (current === key ? null : key));
  }

  return (
    <div className="sidebar__filters discover-filters" ref={rootRef}>
      <p className="sidebar__filters-label">Filters</p>

      <div className={`sidebar__filter ${openFilter === "country" ? "is-open" : ""}`}>
        <button
          type="button"
          className="sidebar__filter-trigger"
          aria-expanded={openFilter === "country"}
          onClick={() => toggleFilter("country")}
        >
          <span className="sidebar__filter-meta">
            <strong>Country</strong>
            <span>{countryLabel}</span>
          </span>
          <span className="sidebar__caret" aria-hidden>
            {openFilter === "country" ? "▾" : "▸"}
          </span>
        </button>
        {openFilter === "country" && (
          <div className="sidebar__submenu" role="listbox" aria-label="Country">
            <button
              type="button"
              role="option"
              className={!countrycode ? "is-selected" : ""}
              aria-selected={!countrycode}
              onClick={() => {
                onCountryChange("");
                setOpenFilter(null);
              }}
            >
              Anywhere
            </button>
            {countries.map((country) => (
              <button
                key={country.iso_3166_1}
                type="button"
                role="option"
                className={countrycode === country.iso_3166_1 ? "is-selected" : ""}
                aria-selected={countrycode === country.iso_3166_1}
                onClick={() => {
                  onCountryChange(country.iso_3166_1);
                  setOpenFilter(null);
                }}
              >
                <span>{country.name}</span>
                <em>{country.stationcount}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`sidebar__filter ${openFilter === "language" ? "is-open" : ""}`}>
        <button
          type="button"
          className="sidebar__filter-trigger"
          aria-expanded={openFilter === "language"}
          onClick={() => toggleFilter("language")}
        >
          <span className="sidebar__filter-meta">
            <strong>Language</strong>
            <span>{languageLabel}</span>
          </span>
          <span className="sidebar__caret" aria-hidden>
            {openFilter === "language" ? "▾" : "▸"}
          </span>
        </button>
        {openFilter === "language" && (
          <div className="sidebar__submenu" role="listbox" aria-label="Language">
            <button
              type="button"
              role="option"
              className={!language ? "is-selected" : ""}
              aria-selected={!language}
              onClick={() => {
                onLanguageChange("");
                setOpenFilter(null);
              }}
            >
              Any
            </button>
            {languages.map((item) => (
              <button
                key={item.name}
                type="button"
                role="option"
                className={language === item.name ? "is-selected" : ""}
                aria-selected={language === item.name}
                onClick={() => {
                  onLanguageChange(item.name);
                  setOpenFilter(null);
                }}
              >
                <span>{item.name}</span>
                <em>{item.stationcount}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`sidebar__filter ${openFilter === "genre" ? "is-open" : ""}`}>
        <button
          type="button"
          className="sidebar__filter-trigger"
          aria-expanded={openFilter === "genre"}
          onClick={() => toggleFilter("genre")}
        >
          <span className="sidebar__filter-meta">
            <strong>Genre</strong>
            <span>{genreLabel}</span>
          </span>
          <span className="sidebar__caret" aria-hidden>
            {openFilter === "genre" ? "▾" : "▸"}
          </span>
        </button>
        {openFilter === "genre" && (
          <div className="sidebar__submenu" role="listbox" aria-label="Genre">
            <button
              type="button"
              role="option"
              className={!tag ? "is-selected" : ""}
              aria-selected={!tag}
              onClick={() => {
                onTagChange("");
                setOpenFilter(null);
              }}
            >
              All genres
            </button>
            {tags.slice(0, 80).map((item) => (
              <button
                key={item.name}
                type="button"
                role="option"
                className={tag === item.name ? "is-selected" : ""}
                aria-selected={tag === item.name}
                onClick={() => {
                  onTagChange(item.name);
                  setOpenFilter(null);
                }}
              >
                <span>{item.name}</span>
                <em>{item.stationcount}</em>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
