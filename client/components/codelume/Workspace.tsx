import ReactMarkdown from "react-markdown";
import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleHelp, Code2, Copy, FileCode2, FileText, Folder, FolderOpen, GitBranch, Menu, MessageCircle, Moon, PanelRightClose, Search, Send, Sun, X } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { demoAnswers, demoClaims, demoFiles, demoMetadata, demoReport } from "@/data/demo";
import { askQuestion, apiConfigured, getAnalysis, retryAnalysisAI, errorMessage } from "@/services/api";
import type { AnalysisResponse, DemoFile, DemoReport, EvidenceClaim } from "@/types";

const tabs = ["Overview", "Code Explorer", "README Evidence"] as const;
type Tab = (typeof tabs)[number];
type ChatMessage = { role: "assistant" | "user"; content: string; sources?: { path: string; startLine: number; endLine: number }[] };

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? "brand-mark-small" : ""}`} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M12 6H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h4M20 6h4a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-4M18.5 10l-5 12M16 15.5h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 14.5h.01" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round"/></svg></span>;
}

function ToggleTheme({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return <button className="icon-button" onClick={onToggle} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>;
}

function HighlightCode({ file, selectedLines }: { file: DemoFile; selectedLines?: [number, number] }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector('.code-line-selected')?.scrollIntoView({ block: 'center', behavior: 'auto' }); }, [file.path, selectedLines]);
  const lines = file.content.replace(/\n$/, "").split("\n");
  const colorLine = (line: string) => line.split(/(\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\b(?:import|from|export|default|function|return|const|let|async|await|if|else|class|def|with|as|type|new|true|false|null|None|app|FastAPI)\b|\b\d+\b)/g).map((part, index) => {
    const style = /^(?:\/\/|#)/.test(part) ? "syntax-comment" : /^(?:\"|')/.test(part) || part.startsWith("`") ? "syntax-string" : /^\d+$/.test(part) ? "syntax-number" : /^(?:import|from|export|default|function|return|const|let|async|await|if|else|class|def|with|as|type|new|true|false|null|None|app|FastAPI)$/.test(part) ? "syntax-keyword" : "";
    return style ? <span key={index} className={style}>{part}</span> : part;
  });
  return <div ref={root} className="code-lines" role="region" aria-label={`${file.path} source code`}>
    {lines.map((line, index) => {
      const lineNo = index + 1;
      const selected = selectedLines && lineNo >= selectedLines[0] && lineNo <= selectedLines[1];
      return <div key={lineNo} className={`code-line ${selected ? "code-line-selected" : ""}`}><span className="line-number">{lineNo}</span><code>{colorLine(line || " ")}</code></div>;
    })}
  </div>;
}

function SafeMarkdown({ text }: { text: string }) {
  return <div className="markdown-copy"><ReactMarkdown skipHtml components={{ a: ({ children }) => <span>{children}</span> }}>{text}</ReactMarkdown></div>;
}

function getQuestionKey(question: string): keyof typeof demoAnswers | null {
  const value = question.toLowerCase();
  if (/auth|login|security/.test(value)) return "auth";
  if (/ai|integration|model/.test(value)) return "ai";
  if (/front.?end|communicat|api|backend/.test(value)) return "frontend";
  if (/purpose|what.*project|what.*app|what.*do/.test(value)) return "purpose";
  return null;
}

