// aiEngine.ts - Client-side wrapper for the Raspberry Pi AI Server

const getAiUrl = (endpoint: string) => {
    const piBackend = import.meta.env.VITE_PI_BACKEND_URL;
    if (!piBackend) {
        throw new Error("No Raspberry Pi backend configured in .env");
    }
    return `${piBackend}${endpoint}`;
}

export const aiEngine = {
    parseBrainDump: async (text: string) => {
        const res = await fetch(getAiUrl('/api/parse-task'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ natural_language: text })
        });
        const json = await res.json();
        if (!json.success) throw new Error("AI failed to parse task");
        return json.data; // Expecting an array of tasks
    },

    getDailyBriefing: async (tasksJson: string) => {
        const res = await fetch(getAiUrl('/api/daily-briefing'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tasks_json: tasksJson })
        });
        const json = await res.json();
        if (!json.success) throw new Error("AI failed to generate briefing");
        return json.data;
    }
}
