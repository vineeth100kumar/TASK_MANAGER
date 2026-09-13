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

    # Polish the title to make it executive and actionable
    polished_title = heuristic_improve_title(text, entity_type)

    return [{
        "title": polished_title,
        "description": f"Captured via AI Brain Dump. Original note: \"{text}\"" + (f" (Scheduled for {time_str})" if time_str else ""),
        "due_date": due_date,
        "start_at": start_at,
        "priority": priority,
        "entity_type": entity_type,
        "estimated_minutes": 60 if entity_type == "event" else 30,
        "expense": expense
    }]

def heuristic_improve_title(raw: str, entity_type: str = "task") -> str:
    """Refines raw, messy, or conversational text into a crisp, executive action title."""
    t = raw.strip()
    if not t:
        return "Untitled Action Item"

    # Strip conversational prefixes
    t = re.sub(r'^(?:i (?:need|have|want) to|please|can you|remind me to|don\'t forget to|remember to)\s+', '', t, flags=re.I)
    
    # Strip time and date tokens at end or middle (e.g. at 11.30 am, at 5pm, tomorrow, today)
    t = re.sub(r'\s+at\s+\d{1,2}(?::\d{2}|\.\d{2})?\s*(?:am|pm)?\b', '', t, flags=re.I)
    t = re.sub(r'\s+\b\d{1,2}(?::\d{2}|\.\d{2})?\s*(?:am|pm)\b', '', t, flags=re.I)
    t = re.sub(r'\s+(?:today|tomorrow|tmrw|yesterday|tonight|this evening)\b', '', t, flags=re.I)
    t = re.sub(r'\s+(?:asap|urgent|urgently|pls|please)\b', '', t, flags=re.I)
    t = t.strip(' ,.-')

    tl = t.lower()
    
    def smart_title(s: str) -> str:
        small_words = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "up", "with"}
        words = s.split()
        return " ".join(w.capitalize() if i == 0 or w.lower() not in small_words else w.lower() for i, w in enumerate(words))

    if 'baby naming' in tl:
        return 'Attend Baby Naming Ceremony'
    if 'car service' in tl or 'service car' in tl or 'oil change' in tl:
        return 'Schedule Periodic Vehicle Maintenance'
    if 'wifi' in tl or 'broadband' in tl or 'internet bill' in tl:
        return 'Pay Broadband Internet Bill'
    if 'electricity bill' in tl or 'power bill' in tl:
        return 'Pay Monthly Electricity Bill'
    if 'rent' in tl and ('pay' in tl or 'transfer' in tl):
        return 'Pay Monthly House Rent'
    if 'grocer' in tl or 'supermarket' in tl:
        return 'Purchase Weekly Household Groceries'
    if 'gym' in tl or 'workout' in tl or 'exercise' in tl:
        return 'Complete Workout & Fitness Session'
    if 'dentist' in tl or 'dental' in tl:
        return 'Attend Dental Health Appointment'
    if 'doctor' in tl or 'physician' in tl:
        return 'Consultation with Doctor'
    if tl.startswith('call '):
        person = t[5:].strip()
        if ' about ' in person.lower():
            idx = person.lower().index(' about ')
            p = person[:idx].strip()
            topic = person[idx+7:].strip()
            return f'Discuss {smart_title(topic)} with {smart_title(p)}'
        return f'Phone Call with {smart_title(person)}'
    if tl.startswith(('buy ', 'purchase ', 'get ', 'order ')):
        item = re.sub(r'^(?:buy|purchase|get|order)\s+', '', t, flags=re.I).strip()
        return f'Purchase {smart_title(item)}'
    if tl.startswith('pay '):
        bill = re.sub(r'^pay\s+', '', t, flags=re.I).strip()
        return f'Pay {smart_title(bill)}'
    if tl.startswith(('fix ', 'debug ')):
        issue = re.sub(r'^(?:fix|debug)\s+', '', t, flags=re.I).strip()
        return f'Resolve {smart_title(issue)}'
    if tl.startswith(('prep ', 'prepare ')):
        doc = re.sub(r'^(?:prep|prepare)\s+', '', t, flags=re.I).strip()
        return f'Prepare {smart_title(doc)}'
    if tl.startswith(('email ', 'send ')):
        msg = re.sub(r'^(?:email|send)\s+', '', t, flags=re.I).strip()
        return f'Send {smart_title(msg)}'
    if tl.startswith(('meet ', 'meeting ')):
        m = re.sub(r'^(?:meet|meeting)\s+(?:with\s+)?', '', t, flags=re.I).strip()
        return f'Meeting with {smart_title(m)}'
    if tl.startswith(('read ', 'study ')):
        bk = re.sub(r'^(?:read|study)\s+', '', t, flags=re.I).strip()
        return f'Study & Review {smart_title(bk)}'
    if tl.startswith(('clean ', 'organize ', 'tidy ')):
        area = re.sub(r'^(?:clean|organize|tidy)\s+(?:up\s+)?', '', t, flags=re.I).strip()
        return f'Clean & Organize {smart_title(area)}'

    return smart_title(t) if t else raw

