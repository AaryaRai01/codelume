import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp, Code2, FileCode2, FileText, GitBranch, Moon, Play, Search, ShieldCheck, Sun, X } from "lucide-react";
import { demoFiles } from "@/data/demo";
import { analyzeRepository, apiConfigured, errorMessage } from "@/services/api";
import type { DemoFile } from "@/types";

function BrandMark() {
  return <span className="brand-mark"><svg viewBox="0 0 32 32" fill="none"><path d="M12 6H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h4M20 6h4a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-4M18.5 10l-5 12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 15.5h.01" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round"/></svg></span>;
}

function ThemeButton({ dark, toggle }: { dark: boolean; toggle: () => void }) {
  return <button className="icon-button hero-theme" onClick={toggle} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>;
}

function CodeLines({ file }: { file: DemoFile }) {
  return <div className="code-lines preview-lines">{file.content.replace(/\n$/, "").split("\n").slice(0, 12).map((line, index) => <div className="code-line" key={index}><span className="line-number">{index + 1}</span><code>{line || " "}</code></div>)}</div>;
}

function Preview() {
  const [selected, setSelected] = useState("frontend/src/App.tsx");
  const active = demoFiles.find((file) => file.path === selected) ?? demoFiles[1];
  const previewFiles = ["README.md", "frontend/src/App.tsx", "frontend/src/api.ts", "backend/main.py", "backend/database.py"];
  return <div className="hero-preview" aria-label="Interactive Codelume product preview">
    <div className="preview-topbar"><div className="preview-controls"><i /><i /><i /></div><span>codelume / lumen-notes</span><span className="preview-demo-tag">DEMO</span></div>
    <div className="preview-workspace"><div className="preview-sidebar"><div className="preview-explorer"><span>EXPLORER</span><span>⌄</span></div><div className="preview-project"><ChevronRight size={12} className="preview-open-chevron" /> <span className="preview-folder">▣</span> lumen-notes</div>{previewFiles.map((path) => <button key={path} onClick={() => setSelected(path)} className={`preview-file ${selected === path ? "preview-file-active" : ""}`}><span className={`preview-file-symbol ${path.endsWith(".py") ? "py" : path.endsWith(".md") ? "md" : "ts"}`}>{path.endsWith(".py") ? "Py" : path.endsWith(".md") ? "M" : "TS"}</span>{path.includes("/") ? path.split("/").slice(1).join("/") : path}</button>)}</div><div className="preview-code-panel"><div className="preview-file-tab"><FileCode2 size={12} />{active.path}<span>×</span></div><div className="preview-code-caption">{active.purpose}</div><CodeLines file={active} /></div><div className="preview-explanation"><div className="explanation-top"><span className="explanation-mark"><BrandMark /></span><span>CODELUME EXPLAINS</span><span className="explanation-dot" /></div><h3>{selected.includes("App.tsx") ? "Search happens in the browser" : selected.includes("main.py") ? "Three API routes handle notes" : selected.includes("database.py") ? "SQLite holds the note records" : selected.includes("api.ts") ? "The UI calls a local API" : "A promise in the README"}</h3><p>{selected.includes("App.tsx") ? "The app filters note titles in React state. It doesn’t search note bodies or call a search endpoint." : selected.includes("main.py") ? "GET, POST and DELETE routes use parameterized SQLite statements. No auth middleware is present in this snapshot." : selected.includes("database.py") ? "A local SQLite file is initialized with a notes table when the service connects." : selected.includes("api.ts") ? "The frontend sends requests to a FastAPI service running on localhost:8000." : "Offline sync is listed as a feature, but no implementation appears in inspected files."}</p><button onClick={() => setSelected(selected === "README.md" ? "frontend/src/App.tsx" : "README.md")}>View supporting code <ArrowUpRight size={12} /></button></div></div>
    <div className="preview-foot"><span><span className="preview-live-dot" /> 8 FILES INSPECTED</span><span><ShieldCheck size={12} /> PUBLIC REPO ONLY</span><span>click a file to explore</span></div>
  </div>;
}

