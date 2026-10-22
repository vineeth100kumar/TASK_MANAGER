// aiEngine.ts - Client-side wrapper for the Raspberry Pi AI Server
import { piBackendUrl, piHeaders } from './piBackend';

const getAiUrl = (endpoint: string) => {
    const piBackend = piBackendUrl();
    if (!piBackend) {
        throw new Error("No Raspberry Pi backend configured in .env");
    }
    return `${piBackend}${endpoint}`;
}

export type ThinkMode = 'review' | 'summarize' | 'ask' | 'edit';
// Which AI answered: Groq, Claude, or the Pi's own small model.
export type ThinkEngine = 'groq' | 'claude' | 'local';
// How big a chart the AI draws: a short chain, the main steps, or full detail.
export type ThinkDetail = 'simple' | 'moderate' | 'complex';
export interface ThinkTurn { role: 'user' | 'assistant'; text: string }

// Pulls the server's explanation out of a failed response.
const errorText = async (res: Response): Promise<string> => {
    try {
        const json = await res.json();
        return json.detail || json.error || `HTTP ${res.status}`;
    } catch {
        return `HTTP ${res.status}`;
    }
};

export const aiEngine = {
    // Canvas thinking partner. `engine` says which AI answered; `ops` are board edits (edit mode).
    canvasThinkEngine: async (): Promise<ThinkEngine> => {
        const res = await fetch(getAiUrl('/api/canvas/think'), { headers: piHeaders() });
        if (!res.ok) throw new Error(await errorText(res));
        return (await res.json()).engine;
    },

    canvasThink: async (payload: {
        mode: ThinkMode;
        boardTitle: string;
        outline: string;
        imagePng?: string | null;
        question?: string;
        history: ThinkTurn[];
        detail?: ThinkDetail;
        scope?: string[]; // selected shapes that changes are limited to
        document?: string;
        documentName?: string;
        documentRole?: 'new' | 'source'; // a file to chart, or the one the board came from
    }, signal?: AbortSignal): Promise<{ text: string; engine: ThinkEngine; ops?: unknown[] }> => {
        const res = await fetch(getAiUrl('/api/canvas/think'), {
            method: 'POST',
            signal,
            headers: piHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await errorText(res));
        const json = await res.json();
        return { text: json.text, engine: json.engine, ops: json.ops };
    },


    // Chat capture in New Item: only what the app couldn't place itself. Groq on the Pi,
    // else the Pi's local model; the reply names come back as ids from the lists sent.
    chatCaptureEngine: async (): Promise<string> => {
        const res = await fetch(getAiUrl('/api/chat-capture'), { headers: piHeaders() });
        if (!res.ok) throw new Error(await errorText(res));
        return (await res.json()).engine;
    },

    chatCapture: async (payload: {
        mode: 'split' | 'edit';
        message: string;
        today: string;
        projects: { id: string; name: string; key: string; branches: { id: string; name: string }[] }[];
        areas: { id: string; name: string }[];
        openItems: { id: string; key: string; title: string; project: string }[];
        tags: string[];
        cards?: { title: string; kind: string; project: string; branch: string; area: string; context: string; when: string; priority: string }[];
    }, signal?: AbortSignal): Promise<{ engine: string; items?: any[]; changes?: any[]; reply?: string }> => {
        const res = await fetch(getAiUrl('/api/chat-capture'), {
            method: 'POST',
            signal,
            headers: piHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await errorText(res));
        return res.json();
    },

    // A goal broken into a plan, or a plan changed by a follow-up. Groq only.
    chatPlan: async (payload: {
        mode: 'plan' | 'plan_edit';
        message: string;
        today: string;
        planMode: 'new' | 'existing' | 'steps';
        target?: string;
        targetItems?: string[];
        typeHint?: string;
        days?: number | null;
        plan?: { name: string; type: string; phases: string[]; tasks: { title: string; phase: number; days: number; priority: string }[] };
    }, signal?: AbortSignal): Promise<{ engine: string; plan: any }> => {
        const res = await fetch(getAiUrl('/api/chat-capture'), {
            method: 'POST',
            signal,
            headers: piHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await errorText(res));
        return res.json();
    },

    // Tidy one task's name and add a short description, informed by the project's
    // other tasks. Groq on the Pi, else the Pi's local model.
    refineItem: async (payload: {
        title: string;
        project?: string;
        projectType?: string;
        pastTitles?: string[];
        today?: string;
    }, signal?: AbortSignal): Promise<{ engine: string; title: string; description: string }> => {
        const res = await fetch(getAiUrl('/api/chat-capture'), {
            method: 'POST',
            signal,
            headers: piHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                mode: 'refine',
                message: payload.title,
                today: payload.today || '',
                target: payload.project || '',
                typeHint: payload.projectType || '',
                targetItems: payload.pastTitles || [],
            }),
        });
        if (!res.ok) throw new Error(await errorText(res));
        return res.json();
    },
}
