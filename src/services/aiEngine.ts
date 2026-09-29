// aiEngine.ts - Client-side wrapper for the Raspberry Pi AI Server
import { piBackendUrl, piHeaders } from './piBackend';

const getAiUrl = (endpoint: string) => {
    const piBackend = piBackendUrl();
    if (!piBackend) {
        throw new Error("No Raspberry Pi backend configured in .env");
    }
    return `${piBackend}${endpoint}`;
}

export type ThinkMode = 'review' | 'summarize' | 'ask';
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
    // Canvas thinking partner. `engine` says whether Claude or the Pi's local model answered.
    canvasThinkEngine: async (): Promise<'claude' | 'local'> => {
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
    }, signal?: AbortSignal): Promise<{ text: string; engine: 'claude' | 'local' }> => {
        const res = await fetch(getAiUrl('/api/canvas/think'), {
            method: 'POST',
            signal,
            headers: piHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await errorText(res));
        const json = await res.json();
        return { text: json.text, engine: json.engine };
    },


    getDailyBriefing: async (tasksJson: string) => {
        const res = await fetch(getAiUrl('/api/daily-briefing'), {
            method: 'POST',
            headers: piHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ tasks_json: tasksJson })
        });
        const json = await res.json();
        if (!json.success) throw new Error("AI failed to generate briefing");
        return json.data;
    }
}
