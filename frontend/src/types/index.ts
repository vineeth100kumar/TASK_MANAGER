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
  context_tags?: string;
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
  total_task_count?: number;
  completed_task_count?: number;
  progress_percentage?: number;
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
  is_upi_default?: boolean;
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

export interface DailyReflection {
  id?: string;
  date: string;
  big_rocks: string[];
  reflection: string;
  mood?: string;
  completed_count?: number;
  planned_count?: number;
  migrated_tasks_count?: number;
  created_at?: string;
}

export interface KickoffData {
  date: string;
  active_tasks: WorkItem[];
  big_rock_suggestions: { id: string; title: string; priority: TaskPriority; due_date?: string }[];
  today_events: { id: string; title: string; start_at?: string; end_at?: string; estimated_minutes: number }[];
  existing_reflection?: DailyReflection | null;
  streak_days: number;
  total_active_tasks: number;
}

export interface DebriefResult {
  success: boolean;
  date: string;
  completed_today: number;
  planned: number;
  migrated_to_tomorrow: number;
  reflection_id: string;
}

export interface RecurringBill {
  id: string;
  name: string;
  amount: number;
  due_day_of_month: number;
  account_id?: string | null;
  category: string;
  icon: string;
  color: string;
  is_active: boolean;
  days_until_due: number;
  is_overdue: boolean;
  created_at: string;
}

export interface BudgetGuardrail {
  id: string;
  category_id: string;
  category_name?: string;
  monthly_limit: number;
  period_year: number;
  period_month: number;
  spent_this_month: number;
  budget_percentage: number;
  status: 'ok' | 'warning' | 'danger' | 'exceeded';
  created_at: string;
}

// ==========================================
// WHITEBOARD / DRAWING BOARD TYPES
// ==========================================

export type WhiteboardTool =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'laser'
  | 'eraser'
  | 'shape'
  | 'sticky'
  | 'text'
  | 'hand';

export type WhiteboardGridType = 'dots' | 'graph' | 'ruled' | 'blank';

export type StickyColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'orange';

export type ShapeType = 'rectangle' | 'circle' | 'arrow' | 'line' | 'diamond';

export interface Point {
  x: number;
  y: number;
  pressure?: number;
  t?: number;
}

export interface StrokeElement {
  id: string;
  type: 'stroke';
  points: Point[];
  color: string;
  size: number;
  isHighlighter?: boolean;
  opacity?: number;
}

export interface ShapeElement {
  id: string;
  type: 'shape';
  shapeType: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fillColor?: string;
  strokeWidth: number;
  text?: string;
  textColor?: string;
  fontSize?: number;
}

export interface StickyElement {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  width: number;
  height: number;
  color: StickyColor;
  text: string;
  convertedTaskId?: string;
}

export interface TextElement {
  id: string;
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  width?: number;
}

export interface ImageElement {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
}

export type WhiteboardElement =
  | StrokeElement
  | ShapeElement
  | StickyElement
  | TextElement
  | ImageElement;

export interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface Whiteboard {
  id: string;
  title: string;
  project_id?: string | null;
  project_name?: string | null;
  project_color?: string | null;
  elements: WhiteboardElement[];
  view_state: ViewState;
  thumbnail_data?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhiteboardListItem {
  id: string;
  title: string;
  project_id?: string | null;
  project_name?: string | null;
  project_color?: string | null;
  created_at: string;
  updated_at: string;
}


// ---------------------------------------------------------------------------
// Natural-language capture & local AI state
// ---------------------------------------------------------------------------

export interface CaptureToken {
  type: 'date' | 'time' | 'priority' | 'project' | 'tag' | 'estimate' | 'entity' | 'repeat' | 'expense';
  text: string;
  display: string;
}

export interface CapturedItem {
  id?: string;
  title: string;
  source_text: string;
  entity_type: EntityType;
  status: TaskStatus;
  priority: TaskPriority;
  energy: TaskEnergy;
  description?: string | null;
  due_date?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  remind_at?: string | null;
  repeat_rule?: string | null;
  estimated_minutes: number;
  context_tags: string;
  project_id?: string | null;
  project_name?: string | null;
  expense?: { amount: number; payment_mode: string; description?: string } | null;
  tokens: CaptureToken[];
  /** The hour had no am/pm and was inferred, so it is worth showing plainly. */
  time_is_ambiguous: boolean;
}

export interface CaptureResult {
  success: boolean;
  committed: boolean;
  items: CapturedItem[];
  transactions?: { id: string; amount: number; payment_mode: string; description: string }[];
  detail?: string;
}

/** What the Pi's local model is doing right now. */
export interface AiStatus {
  busy: boolean;
  active_requests: number;
  /** False until the model has answered once since boot; the first call is slow. */
  warm: boolean;
  typical_seconds: number | null;
  next_timeout_seconds: number;
  consecutive_failures: number;
  last_error: string | null;
  samples: number;
}

/** Pushed over the WebSocket when the model starts and stops. */
export interface AiBusyEvent {
  busy: boolean;
  label: string;
  expected_seconds: number;
  elapsed_seconds?: number;
}
