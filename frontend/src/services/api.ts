import {
  WorkItem, WorkItemUpdatePayload, Subtask, Milestone, Project, DailyPerformance,
  FinanceSummary, Transaction, AiGreetingResponse,
  FinanceAccount, WeatherData, DailyReflection, KickoffData, DebriefResult,
  RecurringBill, BudgetGuardrail, Whiteboard, WhiteboardListItem, WhiteboardElement, ViewState,
  AiStatus, CaptureResult
} from '../types';
import { getApiSecret, DEFAULT_LAT, DEFAULT_LON, DEFAULT_USER_NAME } from '../config';

/*
 * A rejected key has to reach the UI from anywhere a request is made, and
 * threading it back through every caller would touch every hook in the app.
 * Listeners are told once when the Pi says the key is wrong, and the app
 * responds by asking for it again.
 */
type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function reportUnauthorized(): void {
  unauthorizedListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A listener that throws must not break the request that found out.
    }
  });
}

const BASE_URL = '';

// Most calls to the Pi are a few milliseconds, so a short ceiling catches a
// dead backend quickly. Anything that waits on the local model needs its own,
// far longer budget -- see captureTimeoutMs below.
const DEFAULT_TIMEOUT_MS = 15000;

async function fetchJson<T>(url: string, options?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const token = getApiSecret();
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // A caller's own signal has to be chained rather than replace this one, or
  // passing a signal quietly removes the timeout and a stalled request hangs
  // forever.
  const callerSignal = options?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${BASE_URL}${url}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    });
    if (!res.ok) {
      if (res.status === 401) {
        // The key is missing or no longer the one the Pi expects -- after it
        // was rotated, for instance. Ask for it rather than showing a wall of
        // failed-to-sync toasts.
        reportUnauthorized();
      }
      const errText = await res.text();
      const error: any = new Error(errText || `HTTP error ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      if (!timedOut) {
        const cancelled: any = new Error(`Request cancelled: ${url}`);
        cancelled.cancelled = true;
        throw cancelled;
      }
      const timeout: any = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds: ${url}`);
      timeout.timedOut = true;
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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
  /*
   * A drop is described by the rows it landed between, not by an index.
   * Between the drag starting and the request landing, a websocket update
   * from another device may have re-sorted the list; neighbours still mean
   * the same thing afterwards, an index does not.
   */
  reorderItem: (id: string, move: { before_id?: string | null; after_id?: string | null }) =>
    fetchJson<WorkItem>(`/api/v1/items/${id}/reorder`, {
      method: 'POST',
      body: JSON.stringify(move),
    }),
  addSubtask: (itemId: string, title: string) =>
    fetchJson<Subtask>(`/api/v1/items/${itemId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  deleteSubtask: (subtaskId: string) =>
    fetchJson<{ success: boolean; id: string; work_item_id?: string }>(
      `/api/v1/items/subtasks/${subtaskId}`,
      { method: 'DELETE' }
    ),
  updateSubtask: (subtaskId: string, updates: { title?: string; is_completed?: boolean; position?: number }) =>
    fetchJson<Subtask>(`/api/v1/items/subtasks/${subtaskId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
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
  updateProject: (id: string, updates: Partial<{ name: string; color: string; description: string }>) =>
    fetchJson<Project>(`/api/v1/items/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
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
  getWeather: (lat = DEFAULT_LAT, lon = DEFAULT_LON) =>
    fetchJson<WeatherData>(`/api/v1/weather?lat=${lat}&lon=${lon}`),

  // Local AI Services
  getAiGreeting: (name = DEFAULT_USER_NAME) =>
    fetchJson<AiGreetingResponse>(`/api/v1/ai/greeting?name=${encodeURIComponent(name)}`),

  // Ask the Pi how long the model is currently taking, so the client can wait
  // as long as the backend intends to rather than cutting it off early.
  getAiStatus: () => fetchJson<AiStatus>('/api/v1/ai/status'),

  // Natural-language capture. Inference on a Pi pegs the CPU, so this call can
  // legitimately take tens of seconds on a cold model; the caller passes the
  // budget the backend just told us to expect.
  capture: (
    text: string,
    opts: {
      commit?: boolean;
      useAi?: boolean;
      timeoutMs?: number;
      signal?: AbortSignal;
      requestId?: string;
    } = {}
  ) =>
    fetchJson<CaptureResult>(
      '/api/v1/ai/capture',
      {
        method: 'POST',
        body: JSON.stringify({
          text,
          commit: opts.commit !== false,
          use_ai: opts.useAi !== false,
          // The same id on every attempt at one capture, so a retry is
          // answered with what the first attempt created rather than
          // creating a second copy of everything.
          ...(opts.requestId ? { request_id: opts.requestId } : {}),
        }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      opts.timeoutMs ?? 60000
    ),

  parseBrainDump: (natural_language: string) =>
    fetchJson<{ success: boolean; items: any[] }>('/api/v1/ai/parse-brain-dump', {
      method: 'POST',
      body: JSON.stringify({ natural_language }),
    }),
  autoFillTask: (title: string, context?: string, projectId?: string) =>
    fetchJson<{
      success: boolean;
      data: { description: string; subtasks: string[]; estimated_minutes: number; priority: string };
    }>('/api/v1/ai/auto-fill', {
      method: 'POST',
      body: JSON.stringify({ title, context, project_id: projectId }),
    }),
  improveTask: (title: string, context?: string, entity_type?: string, projectId?: string) =>
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
      body: JSON.stringify({ title, context, entity_type, project_id: projectId }),
    }),
  generateProjectDescription: (name: string) =>
    fetchJson<{
      success: boolean;
      data: { description: string };
    }>('/api/v1/ai/generate-project-description', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  getHomeMode: () =>
    fetchJson<{
      success: boolean;
      data: {
        home_mode: boolean;
        quiet_hours_schedule: string;
        is_quiet_hours_now: boolean;
        pending_projects: number;
        pending_tasks: number;
        can_run_now: boolean;
      };
    }>('/api/v1/ai/home-mode'),
  setHomeMode: (home_mode: boolean) =>
    fetchJson<{
      success: boolean;
      data: {
        home_mode: boolean;
        quiet_hours_schedule: string;
        is_quiet_hours_now: boolean;
        pending_projects: number;
        pending_tasks: number;
        can_run_now: boolean;
      };
    }>('/api/v1/ai/home-mode', {
      method: 'POST',
      body: JSON.stringify({ home_mode }),
    }),
  processBacklog: (force = false, max_items = 50) =>
    fetchJson<{
      success: boolean;
      data: {
        processed_projects: number;
        processed_tasks: number;
        deferred: boolean;
        reason: string;
        pending_projects: number;
        pending_tasks: number;
      };
    }>('/api/v1/ai/process-backlog', {
      method: 'POST',
      body: JSON.stringify({ force, max_items }),
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
  getVapidPublicKey: () =>
    fetchJson<{ public_key: string; configured: boolean }>('/api/v1/push/vapid-public-key'),

  // The same endpoint a Siri shortcut hits, used by the test button in Settings.
  siriQuickTask: (inputText: string) =>
    fetchJson<{ success: boolean; spoken_response: string; task_id: string; title: string }>(
      '/api/v1/shortcuts/quick-task',
      { method: 'POST', body: JSON.stringify({ input_text: inputText }) }
    ),

  subscribePush: (sub: { endpoint: string; p256dh: string; auth: string; device_name?: string }) =>
    fetchJson<{ success: boolean; id: string }>('/api/v1/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(sub),
    }),

  unsubscribePush: (endpoint: string) =>
    fetchJson<{ success: boolean }>(
      `/api/v1/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
      { method: 'DELETE' }
    ),

  // Whiteboards / Drawing Boards
  getWhiteboards: (projectId?: string) => {
    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    return fetchJson<WhiteboardListItem[]>(`/api/v1/whiteboards${query}`);
  },
  getWhiteboard: async (id: string): Promise<Whiteboard> => {
    const raw = await fetchJson<{
      id: string;
      title: string;
      project_id?: string | null;
      project_name?: string | null;
      project_color?: string | null;
      elements: string;
      view_state: string;
      thumbnail_data?: string | null;
      created_at: string;
      updated_at: string;
    }>(`/api/v1/whiteboards/${id}`);
    let elements: WhiteboardElement[] = [];
    try {
      elements = typeof raw.elements === 'string' ? JSON.parse(raw.elements || '[]') : raw.elements;
    } catch {
      elements = [];
    }
    let view_state: ViewState = { panX: 0, panY: 0, zoom: 1 };
    try {
      view_state = typeof raw.view_state === 'string' ? JSON.parse(raw.view_state || '{"panX": 0, "panY": 0, "zoom": 1}') : raw.view_state;
    } catch {
      view_state = { panX: 0, panY: 0, zoom: 1 };
    }
    return {
      ...raw,
      elements,
      view_state,
    };
  },
  createWhiteboard: async (payload: {
    title?: string;
    project_id?: string | null;
    elements?: WhiteboardElement[];
    view_state?: ViewState;
    thumbnail_data?: string | null;
  }): Promise<Whiteboard> => {
    const raw = await fetchJson<{
      id: string;
      title: string;
      project_id?: string | null;
      project_name?: string | null;
      project_color?: string | null;
      elements: string;
      view_state: string;
      thumbnail_data?: string | null;
      created_at: string;
      updated_at: string;
    }>('/api/v1/whiteboards', {
      method: 'POST',
      body: JSON.stringify({
        title: payload.title,
        project_id: payload.project_id,
        elements: JSON.stringify(payload.elements || []),
        view_state: JSON.stringify(payload.view_state || { panX: 0, panY: 0, zoom: 1 }),
        thumbnail_data: payload.thumbnail_data,
      }),
    });
    return {
      ...raw,
      elements: payload.elements || [],
      view_state: payload.view_state || { panX: 0, panY: 0, zoom: 1 },
    };
  },
  updateWhiteboard: async (
    id: string,
    payload: {
      title?: string;
      project_id?: string | null;
      elements?: WhiteboardElement[];
      view_state?: ViewState;
      thumbnail_data?: string | null;
    }
  ): Promise<Whiteboard> => {
    const body: Record<string, any> = {};
    if (payload.title !== undefined) body.title = payload.title;
    if (payload.project_id !== undefined) body.project_id = payload.project_id;
    if (payload.elements !== undefined) body.elements = JSON.stringify(payload.elements);
    if (payload.view_state !== undefined) body.view_state = JSON.stringify(payload.view_state);
    if (payload.thumbnail_data !== undefined) body.thumbnail_data = payload.thumbnail_data;

    const raw = await fetchJson<{
      id: string;
      title: string;
      project_id?: string | null;
      project_name?: string | null;
      project_color?: string | null;
      elements: string;
      view_state: string;
      thumbnail_data?: string | null;
      created_at: string;
      updated_at: string;
    }>(`/api/v1/whiteboards/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

    let elements: WhiteboardElement[] = payload.elements || [];
    if (payload.elements === undefined) {
      try {
        elements = typeof raw.elements === 'string' ? JSON.parse(raw.elements || '[]') : raw.elements;
      } catch {
        elements = [];
      }
    }

    let view_state: ViewState = payload.view_state || { panX: 0, panY: 0, zoom: 1 };
    if (payload.view_state === undefined) {
      try {
        view_state = typeof raw.view_state === 'string' ? JSON.parse(raw.view_state || '{"panX": 0, "panY": 0, "zoom": 1}') : raw.view_state;
      } catch {
        view_state = { panX: 0, panY: 0, zoom: 1 };
      }
    }

    return {
      ...raw,
      elements,
      view_state,
    };
  },
  deleteWhiteboard: (id: string) =>
    fetchJson<{ success: boolean; id: string }>(`/api/v1/whiteboards/${id}`, {
      method: 'DELETE',
    }),
};
