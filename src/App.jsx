import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircleDashed,
  Copy,
  Grid2X2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Trophy,
} from "lucide-react";

const STORAGE_KEY = "figuritas-world-cup-2026-counts";
const API_BASE = import.meta.env?.VITE_API_BASE_URL || window.FIGURITAS_API_URL || "";
const range = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => String(start + index));

const teams = [
  ["MEX", "Mexico"],
  ["RSA", "Sudafrica"],
  ["KOR", "Corea del Sur"],
  ["CZE", "Chequia"],
  ["CAN", "Canada"],
  ["BIH", "Bosnia y Herzegovina"],
  ["QAT", "Catar"],
  ["SUI", "Suiza"],
  ["BRA", "Brasil"],
  ["MAR", "Marruecos"],
  ["HAI", "Haiti"],
  ["SCO", "Escocia"],
  ["USA", "Estados Unidos"],
  ["PAR", "Paraguay"],
  ["AUS", "Australia"],
  ["TUR", "Turquia"],
  ["GER", "Alemania"],
  ["CUW", "Curazao"],
  ["CIV", "Costa de Marfil"],
  ["ECU", "Ecuador"],
  ["NED", "Paises Bajos"],
  ["JPN", "Japon"],
  ["SWE", "Suecia"],
  ["TUN", "Tunez"],
  ["BEL", "Belgica"],
  ["EGY", "Egipto"],
  ["IRN", "Iran"],
  ["NZL", "Nueva Zelanda"],
  ["ESP", "Espana"],
  ["CPV", "Cabo Verde"],
  ["KSA", "Arabia Saudita"],
  ["URU", "Uruguay"],
  ["FRA", "Francia"],
  ["SEN", "Senegal"],
  ["IRQ", "Irak"],
  ["NOR", "Noruega"],
  ["ARG", "Argentina"],
  ["ALG", "Argelia"],
  ["AUT", "Austria"],
  ["JOR", "Jordania"],
  ["POR", "Portugal"],
  ["COD", "RD Congo"],
  ["UZB", "Uzbekistan"],
  ["COL", "Colombia"],
  ["ENG", "Inglaterra"],
  ["CRO", "Croacia"],
  ["GHA", "Ghana"],
  ["PAN", "Panama"],
];

const sections = [
  {
    id: "FWC-COPA",
    code: "FWC",
    name: "Copa",
    kind: "Especial",
    numbers: ["00", "1", "2", "3", "4"],
  },
  {
    id: "FWC-MUNDO",
    code: "FWC",
    name: "Mundo",
    kind: "Especial",
    numbers: range(5, 8),
  },
  {
    id: "FWC-HISTORIA",
    code: "FWC",
    name: "Historia",
    kind: "Especial",
    numbers: range(9, 19),
  },
  ...teams.map(([code, name]) => ({
    id: code,
    code,
    name,
    kind: "Seleccion",
    numbers: range(1, 20),
  })),
];

const totalStickers = sections.reduce((sum, section) => sum + section.numbers.length, 0);
const sectionAccents = ["#e1253b", "#008c7a", "#f2b632", "#2459a9", "#6f3bbf", "#df6c24"];

const filters = [
  { id: "all", label: "Todas", icon: Grid2X2 },
  { id: "missing", label: "Faltan", icon: CircleDashed },
  { id: "owned", label: "Tengo", icon: Check },
  { id: "duplicates", label: "Repetidas", icon: Copy },
];

function getStickerKey(sectionId, number) {
  return `${sectionId}-${number}`;
}

function getStatus(count) {
  if (count > 1) return "duplicate";
  if (count === 1) return "owned";
  return "missing";
}

function readSavedCounts() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function normalizeCounts(rawCounts = {}) {
  return Object.entries(rawCounts).reduce((counts, [key, value]) => {
    const count = Math.max(0, Math.min(99, Number(value) || 0));
    if (count > 0) counts[key] = count;
    return counts;
  }, {});
}

function applyCountDelta(current, key, direction) {
  const nextCount = Math.max(0, Math.min(99, (current[key] ?? 0) + direction));
  const next = { ...current };

  if (nextCount === 0) {
    delete next[key];
  } else {
    next[key] = nextCount;
  }

  return next;
}