export default function Index() {
  const navigate = useNavigate();
  const [repository, setRepository] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(() => { const value = localStorage.getItem("codelume-theme") === "dark"; document.documentElement.classList.toggle("dark", value); return value; });
  const [notice, setNotice] = useState("");
  const toggleTheme = () => setDark((current) => { const next = !current; localStorage.setItem("codelume-theme", next ? "dark" : "light"); document.documentElement.classList.toggle("dark", next); return next; });
  const validRepo = (value: string) => /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(value.trim());
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const url = repository.trim().replace(/\/$/, "");
    setError(""); setNotice("");
    if (!validRepo(url)) { setError("Enter a public GitHub URL like https://github.com/owner/repository"); return; }
    if (!apiConfigured) { setNotice("Analysis service not connected. This build does not analyze repositories yet. Explore Demo to try the included, clearly labeled example."); return; }
    setBusy(true);
    try {
      const { analysis_id } = await analyzeRepository(url);
      navigate(`/analysis/${encodeURIComponent(analysis_id)}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  };

  return <div className={`landing ${dark ? "landing-dark" : ""}`}>
    <header className="landing-header"><Link to="/" className="brand-lockup"><BrandMark /><span>codelume</span></Link><nav className="landing-nav"><button onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}>How it works</button><button onClick={() => document.getElementById("principles")?.scrollIntoView({ behavior: "smooth" })}>Principles</button></nav><div className="landing-header-actions"><ThemeButton dark={dark} toggle={toggleTheme} /><Link to="/analysis/demo" className="header-demo-link">Explore demo <ArrowUpRight size={14} /></Link></div></header>
    <main>
      <section className="hero-section"><div className="hero-copy"><motion.div className="hero-kicker" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}><span className="kicker-dot" /> REPOSITORY UNDERSTANDING, WITH RECEIPTS</motion.div><motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.07 }}>Understand the code<br />behind the <span>README.</span></motion.h1><motion.p className="hero-description" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.14 }}>A clearer way into an unfamiliar codebase. Trace features from the promise in the README to the files that make them real.</motion.p><motion.form className="repo-form" onSubmit={submit} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.21 }} noValidate><label className="repo-input-wrap"><span className="github-mark">GH</span><input aria-label="Public GitHub repository URL" placeholder="https://github.com/owner/repository" value={repository} onChange={(event) => { setRepository(event.target.value); setError(""); setNotice(""); }} /><button type="button" className="input-clear" aria-label="Clear repository URL" onClick={() => setRepository("")}><X size={14} /></button></label><button type="submit" className="analyze-button" disabled={busy}>{busy ? <span className="button-spinner" /> : <Search size={16} />}{busy ? "Connecting…" : "Analyze repository"}<ArrowRight size={15} /></button></motion.form>{error && <p className="form-message error-message" role="alert">{error}</p>}{notice && <div className="form-message setup-message" role="status"><CircleHelp size={15} /><span>{notice}</span></div>}<motion.div className="hero-assurance" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.28 }}><span><ShieldCheck size={14} /> Public repositories only</span><i /> <span>No code changes</span><i /> <span>Coverage shown in every report</span></motion.div><motion.div className="hero-demo-nudge" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.35 }}><span>New here?</span><Link to="/analysis/demo">Explore the working demo <ArrowUpRight size={13} /></Link></motion.div></div>
        <motion.div className="hero-visual" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.3 }}><Preview /><div className="visual-caption"><span>01 — FROM FILE TREE TO UNDERSTANDING</span><span>LOCAL EXAMPLE · NOT LIVE ANALYSIS</span></div></motion.div>
        <div className="hero-side-note"><span>BUILT FOR THE FIRST READ</span><ArrowDownRight size={15} /></div>
      </section>
      <section className="proof-strip" id="principles"><span>UNDERSTANDING, NOT MAGIC</span><div><span className="proof-icon"><Check size={13} /></span>Every insight points to a file</div><div><span className="proof-icon"><Check size={13} /></span>Declared ≠ implemented</div><div><span className="proof-icon"><Check size={13} /></span>Public code, read-only</div><span className="proof-index">01 / 03</span></section>
      <section className="how-section" id="how-it-works"><div className="how-heading"><div><span className="section-kicker">A MAP, NOT A BLACK BOX</span><h2>Get oriented.<br /><em>Then go deeper.</em></h2></div><p>Codelume is designed to make repository exploration legible: inspect the paths, read the evidence, and keep the source one click away.</p></div><div className="how-steps"><article><span className="step-number">01</span><div className="step-icon"><GitBranch size={17} /></div><h3>Start with the map</h3><p>See the project’s entry points, technologies, and a sensible order for reading the code.</p><span className="step-line" /></article><article><span className="step-number">02</span><div className="step-icon"><FileCode2 size={17} /></div><h3>Follow the evidence</h3><p>Move from README claims to matching, partial, or missing evidence with line references.</p><span className="step-line" /></article><article><span className="step-number">03</span><div className="step-icon"><Code2 size={17} /></div><h3>Ask better questions</h3><p>Explore how the parts connect. Answers stay grounded in files, never pretend to change them.</p><span className="step-line" /></article></div></section>
      <section className="closing-band"><div><span className="section-kicker">START WITH A REAL EXAMPLE</span><h2>Curiosity, meet<br /><em>the codebase.</em></h2></div><Link to="/analysis/demo" className="closing-cta">Explore the demo <Play size={14} /></Link><div className="closing-note"><FileText size={15} /> lumen-notes · 8 inspected files <span>·</span> All local, all fictional</div></section>
    </main><footer className="landing-footer"><Link to="/" className="footer-brand"><BrandMark /> Codelume</Link><span>Read-only repository exploration.</span><span>Built for the curious.</span></footer>
  </div>;
}
