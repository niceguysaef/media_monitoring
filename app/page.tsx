"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Gauge,
  Globe2,
  Hash,
  Link2,
  LockKeyhole,
  LogOut,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

type Project = { id: string; name: string };
type View = "briefing" | "mentions" | "sources" | "topics" | "settings";
type FeatureStatus = "ready" | "empty" | "unavailable";

type DailyMetric = {
  date: string;
  mentions: number;
  reach: number;
  sentiment: { positive: number; neutral: number; negative: number };
  engagement: { likes: number; comments: number; shares: number };
  sources: { source: string; mentions: number; reach: number }[];
};

type Briefing = {
  project: Project;
  dateRange: { from: string; to: string; days: number };
  metrics: {
    days: DailyMetric[];
    totals: {
      mentions: number;
      reach: number;
      sentiment: { positive: number; neutral: number; negative: number };
      engagement: { likes: number; comments: number; shares: number };
    };
    sources: { source: string; mentions: number; reach: number }[];
  };
  comparison?: {
    status: FeatureStatus;
    dateRange: { from: string; to: string };
    changes: {
      mentions?: number | null;
      reach?: number | null;
      engagement?: number | null;
      negativeSharePoints?: number | null;
    };
  };
  summary: { status: FeatureStatus; text: string };
  events: {
    status: FeatureStatus;
    items: { date: string; description: string; mentions: number; reach: number }[];
  };
  topics: {
    status: FeatureStatus;
    items: {
      id: string;
      name: string;
      description: string;
      mentions: number;
      reach: number;
      sentiment: { positive?: number; neutral?: number; negative?: number };
      shareOfVoice: number;
    }[];
  };
  insights: { status: FeatureStatus; items: { title: string; text: string }[] };
  coverage: { status: FeatureStatus; items: Mention[] };
  warnings: { feature: string; status: number; message: string }[];
  cache?: "hit" | "miss";
};

type Mention = {
  id: string;
  date: string;
  time: string;
  title: string | null;
  content: string | null;
  source: string | null;
  sourceUrl: string | null;
  host: string | null;
  category: string;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  tags: string[];
  restricted: boolean;
  restrictionReason: string | null;
};

type MentionFilters = {
  sentiment: string;
  category: string;
};

type SourceIntelligence = {
  project: Project;
  dateRange: { from: string; to: string };
  summary: {
    totalDomains: number;
    totalLinks: number;
    totalAuthors: number;
    peakHour: { day: number; dayName: string; hour: number; mentions: number } | null;
  };
  domains: { status: FeatureStatus; items: { domain: string; mentions: number; reach: number; visits: number; influenceScore: number }[] };
  activeSites: { status: FeatureStatus; items: { domain: string; mentions: number; reach: number }[] };
  links: { status: FeatureStatus; items: { url: string; mentions: number }[] };
  hashtags: { status: FeatureStatus; items: { hashtag: string; mentions: number; reach: number; sentimentScore: number | null }[] };
  authors: { status: FeatureStatus; items: { name: string; url: string | null; followers: number; mentions: number; reach: number }[] };
  hotHours: { status: FeatureStatus; items: { day: number; dayName: string; hour: number; mentions: number }[] };
  warnings: { feature: string; status: number; message: string }[];
  cache?: "hit" | "miss";
};

type Topic = {
  id: string;
  name: string;
  description: string;
  mentions: number;
  reach: number;
  shareOfVoice: number;
  dominantSentiment: "positive" | "neutral" | "negative";
  sentiment: { positive: number; neutral: number; negative: number };
};

type TopicIntelligence = {
  project: Project;
  dateRange: { from: string; to: string };
  status: FeatureStatus;
  summary: {
    topicCount: number;
    topicMentions: number;
    topicReach: number;
    leadingTopic: string | null;
    mostNegativeTopic: string | null;
  };
  items: Topic[];
  cache?: "hit" | "miss";
};

type TopicSort = "shareOfVoice" | "mentions" | "reach" | "negative";
type SelectOption = { value: string; label: string };

const EXPORT_SECTIONS = [
  { id: "overview", label: "Overview & charts" },
  { id: "daily", label: "Daily metrics" },
  { id: "mentions", label: "Raw mentions" },
  { id: "sources", label: "Sources & domains" },
  { id: "topics", label: "Topics" },
  { id: "authors", label: "Authors" },
  { id: "links", label: "Trending links" },
  { id: "hashtags", label: "Hashtags" },
] as const;

// Local development sets this to http://localhost:8000. In production, leave
// it unset so requests use the app's own origin and DigitalOcean routes /api.
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

function dateInputValue(daysAgo = 0) {
  const value = new Date();
  value.setDate(value.getDate() - daysAgo);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialMentionFilters(): MentionFilters {
  return { sentiment: "", category: "" };
}

function comparisonText(value: number | null | undefined, unit = "%") {
  if (value === null || value === undefined) return "No previous baseline";
  if (value === 0) return `No change vs previous period`;
  return `${value > 0 ? "Up" : "Down"} ${Math.abs(value).toFixed(1)}${unit} vs previous period`;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en", {
    notation: Math.abs(value) > 9999 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function displayHost(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return value; }
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);
  return payload?.detail ?? fallback;
}

function MetricCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className="metric-icon">{icon}</span><p>{label}</p></div>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function BarChart({ data }: { data: DailyMetric[] }) {
  const max = Math.max(...data.map((item) => item.mentions), 1);
  return (
    <div className="chart-wrap">
      <div className="bar-chart" aria-label="Daily mention volume">
        {data.map((item) => (
          <div className="bar-column" key={item.date} tabIndex={0} role="img" aria-label={`${formatDate(item.date)}: ${item.mentions.toLocaleString()} mentions`}>
            <div className="bar-fill" style={{ height: `${Math.max((item.mentions / max) * 100, 4)}%` }}>
              <span className="bar-tooltip" aria-hidden="true"><small>{formatDate(item.date)}</small><strong>{item.mentions.toLocaleString()}</strong><small>mentions</small></span>
            </div>
          </div>
        ))}
      </div>
      <div className="chart-axis"><span>{data[0] ? formatDate(data[0].date) : ""}</span><span>{data.at(-1) ? formatDate(data.at(-1)!.date) : ""}</span></div>
    </div>
  );
}

