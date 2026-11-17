export type StageId = 'idea' | 'audience' | 'competitors' | 'market' | 'business' | 'economics' | 'team' | 'roadmap' | 'mvp';
export type ToolId = 'basics' | 'trends' | 'ai' | 'interview' | 'legal';
export type ModuleId = StageId | ToolId;
export type ViewId = 'workspace' | 'presentation' | 'tools' | 'gallery' | 'profile';
export type Provenance = 'user' | 'hypothesis' | 'calculation' | 'unknown' | 'verified';
export interface Fact {
  key: string;
  value: string;
  provenance: Provenance;
  note: string;
  sourceUrl?: string;
  checkedAt?: string;
}
export interface Choice { id: string; label: string; description: string; recommended?: boolean }
export interface ProposedArtifact { title: string; body: string }
export interface MarketCalculationEvidence {
  tam: { quote: string; formula: string; result: string };
  sam: { quote: string; formula: string; result: string };
  som: { quote: string; formula: string; result: string };
}
export interface TopicCoverage {
  rubricVersion: 1;
  moduleId: ModuleId;
  items: { id: string; status: 'missing' | 'partial' | 'covered'; note: string; support: { role: 'user' | 'assistant'; quote: string } | null; calculationEvidence?: MarketCalculationEvidence }[];
  nextCriterionId: string | null;
}
export interface ChatMemory {
  facts: { text: string; evidence: string }[];
  hypotheses: string[];
  openQuestions: string[];
  coverage?: TopicCoverage;
  review?: import('./review.js').TopicReview;
}
export interface MemorySnapshot { content: ChatMemory; updatedAt: string; needsRefresh?: boolean; coverageBasis?: string }
export interface KnowledgeSource {
  id: string; title: string; body: string; version: string;
  methodId?: string; sourceRefs?: string[]; applicability?: string[];
  status?: 'editorial_draft_not_behaviorally_validated'; selectionReason?: string[];
}
export interface AssistantReply {
  calculationScenario?: import('./calculationScenario.js').CalculationScenario | null;
  memoryPatch?: MemoryPatch;
  externalSources?: ExternalEvidence[];
  recoveredSourceRefs?: VersionRef[];
  historySources?: { source: MessageRevision; quotes: string[] }[];
  externalClaims?: ExternalClaim[];
  research?: Pick<ResearchBundle, 'status' | 'limitations'>;
  diagnostics?: ReplyDiagnostics;
  message: string;
  choices: Choice[];
  artifactDraft: ProposedArtifact | null;
  proposedFacts: Fact[];
  memory?: ChatMemory;
  knowledgeSources?: KnowledgeSource[];
}
export interface Message {
  revision?: number;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  choices?: Choice[];
  choiceConsumed?: boolean;
  requestId?: string;
  request?: ChatRequest;
  requestError?: string;
  status?: 'pending' | 'sent' | 'failed';
  reply?: AssistantReply;
  feedback?: 'up' | 'down';
  regenerationRequest?: ChatRequest;
  replacesAnswerId?: string;
}
export interface Assessment {
  textHash: string;
  checks: { label: string; passed: boolean; reason: string }[];
  assessedAt: string;
}
export interface Artifact {
  basedOn?: { memoryVersion: number; atoms: VersionRef[]; evidence: VersionRef[] };
  title: string;
  body: string;
  revision: number;
  savedAt: string;
  stale: boolean;
  staleReason?: string;
  assessment?: Assessment;
}
export interface ModuleState {
  generation?: number;
  completedAt?: string;
  messages: Message[];
  draft: string;
  proposal: AssistantReply | null;
  artifact: Artifact | null;
  memory?: MemorySnapshot;
  resetAt?: string;
}
export interface Project {
  core?: CoreMemory;
  id: string;
  name: string;
  description: string;
  stageLabel: string;
  prototypeUrl: string;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
  facts: Record<string, Fact>;
  modules: Record<ModuleId, ModuleState>;
  activeModule: ModuleId;
  unlockedStages?: StageId[];
  calculations: Record<string, unknown>;
}
export interface Workspace { version: 1; activeProjectId: string; projects: Project[] }
export interface ChatRequest {
  contractVersion?: 2;
  coreContext?: CoreContext;
  requestId: string;
  projectId: string;
  moduleId: ModuleId;
  intent: 'message' | 'draft' | 'start';
  message: string;
  context: {
    name: string;
    description: string;
    facts: Fact[];
    /** Active unsaved assistant proposal; untrusted text, never an accepted fact. */
    currentDraft?: ProposedArtifact;
    artifacts: { moduleId: ModuleId; title: string; body: string; stale: boolean; provenance?: 'assistant_proposal' }[];
    history: { role: 'user' | 'assistant'; content: string }[];
    memories?: { moduleId: ModuleId; content: ChatMemory; updatedAt: string; needsRefresh?: boolean }[];
  };
}
export interface ChatResponse { requestId: string; reply: AssistantReply; model: string }
export interface ApiError { error: { code: string; message: string; retryable: boolean }; requestId?: string }
export type ChatStreamEvent =
  | { type: 'progress'; requestId: string; progress: ResearchProgress }
  | { type: 'start'; requestId: string }
  | { type: 'text.delta'; requestId: string; delta: string }
  | { type: 'text.reset'; requestId: string }
  | { type: 'complete'; requestId: string; response: ChatResponse }
  | { type: 'error'; requestId: string; error: ApiError['error'] };

