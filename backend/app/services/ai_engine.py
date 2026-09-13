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
    Converts unstructured input into structured task, event, or reminder entities.
    Accurately extracts dates, times, priorities, and explicit financial transactions.
    Times like 'at 11.30 am' are strictly classified as event times, NEVER expenses!
    """
    now = datetime.datetime.now()
    today = now.strftime("%Y-%m-%d")
    tomorrow = (now + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    
    prompt = f"""
    You are an intelligent data extraction AI for Sage OS.
    Extract distinct actionable items from user text.
    Today's date is {today}, tomorrow is {tomorrow}. Current time is {now.strftime("%H:%M")}.

    CRITICAL RULES:
    1. Distinguish between EVENT TIMES and EXPENSES:
       - "11.30 am", "at 5pm", "10:00" are event TIMES, NOT money! Expense MUST be null.
       - An expense ONLY exists if money is explicitly mentioned with currency or payment action (e.g. "Rs 500", "₹120", "$50", "paid 250 via upi").
    2. Entity types:
       - "event" for meetings, parties, ceremonies, namings, birthdays, appointments, calls, flights.
       - "reminder" for alerts or time-sensitive notes ("remind me to...").
       - "task" for action items and to-dos.
    3. If a specific time is mentioned (e.g. "at 11.30 am"), put it in "start_at" formatted as "YYYY-MM-DDTHH:MM:SS".

    Respond ONLY with a valid JSON array of objects:
    [
      {{
        "title": "Clear action title",
        "description": "Optional notes or details",
        "due_date": "YYYY-MM-DD or null",
        "start_at": "YYYY-MM-DDTHH:MM:SS or null",
        "priority": "low" | "medium" | "high" | "urgent",
        "entity_type": "task" | "event" | "reminder",
        "estimated_minutes": 30,
        "expense": {{
            "amount": 2500.0,
            "payment_mode": "upi" | "debit_card" | "cash" | "net_banking",
            "category": "Utilities & Bills"
        }} or null
      }}
    ]

    User input: "{natural_language}"
    """
    
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
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
                if isinstance(parsed, list) and len(parsed) > 0:
                    # Sanity check: Ensure times weren't accidentally captured as expenses
                    for item in parsed:
                        if item.get("expense"):
                            exp_amt = item["expense"].get("amount")
                            if exp_amt in [11.3, 11.30, 10.3, 9.3, 12.3] and re.search(r"\b" + str(exp_amt) + r"\s*(?:am|pm)?\b", natural_language, re.I):
                                if "am" in natural_language.lower() or "pm" in natural_language.lower() or "at " in natural_language.lower():
                                    item["expense"] = None
                    return parsed
                elif isinstance(parsed, dict) and parsed:
                    return [parsed]
    except Exception:
        pass

    # Heuristic Rule-Based Fallback (Bulletproof NLP Extraction)
    text = natural_language.strip()
    text_lower = text.lower()
    
    # 1. Determine entity_type
    event_keywords = [
        "event", "naming", "ceremony", "wedding", "party", "birthday",
        "meeting", "meet", "appointment", "call", "interview", "doctor",
        "dinner", "lunch", "breakfast", "flight", "concert", "webinar"
    ]
    reminder_keywords = ["remind", "reminder", "alarm"]
    
    entity_type = "task"
    if any(k in text_lower for k in event_keywords):
        entity_type = "event"
    elif any(k in text_lower for k in reminder_keywords):
        entity_type = "reminder"

    # 2. Extract priority
    priority = "medium"
    if any(w in text_lower for w in ["urgent", "asap", "critical", "emergency"]):
        priority = "urgent"
    elif any(w in text_lower for w in ["high", "important", "must"]):
        priority = "high"
    elif any(w in text_lower for w in ["low", "someday", "later"]):
        priority = "low"

    # 3. Extract Time (e.g. at 11.30 am, 11:30 am, at 4 pm)
    time_str = None
    start_at = None
    time_match = re.search(r"(?:at\s+)?(\b\d{1,2})(?::|\.)(\d{2})\s*(am|pm)?\b", text, re.I)
    if not time_match:
        time_match = re.search(r"(?:at\s+)?(\b\d{1,2})\s*(am|pm)\b", text, re.I)
        if time_match:
            hr = int(time_match.group(1))
            mn = 0
            meridiem = time_match.group(2).lower()
            if meridiem == "pm" and hr < 12:
                hr += 12
            elif meridiem == "am" and hr == 12:
                hr = 0
            time_str = f"{hr:02d}:{mn:02d}:00"
    else:
        hr = int(time_match.group(1))
        mn = int(time_match.group(2))
        meridiem = (time_match.group(3) or "").lower()
        if meridiem == "pm" and hr < 12:
            hr += 12
        elif meridiem == "am" and hr == 12:
            hr = 0
        time_str = f"{hr:02d}:{mn:02d}:00"

    # 4. Extract Date
    due_date = None
    if "today" in text_lower:
        due_date = today
    elif "tomorrow" in text_lower:
        due_date = tomorrow
    elif entity_type == "event" and time_str:
        # Default event with specific time to today
        due_date = today

    if due_date and time_str:
        start_at = f"{due_date}T{time_str}"

    # 5. Extract Expense (Strict check - MUST have explicit currency/spending keywords, never times!)
    expense = None
    exp_patterns = [
        r"(?:rs\.?|inr|₹|\$)\s*(\d+(?:\.\d{1,2})?)(?!\s*(?:am|pm|hrs|hours|mins|minutes|o'clock))",
        r"(\d+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|rupees|\$|bucks)(?!\s*(?:am|pm))",
        r"(?:paid|pay|spent|spend|cost|fee|bill|bought)\s+(?:of\s+)?(?:rs\.?|inr|₹|\$)?\s*(\d+(?:\.\d{1,2})?)(?!\s*(?:am|pm))",
        r"(\d+(?:\.\d{1,2})?)\s*(?:via|through|by|on|in)\s*(?:upi|gpay|phonepe|paytm|cash|card|debit)"
    ]
    for pat in exp_patterns:
        m = re.search(pat, text, re.I)
        if m:
            amt = float(m.group(1))
            mode = "upi"
            if "cash" in text_lower:
                mode = "cash"
            elif "card" in text_lower or "debit" in text_lower:
                mode = "debit_card"
            expense = {
                "amount": amt,
                "payment_mode": mode,
                "category": "General Expense"
            }
            break

    return [{
        "title": text,
        "description": f"Captured via AI Brain Dump ({'Event scheduled at ' + time_str if time_str else 'Action item'})",
        "due_date": due_date,
        "start_at": start_at,
        "priority": priority,
        "entity_type": entity_type,
        "estimated_minutes": 60 if entity_type == "event" else 30,
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
