from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Dict, Any

# ========================================================
# WORK ITEMS (Tasks, Events, Reminders) & MILESTONES
# ========================================================

EntityType = Literal["task", "event", "reminder"]
TaskStatus = Literal["inbox", "todo", "in_progress", "done", "blocked", "archived"]
TaskPriority = Literal["low", "medium", "high", "urgent"]
TaskEnergy = Literal["low", "medium", "high"]

class SubtaskCreate(BaseModel):
    title: str
    is_completed: bool = False
    position: int = 0

class SubtaskResponse(BaseModel):
    id: str
    work_item_id: str
    title: str
    is_completed: bool
    position: int
    created_at: str

class WorkItemBase(BaseModel):
    title: str
    description: Optional[str] = None
    entity_type: EntityType = "task"
    status: TaskStatus = "todo"
    priority: TaskPriority = "medium"
    energy: TaskEnergy = "medium"
    due_date: Optional[str] = None # YYYY-MM-DD
    start_at: Optional[str] = None # ISO datetime
    end_at: Optional[str] = None   # ISO datetime
    remind_at: Optional[str] = None # ISO datetime
    repeat_rule: Optional[str] = None # daily, weekly:mon,tue, monthly:1, custom:7d
    project_id: Optional[str] = None
    milestone_id: Optional[str] = None
    estimated_minutes: int = 30
    actual_minutes: int = 0
    depends_on: List[str] = Field(default_factory=list)
    context_tags: str = ""

class WorkItemCreate(WorkItemBase):
    subtasks: Optional[List[str]] = None

class WorkItemUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    entity_type: Optional[EntityType] = None
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    energy: Optional[TaskEnergy] = None
    due_date: Optional[str] = None
    start_at: Optional[str] = None
    end_at: Optional[str] = None
    remind_at: Optional[str] = None
    repeat_rule: Optional[str] = None
    project_id: Optional[str] = None
    milestone_id: Optional[str] = None
    estimated_minutes: Optional[int] = None
    actual_minutes: Optional[int] = None
    depends_on: Optional[List[str]] = None
    is_completed: Optional[bool] = None
    context_tags: Optional[str] = None
    subtasks: Optional[List[str]] = None

class WorkItemResponse(WorkItemBase):
    id: str
    is_completed: bool
    completed_at: Optional[str] = None
    next_occurrence: Optional[str] = None
    created_at: str
    updated_at: str
    subtasks: List[SubtaskResponse] = Field(default_factory=list)

class ProjectCreate(BaseModel):
    name: str
    color: str = "#3b82f6"
    description: Optional[str] = None

class ProjectResponse(BaseModel):
    id: str
    name: str
    color: str
    description: Optional[str] = None
    created_at: str
    total_task_count: int = 0
    completed_task_count: int = 0
    progress_percentage: int = 0

class MilestoneCreate(BaseModel):
    project_id: Optional[str] = None
    title: str
    due_date: str # YYYY-MM-DD

class MilestoneResponse(BaseModel):
    id: str
    project_id: Optional[str] = None
    title: str
    due_date: str
    status: str
    created_at: str
    linked_task_count: int = 0
    completed_task_count: int = 0
    progress_percentage: int = 0

# ========================================================
# DAILY PERFORMANCE & REVIEW
# ========================================================

class DailyPerformance(BaseModel):
    date: str
    tasks_planned: int
    tasks_completed: int
    completion_rate: int # 0-100%
    focus_minutes_logged: int
    productivity_score: int
    streak_days: int
    timeline: List[Dict[str, Any]] = Field(default_factory=list)

# ========================================================
# MORNING / EVENING WIZARD REFLECTIONS
# ========================================================

class DailyReflectionCreate(BaseModel):
    date: str  # YYYY-MM-DD
    big_rocks: Optional[List[str]] = None
    reflection: Optional[str] = ""
    mood: Optional[str] = ""

class DailyReflectionResponse(BaseModel):
    id: str
    date: str
    big_rocks: List[str] = Field(default_factory=list)
    reflection: str = ""
    mood: str = ""
    completed_count: int = 0
    planned_count: int = 0
    migrated_tasks_count: int = 0
    created_at: str
    updated_at: str

# ========================================================
# PERSONAL FINANCE TRACKER
# ========================================================

AccountType = Literal["bank", "cash", "wallet", "credit"]
TransactionType = Literal["expense", "income", "transfer"]
PaymentMode = Literal["upi", "debit_card", "cash", "net_banking", "credit_card"]

class FinanceAccountCreate(BaseModel):
    name: str
    account_type: AccountType
    balance: float
    currency: str = "INR"

class FinanceAccountUpdate(BaseModel):
    name: Optional[str] = None
    account_type: Optional[AccountType] = None
    balance: Optional[float] = None
    currency: Optional[str] = None

class FinanceAccountResponse(BaseModel):
    id: str
    name: str
    account_type: AccountType
    balance: float
    currency: str
    updated_at: str

class FinanceCategoryCreate(BaseModel):
    name: str
    icon: Optional[str] = "Tag"
    monthly_budget: float = 0.0

class FinanceCategoryResponse(BaseModel):
    id: str
    name: str
    icon: Optional[str]
    monthly_budget: float
    spent_this_month: float = 0.0
    budget_percentage: int = 0

class TransactionCreate(BaseModel):
    account_id: str
    category_id: Optional[str] = None
    type: TransactionType
    amount: float
    payment_mode: PaymentMode
    description: Optional[str] = None
    transfer_to_account_id: Optional[str] = None
    date: str # YYYY-MM-DD

class TransactionResponse(BaseModel):
    id: str
    account_id: str
    account_name: Optional[str] = None
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    type: TransactionType
    amount: float
    payment_mode: PaymentMode
    description: Optional[str] = None
    transfer_to_account_id: Optional[str] = None
    transfer_to_account_name: Optional[str] = None
    date: str
    created_at: str

# ========================================================
# RECURRING BILLS & SUBSCRIPTION RADAR
# ========================================================

class RecurringBillCreate(BaseModel):
    name: str
    amount: float
    due_day_of_month: int
    account_id: Optional[str] = None
    category: str = "Utilities & Bills"
    icon: str = "Receipt"
    color: str = "#6366f1"

class RecurringBillResponse(BaseModel):
    id: str
    name: str
    amount: float
    due_day_of_month: int
    account_id: Optional[str] = None
    category: str
    icon: str
    color: str
    is_active: bool
    days_until_due: int   # computed: negative = overdue
    is_overdue: bool
    created_at: str

# ========================================================
# FINANCE BUDGET GUARDRAILS
# ========================================================

class BudgetCreate(BaseModel):
    category_id: str
    monthly_limit: float
    period_year: Optional[int] = None   # defaults to current year
    period_month: Optional[int] = None  # defaults to current month

class BudgetResponse(BaseModel):
    id: str
    category_id: str
    category_name: Optional[str] = None
    monthly_limit: float
    period_year: int
    period_month: int
    spent_this_month: float = 0.0
    budget_percentage: int = 0
    status: str = "ok"   # ok | warning | danger | exceeded
    created_at: str

# ========================================================
# SIRI & SHORTCUTS QUICK-ADD
# ========================================================

class SiriQuickTask(BaseModel):
    input_text: str

class SiriQuickExpense(BaseModel):
    amount: float
    payment_mode: PaymentMode = "upi"
    category: Optional[str] = "Food & Dining"
    description: Optional[str] = None
    account_id: Optional[str] = None

# ========================================================
# PUSH NOTIFICATIONS
# ========================================================

class PushSubscriptionCreate(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
    device_name: Optional[str] = "iOS Safari"