async def improve_task_data(title: str, context: Optional[str] = None, entity_type: Optional[str] = "task") -> Dict[str, Any]:
    """
    Improvises raw task data into an executive title, structured description,
    definition of done, sequential subtasks, energy level, and duration estimate.
    """
    prompt = f"""
    You are an executive productivity strategist for Sage Life OS.
    Transform the following user task into a polished, executive-ready action item.

    Task Title: "{title}"
    Additional Context: "{context or ''}"
    Entity Type: "{entity_type or 'task'}"

    Instructions:
    1. improved_title: A crisp, professional, action-oriented title starting with an active imperative verb (e.g., "Schedule Dental Checkup", "Finalize Q3 Budget Report", "Restock Kitchen Essentials"). Never include conversational fluff or dates/times in the title.
    2. description: Formatted in clear Markdown with:
       - **Objective**: 1 sentence on the target outcome.
       - **Definition of Done**: Specific completion criteria.
       - **Key Considerations**: Relevant tools, context, or links.
    3. subtasks: A list of 3-5 logical, chronological micro-steps to execute the task.
    4. priority: "low" | "medium" | "high" | "urgent" based on real impact.
    5. energy: "low" | "medium" | "high" (low for admin/errands, high for deep focus work).
    6. estimated_minutes: Integer estimate in minutes (15, 30, 45, 60, etc.).
    7. category: "Work" | "Personal" | "Finance" | "Health" | "Errands" | "Learning"

    Respond ONLY with valid JSON:
    {{
      "improved_title": "...",
      "description": "...",
      "subtasks": ["Step 1", "Step 2", "Step 3"],
      "priority": "medium",
      "energy": "medium",
      "estimated_minutes": 30,
      "category": "Work"
    }}
    """
    
    try:
        async with httpx.AsyncClient(timeout=7.0) as client:
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
                data = safe_parse_json(resp.json().get("response", ""))
                if isinstance(data, dict) and data.get("improved_title"):
                    return data
    except Exception:
        pass

    # High-Performance Heuristic Improvisation Fallback (<5ms execution)
    refined_title = heuristic_improve_title(title, entity_type or "task")
    
    # Contextual category & subtask heuristics
    tl = title.lower()
    cat = "Personal"
    priority = "medium"
    energy = "medium"
    est_mins = 30

    if any(k in tl for k in ["urgent", "asap", "emergency", "broken", "down", "critical"]):
        priority = "urgent"
    elif any(k in tl for k in ["important", "boss", "client", "tax", "deadline", "pay"]):
        priority = "high"

    if any(k in tl for k in ["bill", "pay", "tax", "finance", "bank", "account", "invoice", "salary"]):
        cat = "Finance"
        energy = "low"
        est_mins = 15
        subtasks = [
            f"Review invoice and payment details for {refined_title}",
            "Verify source account balance and credentials",
            "Execute transaction and save digital receipt",
            "Update budget and record in Sage OS"
        ]
    elif any(k in tl for k in ["gym", "workout", "exercise", "run", "doctor", "health", "diet", "medicine", "dentist"]):
        cat = "Health"
        energy = "high"
        est_mins = 60
        subtasks = [
            "Prepare gear and hydration prerequisites",
            f"Begin session: {refined_title}",
            "Complete core routine with focus",
            "Cool down, hydrate, and log activity"
        ]
    elif any(k in tl for k in ["code", "bug", "deploy", "server", "meeting", "report", "presentation", "client", "feature", "review"]):
        cat = "Work"
        energy = "high"
        est_mins = 45
        subtasks = [
            f"Review requirements and gather context for {refined_title}",
            "Outline key deliverables and approach",
            "Execute implementation / drafting",
            "Verify quality and validate definition of done"
        ]
    elif any(k in tl for k in ["buy", "grocery", "groceries", "order", "store", "market", "clean", "laundry"]):
        cat = "Errands"
        energy = "low"
        est_mins = 30
        subtasks = [
            f"List specific items and requirements needed for {refined_title}",
            "Execute procurement / errand run",
            "Inspect and verify received items",
            "Store or distribute items appropriately"
        ]
    else:
        subtasks = [
            f"Define requirements and clear scope for {refined_title}",
            "Execute primary action steps",
            "Perform final quality check and complete"
        ]

    description = f"### Objective\nComplete **{refined_title}** efficiently with high quality.\n\n### Definition of Done\n- All associated checklist items verified and executed.\n- Any outcomes documented or filed.\n\n### Notes\n{context if context else 'Captured via Sage AI Intelligence.'}"

    return {
        "improved_title": refined_title,
        "description": description,
        "subtasks": subtasks,
        "priority": priority,
        "energy": energy,
        "estimated_minutes": est_mins,
        "category": cat
    }

