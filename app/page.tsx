"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  BrainCircuit,
  CalendarDays,
  ChevronRight,
  FileSearch,
  Gauge,
  Globe2,
  Hash,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

type Project = { id: string; name: string };
type View = "briefing" | "settings";
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
  warnings: { feature: string; status: number; message: string }[];
  cache?: "hit" | "miss";
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

function compactNumber(value: number) {
  return new Intl.NumberFormat("en", {
    notation: Math.abs(value) > 9999 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
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
          <div className="bar-column" key={item.date}>
            <div className="bar-fill" style={{ height: `${Math.max((item.mentions / max) * 100, 4)}%` }} title={`${formatDate(item.date)}: ${compactNumber(item.mentions)} mentions`} />
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
      <p>{status === "unavailable" ? `${label} is still being prepared by Brand24.` : `No ${label.toLowerCase()} were found for this period.`}</p>
    </div>
  );
}

function Skeleton({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? "skeleton skeleton-compact" : "skeleton tall"} />;
}

export default function Home() {
  const [view, setView] = useState<View>("briefing");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [days, setDays] = useState(7);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectName, setProjectName] = useState("");
  const [language, setLanguage] = useState("english");
  const [keywords, setKeywords] = useState("");
  const [requiredWords, setRequiredWords] = useState("");
  const [excludedWords, setExcludedWords] = useState("");
  const [creating, setCreating] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);

  const loadProjects = useCallback(async (refresh = false, preferredProjectId?: string) => {
    setProjectsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects${refresh ? "?refresh=true" : ""}`);
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
      setError(requestError instanceof Error ? requestError.message : "Could not synchronize Brand24 projects.");
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => { void loadProjects(true); }, [loadProjects]);

  useEffect(() => {
    if (!selectedProjectId) { setBriefing(null); return; }
    const controller = new AbortController();
    setBriefingLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/api/projects/${selectedProjectId}/briefing?days=${days}`, { signal: controller.signal })
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
  }, [days, selectedProjectId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAnalysisOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const totals = briefing?.metrics.totals;
  const totalEngagement = totals ? totals.engagement.likes + totals.engagement.comments + totals.engagement.shares : 0;
  const negativeShare = useMemo(() => {
    if (!totals) return 0;
    const total = totals.sentiment.positive + totals.sentiment.neutral + totals.sentiment.negative;
    return total ? (totals.sentiment.negative / total) * 100 : 0;
  }, [totals]);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keywordList = keywords.split(",").map((value) => value.trim()).filter(Boolean);
    if (!projectName.trim() || !keywordList.length) { setError("A project name and at least one keyword are required."); return; }
    if (!window.confirm(`Create “${projectName.trim()}” in the connected Brand24 account?`)) return;

    setCreating(true);
    setError(null);
    setSetupMessage(null);
    const required = requiredWords.split(",").map((value) => value.trim()).filter(Boolean);
    const excluded = excludedWords.split(",").map((value) => value.trim()).filter(Boolean);
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName: projectName.trim(), language: language || null, keywords: keywordList.map((keyword) => ({ keyword, required, excluded })) }),
      });
      if (!response.ok) throw new Error(await responseError(response, `Project creation failed: ${response.status}`));
      const payload = await response.json();
      const createdProject = payload.project as Project;
      setSetupMessage(`${createdProject.name} was created in Brand24 and synchronized.`);
      setProjectName(""); setKeywords(""); setRequiredWords(""); setExcludedWords("");
      await loadProjects(true, createdProject.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the Brand24 project.");
    } finally { setCreating(false); }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark"><span>Z</span><div><strong>Zestar</strong><p>Media intelligence</p></div></div>
        <div className="nav-label">Workspace</div>
        <nav className="main-nav">
          <button className={view === "briefing" ? "active" : ""} onClick={() => setView("briefing")} type="button"><Gauge size={18} /><span>Briefing</span></button>
          <button disabled type="button"><FileSearch size={18} /><span>Mentions</span><small>Next</small></button>
          <button disabled type="button"><Globe2 size={18} /><span>Sources</span><small>Soon</small></button>
          <button disabled type="button"><Hash size={18} /><span>Topics</span><small>Soon</small></button>
        </nav>
        <div className="sidebar-spacer" />
        <nav className="main-nav">
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")} type="button"><Settings2 size={18} /><span>Project settings</span></button>
        </nav>
        <div className="connection-card"><span className="status live" /><div><strong>Brand24 connected</strong><small>{projects.length} synchronized project{projects.length === 1 ? "" : "s"}</small></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{view === "briefing" ? "Intelligence briefing" : "Project administration"}</p>
            <h1>{view === "briefing" ? selectedProject?.name ?? "Select a project" : "Project settings"}</h1>
          </div>
          <div className="project-toolbar">
            <label className="project-picker"><span>Project</span><select aria-label="Brand24 project" disabled={projectsLoading || !projects.length} value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
              {!projects.length ? <option value="">No projects</option> : null}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select></label>
            {view === "briefing" ? <label className="project-picker period-picker"><span>Period</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></label> : null}
            <button className="icon-button" type="button" onClick={() => void loadProjects(true)} aria-label="Synchronize projects" title="Synchronize projects"><RefreshCw size={18} /></button>
          </div>
        </header>

        {error ? <div className="error-state">{error}</div> : null}

        {view === "briefing" ? (
          <>
            <div className="context-strip"><span className="status live" /><span>Live Brand24 data</span><i />{briefing ? <span>{formatDate(briefing.dateRange.from)} – {formatDate(briefing.dateRange.to)}</span> : <span>Loading reporting period</span>}{briefing?.cache === "hit" ? <><i /><span>Cached response</span></> : null}</div>

            {!selectedProject && !projectsLoading ? <section className="empty-project-state"><Radio size={30} /><h2>No Brand24 projects</h2><p>Create a basic monitor from Project settings.</p><button className="primary-action inline-action" onClick={() => setView("settings")} type="button">Open project settings</button></section> : null}

            <section className="metric-grid">
              <MetricCard label="Mentions" value={compactNumber(totals?.mentions ?? 0)} detail={`Across ${days} days`} icon={<Radio size={18} />} />
              <MetricCard label="Estimated reach" value={compactNumber(totals?.reach ?? 0)} detail="Potential audience" icon={<TrendingUp size={18} />} />
              <MetricCard label="Engagement" value={compactNumber(totalEngagement)} detail="Likes, comments & shares" icon={<Users size={18} />} />
              <MetricCard label="Negative share" value={`${negativeShare.toFixed(1)}%`} detail={`${compactNumber(totals?.sentiment.negative ?? 0)} mentions`} icon={<Activity size={18} />} />
            </section>

            <section className="briefing-grid">
              <article className="panel executive-panel">
                <div className="panel-heading"><div><p>Brand24 AI</p><h2>Executive readout</h2></div><BrainCircuit size={20} /></div>
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
            </section>

            {briefing?.warnings.length ? <div className="warning-strip">Some optional intelligence could not be loaded: {briefing.warnings.map((warning) => warning.feature).join(", ")}.</div> : null}
          </>
        ) : (
          <section className="settings-grid">
            <form className="setup-panel" onSubmit={createProject}>
              <div className="panel-heading"><div><p>Basic API setup</p><h2>Create Brand24 project</h2></div><Plus size={20} /></div>
              <p className="setup-intro">Create a basic monitor here. Country, region and advanced collection settings remain in Brand24.</p>
              <label>Project name<input required value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. Product launch monitor" /></label>
              <label>Keywords<input required value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="Comma-separated keywords" /></label>
              <div className="form-row"><label>Required words<input value={requiredWords} onChange={(event) => setRequiredWords(event.target.value)} placeholder="Optional" /></label><label>Excluded words<input value={excludedWords} onChange={(event) => setExcludedWords(event.target.value)} placeholder="Optional" /></label></div>
              <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="">Any language</option><option value="english">English</option><option value="arabic">Arabic</option><option value="french">French</option><option value="german">German</option><option value="spanish">Spanish</option></select></label>
              <button className="primary-action" disabled={creating} type="submit">{creating ? "Creating in Brand24…" : "Create project"}</button>
              {setupMessage ? <p className="setup-message">{setupMessage}</p> : null}
            </form>

            <section className="setup-panel project-directory">
              <div className="panel-heading"><div><p>Source of truth</p><h2>Synchronized projects</h2></div><button className="icon-button small" type="button" onClick={() => void loadProjects(true)} aria-label="Synchronize projects"><RefreshCw size={16} /></button></div>
              <p className="setup-intro">Projects are read directly from the connected Brand24 account.</p>
              <div className="project-list">{projects.map((project) => <button className={project.id === selectedProjectId ? "project-row active" : "project-row"} key={project.id} type="button" onClick={() => { setSelectedProjectId(project.id); setView("briefing"); }}><span><strong>{project.name}</strong><small>Project {project.id}</small></span><ChevronRight size={17} /></button>)}</div>
              {!projects.length ? <FeatureEmpty status="empty" label="Projects" /> : null}
            </section>
          </section>
        )}
      </section>

      {analysisOpen && briefing ? <div className="analysis-backdrop" role="presentation" onMouseDown={() => setAnalysisOpen(false)}><section className="analysis-drawer" role="dialog" aria-modal="true" aria-label="Full Brand24 analysis" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">Brand24 AI analysis</p><h2>{briefing.project.name}</h2></div><button className="icon-button" onClick={() => setAnalysisOpen(false)} type="button" aria-label="Close analysis"><X size={18} /></button></header>
        <div className="analysis-content"><section><h3>Executive summary</h3><p>{briefing.summary.text}</p></section>{briefing.insights.items.map((insight) => <section key={`${insight.title}-${insight.text}`}><h3>{insight.title}</h3><p>{insight.text}</p></section>)}</div>
      </section></div> : null}
    </main>
  );
}
