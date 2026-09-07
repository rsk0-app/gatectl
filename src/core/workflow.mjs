export const COMMAND_NAMES = { lock: 'spec-check', red: 'test-red', green: 'test-green', 'gate fast': 'check', 'gate full': 'check-all', 'gate x': 'review-check', 'commit-check': 'ready-to-commit', complete: 'finish' }
export function readableCommand(command) {
  if (!command) return command
  for (const [old, name] of Object.entries(COMMAND_NAMES)) {
    const prefix = `gatectl ${old}`
    if (command === prefix || command.startsWith(prefix + ' ')) return command.replace(prefix, `gatectl ${name}`)
  }
  return command
}
export function configureWorkflow(policy, mode) {
  if (!['fast', 'strict'].includes(mode)) throw new Error('workflow mode must be fast or strict')
  const next = structuredClone(policy)
  next.workflow = { ...next.workflow, mode, cache: true }
  if (mode === 'fast') {
    next.workflow.strict_requires = Object.fromEntries(Object.entries(next.tiers ?? {}).map(([name, tier]) => [name, [...tier.requires]]))
    for (const tier of Object.values(next.tiers ?? {})) tier.requires = ['Gfull', 'X']
    if (next.critic) next.critic.required_for_tiers = []
  } else {
    for (const [name, tier] of Object.entries(next.tiers ?? {})) tier.requires = next.workflow.strict_requires?.[name] ?? ['L', 'R', 'Gfull', 'X']
    if (next.critic) next.critic.required_for_tiers = Object.keys(next.tiers ?? {}).filter(t => next.tiers[t].requires.includes('L'))
  }
  return next
}
