import { getPool } from './db.service'
import { validateFolderId } from './folder.service'
import type {
  EmailRule,
  InboundRuleResult,
  RuleAction,
  RuleCondition,
} from '../types/rule'

interface RuleRow {
  id: string
  user_id: string
  name: string
  conditions: RuleCondition[]
  actions: RuleAction[]
  is_active: boolean
  priority: number
  created_at: Date
}

function mapRule(row: RuleRow): EmailRule {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    conditions: row.conditions ?? [],
    actions: row.actions ?? [],
    is_active: row.is_active,
    priority: row.priority,
    created_at: row.created_at.toISOString(),
  }
}

export async function listRules(userId: string): Promise<EmailRule[]> {
  const { rows } = await getPool().query<RuleRow>(
    `SELECT id, user_id, name, conditions, actions, is_active, priority, created_at
     FROM email_rules
     WHERE user_id = $1
     ORDER BY priority DESC, created_at`,
    [userId],
  )
  return rows.map(mapRule)
}

export interface UpsertRuleInput {
  name: string
  conditions: RuleCondition[]
  actions: RuleAction[]
  isActive?: boolean
  priority?: number
}

function validateRuleInput(input: UpsertRuleInput): void {
  if (!input.name.trim()) throw new Error('Rule name is required')
  if (input.conditions.length === 0) throw new Error('At least one condition is required')
  if (input.actions.length === 0) throw new Error('At least one action is required')

  for (const action of input.actions) {
    if (action.type === 'move') {
      const folder = action.params?.folder
      if (!folder || !validateFolderId(folder)) {
        throw new Error('Invalid folder in move action')
      }
    }
  }
}

export async function createRule(userId: string, input: UpsertRuleInput): Promise<EmailRule> {
  validateRuleInput(input)
  const { rows } = await getPool().query<RuleRow>(
    `INSERT INTO email_rules (user_id, name, conditions, actions, is_active, priority)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, name, conditions, actions, is_active, priority, created_at`,
    [
      userId,
      input.name.trim(),
      JSON.stringify(input.conditions),
      JSON.stringify(input.actions),
      input.isActive ?? true,
      input.priority ?? 0,
    ],
  )
  return mapRule(rows[0])
}

export async function updateRule(
  userId: string,
  ruleId: string,
  input: UpsertRuleInput,
): Promise<EmailRule | null> {
  validateRuleInput(input)
  const { rows } = await getPool().query<RuleRow>(
    `UPDATE email_rules SET
       name = $3, conditions = $4, actions = $5, is_active = $6, priority = $7
     WHERE id = $1 AND user_id = $2
     RETURNING id, user_id, name, conditions, actions, is_active, priority, created_at`,
    [
      ruleId,
      userId,
      input.name.trim(),
      JSON.stringify(input.conditions),
      JSON.stringify(input.actions),
      input.isActive ?? true,
      input.priority ?? 0,
    ],
  )
  return rows[0] ? mapRule(rows[0]) : null
}

export async function deleteRule(userId: string, ruleId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'DELETE FROM email_rules WHERE id = $1 AND user_id = $2',
    [ruleId, userId],
  )
  return (rowCount ?? 0) > 0
}

function matchCondition(
  condition: RuleCondition,
  mail: { fromAddress: string; subject: string; toAddresses: string },
): boolean {
  const value = condition.value.trim().toLowerCase()
  if (!value) return false

  let fieldValue = ''
  if (condition.field === 'from') fieldValue = mail.fromAddress.toLowerCase()
  if (condition.field === 'subject') fieldValue = mail.subject.toLowerCase()
  if (condition.field === 'to') fieldValue = mail.toAddresses.toLowerCase()

  if (condition.operator === 'equals') return fieldValue === value
  return fieldValue.includes(value)
}

export async function applyInboundRules(
  userId: string,
  mail: { fromAddress: string; subject: string; toAddresses: string },
): Promise<InboundRuleResult> {
  const rules = await listRules(userId)
  const result: InboundRuleResult = {}

  for (const rule of rules) {
    if (!rule.is_active) continue
    const matches = rule.conditions.every((c) => matchCondition(c, mail))
    if (!matches) continue

    for (const action of rule.actions) {
      if (action.type === 'move' && action.params?.folder) {
        result.folder = action.params.folder
      }
      if (action.type === 'mark_read') result.markRead = true
      if (action.type === 'delete') result.delete = true
      if (action.type === 'star') result.star = true
    }
    break
  }

  return result
}
