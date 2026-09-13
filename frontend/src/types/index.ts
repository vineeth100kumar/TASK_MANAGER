export type EntityType = 'task' | 'event' | 'reminder';
export type TaskStatus = 'inbox' | 'todo' | 'in_progress' | 'done' | 'blocked' | 'archived';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskEnergy = 'low' | 'medium' | 'high';

export interface Subtask {
  id: string;
  work_item_id: string;
  title: string;
  is_completed: boolean;
  position: number;
}

export interface WorkItem {
  id: string;
  title: string;
  description?: string | null;
  entity_type: EntityType;
  status: TaskStatus;
  priority: TaskPriority;
  energy: TaskEnergy;
  due_date?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  remind_at?: string | null;
  repeat_rule?: string | null;
  next_occurrence?: string | null;
  project_id?: string | null;
  milestone_id?: string | null;
  estimated_minutes: number;
  actual_minutes: number;
  depends_on: string[];
  is_completed: boolean;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  subtasks: Subtask[];
}

export type WorkItemUpdatePayload = Omit<Partial<WorkItem>, 'subtasks'> & { subtasks?: string[] };

export interface Milestone {
  id: string;
  project_id?: string | null;
  title: string;
  due_date: string;
  status: 'pending' | 'achieved' | 'delayed';
  created_at: string;
  linked_task_count: number;
  completed_task_count: number;
  progress_percentage: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  description?: string | null;
  created_at: string;
}

export interface DailyPerformance {
  date: string;
  tasks_planned: number;
  tasks_completed: number;
  completion_rate: number;
  focus_minutes_logged: number;
  productivity_score: number;
  urgent_task_count: number;
  streak_days: number;
  timeline: {
    id: string;
    title: string;
    completed_at: string;
    priority: TaskPriority;
    entity_type: EntityType;
  }[];
}

export type AccountType = 'bank' | 'cash' | 'wallet' | 'credit';
export type TransactionType = 'expense' | 'income' | 'transfer';
export type PaymentMode = 'upi' | 'debit_card' | 'cash' | 'net_banking' | 'credit_card';

export interface FinanceAccount {
  id: string;
  name: string;
  account_type: AccountType;
  balance: number;
  currency: string;
  updated_at: string;
}

export interface FinanceCategory {
  id: string;
  name: string;
  icon?: string;
  monthly_budget: number;
  spent_this_month: number;
  budget_percentage: number;
}

export interface Transaction {
  id: string;
  account_id: string;
  account_name?: string;
  category_id?: string | null;
  category_name?: string | null;
  type: TransactionType;
  amount: number;
  payment_mode: PaymentMode;
  description?: string | null;
  transfer_to_account_id?: string | null;
  transfer_to_account_name?: string | null;
  date: string;
  created_at: string;
}

export interface FinanceSummary {
  accounts: FinanceAccount[];
  net_worth: number;
  total_bank: number;
  total_cash: number;
  total_wallet: number;
  today_spend: number;
  today_breakdown: {
    upi: number;
    debit_card: number;
    cash: number;
  };
  monthly_spend: number;
  monthly_budget: number;
  categories: FinanceCategory[];
}

export interface WeatherData {
  temperature: number;
  apparent_temperature: number;
  humidity: number;
  precipitation: number;
  rain_probability: number;
  temp_max: number;
  temp_min: number;
  condition: string;
  icon: string;
  wind_speed: number;
  source: string;
}

export interface AiGreetingResponse {
  greeting: string;
  weather: WeatherData;
  stats: {
    planned: number;
    completed: number;
    urgent: number;
  };
}