export default function Workspace() {
  const { id = "demo" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isChatRoute = location.pathname.endsWith("/chat");
  const isDemo = id === "demo";
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(!isDemo);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [retryingAI, setRetryingAI] = useState(false);
  const [aiRetryError, setAiRetryError] = useState("");
  const [tab, setTab] = useState<Tab>("Overview");
  const [selectedPath, setSelectedPath] = useState("frontend/src/App.tsx");
  const [selectedLines, setSelectedLines] = useState<[number, number] | undefined>();
  const [query, setQuery] = useState("");
  const [treeOpen, setTreeOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [dark, setDark] = useState(() => { const value = localStorage.getItem("codelume-theme") === "dark"; document.documentElement.classList.toggle("dark", value); return value; });
  const files = isDemo ? demoFiles : analysis?.files ?? [];
  const report = isDemo ? demoReport : analysis?.report;
  const claims = isDemo ? demoClaims : analysis?.report?.evidence ?? [];
  const file = files.find((entry) => entry.path === selectedPath) ?? files.find((entry) => entry.inspected && /(^|\/)readme/i.test(entry.path)) ?? files.find((entry) => entry.inspected) ?? files[0];
  const filteredFiles = useMemo(() => files.filter((entry) => entry.path.toLowerCase().includes(query.toLowerCase())), [files, query]);

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    setLoadingAnalysis(true);
    setLoadError("");
    if (!apiConfigured) {
      setLoadingAnalysis(false);
      setLoadError("This analysis belongs to a custom repository, but no FastAPI service is connected. Configure VITE_API_BASE_URL to load its report.");
      return () => { active = false; };
    }
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await getAnalysis(id);
        if (!active) return;
        setAnalysis(result);
        setLoadingAnalysis(result.status === "processing");
        if (result.status === "processing") timer = setTimeout(poll, 1800);
      } catch (cause) {
        if (active) { setLoadError(errorMessage(cause)); setLoadingAnalysis(false); }
      }
    }
    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [id, isDemo, retryKey]);

  useEffect(() => {
    const source = location.state as { sourcePath?: string; startLine?: number; endLine?: number } | null;
    if (source?.sourcePath) {
      setSelectedPath(source.sourcePath);
      setSelectedLines(source.startLine && source.endLine ? [source.startLine, source.endLine] : undefined);
      setTab("Code Explorer");
    }
  }, [location.state]);

  const retryAI = async () => {
    setRetryingAI(true); setAiRetryError("");
    try { await retryAnalysisAI(id); setRetryKey((value) => value + 1); }
    catch (cause) { setAiRetryError(errorMessage(cause)); }
    finally { setRetryingAI(false); }
  };

  const toggleTheme = () => {
    setDark((current) => {
      const next = !current;
      localStorage.setItem("codelume-theme", next ? "dark" : "light");
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  };

  const openSource = (path: string, start?: number, end?: number) => {
    setSelectedPath(path);
    setSelectedLines(start && end ? [start, end] : undefined);
    setTab("Code Explorer");
    setDrawerOpen(false);
    if (isChatRoute) navigate(`/analysis/${id}`, { state: { sourcePath: path, startLine: start, endLine: end } });
  };

  const repoUrl = analysis?.repository_url;
  const repoParts = repoUrl?.replace(/\/$/, "").split("/").slice(-2) ?? ["codelume-demo", "lumen-notes"];
  const fileCount = isDemo ? 8 : analysis?.coverage?.inspected ?? files.length;
  const demoTimestamp = useMemo(() => new Date().toLocaleString(), []);

  if (!isDemo && (loadingAnalysis || loadError || !analysis || analysis.status !== "complete" || !report)) {
    const stateMessage = loadingAnalysis ? `Loading repository analysis${analysis?.stage ? `: ${analysis.stage}` : "…"}` : loadError || analysis?.error || (analysis?.status === "processing" ? `Analysis in progress${analysis.stage ? `: ${analysis.stage}` : ""}. Refresh shortly to check its status.` : analysis?.status === "no-data" ? "The service returned no analysis data for this repository." : analysis?.status === "invalid" ? "The repository URL is invalid. Return home and enter a valid public GitHub URL." : analysis?.status === "inaccessible" ? "This repository could not be accessed. Confirm it is public and the URL is correct." : analysis?.status === "rate-limited" ? "The analysis service is rate limited. Try again later." : "Analysis failed. Retry when the service is available.");
    return <div className={`workspace status-workspace ${dark ? "workspace-dark" : ""}`}><header className="workspace-topbar"><div className="workspace-brand"><Link to="/" aria-label="Codelume home"><BrandMark small /></Link><span className="repo-heading"><strong>Codelume</strong></span></div><ToggleTheme dark={dark} onToggle={toggleTheme} /></header><main className="analysis-state"><span className="state-icon">{loadingAnalysis ? <span className="button-spinner" /> : <CircleHelp size={20} />}</span><h1>{loadingAnalysis ? "Reading the report." : "Analysis not available."}</h1><p>{stateMessage}</p>{!loadingAnalysis && <div className="state-actions"><button onClick={() => setRetryKey((value) => value + 1)}>Retry</button><Link to="/">Back home</Link></div>}</main></div>;
  }

  return <div className={`workspace ${dark ? "workspace-dark" : ""}`}>
    <header className="workspace-topbar">
      <div className="workspace-brand"><Link to="/" aria-label="Codelume home"><BrandMark small /></Link><span className="topbar-divider" /><div className="repo-heading">{isDemo ? <><span className="repo-owner">codelume-demo /</span><strong>lumen-notes</strong><span className="demo-pill">DEMO</span></> : <><span className="repo-owner">{repoParts[0]} /</span><strong>{repoParts[1]}</strong></>}</div></div>
      <div className="workspace-meta">{isDemo ? <><span><GitBranch size={14} /> main <i className="demo-meta-label">demo</i></span><span className="commit-hash">fixture</span><span className="commit-label">· 8 inspected</span><span className="updated-label">Demo session · {demoTimestamp}</span><span className="demo-metadata">DEMO FACTS · Stars {demoMetadata.stars} · Forks {demoMetadata.forks} · {demoMetadata.languages.join(" / ")}</span></> : <>{analysis?.branch && <span><GitBranch size={14} /> {analysis.branch}</span>}{analysis?.commit && <span className="commit-hash">{analysis.commit.slice(0, 8)}</span>}{analysis?.analyzed_at && <span>{new Date(analysis.analyzed_at).toLocaleString()}</span>}{repoUrl && <a className="repo-external" href={analysis?.commit ? `${repoUrl.replace(/\/$/, "")}/tree/${analysis.commit}` : repoUrl} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={12} /></a>}</>}</div>
      <div className="workspace-actions"><ToggleTheme dark={dark} onToggle={toggleTheme} /><Link to={`/analysis/${id}/chat`} className={`chat-top-link ${isChatRoute ? "active" : ""}`}><MessageCircle size={15} /><span>Ask about code</span></Link></div>
    </header>
    <div className="workspace-subhead"><div className="mobile-menu"><button className="icon-button" onClick={() => setDrawerOpen(true)} aria-label="Open file drawer"><Menu size={16} /></button></div><div className="workspace-tabs" role="tablist" aria-label="Analysis views">{tabs.map((item) => <button role="tab" aria-selected={tab === item} key={item} className={`workspace-tab ${tab === item ? "selected" : ""}`} onClick={() => setTab(item)}>{item}</button>)}</div><div className="subhead-right"><span className="coverage-indicator"><span /> {fileCount} / {isDemo ? 8 : analysis?.coverage?.total ?? files.length} files inspected{!isDemo && analysis?.coverage?.treeTruncated ? " (partial tree)" : ""}</span><button onClick={() => setRightOpen((value) => !value)} className="icon-button contextual-toggle" aria-label={rightOpen ? "Hide source panel" : "Show source panel"}><PanelRightClose size={16} /></button></div></div>
    <div className="workspace-body">
      <ResizablePanelGroup direction="horizontal" className="workspace-panels">
        <ResizablePanel defaultSize={19} minSize={15} maxSize={30} className="tree-panel">
          <div className="tree-heading"><span>EXPLORER</span><button className="subtle-icon" aria-label="Collapse file tree" onClick={() => setTreeOpen((value) => !value)}><ChevronDown size={15} className={treeOpen ? "" : "rotated"} /></button></div>
          <label className="file-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a file" aria-label="Find a file" /><kbd>⌘ K</kbd></label>
          {treeOpen && <div className="file-tree"><button className="tree-folder"><ChevronDown size={14} /><FolderOpen size={15} /><span>{repoParts[1]}</span></button>{filteredFiles.map((entry) => <button key={entry.path} onClick={() => openSource(entry.path)} className={`tree-file ${selectedPath === entry.path ? "active" : ""}`} title={entry.purpose}><FileIcon path={entry.path} /><span>{entry.path}{!entry.inspected && " · not inspected"}</span></button>)}{filteredFiles.length === 0 && <span className="no-files">No matching files</span>}<span className="tree-uninspected"><CircleHelp size={13} /> {isDemo ? "22 files not inspected" : `${Math.max(0, (analysis?.coverage?.total ?? files.length) - fileCount)} files not inspected${analysis?.coverage?.treeTruncated ? " (partial tree)" : ""}`}</span></div>}
          <div className="tree-bottom"><span className="green-dot" /> PUBLIC REPOSITORY <span>·</span> READ ONLY</div>
        </ResizablePanel>
        <ResizableHandle withHandle className="workspace-resize" />
        <ResizablePanel defaultSize={rightOpen ? 56 : 81} minSize={40} className="center-panel">
          <main className="workspace-main">
            {!isDemo && <div className="analysis-mode-notice" role="status"><strong>{analysis?.analysis_mode === "ai" ? "AI-assisted analysis" : "Basic source explorer"}</strong><span>{analysis?.warning}</span><small>{fileCount} of {analysis?.coverage?.total ?? files.length} known files inspected · limit {analysis?.coverage?.maximum ?? 30}{analysis?.coverage?.treeTruncated ? " · GitHub tree is incomplete" : ""}{(analysis?.coverage?.listed ?? files.length) < (analysis?.coverage?.total ?? files.length) ? " · file tree display capped" : ""}</small>{(analysis?.analysis_mode !== "ai" || analysis?.coverage?.aiPartial) && <button className="retry-ai-button" onClick={retryAI} disabled={retryingAI}>{retryingAI ? "Starting…" : "Retry AI explanation"}</button>}{aiRetryError && <span role="alert">{aiRetryError}</span>}</div>}
            <div className="mobile-back"><Link to="/" className="back-link"><ArrowLeft size={14} /> Home</Link><button className="icon-button" onClick={() => setDrawerOpen(true)} aria-label="Browse files"><Menu size={16} /></button></div>
            {tab === "Overview" && report && <Overview report={report} demo={isDemo} openSource={openSource} />}
            {tab === "Code Explorer" && file && <CodeView file={file} selectedLines={selectedLines} demo={isDemo} repoName={repoParts[1]} />}
            {tab === "README Evidence" && <EvidenceView claims={claims} demo={isDemo} openSource={openSource} />}
          </main>
        </ResizablePanel>
        {rightOpen && <><ResizableHandle withHandle className="workspace-resize right-resize" /><ResizablePanel defaultSize={25} minSize={18} maxSize={36} className="source-panel">{file ? <SourcePanel file={file} selectedLines={selectedLines} demo={isDemo} openSource={openSource} /> : <div className="empty-source">Select an inspected file to preview its source.</div>}</ResizablePanel></>}
      </ResizablePanelGroup>
    </div>
    <AnimatePresence>{drawerOpen && <motion.div className="drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawerOpen(false)}><motion.aside className="mobile-drawer" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} onClick={(event) => event.stopPropagation()}><div className="drawer-title"><strong>Files</strong><button className="icon-button" onClick={() => setDrawerOpen(false)} aria-label="Close file drawer"><X size={17} /></button></div>{files.map((entry) => <button key={entry.path} className={`tree-file ${selectedPath === entry.path ? "active" : ""}`} onClick={() => openSource(entry.path)}><FileIcon path={entry.path} /><span>{entry.path}</span></button>)}</motion.aside></motion.div>}</AnimatePresence>
    <div className="chat-launch"><Link to={`/analysis/${id}/chat`} aria-label="Open repository chat"><MessageCircle size={18} /><span>Ask a question</span></Link></div>
  </div>;
}

function FileIcon({ path }: { path: string }) {
  if (path.includes("README")) return <FileText size={14} className="file-icon md-file" />;
  if (path.includes(".py")) return <span className="language-icon py-icon">Py</span>;
  if (path.endsWith("json")) return <span className="language-icon json-icon">{ }</span>;
  if (path.endsWith("txt")) return <FileText size={14} className="file-icon" />;
  return <FileCode2 size={14} className="file-icon ts-file" />;
}

function CitationLinks({ sources, openSource }: { sources?: { path: string; start_line: number; end_line: number }[]; openSource: (path: string, start?: number, end?: number) => void }) {
  return sources?.length ? <span className="report-citations">{sources.map((ref, i) => <button key={i} onClick={() => openSource(ref.path, ref.start_line, ref.end_line)}>{ref.path} · L{ref.start_line}–{ref.end_line}</button>)}</span> : null;
}

function TechnologyMap({ technologies, openSource }: { technologies: DemoReport["technologies"]; openSource: (path: string, start?: number, end?: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const visible = expanded ? technologies : technologies.slice(0, 6);
  const technology = selected === null ? null : technologies[selected];
  return <section className="overview-section tech-section">
    <div className="section-heading"><h2>Technology map</h2><span>{technologies.length} ITEMS</span></div>
    <p className="technology-hint">Select a technology to see its role and evidence.</p>
    <div className="technology-buttons" id="technology-options">{visible.map((item, index) => <button key={`${item.name}-${index}`} aria-pressed={selected === index} aria-controls="technology-detail" onClick={() => setSelected(selected === index ? null : index)}>{item.name}</button>)}</div>
    {technologies.length > 6 && <button className="technology-toggle" aria-expanded={expanded} aria-controls="technology-options" onClick={() => { setExpanded(!expanded); setSelected(null); }}>{expanded ? "Show fewer" : `Show all ${technologies.length} technologies`}<ChevronDown size={14} /></button>}
    <div id="technology-detail" aria-live="polite">{technology && <div className="technology-detail"><strong>{technology.name}</strong><span className={`evidence-tag ${technology.evidence}`}>{technology.evidence}</span><p>{technology.role}</p><CitationLinks sources={technology.sources} openSource={openSource} /></div>}</div>
    {!technologies.length && <p className="technology-hint">No technologies identified in the inspected excerpts.</p>}
  </section>;
}

function Overview({ report, demo, openSource }: { report: DemoReport; demo: boolean; openSource: (path: string, start?: number, end?: number) => void }) {
  return <motion.div className="overview-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
    <div className="content-eyebrow"><span className="eyebrow-line" /> REPOSITORY OVERVIEW</div><h1>What this codebase<br />is <em>actually doing.</em></h1><p className="overview-summary">{report.summary}</p><CitationLinks sources={report.summarySources} openSource={openSource} />
    <div className="read-limit-note"><span className="limit-icon"><Code2 size={15} /></span><span><strong>Snapshot, not the whole story.</strong> {demo ? "8 of 30 allowed files inspected in this demo." : "Only files returned by this analysis are included."} Conclusions reflect only inspected files.</span><ArrowDown size={14} /></div>
      <section className="overview-section reading-section"><div className="section-heading"><h2>Start reading here</h2><span>ENTRY POINTS</span></div>{report.entryPoints.map((path) => <button key={path} className="source-row" onClick={() => openSource(path)}><FileIcon path={path} /><span>{path}</span><ArrowUpRight size={14} /></button>)}<div className="reading-order">Suggested reading <span>{report.readingOrder.slice(0, 4).map((path, index) => <button key={path} onClick={() => openSource(path)}>{index + 1}. {path}</button>)}</span></div></section>
    <div className="overview-grid">
      <section className="overview-section feature-section"><div className="section-heading"><h2>What it can do</h2><span>{report.features.length} FINDINGS</span></div><div className="feature-list">{report.features.length === 0 && <p className="empty-findings">No AI feature findings are available for this report. Browse the source or retry the AI explanation above.</p>}{report.features.map((item, index) => <div key={item} className="feature-row"><span className="feature-index">0{index + 1}</span><span>{item}<CitationLinks sources={report.featureSources?.[index]} openSource={openSource} /></span><Check size={14} className="feature-check" /></div>)}</div></section>
      <TechnologyMap technologies={report.technologies} openSource={openSource} />

    </div>
    <div className="caveat-strip"><CircleHelp size={15} /><span><strong>Evidence has limits.</strong> {demo ? "No evidence of authentication or AI integration was found in this snapshot." : "Conclusions are limited to the files inspected for this analysis."} Absence from inspected files isn’t proof of absence elsewhere.</span><button onClick={() => document.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]:last-child')?.click()}>Review evidence <ArrowUpRight size={13} /></button></div>
  </motion.div>;
}

function CodeView({ file, selectedLines, demo, repoName }: { file: DemoFile; selectedLines?: [number, number]; demo: boolean; repoName: string }) {
  return <motion.div className="code-view" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}><div className="code-breadcrumb"><span>{repoName}</span><ChevronRight size={13} /><strong>{file.path}</strong><span className="code-language">{file.language}</span></div><div className="code-purpose"><span className="purpose-pip" />{file.purpose}<span className="inspected-tag">{file.inspected ? "INSPECTED" : "NOT INSPECTED"}</span></div><div className="code-browser">{file.inspected ? <HighlightCode file={file} selectedLines={selectedLines} /> : <p className="read-limit-note">{file.purpose}. This file was not used as evidence.</p>}</div><div className="code-footer"><span><span className="green-dot" /> {demo ? "This is a local demo snapshot" : "Source from analyzed repository snapshot"}</span><span>Line {file.content.trimEnd().split("\n").length}</span></div></motion.div>;
}

function EvidenceView({ claims, demo, openSource }: { claims: EvidenceClaim[]; demo: boolean; openSource: (path: string, start?: number, end?: number) => void }) {
  const statuses = { supported: { text: "SUPPORTED", symbol: "✓" }, partial: { text: "PARTIAL", symbol: "◐" }, "not-found": { text: "NOT FOUND", symbol: "—" } };
  return <motion.div className="evidence-view" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}><div className="content-eyebrow"><span className="eyebrow-line" /> README EVIDENCE</div><h1>Claims meet<br /><em>the code.</em></h1><p className="evidence-intro">Each README statement is checked against inspected files. A missing match is a signal to investigate, not a verdict.</p>{claims.length === 0 && !demo ? <div className="read-limit-note"><CircleHelp size={15} /> This analysis did not include claim-level evidence.</div> : null}<div className="evidence-cards">{claims.map((claim, index) => <motion.article className="evidence-card" key={claim.claim} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, delay: index * 0.06 }}><div className="evidence-card-top"><span className="claim-number">0{index + 1}</span><span className={`claim-status ${claim.status}`}>{statuses[claim.status].symbol} {statuses[claim.status].text}</span></div><h2>“{claim.claim}”</h2><p>{claim.explanation}</p>{claim.sourcePath && <button className="evidence-source" onClick={() => openSource(claim.sourcePath!, claim.startLine, claim.endLine)}><FileCode2 size={14} /><span>{claim.sourcePath}</span><span className="line-ref">L{claim.startLine}–{claim.endLine}</span><ArrowUpRight size={13} /></button>}</motion.article>)}</div><div className="coverage-detail"><strong>Coverage note</strong><span>{demo ? "8 files inspected · 22 outside this demo snapshot · 30-file analysis limit" : "Evidence below covers only source files returned by the analysis."}</span></div></motion.div>;
}