function SentimentBreakdown({ totals }: { totals: Briefing["metrics"]["totals"]["sentiment"] }) {
  const total = totals.positive + totals.neutral + totals.negative;
  const items = [
    { key: "positive", label: "Positive", value: totals.positive },
    { key: "neutral", label: "Neutral", value: totals.neutral },
    { key: "negative", label: "Negative", value: totals.negative },
  ];
  return (
    <div className="sentiment-breakdown">
      <div className="sentiment-track sentiment-total">
        {items.map((item) => <i className={item.key} key={item.key} style={{ width: `${total ? (item.value / total) * 100 : 0}%` }} />)}
      </div>
      {items.map((item) => (
        <div className="sentiment-stat" key={item.key}>
          <span><i className={item.key} />{item.label}</span>
          <strong>{total ? ((item.value / total) * 100).toFixed(1) : "0.0"}%</strong>
          <small>{compactNumber(item.value)} mentions</small>
        </div>
      ))}
    </div>
  );
}

function FeatureEmpty({ status, label }: { status: FeatureStatus; label: string }) {
  return (
    <div className="feature-empty">
      <span>{status === "unavailable" ? "Not available yet" : "Nothing detected"}</span>
      <p>{status === "unavailable" ? `${label} is still being prepared by the monitoring service.` : `No ${label.toLowerCase()} were found for this period.`}</p>
    </div>
  );
}

function Skeleton({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? "skeleton skeleton-compact" : "skeleton tall"} />;
}

function CustomSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className = "",
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex] ?? { value: "", label: "Select an option" };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, selectedIndex]);

  function focusOption(index: number) {
    const nextIndex = (index + options.length) % options.length;
    optionRefs.current[nextIndex]?.focus();
  }

  function close(returnFocus = false) {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div className={`custom-select-field ${className}`.trim()} ref={rootRef}>
      <span className="custom-select-label" id={`${id}-label`}>{label}</span>
      <div className={`custom-select ${open ? "open" : ""}`}>
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : `${id}-label ${id}-value`}
          aria-controls={`${id}-menu`}
          className="custom-select-trigger"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
            }
            if (event.key === "Escape") close();
          }}
          ref={triggerRef}
          type="button"
        >
          <span id={`${id}-value`}>{selected.label}</span>
          <ChevronDown aria-hidden="true" size={16} />
        </button>
        {open ? (
          <div className="custom-select-menu" id={`${id}-menu`} role="listbox" aria-labelledby={`${id}-label`}>
            {options.map((option, index) => (
              <button
                aria-selected={option.value === value}
                className={option.value === value ? "selected" : ""}
                key={option.value}
                onClick={() => { onChange(option.value); close(true); }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") { event.preventDefault(); focusOption(index + 1); }
                  if (event.key === "ArrowUp") { event.preventDefault(); focusOption(index - 1); }
                  if (event.key === "Home") { event.preventDefault(); focusOption(0); }
                  if (event.key === "End") { event.preventDefault(); focusOption(options.length - 1); }
                  if (event.key === "Escape") { event.preventDefault(); close(true); }
                  if (event.key === "Tab") close();
                }}
                ref={(element) => { optionRefs.current[index] = element; }}
                role="option"
                type="button"
              >
                <span className="custom-select-check">{option.value === value ? <Check aria-hidden="true" size={15} /> : null}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function Home() {
  const [authState, setAuthState] = useState<"checking" | "required" | "authenticated">("checking");
  const [trialAccessRequired, setTrialAccessRequired] = useState(false);
  const [accessPassword, setAccessPassword] = useState("");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessSubmitting, setAccessSubmitting] = useState(false);
  const [view, setView] = useState<View>("briefing");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [days, setDays] = useState(7);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingRefresh, setBriefingRefresh] = useState(0);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mentionCategories, setMentionCategories] = useState<string[]>([]);
  const [mentionDraft, setMentionDraft] = useState<MentionFilters>(initialMentionFilters);
  const [mentionFilters, setMentionFilters] = useState<MentionFilters>(initialMentionFilters);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionsCursor, setMentionsCursor] = useState<string | null>(null);
  const [mentionsHasMore, setMentionsHasMore] = useState(false);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [mentionsLoadingMore, setMentionsLoadingMore] = useState(false);
  const [mentionsError, setMentionsError] = useState<string | null>(null);
  const [sourceData, setSourceData] = useState<SourceIntelligence | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [domainSearch, setDomainSearch] = useState("");
  const [topicData, setTopicData] = useState<TopicIntelligence | null>(null);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [topicSearch, setTopicSearch] = useState("");
  const [topicSort, setTopicSort] = useState<TopicSort>("shareOfVoice");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportLanguage, setExportLanguage] = useState("en");
  const [exportFormat, setExportFormat] = useState<"xlsx" | "pptx" | "pdf">("xlsx");
  const [exportTitle, setExportTitle] = useState("");
  const [exportOrganization, setExportOrganization] = useState("");
  const [exportSections, setExportSections] = useState<string[]>(() => EXPORT_SECTIONS.map((section) => section.id));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportPreferencesReady, setExportPreferencesReady] = useState(false);
  const reportingPeriod = useMemo(() => ({ from: dateInputValue(days - 1), to: dateInputValue() }), [days]);

  const apiFetch = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const response = await fetch(input, { ...init, credentials: "include" });
    if (response.status === 401) {
      setAuthState("required");
      throw new Error("Your trial session has expired. Enter the access password again.");
    }
    return response;
  }, []);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/auth/status`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Could not verify trial access."));
        return response.json();
      })
      .then((payload) => {
        setTrialAccessRequired(Boolean(payload.required));
        setAuthState(payload.authenticated ? "authenticated" : "required");
      })
      .catch((requestError) => {
        setAccessError(requestError instanceof Error ? requestError.message : "Could not verify trial access.");
        setAuthState("required");
      });
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("zestar-export-preferences") ?? "null");
      if (stored && typeof stored === "object") {
        if (["en", "ms"].includes(stored.language)) setExportLanguage(stored.language);
        if (["xlsx", "pptx", "pdf"].includes(stored.format)) setExportFormat(stored.format);
        if (typeof stored.title === "string") setExportTitle(stored.title.slice(0, 120));
        if (typeof stored.organization === "string") setExportOrganization(stored.organization.slice(0, 120));
        const allowedSections = new Set(EXPORT_SECTIONS.map((section) => section.id));
        const storedSections = Array.isArray(stored.sections)
          ? stored.sections.filter((section: unknown): section is string => typeof section === "string" && allowedSections.has(section as typeof EXPORT_SECTIONS[number]["id"]))
          : [];
        if (storedSections.length) setExportSections(storedSections);
      }
    } catch {
      window.localStorage.removeItem("zestar-export-preferences");
    } finally {
      setExportPreferencesReady(true);
    }
  }, []);

  useEffect(() => {
    if (!exportPreferencesReady) return;
    window.localStorage.setItem("zestar-export-preferences", JSON.stringify({
      language: exportLanguage,
      format: exportFormat,
      title: exportTitle,
      organization: exportOrganization,
      sections: exportSections,
    }));
  }, [exportFormat, exportLanguage, exportOrganization, exportPreferencesReady, exportSections, exportTitle]);

  const loadProjects = useCallback(async (refresh = false, preferredProjectId?: string) => {
    setProjectsLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/projects${refresh ? "?refresh=true" : ""}`);
      if (!response.ok) throw new Error(await responseError(response, `Project sync failed: ${response.status}`));
      const payload = await response.json();
      const nextProjects = (payload.projects ?? []) as Project[];
      setProjects(nextProjects);
      setSelectedProjectId((current) => {
        if (preferredProjectId && nextProjects.some((project) => project.id === preferredProjectId)) return preferredProjectId;
        if (nextProjects.some((project) => project.id === current)) return current;
        return nextProjects[0]?.id ?? "";
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not synchronize projects.");
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { if (authState === "authenticated") void loadProjects(); }, [authState, loadProjects]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    apiFetch(`${API_BASE_URL}/api/reference/mention-categories`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Could not load mention categories."));
        return response.json();
      })
      .then((payload) => setMentionCategories(payload.categories ?? []))
      .catch(() => setMentionCategories([]));
  }, [apiFetch, authState]);

  useEffect(() => {
    if (authState !== "authenticated" || !selectedProjectId) { setBriefing(null); return; }
    const controller = new AbortController();
    setBriefingLoading(true);
    setError(null);
    const params = new URLSearchParams({ date_from: reportingPeriod.from, date_to: reportingPeriod.to });
    apiFetch(`${API_BASE_URL}/api/projects/${selectedProjectId}/briefing?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, `Briefing failed: ${response.status}`));
        return response.json();
      })
      .then(setBriefing)
      .catch((requestError) => {
        if (requestError.name !== "AbortError") {
          setError(requestError instanceof Error ? requestError.message : "Could not load the project briefing.");
          setBriefing(null);
        }
      })
      .finally(() => setBriefingLoading(false));
    return () => controller.abort();
  }, [apiFetch, authState, briefingRefresh, reportingPeriod, selectedProjectId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setAnalysisOpen(false); setExportOpen(false); } };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const loadMentions = useCallback(async (append = false, cursor?: string | null) => {
    if (!selectedProjectId) return;
    append ? setMentionsLoadingMore(true) : setMentionsLoading(true);
    setMentionsError(null);
    try {
      const params = new URLSearchParams({
        date_from: reportingPeriod.from,
        date_to: reportingPeriod.to,
        limit: "25",
      });
      if (mentionFilters.sentiment) params.set("sentiment", mentionFilters.sentiment);
      if (mentionFilters.category) params.set("category", mentionFilters.category);
      if (cursor) params.set("cursor", cursor);
      const response = await apiFetch(`${API_BASE_URL}/api/projects/${selectedProjectId}/mentions?${params.toString()}`);
      if (!response.ok) throw new Error(await responseError(response, `Mentions request failed: ${response.status}`));
      const payload = await response.json();
      const nextItems = (payload.items ?? []) as Mention[];
      setMentions((current) => {
        if (!append) return nextItems;
        return Array.from(new Map([...current, ...nextItems].map((item) => [item.id, item])).values());
      });
      setMentionsCursor(payload.pagination?.cursor ?? null);
      setMentionsHasMore(Boolean(payload.pagination?.hasMore));
    } catch (requestError) {
      setMentionsError(requestError instanceof Error ? requestError.message : "Could not load mentions.");
      if (!append) setMentions([]);
    } finally {
      append ? setMentionsLoadingMore(false) : setMentionsLoading(false);
    }
  }, [apiFetch, mentionFilters, reportingPeriod, selectedProjectId]);

  useEffect(() => {
    if (view === "mentions" && selectedProjectId) void loadMentions(false);
  }, [loadMentions, selectedProjectId, view]);

  const loadSources = useCallback(async () => {
    if (!selectedProjectId) return;
    setSourcesLoading(true);
    setSourcesError(null);
    setSourceData(null);
    try {
      const params = new URLSearchParams({ date_from: reportingPeriod.from, date_to: reportingPeriod.to });
      const response = await apiFetch(`${API_BASE_URL}/api/projects/${selectedProjectId}/sources?${params.toString()}`);
      if (!response.ok) throw new Error(await responseError(response, `Sources request failed: ${response.status}`));
      setSourceData(await response.json());
    } catch (requestError) {
      setSourcesError(requestError instanceof Error ? requestError.message : "Could not load source intelligence.");
      setSourceData(null);
    } finally {
      setSourcesLoading(false);
    }
  }, [apiFetch, reportingPeriod, selectedProjectId]);

  useEffect(() => {
    if (view === "sources" && selectedProjectId) void loadSources();
  }, [loadSources, selectedProjectId, view]);

  const loadTopics = useCallback(async () => {
    if (!selectedProjectId) return;
    setTopicsLoading(true);
    setTopicsError(null);
    setTopicData(null);
    try {
      const params = new URLSearchParams({ date_from: reportingPeriod.from, date_to: reportingPeriod.to });
      const response = await apiFetch(`${API_BASE_URL}/api/projects/${selectedProjectId}/topics?${params.toString()}`);
      if (!response.ok) throw new Error(await responseError(response, `Topics request failed: ${response.status}`));
      setTopicData(await response.json());
    } catch (requestError) {
      setTopicsError(requestError instanceof Error ? requestError.message : "Could not load topic intelligence.");
      setTopicData(null);
    } finally {
      setTopicsLoading(false);
    }
  }, [apiFetch, reportingPeriod, selectedProjectId]);

  useEffect(() => {
    if (view === "topics" && selectedProjectId) void loadTopics();
  }, [loadTopics, selectedProjectId, view]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const totals = briefing?.metrics.totals;
  const totalEngagement = totals ? totals.engagement.likes + totals.engagement.comments + totals.engagement.shares : 0;
  const comparisonChanges = briefing?.comparison?.status === "ready" ? briefing.comparison.changes : null;
  const peakDay = useMemo(() => {
    const metrics = briefing?.metrics.days ?? [];
    return metrics.length
      ? metrics.reduce((peak, item) => item.mentions > peak.mentions ? item : peak, metrics[0])
      : null;
  }, [briefing]);
  const leadingSource = briefing?.metrics.sources[0] ?? null;
  const negativeShare = useMemo(() => {
    if (!totals) return 0;
    const total = totals.sentiment.positive + totals.sentiment.neutral + totals.sentiment.negative;
    return total ? (totals.sentiment.negative / total) * 100 : 0;
  }, [totals]);
  const visibleDomains = useMemo(() => {
    const query = domainSearch.trim().toLowerCase();
    const domains = sourceData?.domains.items ?? [];
    return query ? domains.filter((item) => item.domain.toLowerCase().includes(query)) : domains;
  }, [domainSearch, sourceData]);
  const visibleTopics = useMemo(() => {
    const query = topicSearch.trim().toLowerCase();
    const topics = query
      ? (topicData?.items ?? []).filter((topic) => `${topic.name} ${topic.description}`.toLowerCase().includes(query))
      : [...(topicData?.items ?? [])];
    return topics.sort((left, right) => {
      if (topicSort === "negative") return right.sentiment.negative - left.sentiment.negative;
      return right[topicSort] - left[topicSort];
    });
  }, [topicData, topicSearch, topicSort]);

  function applyMentionFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMentions([]);
    setMentionsCursor(null);
    setMentionsHasMore(false);
    setMentionFilters({ ...mentionDraft });
  }

  function resetMentionFilters() {
    const defaults = initialMentionFilters();
    setMentionDraft(defaults);
    setMentions([]);
    setMentionsCursor(null);
    setMentionsHasMore(false);
    setMentionFilters(defaults);
  }

  function toggleExportSection(section: string) {
    setExportSections((current) => current.includes(section) ? current.filter((item) => item !== section) : [...current, section]);
  }

  async function submitTrialAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccessSubmitting(true);
    setAccessError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: accessPassword }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not unlock the trial."));
      setAccessPassword("");
      setAuthState("authenticated");
    } catch (requestError) {
      setAccessError(requestError instanceof Error ? requestError.message : "Could not unlock the trial.");
    } finally {
      setAccessSubmitting(false);
    }
  }

  async function signOut() {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
    } finally {
      setProjects([]);
      setSelectedProjectId("");
      setBriefing(null);
      setAuthState("required");
    }
  }

  async function downloadExport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId || !exportSections.length) return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/projects/${selectedProjectId}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFrom: reportingPeriod.from,
          dateTo: reportingPeriod.to,
          format: exportFormat,
          language: exportLanguage,
          reportTitle: exportTitle.trim() || null,
          organization: exportOrganization.trim() || null,
          sections: exportSections,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, `Export failed: ${response.status}`));
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? `${selectedProject?.name ?? "media-monitor"}-export.${exportFormat}`;
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      setExportOpen(false);
    } catch (requestError) {
      setExportError(requestError instanceof Error ? requestError.message : "Could not generate the export.");
    } finally {
      setExporting(false);
    }
  }

  if (authState === "checking") {
    return <main className="access-shell"><section className="access-card access-loading" aria-live="polite"><div className="access-brand"><span>Z</span><strong>Zestar</strong></div><span className="access-spinner" /><p>Securing your workspace…</p></section></main>;
  }

  if (authState === "required") {
    return <main className="access-shell"><form className="access-card" onSubmit={submitTrialAccess}>
      <div className="access-brand"><span>Z</span><strong>Zestar</strong></div>
      <div className="access-icon"><LockKeyhole size={24} /></div>
      <p className="eyebrow">Private client preview</p>
      <h1>Welcome to your media intelligence workspace</h1>
      <p className="access-intro">Enter the shared trial password to continue.</p>
      <label>Access password<input autoComplete="current-password" autoFocus type="password" value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} placeholder="Enter password" required maxLength={256} /></label>
      {accessError ? <div className="error-state access-error">{accessError}</div> : null}
      <button className="primary-action" disabled={accessSubmitting || !accessPassword} type="submit">{accessSubmitting ? "Checking…" : "Unlock workspace"}</button>
      <small>Access is limited to invited trial participants.</small>
    </form></main>;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark"><span>Z</span><div><strong>Zestar</strong><p>Media intelligence</p></div></div>
        <div className="nav-label">Workspace</div>
        <nav className="main-nav">
          <button className={view === "briefing" ? "active" : ""} onClick={() => setView("briefing")} type="button"><Gauge size={18} /><span>Briefing</span></button>
          <button className={view === "mentions" ? "active" : ""} onClick={() => setView("mentions")} type="button"><FileSearch size={18} /><span>Mentions</span></button>
          <button className={view === "sources" ? "active" : ""} onClick={() => setView("sources")} type="button"><Globe2 size={18} /><span>Sources</span></button>
          <button className={view === "topics" ? "active" : ""} onClick={() => setView("topics")} type="button"><Hash size={18} /><span>Topics</span></button>
        </nav>
        <div className="sidebar-spacer" />
        <nav className="main-nav">
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")} type="button"><Settings2 size={18} /><span>Projects</span></button>
        </nav>
        <div className="connection-card"><span className="status live" /><div><strong>Data connected</strong><small>{projects.length} synchronized project{projects.length === 1 ? "" : "s"}</small></div></div>
        {trialAccessRequired ? <button className="sign-out-button" type="button" onClick={() => void signOut()}><LogOut size={15} /><span>Sign out</span></button> : null}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{view === "briefing" ? "Intelligence briefing" : view === "mentions" ? "Evidence explorer" : view === "sources" ? "Source intelligence" : view === "topics" ? "Topic intelligence" : "Project directory"}</p>
            <h1>{view === "settings" ? "Projects" : selectedProject?.name ?? "Select a project"}</h1>
          </div>
          <div className="project-toolbar">
            <CustomSelect className="project-picker" label="Project" ariaLabel="Monitoring project" disabled={projectsLoading || !projects.length} value={selectedProjectId} onChange={setSelectedProjectId} options={projects.length ? projects.map((project) => ({ value: project.id, label: project.name })) : [{ value: "", label: "No projects" }]} />
            {view !== "settings" ? <CustomSelect className="project-picker period-picker" label="Reporting period" value={String(days)} onChange={(value) => setDays(Number(value))} options={[{ value: "7", label: "Last 7 days" }, { value: "14", label: "Last 14 days" }, { value: "30", label: "Last 30 days" }]} /> : null}
            <button className="export-button" type="button" disabled={!selectedProjectId} onClick={() => { setExportError(null); setExportOpen(true); }}><Download size={16} /> Export</button>
            <button className="icon-button" type="button" onClick={() => void loadProjects(true)} aria-label="Synchronize projects" title="Synchronize projects"><RefreshCw size={18} /></button>
          </div>
        </header>

        {error ? <div className="error-state mention-error">{error}<button type="button" onClick={() => { setError(null); selectedProjectId ? setBriefingRefresh((value) => value + 1) : void loadProjects(true); }}>Try again</button></div> : null}

        {view === "briefing" ? (
          <>
            <div className="context-strip"><span className="status live" /><span>Live monitoring data</span><i />{briefing ? <span>{formatDate(briefing.dateRange.from)} – {formatDate(briefing.dateRange.to)}</span> : <span>Loading reporting period</span>}{briefing?.cache === "hit" ? <><i /><span>Cached response</span></> : null}</div>

            {!selectedProject && !projectsLoading ? <section className="empty-project-state"><Radio size={30} /><h2>No monitoring projects</h2><p>No projects are currently available in the connected monitoring account.</p><button className="primary-action inline-action" onClick={() => void loadProjects(true)} type="button">Synchronize projects</button></section> : null}

            <section className="metric-grid">
              <MetricCard label="Mentions" value={compactNumber(totals?.mentions ?? 0)} detail={comparisonChanges ? comparisonText(comparisonChanges.mentions) : `Across ${days} days`} icon={<Radio size={18} />} />
              <MetricCard label="Estimated reach" value={compactNumber(totals?.reach ?? 0)} detail={comparisonChanges ? comparisonText(comparisonChanges.reach) : "Potential audience"} icon={<TrendingUp size={18} />} />
              <MetricCard label="Engagement" value={compactNumber(totalEngagement)} detail={comparisonChanges ? comparisonText(comparisonChanges.engagement) : "Likes, comments & shares"} icon={<Users size={18} />} />
              <MetricCard label="Negative share" value={`${negativeShare.toFixed(1)}%`} detail={comparisonChanges ? comparisonText(comparisonChanges.negativeSharePoints, " pts") : `${compactNumber(totals?.sentiment.negative ?? 0)} mentions`} icon={<Activity size={18} />} />
            </section>

            <section className="briefing-highlights" aria-label="Period highlights">
              <article><CalendarDays size={16} /><span><small>Peak activity</small><strong>{peakDay ? formatDate(peakDay.date) : "—"}</strong></span><b>{peakDay ? `${compactNumber(peakDay.mentions)} mentions` : "No activity"}</b></article>
              <article><Globe2 size={16} /><span><small>Leading source</small><strong>{leadingSource?.source ?? "—"}</strong></span><b>{leadingSource ? `${compactNumber(leadingSource.mentions)} mentions` : "No source data"}</b></article>
              <article><Activity size={16} /><span><small>Compared with</small><strong>{briefing?.comparison ? `${formatDate(briefing.comparison.dateRange.from)} – ${formatDate(briefing.comparison.dateRange.to)}` : "Previous period"}</strong></span><b>{briefing?.comparison?.status === "ready" ? "Comparison ready" : "Baseline unavailable"}</b></article>
            </section>

            <section className="briefing-grid">
              <article className="panel executive-panel">
                <div className="panel-heading"><div><p>AI intelligence</p><h2>Executive readout</h2></div><BrainCircuit size={20} /></div>
                {briefingLoading || !briefing ? <Skeleton compact /> : briefing.summary.status === "ready" ? <>
                  <p className="summary-preview">{briefing.summary.text}</p>
                  <div className="summary-actions"><button className="text-button" onClick={() => setAnalysisOpen(true)} type="button">Read full analysis <ChevronRight size={16} /></button><span>{briefing.insights.items.length} supporting sections</span></div>
                </> : <FeatureEmpty status={briefing.summary.status} label="AI summary" />}
              </article>

              <article className="panel activity-panel">
                <div className="panel-heading"><div><p>Conversation volume</p><h2>Daily activity</h2></div><BarChart3 size={20} /></div>
                {briefingLoading || !briefing ? <Skeleton /> : <BarChart data={briefing.metrics.days} />}
              </article>

              <article className="panel sentiment-panel">
                <div className="panel-heading"><div><p>Conversation tone</p><h2>Sentiment mix</h2></div><Activity size={20} /></div>
                {briefingLoading || !totals ? <Skeleton /> : <SentimentBreakdown totals={totals.sentiment} />}
              </article>

              <article className="panel sources-panel">
                <div className="panel-heading"><div><p>Channel performance</p><h2>Leading sources</h2></div><Globe2 size={20} /></div>
                {briefingLoading || !briefing ? <Skeleton /> : briefing.metrics.sources.length ? <div className="ranked-list">{briefing.metrics.sources.slice(0, 5).map((source, index) => <div className="ranked-row" key={source.source}><em>{index + 1}</em><span><strong>{source.source}</strong><small>{compactNumber(source.reach)} reach</small></span><b>{compactNumber(source.mentions)}</b></div>)}</div> : <FeatureEmpty status="empty" label="Sources" />}
              </article>

              <article className="panel topics-panel">
                <div className="panel-heading"><div><p>Conversation themes</p><h2>Top topics</h2></div><Hash size={20} /></div>
                {briefingLoading || !briefing ? <Skeleton /> : briefing.topics.items.length ? <div className="topic-list">{briefing.topics.items.slice(0, 5).map((topic) => <div className="topic-row" key={topic.id}><div><strong>{topic.name}</strong><span>{topic.description}</span></div><b>{topic.shareOfVoice.toFixed(1)}%</b></div>)}</div> : <FeatureEmpty status={briefing.topics.status} label="Topics" />}
              </article>

              <article className="panel events-panel">
                <div className="panel-heading"><div><p>Attention shifts</p><h2>Detected events</h2></div><CalendarDays size={20} /></div>
                {briefingLoading || !briefing ? <Skeleton compact /> : briefing.events.items.length ? <div className="event-list">{briefing.events.items.slice(0, 3).map((event) => <div className="event-row" key={`${event.date}-${event.description}`}><time>{formatDate(event.date)}</time><div><strong>{event.description}</strong><span>{compactNumber(event.mentions)} peak mentions · {compactNumber(event.reach)} reach</span></div></div>)}</div> : <FeatureEmpty status={briefing.events.status} label="Events" />}
              </article>

              <article className="panel coverage-panel">
                <div className="panel-heading"><div><p>Evidence snapshot</p><h2>Notable coverage</h2></div><FileSearch size={20} /></div>
                {briefingLoading || !briefing ? <Skeleton compact /> : briefing.coverage?.items.length ? <div className="coverage-grid">{briefing.coverage.items.slice(0, 3).map((mention) => <article className="coverage-card" key={mention.id}>
                  <div className="coverage-meta"><span className={`sentiment-badge ${mention.sentiment}`}>{mention.sentiment}</span><time>{formatDate(mention.date)}</time></div>
                  <h3>{mention.title || mention.content || "Restricted mention"}</h3>
                  {mention.title && mention.content ? <p>{mention.content}</p> : null}
                  <footer><span>{mention.host || mention.category}</span>{mention.sourceUrl ? <a href={mention.sourceUrl} target="_blank" rel="noreferrer">Open source <ExternalLink size={13} /></a> : <small>Source link unavailable</small>}</footer>
                </article>)}</div> : <FeatureEmpty status={briefing.coverage?.status ?? "empty"} label="Notable coverage" />}
                <p className="coverage-note">Selected from recent available evidence for this period. Items are not ranked by post-level reach.</p>
              </article>
            </section>

            {briefing?.warnings.length ? <div className="warning-strip">Some optional intelligence could not be loaded: {briefing.warnings.map((warning) => warning.feature).join(", ")}.</div> : null}
          </>
        ) : view === "mentions" ? (
          <section className="mentions-workspace">
            <form className="mention-filters" onSubmit={applyMentionFilters}>
              <div className="filter-heading"><div><p className="eyebrow">Filter evidence</p><h2>Collected mentions</h2></div><button className="reset-button" type="button" onClick={resetMentionFilters}><RotateCcw size={15} /> Reset</button></div>
              <div className="filter-grid evidence-filter-grid">
                <CustomSelect label="Sentiment" value={mentionDraft.sentiment} onChange={(value) => setMentionDraft((current) => ({ ...current, sentiment: value }))} options={[{ value: "", label: "All sentiment" }, { value: "positive", label: "Positive" }, { value: "neutral", label: "Neutral" }, { value: "negative", label: "Negative" }]} />
                <CustomSelect label="Source" value={mentionDraft.category} onChange={(value) => setMentionDraft((current) => ({ ...current, category: value }))} options={[{ value: "", label: "All sources" }, ...mentionCategories.map((category) => ({ value: category, label: category.replaceAll("_", " ") }))]} />
                <button className="filter-action" type="submit">Apply filters</button>
              </div>
            </form>

            <div className="mention-results-heading">
              <div><strong>{mentionsLoading ? "Loading mentions…" : `${mentions.length} mention${mentions.length === 1 ? "" : "s"} loaded`}</strong><span>{formatDate(reportingPeriod.from)} – {formatDate(reportingPeriod.to)}{mentionFilters.sentiment ? ` · ${mentionFilters.sentiment}` : ""}{mentionFilters.category ? ` · ${mentionFilters.category.replaceAll("_", " ")}` : ""}</span></div>
              <span className="live-pill"><i /> Live monitoring data</span>
            </div>

            {mentionsError ? <div className="error-state mention-error">{mentionsError}<button type="button" onClick={() => void loadMentions(false)}>Try again</button></div> : null}

            <div className="mention-list">
              {mentionsLoading ? Array.from({ length: 5 }, (_, index) => <div className="mention-card" key={index}><Skeleton compact /></div>) : null}
              {!mentionsLoading && !mentions.length && !mentionsError ? <div className="mention-empty"><FileSearch size={28} /><strong>No mentions matched these filters</strong><p>Try a wider date range or remove a sentiment or source filter.</p></div> : null}
              {!mentionsLoading ? mentions.map((mention) => (
                <article className={mention.restricted ? "mention-card restricted" : "mention-card"} key={mention.id}>
                  <div className="mention-meta">
                    <span className={`sentiment-badge ${mention.sentiment}`}>{mention.sentiment}</span>
                    <span className="category-badge">{mention.category}</span>
                    <time>{formatDate(mention.date)}{mention.time ? ` · ${mention.time}` : ""}</time>
                  </div>
                  <div className="mention-body">
                    <div>
                      <h3>{mention.title || (mention.restricted ? "Platform-restricted mention" : `${mention.category} mention`)}</h3>
                      {mention.content ? <p>{mention.content}</p> : mention.restricted ? <p className="restriction-copy">{mention.restrictionReason}</p> : <p className="restriction-copy">No text excerpt was supplied by the data source.</p>}
                    </div>
                    <div className="mention-actions">
                      {mention.sourceUrl ? <a href={mention.sourceUrl} target="_blank" rel="noreferrer">Open source <ExternalLink size={14} /></a> : null}
                    </div>
                  </div>
                  <footer>
                    <span><Globe2 size={13} />{mention.host || "Source unavailable"}</span>
                    {mention.source && !mention.sourceUrl ? <code>{mention.source}</code> : null}
                    {mention.tags.length ? <div className="mention-tags">{mention.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                  </footer>
                </article>
              )) : null}
            </div>

            {!mentionsLoading && mentionsHasMore ? <button className="load-more" disabled={mentionsLoadingMore || !mentionsCursor} onClick={() => void loadMentions(true, mentionsCursor)} type="button">{mentionsLoadingMore ? "Loading more…" : "Load more mentions"}</button> : null}
            {!mentionsLoading && mentions.length > 0 && !mentionsHasMore ? <p className="end-of-results">You’ve reached the end of this result set.</p> : null}
          </section>
        ) : view === "sources" ? (
          <section className="sources-workspace">
            {sourcesError ? <div className="error-state mention-error">{sourcesError}<button type="button" onClick={() => void loadSources()}>Try again</button></div> : null}

            <section className="metric-grid source-metrics">
              <MetricCard label="Distinct domains" value={compactNumber(sourceData?.summary.totalDomains ?? 0)} detail="Across monitored coverage" icon={<Globe2 size={18} />} />
              <MetricCard label="Trending links" value={compactNumber(sourceData?.summary.totalLinks ?? 0)} detail="Shared in conversations" icon={<Link2 size={18} />} />
              <MetricCard label="Active authors" value={compactNumber(sourceData?.summary.totalAuthors ?? 0)} detail="Ranked by followers" icon={<Users size={18} />} />
              <MetricCard label="Peak window" value={sourceData?.summary.peakHour ? formatHour(sourceData.summary.peakHour.hour) : "—"} detail={sourceData?.summary.peakHour?.dayName ?? "No peak detected"} icon={<Activity size={18} />} />
            </section>

            <section className="source-intelligence-grid">
              <article className="panel domain-panel">
                <div className="panel-heading domain-heading"><div><p>Domain authority</p><h2>Leading domains</h2></div><label className="table-search"><Search size={14} /><input aria-label="Search domains" value={domainSearch} onChange={(event) => setDomainSearch(event.target.value)} placeholder="Search domains" /></label></div>
                {sourcesLoading || !sourceData ? <Skeleton /> : visibleDomains.length ? <div className="source-table-wrap"><table className="source-table"><thead><tr><th>Domain</th><th>Mentions</th><th>Reach</th><th>Monthly visits</th><th>Influence</th></tr></thead><tbody>{visibleDomains.map((domain) => <tr key={domain.domain}><td><strong>{domain.domain}</strong></td><td>{compactNumber(domain.mentions)}</td><td>{compactNumber(domain.reach)}</td><td>{compactNumber(domain.visits)}</td><td><span className={`influence-score score-${Math.min(10, Math.max(0, domain.influenceScore))}`}>{domain.influenceScore}/10</span></td></tr>)}</tbody></table></div> : <FeatureEmpty status={sourceData.domains.status} label="Domains" />}
              </article>

              <article className="panel hot-hours-panel">
                <div className="panel-heading"><div><p>Publishing rhythm</p><h2>Hot hours</h2></div><Activity size={20} /></div>
                {sourcesLoading || !sourceData ? <Skeleton /> : sourceData.hotHours.items.length ? <div className="hour-list">{sourceData.hotHours.items.slice(0, 10).map((item, index) => { const maximum = sourceData.hotHours.items[0]?.mentions || 1; return <div className="hour-row" key={`${item.day}-${item.hour}`}><span><strong>{item.dayName.slice(0, 3)}</strong><small>{formatHour(item.hour)}</small></span><div><i style={{ width: `${Math.max((item.mentions / maximum) * 100, 3)}%` }} /></div><b>{compactNumber(item.mentions)}</b><em>{index + 1}</em></div>; })}</div> : <FeatureEmpty status={sourceData.hotHours.status} label="Hot hours" />}
              </article>

              <article className="panel links-panel">
                <div className="panel-heading"><div><p>Shared content</p><h2>Trending links</h2></div><Link2 size={20} /></div>
                {sourcesLoading || !sourceData ? <Skeleton /> : sourceData.links.items.length ? <div className="asset-list">{sourceData.links.items.slice(0, 10).map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={link.url}><span><strong>{displayHost(link.url)}</strong><small>{link.url}</small></span><b>{compactNumber(link.mentions)}</b><ExternalLink size={14} /></a>)}</div> : <FeatureEmpty status={sourceData.links.status} label="Trending links" />}
              </article>

              <article className="panel hashtags-panel">
                <div className="panel-heading"><div><p>Social language</p><h2>Trending hashtags</h2></div><Hash size={20} /></div>
                {sourcesLoading || !sourceData ? <Skeleton /> : sourceData.hashtags.items.length ? <div className="hashtag-grid">{sourceData.hashtags.items.slice(0, 16).map((tag) => <div className="hashtag-card" key={tag.hashtag}><strong>{tag.hashtag}</strong><span>{compactNumber(tag.mentions)} mentions</span><small>{compactNumber(tag.reach)} reach{tag.sentimentScore !== null ? ` · ${tag.sentimentScore.toFixed(2)} sentiment` : ""}</small></div>)}</div> : <FeatureEmpty status={sourceData.hashtags.status} label="Hashtags" />}
              </article>

              <article className="panel authors-panel">
                <div className="panel-heading"><div><p>Audience influence</p><h2>Largest authors</h2></div><Users size={20} /></div>
                {sourcesLoading || !sourceData ? <Skeleton /> : sourceData.authors.items.length ? <div className="author-grid">{sourceData.authors.items.slice(0, 12).map((author, index) => <div className="author-card" key={`${author.name}-${author.url ?? index}`}><em>{index + 1}</em><span><strong>{author.name}</strong><small>{compactNumber(author.followers)} followers · {compactNumber(author.reach)} reach</small></span><b>{author.mentions} mention{author.mentions === 1 ? "" : "s"}</b>{author.url ? <a href={author.url} target="_blank" rel="noreferrer" aria-label={`Open ${author.name} profile`}><ExternalLink size={14} /></a> : null}</div>)}</div> : <FeatureEmpty status={sourceData.authors.status} label="Authors" />}
              </article>
            </section>

            {sourceData?.warnings.length ? <div className="warning-strip">Some source intelligence could not be loaded: {sourceData.warnings.map((warning) => warning.feature).join(", ")}.</div> : null}
          </section>
        ) : view === "topics" ? (
          <section className="topics-workspace">
            {topicsError ? <div className="error-state mention-error">{topicsError}<button type="button" onClick={() => void loadTopics()}>Try again</button></div> : null}

            <section className="metric-grid topic-metrics">
              <MetricCard label="Topics detected" value={compactNumber(topicData?.summary.topicCount ?? 0)} detail="AI-grouped conversation themes" icon={<Hash size={18} />} />
              <MetricCard label="Topic mentions" value={compactNumber(topicData?.summary.topicMentions ?? 0)} detail="Mentions assigned across topics" icon={<Radio size={18} />} />
              <MetricCard label="Topic reach" value={compactNumber(topicData?.summary.topicReach ?? 0)} detail="Summed topic-level reach" icon={<TrendingUp size={18} />} />
              <MetricCard label="Leading theme" value={topicData?.summary.leadingTopic ?? "—"} detail="Highest share of voice" icon={<BrainCircuit size={18} />} />
            </section>

            <section className="panel topic-explorer-panel">
              <div className="topic-explorer-heading">
                <div><p className="eyebrow">Theme ranking</p><h2>{topicsLoading ? "Loading topics…" : `${visibleTopics.length} topic${visibleTopics.length === 1 ? "" : "s"}`}</h2></div>
                <div className="topic-tools">
                  <label className="table-search"><Search size={14} /><input aria-label="Search topics" value={topicSearch} onChange={(event) => setTopicSearch(event.target.value)} placeholder="Search topics" /></label>
                  <CustomSelect className="topic-sort" label="Rank by" ariaLabel="Rank topics by" value={topicSort} onChange={(value) => setTopicSort(value as TopicSort)} options={[{ value: "shareOfVoice", label: "Share of voice" }, { value: "mentions", label: "Mentions" }, { value: "reach", label: "Reach" }, { value: "negative", label: "Negative sentiment" }]} />
                </div>
              </div>

              {topicsLoading || !topicData ? <Skeleton /> : topicData.status !== "ready" ? <FeatureEmpty status={topicData.status} label="Topics" /> : !visibleTopics.length ? <div className="mention-empty topic-search-empty"><Search size={26} /><strong>No topics match your search</strong><p>Try a broader name or description.</p></div> : <div className="topic-card-list">
                {visibleTopics.map((topic, index) => {
                  const sentimentTotal = topic.sentiment.positive + topic.sentiment.neutral + topic.sentiment.negative;
                  return <article className="topic-card" key={topic.id}>
                    <div className="topic-rank">{index + 1}</div>
                    <div className="topic-copy"><div className="topic-title-line"><h3>{topic.name}</h3><span className={`sentiment-badge ${topic.dominantSentiment}`}>{topic.dominantSentiment}</span></div><p>{topic.description || "No description was provided for this topic."}</p></div>
                    <div className="topic-stat"><span>Mentions</span><strong>{compactNumber(topic.mentions)}</strong></div>
                    <div className="topic-stat"><span>Reach</span><strong>{compactNumber(topic.reach)}</strong></div>
                    <div className="topic-sov"><div><span>Share of voice</span><strong>{topic.shareOfVoice.toFixed(1)}%</strong></div><i><b style={{ width: `${Math.min(Math.max(topic.shareOfVoice, 0), 100)}%` }} /></i></div>
                    <div className="topic-sentiment"><div className="sentiment-track">{(["positive", "neutral", "negative"] as const).map((label) => <i className={label} key={label} style={{ width: `${sentimentTotal ? (topic.sentiment[label] / sentimentTotal) * 100 : 0}%` }} />)}</div><div>{(["positive", "neutral", "negative"] as const).map((label) => <span key={label}><i className={label} />{label} <b>{topic.sentiment[label].toFixed(1)}%</b></span>)}</div></div>
                  </article>;
                })}
              </div>}

              <p className="topic-method-note">Topics are generated automatically from monitored coverage. They are analytical groups, not editable project keywords.</p>
            </section>
          </section>
        ) : (
          <section className="settings-grid">
            <section className="setup-panel project-directory">
              <div className="panel-heading"><div><p>Available monitoring</p><h2>Synchronized projects</h2></div><button className="icon-button small" type="button" onClick={() => void loadProjects(true)} aria-label="Synchronize projects"><RefreshCw size={16} /></button></div>
              <p className="setup-intro">This application is read-only for project configuration. Create projects and change keywords, languages, regions, or collection settings in the connected monitoring account, then synchronize here.</p>
              <div className="project-list">{projects.map((project) => <button className={project.id === selectedProjectId ? "project-row active" : "project-row"} key={project.id} type="button" onClick={() => { setSelectedProjectId(project.id); setView("briefing"); }}><span><strong>{project.name}</strong><small>Project {project.id}</small></span><ChevronRight size={17} /></button>)}</div>
              {!projects.length ? <FeatureEmpty status="empty" label="Projects" /> : null}
            </section>
          </section>
        )}
      </section>

      {exportOpen ? <div className="analysis-backdrop export-backdrop" role="presentation" onMouseDown={() => { if (!exporting) setExportOpen(false); }}><form className="export-dialog" role="dialog" aria-modal="true" aria-label="Export project data" onSubmit={downloadExport} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">Live monitoring snapshot</p><h2>Export {selectedProject?.name}</h2></div><button className="icon-button small" disabled={exporting} onClick={() => setExportOpen(false)} type="button" aria-label="Close export"><X size={17} /></button></header>
        <div className="export-content">
          <div className="export-callout">{exportFormat === "pdf" ? <FileText size={22} /> : <FileSpreadsheet size={22} />}<div><strong>{exportFormat === "xlsx" ? "Excel workbook" : exportFormat === "pptx" ? "Editable PowerPoint deck" : "Client-ready PDF report"}</strong><p>{exportFormat === "xlsx" ? "A formatted, multi-sheet report containing the selected data and charts." : exportFormat === "pptx" ? "A client-ready presentation with editable charts, text and report branding." : "A polished, printable report with vector charts, evidence links and fixed page layouts."}</p></div></div>
          <div className="export-form-grid">
            <div className="export-period"><span>Reporting period</span><strong>{formatDate(reportingPeriod.from)} – {formatDate(reportingPeriod.to)}</strong></div>
            <CustomSelect label="Language" value={exportLanguage} onChange={setExportLanguage} options={[{ value: "en", label: "English" }, { value: "ms", label: "Bahasa Melayu" }]} />
            <CustomSelect label="Format" value={exportFormat} onChange={(value) => setExportFormat(value as "xlsx" | "pptx" | "pdf")} options={[{ value: "xlsx", label: "Excel (.xlsx)" }, { value: "pptx", label: "PowerPoint (.pptx)" }, { value: "pdf", label: "PDF report (.pdf)" }]} />
          </div>
          <div className="export-form-grid text-fields">
            <label>Report title<input value={exportTitle} onChange={(event) => setExportTitle(event.target.value)} placeholder="Media Intelligence Report" maxLength={120} /></label>
            <label>Organization<input value={exportOrganization} onChange={(event) => setExportOrganization(event.target.value)} placeholder="Optional client name" maxLength={120} /></label>
          </div>
          <fieldset className="export-sections"><legend>Report sections</legend><div>{EXPORT_SECTIONS.map((section) => <label className={exportSections.includes(section.id) ? "selected" : ""} key={section.id}><input type="checkbox" checked={exportSections.includes(section.id)} onChange={() => toggleExportSection(section.id)} /><span>{section.label}</span></label>)}</div></fieldset>
          <div className="export-limitation"><strong>About post rankings</strong><p>Per-post reach and engagement are not available for individual mentions. Raw mentions are exported as evidence, while reach and engagement remain accurate at daily, source, domain, and author levels where available.</p></div>
          {exportError ? <div className="error-state export-error">{exportError}</div> : null}
        </div>
        <footer><span>Maximum reporting period: 31 days</span><button className="primary-action inline-action" disabled={exporting || !exportSections.length} type="submit"><Download size={16} />{exporting ? `Building ${exportFormat === "xlsx" ? "workbook" : exportFormat === "pptx" ? "presentation" : "PDF report"}…` : `Download ${exportFormat === "xlsx" ? "Excel report" : exportFormat === "pptx" ? "PowerPoint deck" : "PDF report"}`}</button></footer>
      </form></div> : null}

      {analysisOpen && briefing ? <div className="analysis-backdrop" role="presentation" onMouseDown={() => setAnalysisOpen(false)}><section className="analysis-drawer" role="dialog" aria-modal="true" aria-label="Full AI analysis" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">AI analysis</p><h2>{briefing.project.name}</h2></div><button className="icon-button" onClick={() => setAnalysisOpen(false)} type="button" aria-label="Close analysis"><X size={18} /></button></header>
        <div className="analysis-content"><section><h3>Executive summary</h3><p>{briefing.summary.text}</p></section>{briefing.insights.items.map((insight) => <section key={`${insight.title}-${insight.text}`}><h3>{insight.title}</h3><p>{insight.text}</p></section>)}</div>
      </section></div> : null}
    </main>
  );
}
