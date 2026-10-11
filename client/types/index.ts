export type EvidenceStatus = "supported" | "partial" | "not-found";

export interface DemoFile {
  path: string;
  purpose: string;
  language: string;
  inspected: boolean;
  content: string;
  url?: string;
}

export interface EvidenceClaim {
  claim: string;
  status: EvidenceStatus;
  explanation: string;
  sourcePath?: string;
  startLine?: number;
  endLine?: number;
}

export interface DemoReport {
  summary: string;
  summarySources?: Source[];
  features: string[];
  featureSources?: Source[][];
  technologies: { name: string; role: string; evidence: "declared" | "observed"; sources?: Source[] }[];
  entryPoints: string[];
  readingOrder: string[];
  evidence?: EvidenceClaim[];
}

export interface Source {
  path: string;
  start_line: number;
  end_line: number;
  url?: string;
}

export interface AnalysisResponse {
  status: "processing" | "complete" | "no-data" | "invalid" | "inaccessible" | "rate-limited" | "failed";
  stage?: string;
  repository_url?: string;
  branch?: string;
  commit?: string;
  analyzed_at?: string;
  analysis_mode?: "ai" | "basic";
  retrieval_mode?: "lexical" | "semantic";
  warning?: string;
  error?: string;
  stars?: number;
  forks?: number;
  report?: DemoReport;
  files?: DemoFile[];
  coverage?: { inspected: number; maximum: number; total?: number; listed?: number; treeTruncated?: boolean; aiContextChunks?: number; aiPartial?: boolean; missingEvidence: boolean };
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
  mode?: "ai" | "basic";
}
