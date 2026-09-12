import os
import re
import json
import datetime
import httpx
from typing import Dict, Any, List, Optional

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:1.5b")

def safe_parse_json(raw_text: str):
    """Strips markdown code fences and safely extracts JSON dictionaries or arrays."""
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    elif text.startswith("`"):
        text = re.sub(r"^`(?:json)?\s*", "", text)
        text = re.sub(r"\s*`$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start_obj = text.find('{')
        end_obj = text.rfind('}')
        if start_obj != -1 and end_obj != -1:
            return json.loads(text[start_obj:end_obj+1])
        start_arr = text.find('[')
        end_arr = text.rfind(']')
        if start_arr != -1 and end_arr != -1:
            return json.loads(text[start_arr:end_arr+1])
        raise ValueError("Failed to extract valid JSON from model response")

async def generate_greeting(
    username: str = "Chief",
    weather_condition: str = "Clear",
    temperature: float = 25.0,
    urgent_task_count: int = 2,
    today_completed_count: int = 3,
    total_planned_count: int = 5
) -> str:
    """Generates an encouraging, time-of-day and context-aware greeting."""
    hour = datetime.datetime.now().hour
    if 5 <= hour < 12:
        period = "morning"
    elif 12 <= hour < 17:
        period = "afternoon"
    elif 17 <= hour < 22:
        period = "evening"
    else:
        period = "night"

    prompt = f"""
    You are an executive personal assistant. Write a concise, 2-sentence greeting for {username}.
    Current time: {period}.
    Current weather: {temperature}°C and {weather_condition}.
    Tasks for today: {today_completed_count} completed out of {total_planned_count} planned.
    Urgent tasks pending: {urgent_task_count}.
    Tone: Sharp, professional, motivating.
    Output ONLY the 2 sentences. No quotes or preamble.
    """
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.4}
                }
            )
            if resp.status_code == 200:
                text = resp.json().get("response", "").strip()
                if text:
                    return text
    except Exception:
        pass

    # Intelligent fallback if Ollama is not yet active on Pi
    if period == "morning":
        return f"Good morning! It's {temperature}°C and {weather_condition.lower()} outside. You have {urgent_task_count} urgent items requiring attention today—let's conquer them."
    elif period == "afternoon":
        return f"Good afternoon! You've already completed {today_completed_count} tasks today. Maintain this velocity as you tackle the remaining items."
    elif period == "evening":
        return f"Good evening! Great progress today with {today_completed_count} tasks checked off. Review your achievements and wind down with clarity."
    else:
        return f"Night owl hours! Wrap up any lingering thoughts in your inbox so tomorrow starts on your terms."

async def parse_brain_dump(natural_language: str) -> List[Dict[str, Any]]:
    """
    Converts unstructured input into structured task and optional finance entities.
    Example: 'Pay electricity bill 2500 via upi tomorrow high priority'
    """
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    tomorrow = (datetime.datetime.now() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    
    prompt = f"""
    You are an intelligent data extraction AI. Extract distinct actionable tasks from the user's text.
    Today's date is {today}, tomorrow is {tomorrow}.
    Respond ONLY with a valid JSON array of objects matching this exact format:
    [
      {{
        "title": "Clear action title",
        "description": "Optional notes or details",
        "due_date": "YYYY-MM-DD or null",
        "priority": "low" | "medium" | "high" | "urgent",
        "entity_type": "task" | "event" | "reminder",
        "estimated_minutes": 30,
        "expense": {{
            "amount": 2500.0,
            "payment_mode": "upi" | "debit_card" | "cash" | "net_banking",
            "category": "Utilities & Bills"
        }} (or null if no money/payment mentioned)
      }}
    ]
    User input: "{natural_language}"
    """
    
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "format": "json",
                    "stream": False,
                    "options": {"temperature": 0.0}
                }
            )
            if resp.status_code == 200:
                parsed = safe_parse_json(resp.json().get("response", ""))
                if isinstance(parsed, list):
                    return parsed
                elif isinstance(parsed, dict):
                    return [parsed]
    except Exception:
        pass

    # Heuristic Rule-Based Fallback
    text = natural_language.strip()
    priority = "medium"
    if any(w in text.lower() for w in ["urgent", "asap", "critical"]):
        priority = "urgent"
    elif any(w in text.lower() for w in ["high", "important"]):
        priority = "high"
    elif any(w in text.lower() for w in ["low", "someday", "later"]):
        priority = "low"

    due_date = None
    if "today" in text.lower():
        due_date = today
    elif "tomorrow" in text.lower():
        due_date = tomorrow

    # Check for expense mentions (e.g. 500 upi, rs 2500, etc.)
    expense = None
    money_match = re.search(r"(?:rs\.?|inr|\$|₹)?\s*(\d+(?:\.\d{1,2})?)\s*(?:rs|inr|rupees)?", text, re.I)
    if money_match:
        amount = float(money_match.group(1))
        payment_mode = "upi"
        if "cash" in text.lower():
            payment_mode = "cash"
        elif "card" in text.lower() or "debit" in text.lower():
            payment_mode = "debit_card"
        expense = {
            "amount": amount,
            "payment_mode": payment_mode,
            "category": "General Expense"
        }

    return [{
        "title": text,
        "description": "Captured via Quick Brain Dump",
        "due_date": due_date,
        "priority": priority,
        "entity_type": "task",
        "estimated_minutes": 30,
        "expense": expense
    }]

async def auto_fill_task_details(title: str, context: Optional[str] = None) -> Dict[str, Any]:
    """Generates a detailed description and 3-5 subtask checklist for a given task title."""
    prompt = f"""
    You are an executive productivity strategist. Given the task title '{title}' (Context: '{context or ''}'),
    generate a detailed Markdown description and a logical sequence of 3 to 5 subtask checklist items.
    Respond ONLY with a JSON object in this exact schema:
    {{
        "description": "2-3 sentences explaining the objective and definition of done.",
        "subtasks": ["Step 1...", "Step 2...", "Step 3...", "Step 4..."],
        "estimated_minutes": 45,
        "priority": "medium"
    }}
    """
    
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "format": "json",
                    "stream": False,
                    "options": {"temperature": 0.2}
                }
            )
            if resp.status_code == 200:
                return safe_parse_json(resp.json().get("response", ""))
    except Exception:
        pass

    # Intelligent Fallback
    return {
        "description": f"Execute and complete: {title}. Ensure all prerequisites are verified and results documented.",
        "subtasks": [
            f"Review requirements for {title}",
            "Draft initial implementation / plan",
            "Execute primary action steps",
            "Perform final review and verification"
        ],
        "estimated_minutes": 30,
        "priority": "medium"
    }