function SourcePanel({ file, selectedLines, demo, openSource }: { file: DemoFile; selectedLines?: [number, number]; demo: boolean; openSource: (path: string, start?: number, end?: number) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(file.content); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { setCopied(false); } };
  return <div className="source-panel-inner"><div className="source-panel-heading"><span>SELECTED SOURCE</span><button className="subtle-icon" onClick={copy} aria-label="Copy source code">{copied ? <Check size={14} /> : <Copy size={14} />}</button></div><button className="source-title" onClick={() => openSource(file.path)}><FileIcon path={file.path} /><strong>{file.path}</strong><ArrowUpRight size={13} /></button><p className="source-purpose">{file.purpose}</p><div className="source-code-preview"><HighlightCode file={file} selectedLines={selectedLines} /></div><button className="open-full-file" onClick={() => openSource(file.path)}><span>Open in code explorer</span><ArrowUpRight size={13} /></button><div className="source-panel-foot"><span>{demo ? "LOCAL DEMO SOURCE" : "ANALYZED SNAPSHOT"}</span>{demo ? <span>Not a GitHub link</span> : file.url ? <a href={file.url} target="_blank" rel="noreferrer">Pinned source link <ArrowUpRight size={11} /></a> : <span>Source URL not provided</span>}</div></div>;
}

