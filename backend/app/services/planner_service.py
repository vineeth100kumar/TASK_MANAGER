import datetime

def compute_big_rock_suggestions(tasks: list, limit: int = 5) -> list:
    """
    Smart Big Rock picker: scores tasks by urgency, priority, due proximity.
    Pure Python — instant, no Ollama needed.
    """
    today = datetime.date.today().isoformat()
    priority_score = {"urgent": 40, "high": 30, "medium": 15, "low": 5}
    energy_bonus = {"high": 5, "medium": 2, "low": 0}

    scored = []
    for t in tasks:
        score = priority_score.get(t.get("priority", "medium"), 15)
        score += energy_bonus.get(t.get("energy", "medium"), 0)
        due = t.get("due_date")
        if due:
            if due <= today:
                score += 20
            elif due == today:
                score += 15
        if t.get("status") == "in_progress":
            score += 10
        scored.append({**t, "_score": score})

    scored.sort(key=lambda x: x["_score"], reverse=True)
    return [
        {"id": t["id"], "title": t["title"], "priority": t.get("priority", "medium"), "due_date": t.get("due_date")}
        for t in scored[:limit]
    ]