export type VersionRef = { id: string; version: number };
export type ConversationRef = { projectId: string; moduleId: ModuleId; generation: number };
export type MessageRevision = ConversationRef & { messageId: string; revision: number; role: 'user' | 'assistant'; content: string; createdAt: string };
export type MemoryScope = { subject: 'our_project' | 'external_entity'; entityId: string | null; area: 'project' | 'stage' | 'scenario'; stageId: ModuleId | null; scenario: string | null };
export type SourceRef =
  | { type: 'message'; projectId: string; moduleId: ModuleId; generation: number; messageId: string; revision: number; quote: string }
  | { type: 'external'; evidenceId: string; version: number; quoteId: string }
  | { type: 'legacy'; label: string; quote: string };
export type AtomicValue = {
  kind: 'decision' | 'requirement' | 'constraint' | 'unknown' | 'rejected_option'; key: string; scope: MemoryScope; text: string;
  origin: 'user' | 'assistant' | 'external' | 'calculation' | 'legacy';
  epistemic: 'reported' | 'hypothesis' | 'observed' | 'calculated' | 'unknown';
  acceptance: 'proposed' | 'accepted' | 'rejected' | 'unresolved'; sources: SourceRef[]; dependsOn: VersionRef[];
};
export type AtomicEntry = AtomicValue & { id: string; version: number; previousVersion: number | null; createdAt: string; requestId: string | null };
export type MemoryOperation = { op: 'create'; localId: string; value: AtomicValue } | { op: 'revise'; id: string; expectedVersion: number; value: AtomicValue };
export type MemoryPatch = ConversationRef & {
  schemaVersion: 1; requestId: string; baseMemoryVersion: number; baseContextVersion: number;
  sourceMessage: { messageId: string; revision: number }; operations: MemoryOperation[];
};
export type ExternalEvidence = ConversationRef & {
  id: string; version: number; requestId: string; operationId: string; url: string; title: string; retrievedAt: string;
  publishedAt: string | null; effectiveAt: string | null; retrieval: 'read' | 'search_snippet' | 'unavailable'; contentHash: string;
  quotes: { id: string; text: string; start: number | null; end: number | null }[]; limitations: string[];
};
export type ExternalClaim = { text: string; evidenceId: string; version: number; quoteId: string; price: null | { amount: string; currency: string; unit: string; period: string; paymentTerms: string } };
export type CoreMemory = { schemaVersion: 1; revision: number; contextVersion: number; entries: AtomicEntry[]; sourceMessages: MessageRevision[]; evidence: ExternalEvidence[]; appliedRequestIds: string[] };
export type CoreContext = ConversationRef & {
  schemaVersion: 1; revision: number; contextVersion: number; currentEntryRefs: VersionRef[]; sourceMessage: { messageId: string; revision: number };
  entries: AtomicEntry[]; sourceMessages: MessageRevision[]; evidence: ExternalEvidence[];
};
export type ResearchProgress = { phase: 'planning' | 'searching' | 'reading' | 'composing' | 'finalizing' | 'reviewing'; message: string };
export type ResearchBundle = { status: 'not_needed' | 'completed' | 'partial' | 'failed'; evidence: ExternalEvidence[]; limitations: string[] };
export type ReplyDiagnostics = {
  action?: 'answer' | 'research'; methods?: { id: string; version: string; reason?: string }[];
  coreVersions?: { revision: number; contextVersion: number };
  operations?: { id: string; kind: 'plan' | 'search' | 'read' | 'generate' | 'skill' | 'evaluate'; state: 'started' | 'completed' | 'failed' | 'unknown'; inputHash?: string; errorCode?: string }[];
  skills?: { id: string; version: string }[];
  elapsedMs?: number; costUsd?: number | null;
};
