import {
  WorkItem, WorkItemUpdatePayload, Milestone, Project, DailyPerformance,
  FinanceSummary, Transaction, AiGreetingResponse,
  FinanceAccount, WeatherData, DailyReflection, KickoffData, DebriefResult,
  RecurringBill, BudgetGuardrail
} from '../types';

const BASE_URL = '';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || `HTTP error ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Items (Tasks, Events, Reminders)
  getItems: (params?: { entity_type?: string; status?: string; priority?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return fetchJson<WorkItem[]>(`/api/v1/items${query ? `?${query}` : ''}`);
  },
  createItem: (item: Omit<Partial<WorkItem>, 'subtasks'> & { subtasks?: string[] }) =>
    fetchJson<WorkItem>('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify(item),
    }),
  updateItem: (id: string, updates: WorkItemUpdatePayload) =>
    fetchJson<WorkItem>(`/api/v1/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
  deleteItem: (id: string) =>
    fetchJson<{ success: boolean; id: string }>(`/api/v1/items/${id}`, {
      method: 'DELETE',
    }),
  toggleSubtask: (subtaskId: string) =>
    fetchJson<{ success: boolean; id: string; is_completed: boolean }>(
      `/api/v1/items/subtasks/${subtaskId}/toggle`,
      { method: 'PATCH' }
    ),

  // Projects & Milestones
  getProjects: () => fetchJson<Project[]>('/api/v1/items/projects'),
  createProject: (proj: { name: string; color?: string; description?: string }) =>
    fetchJson<Project>('/api/v1/items/projects', {
      method: 'POST',
      body: JSON.stringify(proj),
    }),
  deleteProject: (id: string) =>
    fetchJson<{ success: boolean; id: string }>(`/api/v1/items/projects/${id}`, {
      method: 'DELETE',
    }),
  getMilestones: () => fetchJson<Milestone[]>('/api/v1/items/milestones'),
  createMilestone: (m: { project_id?: string; title: string; due_date: string }) =>
    fetchJson<Milestone>('/api/v1/items/milestones', {
      method: 'POST',
      body: JSON.stringify(m),
    }),
  deleteMilestone: (id: string) =>
    fetchJson<{ success: boolean; id: string }>(`/api/v1/items/milestones/${id}`, {
      method: 'DELETE',
    }),

  // Dashboard & Daily Performance
  getTodayDashboard: () => fetchJson<DailyPerformance>('/api/v1/dashboard/today'),

  // Finance Tracker
  getFinanceSummary: () => fetchJson<FinanceSummary>('/api/v1/finance/summary'),
  getTransactions: (limit = 30) =>
    fetchJson<Transaction[]>(`/api/v1/finance/transactions?limit=${limit}`),
  createTransaction: (tx: {
    account_id: string;
    category_id?: string;
    type: 'expense' | 'income' | 'transfer';
    amount: number;
    payment_mode: 'upi' | 'debit_card' | 'cash' | 'net_banking' | 'credit_card';
    description?: string;
    transfer_to_account_id?: string;
    date: string;
  }) =>
    fetchJson<Transaction>('/api/v1/finance/transactions', {
      method: 'POST',
      body: JSON.stringify(tx),
    }),
  deleteTransaction: (id: string) =>
    fetchJson<{ success: boolean; id: string }>(`/api/v1/finance/transactions/${id}`, {
      method: 'DELETE',
    }),
  createAccount: (acc: { name: string; account_type: string; balance: number; currency?: string; is_upi_default?: boolean }) =>
    fetchJson<FinanceAccount>('/api/v1/finance/accounts', {
      method: 'POST',
      body: JSON.stringify(acc),
    }),
  updateAccount: (id: string, updates: Partial<{ name: string; balance: number; account_type: string; is_upi_default: boolean }>) =>
    fetchJson<FinanceAccount>(`/api/v1/finance/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
  deleteAccount: (id: string) =>
    fetchJson<{ success: boolean; id: string }>(`/api/v1/finance/accounts/${id}`, {
      method: 'DELETE',
    }),
  unifyUPI: (bankAccountId: string, mergeWalletId?: string) =>
    fetchJson<{ success: boolean; bank_account_id: string; merged_amount: number }>('/api/v1/finance/accounts/unify-upi', {
      method: 'POST',
      body: JSON.stringify({ bank_account_id: bankAccountId, merge_wallet_id: mergeWalletId }),
    }),
  splitUPI: (bankAccountId: string, walletName?: string, initialBalance?: number) =>
    fetchJson<{ success: boolean; wallet_id: string }>('/api/v1/finance/accounts/split-upi', {
      method: 'POST',
      body: JSON.stringify({
        bank_account_id: bankAccountId,
        wallet_name: walletName || 'UPI / Digital Wallet',
        initial_wallet_balance: initialBalance || 0,
      }),
    }),

  // Recurring Bills & Subscriptions
  getRecurringBills: () => fetchJson<RecurringBill[]>('/api/v1/finance/recurring-bills'),
  createRecurringBill: (bill: {
    name: string;
    amount: number;
    due_day_of_month: number;
    account_id?: string | null;
    category?: string;
    icon?: string;
    color?: string;
  }) =>
    fetchJson<RecurringBill>('/api/v1/finance/recurring-bills', {
      method: 'POST',
      body: JSON.stringify(bill),
    }),
  deleteRecurringBill: (id: string) =>
    fetchJson<{ success: boolean; id: string }>(`/api/v1/finance/recurring-bills/${id}`, {
      method: 'DELETE',
    }),

  // Budget Guardrails
  getBudgets: (year?: number, month?: number) => {
    const q = year && month ? `?year=${year}&month=${month}` : '';
    return fetchJson<BudgetGuardrail[]>(`/api/v1/finance/budgets${q}`);
  },
  setBudget: (budget: {
    category_id: string;
    monthly_limit: number;
    period_year?: number;
    period_month?: number;
  }) =>
    fetchJson<BudgetGuardrail>('/api/v1/finance/budgets', {
      method: 'POST',
      body: JSON.stringify(budget),
    }),
  deleteBudget: (id: string) =>
    fetchJson<{ success: boolean; id: string }>(`/api/v1/finance/budgets/${id}`, {
      method: 'DELETE',
    }),

  // Morning Kickoff & Evening Debrief Wizard
  getKickoff: () => fetchJson<KickoffData>('/api/v1/planner/kickoff'),
  submitDebrief: (reflection: {
    date: string;
    big_rocks?: string[];
    reflection?: string;
    mood?: string;
  }) =>
    fetchJson<DebriefResult>('/api/v1/planner/debrief', {
      method: 'POST',
      body: JSON.stringify(reflection),
    }),
  getReflection: (date: string) => fetchJson<DailyReflection>(`/api/v1/planner/reflection/${date}`),
  listReflections: () => fetchJson<DailyReflection[]>('/api/v1/planner/reflections'),

  // Live Weather (Direct & Fast)
  getWeather: (lat = 28.6139, lon = 77.2090) =>
    fetchJson<WeatherData>(`/api/v1/weather?lat=${lat}&lon=${lon}`),

  // Local AI Services
  getAiGreeting: (name = 'Chief') =>
    fetchJson<AiGreetingResponse>(`/api/v1/ai/greeting?name=${encodeURIComponent(name)}`),
  parseBrainDump: (natural_language: string) =>
    fetchJson<{ success: boolean; items: any[] }>('/api/v1/ai/parse-brain-dump', {
      method: 'POST',
      body: JSON.stringify({ natural_language }),
    }),
  autoFillTask: (title: string, context?: string) =>
    fetchJson<{
      success: boolean;
      data: { description: string; subtasks: string[]; estimated_minutes: number; priority: string };
    }>('/api/v1/ai/auto-fill', {
      method: 'POST',
      body: JSON.stringify({ title, context }),
    }),
  improveTask: (title: string, context?: string, entity_type?: string) =>
    fetchJson<{
      success: boolean;
      data: {
        improved_title: string;
        description: string;
        subtasks: string[];
        priority: string;
        energy: string;
        estimated_minutes: number;
        category: string;
      };
    }>('/api/v1/ai/improve-task', {
      method: 'POST',
      body: JSON.stringify({ title, context, entity_type }),
    }),
  organizeBoard: (tasks?: any[]) =>
    fetchJson<{
      success: boolean;
      data: {
        total_pending: number;
        total_estimated_hours: number;
        executive_summary: string;
        big_rocks: any[];
        title_improvements: { id: string; current_title: string; improved_title: string; priority: string }[];
        missing_subtasks_count: number;
      };
    }>('/api/v1/ai/organize-board', {
      method: 'POST',
      body: JSON.stringify({ tasks }),
    }),

  // Web Push
  subscribePush: (sub: { endpoint: string; p256dh: string; auth: string; device_name?: string }) =>
    fetchJson<{ success: boolean; id: string }>('/api/v1/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(sub),
    }),
};
