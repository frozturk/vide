const LABELS: Record<string, string> = {
  Bash: 'Running',
  shell: 'Running',
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Write: 'Writing',
  NotebookEdit: 'Editing',
  apply_patch: 'Editing',
  Grep: 'Searching',
  Glob: 'Searching',
  WebFetch: 'Browsing',
  WebSearch: 'Searching the web',
  Task: 'Delegating',
  Agent: 'Delegating',
  TodoWrite: 'Planning',
  AskUserQuestion: 'Asking'
}

export function activityLabel(activity: string | null | undefined): string {
  if (!activity) return 'Working'
  if (activity === 'Thinking') return 'Thinking'
  if (activity.startsWith('mcp__')) return activity.split('__').pop() || 'Working'
  return LABELS[activity] ?? activity
}