function applyServerCount(current, key, count) {
  return applyCountDelta({ ...current, [key]: 0 }, key, Number(count) || 0);
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function matchesFilter(filter, count) {
  if (filter === "owned") return count > 0;
  if (filter === "missing") return count === 0;
  if (filter === "duplicates") return count > 1;
  return true;
}

function App() {
  const [counts, setCounts] = useState(readSavedCounts);
  const [syncStatus, setSyncStatus] = useState({ state: "loading", label: "Conectando" });
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const migrationPromptedRef = useRef(false);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
  }, [counts]);

  const loadRemoteCounts = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setSyncStatus({ state: "loading", label: "Conectando" });
    }

    try {
      const data = await apiRequest("/api/stickers");
      const remoteCounts = normalizeCounts(data.counts);
      const localCounts = normalizeCounts(readSavedCounts());
      const hasRemoteCounts = Object.keys(remoteCounts).length > 0;
      const hasLocalCounts = Object.keys(localCounts).length > 0;

      if (!silent && !migrationPromptedRef.current && !hasRemoteCounts && hasLocalCounts) {
        migrationPromptedRef.current = true;
        const shouldMigrate = window.confirm("Tienes marcas guardadas en este navegador. Subirlas a MySQL para compartirlas?");

        if (shouldMigrate) {
          const migrated = await apiRequest("/api/stickers", {
            method: "PUT",
            body: JSON.stringify({ counts: localCounts }),
          });
          setCounts(normalizeCounts(migrated.counts));
          setSyncStatus({ state: "synced", label: "MySQL activo" });
          return;
        }
      }

      setCounts(remoteCounts);
      setSyncStatus({ state: "synced", label: "MySQL activo" });
    } catch (error) {
      console.error(error);
      setSyncStatus({ state: "error", label: "Sin conexion" });
    }
  }, []);

  useEffect(() => {
    loadRemoteCounts();
    const interval = window.setInterval(() => loadRemoteCounts({ silent: true }), 10000);

    return () => window.clearInterval(interval);
  }, [loadRemoteCounts]);

  const stats = useMemo(() => {
    let owned = 0;
    let duplicates = 0;
    let totalCopies = 0;

    sections.forEach((section) => {
      section.numbers.forEach((number) => {
        const count = counts[getStickerKey(section.id, number)] ?? 0;
        if (count > 0) owned += 1;
        if (count > 1) duplicates += count - 1;
        totalCopies += count;
      });
    });

    return {
      owned,
      missing: totalStickers - owned,
      duplicates,
      totalCopies,
      progress: Math.round((owned / totalStickers) * 100),
    };
  }, [counts]);

  const filteredSections = useMemo(() => {
    const tokens = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    return sections
      .map((section) => {
        const numbers = section.numbers.filter((number) => {
          const count = counts[getStickerKey(section.id, number)] ?? 0;
          const searchable = `${section.code} ${section.name} ${section.kind} ${number}`.toLowerCase();
          const matchesSearch = tokens.every((token) => searchable.includes(token));
          return matchesSearch && matchesFilter(activeFilter, count);
        });

        return { ...section, numbers };
      })
      .filter((section) => section.numbers.length > 0);
  }, [activeFilter, counts, query]);

  const updateSticker = async (sectionId, number, direction) => {
    const key = getStickerKey(sectionId, number);

    if (direction < 0 && (counts[key] ?? 0) === 0) return;

    setCounts((current) => applyCountDelta(current, key, direction));
    setSyncStatus({ state: "saving", label: "Guardando" });

    try {
      const data = await apiRequest(`/api/stickers/${encodeURIComponent(key)}/adjust`, {
        method: "POST",
        body: JSON.stringify({ delta: direction }),
      });
      setCounts((current) => applyServerCount(current, key, data.count));
      setSyncStatus({ state: "synced", label: "MySQL activo" });
    } catch (error) {
      console.error(error);
      setSyncStatus({ state: "error", label: "Sin conexion" });
      loadRemoteCounts({ silent: true });
    }
  };

  const resetAlbum = async () => {
    const confirmed = window.confirm("Borrar todas las marcas del album?");
    if (!confirmed) return;

    setCounts({});
    setSyncStatus({ state: "saving", label: "Guardando" });

    try {
      await apiRequest("/api/stickers", { method: "DELETE" });
      setSyncStatus({ state: "synced", label: "MySQL activo" });
    } catch (error) {
      console.error(error);
      setSyncStatus({ state: "error", label: "Sin conexion" });
      loadRemoteCounts({ silent: true });
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="hero-mark" aria-hidden="true">
            <Trophy size={24} />
          </div>
          <p className="eyebrow">Album Mundial</p>
          <h1>USA MEX CAN 2026</h1>
          <div className="host-strip" aria-label="Sedes">
            <span>USA</span>
            <span>MEX</span>
            <span>CAN</span>
          </div>
          <div className={`sync-pill ${syncStatus.state}`} aria-live="polite">
            <span aria-hidden="true" />
            {syncStatus.label}
          </div>
        </div>

        <button className="icon-button" type="button" onClick={resetAlbum} title="Borrar marcas" aria-label="Borrar marcas">
          <RotateCcw size={20} />
        </button>
      </header>

      <section className="summary-panel" aria-label="Resumen del album">
        <div className="progress-heading">
          <span>{stats.progress}% completo</span>
          <strong>
            {stats.owned}/{totalStickers}
          </strong>
        </div>
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${stats.progress}%` }} />
        </div>

        <div className="stat-grid">
          <article className="stat-owned">
            <span>Tengo</span>
            <strong>{stats.owned}</strong>
          </article>
          <article className="stat-missing">
            <span>Faltan</span>
            <strong>{stats.missing}</strong>
          </article>
          <article className="stat-duplicates">
            <span>Repetidas</span>
            <strong>{stats.duplicates}</strong>
          </article>
          <article className="stat-copies">
            <span>Copias</span>
            <strong>{stats.totalCopies}</strong>
          </article>
        </div>
      </section>

      <section className="controls" aria-label="Filtros">
        <label className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar"
            autoComplete="off"
          />
        </label>

        <div className="filter-tabs" role="tablist" aria-label="Estado">
          {filters.map((filter) => {
            const Icon = filter.icon;
            return (
              <button
                className={activeFilter === filter.id ? "active" : ""}
                key={filter.id}
                type="button"
                onClick={() => setActiveFilter(filter.id)}
                title={filter.label}
                aria-pressed={activeFilter === filter.id}
              >
                <Icon size={17} />
                <span>{filter.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="album-list" aria-label="Listado de figuritas">
        {filteredSections.map((section, index) => (
          <StickerSection
            counts={counts}
            key={section.id}
            onUpdate={updateSticker}
            section={section}
            accent={sectionAccents[index % sectionAccents.length]}
          />
        ))}

        {filteredSections.length === 0 && (
          <div className="empty-state">
            <strong>Sin resultados</strong>
            <span>Ajusta la busqueda o cambia el filtro.</span>
          </div>
        )}
      </section>
    </main>
  );
}

function StickerSection({ accent, counts, onUpdate, section }) {
  const sectionStats = section.numbers.reduce(
    (accumulator, number) => {
      const count = counts[getStickerKey(section.id, number)] ?? 0;
      if (count > 0) accumulator.owned += 1;
      if (count === 0) accumulator.missing += 1;
      if (count > 1) accumulator.duplicates += count - 1;
      return accumulator;
    },
    { owned: 0, missing: 0, duplicates: 0 },
  );

  return (
    <article className="section-card" style={{ "--section-accent": accent }}>
      <div className="section-heading">
        <div>
          <div className="section-title">
            <span>{section.code}</span>
            <strong>{section.name}</strong>
          </div>
          <p>{section.kind}</p>
        </div>

        <div className="section-counts" aria-label={`Resumen ${section.code} ${section.name}`}>
          <span>{sectionStats.owned} tengo</span>
          <span>{sectionStats.missing} faltan</span>
          {sectionStats.duplicates > 0 && <span>{sectionStats.duplicates} rep.</span>}
        </div>
      </div>

      <div className="sticker-grid">
        {section.numbers.map((number) => {
          const count = counts[getStickerKey(section.id, number)] ?? 0;
          const status = getStatus(count);

          return (
            <div className={`sticker-tile ${status}`} key={number}>
              <div className="sticker-main">
                <span className="sticker-number">{number}</span>
                <span className="sticker-state">
                  {count === 0 ? "Falta" : count === 1 ? "Tengo" : `x${count}`}
                </span>
              </div>

              <div className="stepper">
                <button
                  type="button"
                  onClick={() => onUpdate(section.id, number, -1)}
                  title={`Restar ${section.code} ${number}`}
                  aria-label={`Restar ${section.code} ${number}`}
                  disabled={count === 0}
                >
                  <Minus size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate(section.id, number, 1)}
                  title={`Sumar ${section.code} ${number}`}
                  aria-label={`Sumar ${section.code} ${number}`}
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export default App;