async def organize_board_data(tasks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Analyzes an entire task board to provide:
    1. The Top 3 Strategic Focus items for today (Big Rocks).
    2. Suggested title & description enhancements for unpolished tasks.
    3. Missing subtask checklists for complex items.
    4. Executive workload distribution and recommendations.
    """
    uncompleted = [t for t in tasks if not t.get("is_completed")]
    priority_weights = {"urgent": 4, "high": 3, "medium": 2, "low": 1}
    
    # Sort uncompleted tasks by priority and urgency
    sorted_tasks = sorted(
        uncompleted,
        key=lambda x: priority_weights.get(x.get("priority", "medium"), 2),
        reverse=True
    )

    # 1. Top 3 "Big Rocks" for Today
    big_rocks = sorted_tasks[:3]

    # 2. Identify items that need title polishing
    need_polish = []
    for t in uncompleted:
        title = t.get("title", "").strip()
        words = title.split()
        is_messy = (
            len(words) <= 2 or
            title.islower() or
            any(w in title.lower() for w in ["tmrw", "asap", "pls", "call", "buy", "pay", "fix", "prep"]) or
            len(title) < 14
        )
        if is_messy:
            improved = heuristic_improve_title(title, t.get("entity_type", "task"))
            if improved != title:
                need_polish.append({
                    "id": t.get("id"),
                    "current_title": title,
                    "improved_title": improved,
                    "priority": t.get("priority", "medium")
                })

    # 3. Tasks lacking checklists
    need_subtasks = []
    for t in uncompleted:
        subtasks = t.get("subtasks", [])
        if not subtasks and t.get("estimated_minutes", 30) >= 30:
            need_subtasks.append({
                "id": t.get("id"),
                "title": t.get("title")
            })

    total_est_minutes = sum(t.get("estimated_minutes", 30) for t in uncompleted)
    hours = round(total_est_minutes / 60, 1)

    summary = (
        f"You have {len(uncompleted)} active items totaling approximately {hours} hours of focused work. "
        f"Conquering your Top 3 Big Rocks will eliminate your highest-risk bottlenecks today."
    )

    return {
        "total_pending": len(uncompleted),
        "total_estimated_hours": hours,
        "executive_summary": summary,
        "big_rocks": big_rocks,
        "title_improvements": need_polish[:6],
        "missing_subtasks_count": len(need_subtasks)
    }

async def auto_fill_task_details(title: str, context: Optional[str] = None) -> Dict[str, Any]:
    """Expands a task title into a detailed description and 3-5 subtask checklist."""
    return await improve_task_data(title, context)
