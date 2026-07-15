export type RuleConditionField = 'from' | 'to' | 'subject'
export type RuleConditionOperator = 'contains' | 'equals'

export interface RuleCondition {
  field: RuleConditionField
  operator: RuleConditionOperator
  value: string
}

export type RuleActionType = 'move' | 'mark_read' | 'delete' | 'star'

export interface RuleAction {
  type: RuleActionType
  params?: {
    folder?: string
  }
}

export interface EmailRule {
  id: string
  user_id: string
  name: string
  conditions: RuleCondition[]
  actions: RuleAction[]
  is_active: boolean
  priority: number
  created_at: string
}

export interface InboundRuleResult {
  folder?: string
  markRead?: boolean
  delete?: boolean
  star?: boolean
}
