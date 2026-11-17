import { MODULES } from './modules.js';
import type { ModuleId, Project } from './types.js';
import { getCurrentEntries } from './coreMemory.js';
import { collectArtifacts } from './chatContext.js';

export function getStageWelcome(project: Project, moduleId: ModuleId): { message: string; prompt: string | null; materials: ModuleId[] } {
  // Presence is enough: free-form material is never parsed into asserted facts here.
  const materials = collectArtifacts(project, moduleId).map(artifact => artifact.moduleId);
  const hasCore = project.core && getCurrentEntries(project.core).some(entry => entry.acceptance === 'accepted' || entry.kind === 'unknown' || entry.kind === 'constraint');
  if (!hasCore && !project.description.trim() && !Object.keys(project.facts).length && !materials.length) return { message: MODULES[moduleId].welcome, prompt: null, materials };
  return {
    message: MODULES[moduleId].welcome,
    // Context, provenance and the stage's method already accompany the request.
    // Keep the message attributed to the user readable in the conversation.
    prompt: `Начнём этап «${MODULES[moduleId].title}». Учти то, что мы уже обсудили о проекте.`,
    materials,
  };
}