export function ChatPage() {
  const { id = "demo" } = useParams();
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [chatAnalysis, setChatAnalysis] = useState<AnalysisResponse | null>(null);
  const [chatMode, setChatMode] = useState<string>("");
  const lastMessage = useRef<HTMLDivElement>(null);
  useEffect(() => { if (id !== "demo") getAnalysis(id).then(setChatAnalysis).catch(() => {}); }, [id]);
  const repoLabel = chatAnalysis?.repository_url?.replace('https://github.com/', '') || id;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [copiedIndex, setCopiedIndex] = useState(-1);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dark, setDark] = useState(() => { const value = localStorage.getItem("codelume-theme") === "dark"; document.documentElement.classList.toggle("dark", value); return value; });
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: "Hi, I’m here to help you understand this repository. Ask about its purpose, how the frontend connects to the backend, authentication, or AI integration." }]);
  const toggleTheme = () => setDark((current) => { const next = !current; localStorage.setItem("codelume-theme", next ? "dark" : "light"); document.documentElement.classList.toggle("dark", next); return next; });
  const suggestions = ["What is this project for?", "How does the frontend talk to the backend?", "Is authentication implemented?", "Is there an AI integration?"];
  const send = async (value = question) => {
    const text = value.trim(); if (!text || sending) return;
    setQuestion(""); setError(""); setMessages((current) => [...current, { role: "user", content: text }]); setSending(true);
    try {
      if (id === "demo") {
        await new Promise((resolve) => window.setTimeout(resolve, 280));
        const key = getQuestionKey(text);
        const answer = key ? demoAnswers[key] : null;
        setMessages((current) => [...current, answer ? { role: "assistant", content: answer.answer, sources: answer.sources } : { role: "assistant", content: "That question isn’t covered by a predefined demo answer. Live Q&A requires a connected FastAPI backend, so I won’t invent an answer." }]);
      } else {
        const response = await askQuestion(id, text, messages.map(({ role, content }) => ({ role, content })));
        setChatMode(response.mode || "ai");
        setMessages((current) => [...current, { role: "assistant", content: response.answer, sources: response.sources.map((source) => ({ path: source.path, startLine: source.start_line, endLine: source.end_line })) }]);
      }
    } catch (cause) { setError(errorMessage(cause)); setQuestion(text); }
    finally { setSending(false); requestAnimationFrame(() => lastMessage.current?.scrollIntoView({ block: "end" })); }
  };
  const clear = () => { setMessages([{ role: "assistant", content: "Chat cleared. Ask about this repository’s purpose, frontend/backend communication, authentication, or AI integration." }]); setConfirmClear(false); };
  return <div className={`chat-page ${dark ? "workspace-dark" : ""}`}><header className="chat-page-header"><Link to="/" className="chat-brand"><BrandMark small /><span>codelume</span></Link><span className="chat-header-repo"><span>{id === "demo" ? "DEMO REPOSITORY" : "REPOSITORY"}</span> {id === "demo" ? "codelume-demo / lumen-notes" : repoLabel}</span><div className="chat-header-actions"><ToggleTheme dark={dark} onToggle={toggleTheme} /><Link to={`/analysis/${id}`} className="back-analysis"><ArrowLeft size={14} /> Analysis</Link></div></header><div className="chat-layout"><aside className="chat-context"><div className="chat-context-label">{id === "demo" ? "DEMO REPOSITORY" : "ANALYSIS"}</div><div className="chat-repo-title"><span className="repo-file-icon"><Folder size={16} /></span><div><strong>{id === "demo" ? "lumen-notes" : repoLabel}</strong><span>{id === "demo" ? "codelume-demo / public" : "Source-backed Q&A"}</span></div></div><div className="chat-context-rule" /><div className="chat-context-label">SUGGESTED QUESTIONS</div>{suggestions.map((item) => <button className="suggestion-button" key={item} onClick={() => send(item)}><span>{item}</span><ArrowUpRight size={13} /></button>)}<div className="chat-snapshot-note"><span className="green-dot" /><span>{id === "demo" ? "Answers use only the 8-file local demo snapshot." : "Answers require a connected API and use the analyzed source snapshot."}</span></div></aside><main className="chat-main"><div className="chat-title-row"><div><span className="content-eyebrow"><span className="eyebrow-line" /> REPOSITORY Q&amp;A</span><h1>Ask the <em>code.</em></h1><p>Answers are grounded in source files, not generated repo changes.</p></div><button className="clear-chat-button" onClick={() => setConfirmClear(true)}><X size={13} /> Clear</button></div><div className="messages-area" aria-live="polite">{messages.map((message, index) => <div className={`message-row ${message.role}`} key={`${index}-${message.role}`}><span className="message-avatar">{message.role === "assistant" ? <BrandMark small /> : "Y"}</span><div className="message-content"><div className="message-author">{message.role === "assistant" ? (id === "demo" ? "Codelume demo" : "Codelume") : "You"}<span>{message.role === "assistant" ? "SOURCE-BASED" : ""}</span></div><SafeMarkdown text={message.content} />{message.sources && <div className="source-chips">{message.sources.map((source) => <button key={`${source.path}-${source.startLine}`} onClick={() => navigate(`/analysis/${id}`, { state: { sourcePath: source.path, startLine: source.startLine, endLine: source.endLine } })}><FileCode2 size={12} />{source.path.split("/").pop()} <span>L{source.startLine}–{source.endLine}</span></button>)}</div>}{message.role === "assistant" && index > 0 && <button className="copy-answer" aria-label="Copy answer" onClick={async () => { try { await navigator.clipboard.writeText(message.content); setCopiedIndex(index); window.setTimeout(() => setCopiedIndex(-1), 1300); } catch { setError("Clipboard unavailable. Select and copy the answer text."); } }}>{copiedIndex === index ? <Check size={13} /> : <Copy size={13} />}{copiedIndex === index ? "Copied" : "Copy"}</button>}</div></div>)}{sending && <div className="message-row assistant"><span className="message-avatar"><BrandMark small /></span><div className="message-content"><div className="message-author">{id === "demo" ? "Codelume demo" : "Codelume"}</div><span className="loading-dots" aria-label="Loading answer"><i /><i /><i /></span></div></div>}{error && <div className="chat-error" role="alert">{error}</div>}<div ref={lastMessage} /></div><div className="composer-area"><div className="composer-box"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Ask about this repository…" aria-label="Ask a question" rows={2} maxLength={2000} /><div className="composer-footer"><span>Shift + Enter for new line</span><button onClick={() => send()} disabled={!question.trim() || sending} aria-label="Send question"><Send size={15} /> Ask</button></div></div><p className="chat-disclaimer">{id === "demo" ? "Demo answers are predefined and limited to the example repository." : chatMode === "basic" ? "Basic mode: relevant code excerpts, without an AI-generated explanation." : error ? "AI request failed. No answer was generated; you can retry your question." : "AI answers use retrieved source excerpts. Verify explanations against the cited code."}</p></div></main></div>{confirmClear && <div className="confirm-overlay" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title"><h2 id="clear-title">Clear this conversation?</h2><p>This removes the messages from this page. It doesn’t affect the repository.</p><div><button onClick={() => setConfirmClear(false)}>Keep chat</button><button className="confirm-danger" onClick={clear}>Clear conversation</button></div></div></div>}</div>;
}
