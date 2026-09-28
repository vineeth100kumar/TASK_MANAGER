// aiEngine.ts - Client-side wrapper for the Raspberry Pi AI Server
import { piBackendUrl, piHeaders } from './piBackend';

const getAiUrl = (endpoint: string) => {
    const piBackend = piBackendUrl();
    if (!piBackend) {
        throw new Error("No Raspberry Pi backend configured in .env");
    }
    return `${piBackend}${endpoint}`;
}

export const aiEngine = {
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
