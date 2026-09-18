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

async def parse_brain_dump(
    natural_language: str,
    projects: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    Converts unstructured input into structured task, event, or reminder entities.

    This is now a thin wrapper over the capture engine, which reads the note
    with the local Ollama model and checks its dates, times and amounts against
    a deterministic parse of the same words. The old hand-rolled prompt used to
    return a single item and needed a patch to stop it reading "11.30 am" as a
    spend of 11.30; the capture engine splits multi-part notes properly and
    only ever accepts an amount the text actually contains.
    """
    from .capture_ai import understand

    items = await understand(natural_language, projects=projects or [])
    return [
        {
            "title": item.title,
            "description": item.description,
            "due_date": item.due_date,
            "start_at": item.start_at,
            "remind_at": item.remind_at,
            "priority": item.priority,
            "entity_type": item.entity_type,
            "estimated_minutes": item.estimated_minutes,
            "repeat_rule": item.repeat_rule,
            "context_tags": item.context_tags,
            "expense": item.expense,
        }
        for item in items
    ]

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
    if 'run' in tl or 'jog' in tl:
        if 'marathon' in tl:
            return 'Train for Marathon Distance Run'
        if '5k' in tl:
            return 'Execute 5km Cardio Run & Mobility'
        return 'Complete Cardio Running Session'
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

def clean_plain_paragraph(text: str) -> str:
    """Ensures text is a single, cohesive plain-text paragraph with zero markdown formatting (#, *, etc.)."""
    if not text:
        return ""
    # Strip markdown headers and common header prefixes
    text = re.sub(r'#+\s*(?:Objective|Engineering Standards|Definition of Done|Target Performance & Form|Training Protocol|Guidelines|Details|Execution Strategy|Project Context & Alignment|Context & Notes|Strategic Objective|Core Scope & Deliverables|Definition of Success|Strategic Focus|Operational Safeguards|Action Items|Culinary Standards|Shopping Protocol|Safety Verification|Deep Work Protocol|Craft Guidelines)[:\s]*', '', text, flags=re.I)
    text = re.sub(r'#+\s*', '', text)
    # Remove markdown bold/italics
    text = re.sub(r'[*_]{1,3}', '', text)
    # Remove list bullet markers
    # Collapse newlines and whitespace into single spaces
    text = re.sub(r'\s*\n+\s*', ' ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip()

def compose_task_description(
    main_summary: str,
    project_name: Optional[str] = None,
    previous_tasks: Optional[List[str]] = None,
    context: Optional[str] = None
) -> str:
    """Combines task summary with project lineage into ONE clean, human-readable paragraph with zero # or *."""
    parts = [main_summary.rstrip(". ")]

    if project_name and previous_tasks:
        recent = [t.strip().rstrip(". ") for t in previous_tasks[:3] if t.strip()]
        if len(recent) == 1:
            prev_clause = f", following up on '{recent[0]}'"
        elif len(recent) == 2:
            prev_clause = f", following up on '{recent[0]}' and '{recent[1]}'"
        else:
            prev_clause = f", following up on '{recent[0]}', '{recent[1]}', and '{recent[2]}'"
        parts.append(f"This task is part of project '{project_name}'{prev_clause} to maintain momentum on overall milestones")
    elif project_name:
        parts.append(f"This task is part of project '{project_name}' and advances its core milestones")
    elif previous_tasks:
        recent = [f"'{t.strip().rstrip('. ')}'" for t in previous_tasks[:2] if t.strip()]
        parts.append(f"This task builds upon recent progress including {' and '.join(recent)}")

    if context and context.strip():
        parts.append(f"Note: {context.strip().rstrip('. ')}")

    combined = ". ".join(p.strip() for p in parts if p.strip()) + "."
    return clean_plain_paragraph(combined)

def synthesize_domain_task(
    title: str,
    context: Optional[str] = None,
    entity_type: Optional[str] = "task",
    project_name: Optional[str] = None,
    previous_tasks: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Expert domain synthesizer: creates authentic, high-value, domain-specific
    one-paragraph descriptions and logical subtasks with zero markdown hashes or asterisks.
    """
    refined_title = heuristic_improve_title(title, entity_type or "task")
    tl = title.lower()

    # Priority determination
    priority = "medium"
    if any(k in tl for k in ["urgent", "asap", "emergency", "broken", "down", "critical"]):
        priority = "urgent"
    elif any(k in tl for k in ["important", "deadline", "tax", "boss", "client", "doctor", "dentist"]):
        priority = "high"

    # Domain matchers with word boundary protections
    is_running = bool(re.search(r'\b(?:run|running|jog|jogging|sprint|sprinting|cardio|marathon|5k|10k)\b', tl))
    is_gym = bool(re.search(r'\b(?:gym|workout|workouts|lift|lifting|exercise|bench|squat|squats|deadlift|deadlifts|push day|pull day|leg day|weights|crossfit)\b', tl))
    is_walking = bool(re.search(r'\b(?:walk|walking|hike|hiking|stroll|steps|morning walk|evening walk)\b', tl))
    is_yoga = bool(re.search(r'\b(?:yoga|stretch|stretching|mobility|meditat|meditation|breathwork|foam roll)\b', tl))
    is_coding = bool(re.search(r'\b(?:code|coding|bug|bugs|feature|features|api|apis|refactor|frontend|backend|test|tests|unit test|git|pr|pull request|commit|commits|migration|endpoint|database)\b', tl))
    is_devops = bool(re.search(r'\b(?:pi|server|servers|deploy|deployment|nginx|systemd|ssh|linux|cloud|backup|cert|ssl|daemon)\b', tl))
    is_finance = bool(re.search(r'\b(?:bill|bills|pay|payment|tax|taxes|finance|bank|banking|invoice|salary|rent|emi|credit card|utility|utilities|electric|electricity|wifi|broadband|insurance|recharge)\b', tl))
    is_grocery = bool(re.search(r'\b(?:grocery|groceries|supermarket|vegetable|vegetables|milk|fruit|fruits|pantry|ration|restock)\b', tl))
    is_cooking = bool(re.search(r'\b(?:cook|cooking|meal prep|bake|baking|dinner|lunch|breakfast|recipe|prep food)\b', tl))
    is_medical = bool(re.search(r'\b(?:doctor|dentist|dental|medical|clinic|hospital|medicine|prescription|blood test|health check|physio|physiotherapy|therapy)\b', tl))
    is_vehicle = bool(re.search(r'\b(?:car|bike|motorcycle|vehicle|oil change|tire|tyre|tires|tyres|petrol|fuel|mechanic|service vehicle)\b', tl))
    is_cleaning = bool(re.search(r'\b(?:clean|cleaning|laundry|organize|tidy|declutter|vacuum|mop|dishes|wash clothes)\b', tl))
    is_learning = bool(re.search(r'\b(?:study|studying|read|reading|book|course|learn|learning|exam|paper|research|lecture|tutorial)\b', tl))
    is_writing = bool(re.search(r'\b(?:write|writing|blog|draft|drafting|document|documentation|deck|slide|slides|presentation|proposal|essay|content)\b', tl))
    is_meeting = bool(re.search(r'\b(?:meet|meeting|call|interview|sync|standup|discuss|1on1|1:1)\b', tl))
    is_travel = bool(re.search(r'\b(?:travel|traveling|trip|flight|hotel|pack|packing|vacation|itinerary|passport|visa)\b', tl))
    is_celebration = bool(re.search(r'\b(?:birthday|anniversary|gift|party|celebrat|celebration|gathering)\b', tl))

    # 1. RUNNING / CARDIO
    if is_running:
        desc = compose_task_description(
            "Execute an energizing cardio running session to build cardiovascular endurance, increase aerobic capacity, and clear mental fatigue. "
            "Maintain a steady Zone 2 or 3 pacing rhythm with an upright posture and compact cadence, and finish with a five-minute cool-down walk followed by lower-body mobility stretches and hydration",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title if ("Run" in refined_title or "Cardio" in refined_title) else "Complete Cardio Running Session",
            "description": desc,
            "subtasks": [
                "Lace up running shoes & prepare water / electrolyte bottle",
                "5-minute dynamic warm-up (leg swings, high knees, ankle rotations)",
                "Execute run maintaining target heart-rate zone and steady cadence",
                "5-minute cool-down walk followed by lower-body static stretches",
                "Rehydrate and log workout distance, time, and heart rate"
            ],
            "priority": priority,
            "energy": "high",
            "estimated_minutes": 45,
            "category": "Health"
        }

    # 2. GYM / STRENGTH / WORKOUT
    if is_gym:
        desc = compose_task_description(
            f"Complete a focused progressive overload strength training session for {refined_title} targeting muscular density and physical resilience. "
            "Prioritize heavy compound multi-joint movements with controlled pacing before moving to secondary accessories, maintaining strict core bracing throughout each set",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title if "Workout" in refined_title else f"Execute Strength Session: {refined_title}",
            "description": desc,
            "subtasks": [
                "Pre-workout joint mobility drills and dynamic muscle warm-up",
                "Warm-up sets gradually ramping up to target working weights",
                "Execute core compound lifts with strict form and core bracing",
                "Complete secondary hypertrophy / accessory exercises",
                "Post-workout mobility cooldown, log weights & consume protein refuel"
            ],
            "priority": priority,
            "energy": "high",
            "estimated_minutes": 60,
            "category": "Health"
        }

    # 3. WALKING / HIKING / STEPS
    if is_walking:
        desc = compose_task_description(
            f"Take an outdoor brisk walk for {refined_title} to support active recovery, daily step accumulation, and mental decompression. "
            "Maintain a purposeful stride in natural daylight and log total step count upon return",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Put on supportive footwear and prepare hydration",
                "Step outside on pedestrian route away from heavy traffic",
                "Maintain steady brisk pace with rhythmic breathing",
                "Log step count and finish with gentle calf/hamstring stretch"
            ],
            "priority": priority,
            "energy": "low",
            "estimated_minutes": 30,
            "category": "Health"
        }

    # 4. YOGA / MOBILITY / MEDITATION
    if is_yoga:
        desc = compose_task_description(
            f"Engage in a dedicated mobility and restorative flow session for {refined_title} to release physical tension, open tight joints, and reset posture. "
            "Focus on deep diaphragmatic breathing through hip openers and spinal rotations to restore flexibility and mental focus",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Set up yoga mat and ensure a quiet, distraction-free environment",
                "Gentle spinal warm-up: Cat-Cow, Child's Pose, and Downward Dog",
                "Targeted flow for hips, hamstrings, and thoracic spine",
                "5-minute Savasana or diaphragmatic breathing to reset parasympathetic tone"
            ],
            "priority": priority,
            "energy": "low",
            "estimated_minutes": 25,
            "category": "Health"
        }

    # 5. SOFTWARE / CODING / REFACTOR / BUG
    if is_coding:
        desc = compose_task_description(
            f"Implement and test the technical solution for {refined_title} with clean architecture, strict error handling, and complete verification. "
            "Ensure modular function design, handle edge cases gracefully, and validate that test suites pass before committing changes",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                f"Inspect existing codebase and define exact scope for {refined_title}",
                "Implement core logic changes and verify type definitions",
                "Run test suites and validate edge case coverage",
                "Review diff, remove temporary debug statements, and format code",
                "Commit with conventional commit message and push changes"
            ],
            "priority": priority if priority != "medium" else "high",
            "energy": "high",
            "estimated_minutes": 60,
            "category": "Work"
        }

    # 6. DEVOPS / SERVER / PI / DEPLOYMENT
    if is_devops:
        desc = compose_task_description(
            f"Configure, deploy, or maintain server infrastructure for {refined_title} ensuring high availability and secure operations. "
            "Verify configuration syntax and port bindings before reloading active daemons, and check system logs to ensure clean startup",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Establish secure SSH session and back up active configuration files",
                "Apply infrastructure changes or pull latest deployment artifacts",
                "Restart / reload systemd services and test daemon status",
                "Inspect systemd journal logs to ensure clean startup with no errors",
                "Verify service accessibility via HTTP health check or network probe"
            ],
            "priority": "high",
            "energy": "high",
            "estimated_minutes": 45,
            "category": "Work"
        }

    # 7. FINANCE / BILLS / TAXES / PAYMENTS
    if is_finance:
        desc = compose_task_description(
            f"Review, verify, and complete payment for {refined_title} to keep accounts reconciled and avoid late fees or penalties. "
            "Confirm payment amount and recipient details, complete transaction through secure payment mode, and retain the payment receipt",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                f"Open billing statement and verify statement total for {refined_title}",
                "Log into banking portal or payment app and initiate payment",
                "Authorize transaction and confirm receipt / transaction reference ID",
                "Download and archive PDF payment acknowledgement",
                "Record transaction in Sage OS Finance tracker to update net worth"
            ],
            "priority": "high",
            "energy": "low",
            "estimated_minutes": 15,
            "category": "Finance"
        }

    # 8. GROCERIES / PANTRY / SUPERMARKET
    if is_grocery:
        desc = compose_task_description(
            f"Restock household essentials and groceries for {refined_title} to keep the kitchen well supplied. "
            "Check current inventory, select fresh high-quality items, and organize groceries promptly upon return",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Audit refrigerator and pantry to compile prioritized shopping list",
                "Visit local store or submit online grocery order",
                "Inspect delivered items for quality, count, and expiry dates",
                "Unpack groceries and organize into designated pantry/refrigerator zones",
                "Log total spend in Sage OS Finance tracker"
            ],
            "priority": priority,
            "energy": "low",
            "estimated_minutes": 40,
            "category": "Errands"
        }

    # 9. COOKING / MEAL PREP
    if is_cooking:
        desc = compose_task_description(
            f"Prepare and cook {refined_title} focusing on balanced nutrition, fresh ingredients, and efficient kitchen workflow. "
            "Measure and prep ingredients in advance, manage heat carefully, and pack any meal portions for storage",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Review recipe and prep ingredients (wash, chop, measure spices)",
                "Preheat cookware and execute cooking steps with proper timing",
                "Taste, fine-tune seasonings, and plate or portion into containers",
                "Wash cooking pans and utensils, wiping down all work surfaces",
                "Allow portions to cool safely before sealing and refrigerating"
            ],
            "priority": priority,
            "energy": "medium",
            "estimated_minutes": 45,
            "category": "Personal"
        }

    # 10. DOCTOR / MEDICAL / HEALTH CHECK / DENTIST
    if is_medical:
        desc = compose_task_description(
            f"Attend the medical consultation or health appointment for {refined_title} to review health priorities and wellness. "
            "Prepare relevant health records and questions beforehand, discuss with the physician, and note down recommendations or prescriptions",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Compile medical records, diagnostic history, and questions for the doctor",
                "Arrive at clinic/hospital 10 minutes prior to scheduled appointment",
                "Complete consultation, taking notes on diagnoses and lifestyle guidelines",
                "Pick up prescribed medications from pharmacy or book lab investigations",
                "Log health notes, prescription schedule, and follow-up date in Sage OS"
            ],
            "priority": "high",
            "energy": "medium",
            "estimated_minutes": 60,
            "category": "Health"
        }

    # 11. CAR / BIKE / VEHICLE SERVICE
    if is_vehicle:
        desc = compose_task_description(
            f"Complete routine inspection and maintenance for {refined_title} to ensure safety, reliability, and smooth performance. "
            "Check fluid levels, tire pressures, and critical components, and retain service records",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Check cold tire pressures and inspect engine fluid levels",
                "Take vehicle to certified service station or perform maintenance routine",
                "Review technician's job card and verify all requested work was completed",
                "Test vehicle response, brakes, and indicator lights post-service",
                "Retain receipt and record service odometer reading in Sage OS"
            ],
            "priority": priority if priority != "medium" else "high",
            "energy": "medium",
            "estimated_minutes": 60,
            "category": "Errands"
        }

    # 12. CLEANING / LAUNDRY / DECLUTTER
    if is_cleaning:
        desc = compose_task_description(
            f"Clean, declutter, and organize {refined_title} to restore order and maintain a fresh living environment. "
            "Work systematically through surfaces using appropriate cleaning supplies, dispose of waste, and return items to their proper places",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Clear all loose clutter and return stray items to proper locations",
                "Dust high shelves and wipe down countertops with disinfectant",
                "Vacuum rugs/carpets and mop hard flooring",
                "Empty trash and recycling bins, replacing liners",
                "Inspect completed room for aesthetic balance and cleanliness"
            ],
            "priority": priority,
            "energy": "medium",
            "estimated_minutes": 45,
            "category": "Errands"
        }

    # 13. STUDY / READING / LEARNING / RESEARCH
    if is_learning:
        desc = compose_task_description(
            f"Dedicate focused study and review time for {refined_title} to master core principles and concepts. "
            "Take concise notes on key ideas, test recall on challenging topics, and summarize actionable takeaways",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Silence notifications and prepare study material, notebook, and pen",
                "Engage in focused reading / watching with active marginalia",
                "Synthesize key concepts into concise bulleted takeaways in your own words",
                "Draft 3 practice questions or flashcards testing foundational comprehension",
                "Review notes and file into personal knowledge base"
            ],
            "priority": priority,
            "energy": "high",
            "estimated_minutes": 50,
            "category": "Learning"
        }

    # 14. WRITING / PRESENTATION / DECK
    if is_writing:
        desc = compose_task_description(
            f"Draft and refine content for {refined_title} with clear narrative flow, engaging structure, and concise language. "
            "Outline the main arguments before drafting, eliminate unnecessary fluff, and polish grammar and tone before sharing",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Structure core thesis, target audience takeaways, and slide outline",
                "Write primary content sections focusing on brevity and high signal",
                "Design visual diagrams or format typography for aesthetic clarity",
                "Proofread thoroughly for narrative pacing, clarity, and grammatical precision",
                "Export final draft, share review copy, or schedule distribution"
            ],
            "priority": priority if priority != "medium" else "high",
            "energy": "high",
            "estimated_minutes": 60,
            "category": "Work"
        }

    # 15. MEETING / CALL / INTERVIEW / 1:1
    if is_meeting:
        desc = compose_task_description(
            f"Participate in the meeting or discussion for {refined_title} to align on priorities and establish clear outcomes. "
            "Prepare agenda topics in advance, capture key decisions during the call, and track follow-up action items with assigned owners",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Draft and review meeting agenda with clear outcome targets",
                "Join meeting on schedule and guide discussion through key topics",
                "Record explicit decisions, ownership responsibilities, and target dates",
                "Circulate concise summary with action items to attendees",
                "Add assigned follow-ups into Sage OS task board"
            ],
            "priority": priority,
            "energy": "medium",
            "estimated_minutes": 30,
            "category": "Work"
        }

    # 16. TRAVEL / TRIP / PACKING / FLIGHT
    if is_travel:
        desc = compose_task_description(
            f"Coordinate logistics, packing, and arrangements for {refined_title} to ensure a seamless and well-prepared journey. "
            "Confirm tickets, itineraries, and reservations in advance, and pack weather-appropriate essentials",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Review travel itinerary, flight/train timings, and terminal details",
                "Download tickets, boarding passes, and hotel reservations offline",
                "Pack clothing, weather-appropriate gear, and footwear",
                "Assemble tech pouch: chargers, power banks, adapters, and cables",
                "Pack essential toiletries, medication kit, and government photo IDs"
            ],
            "priority": priority if priority != "medium" else "high",
            "energy": "medium",
            "estimated_minutes": 45,
            "category": "Personal"
        }

    # 17. CELEBRATION / GIFT / BIRTHDAY
    if is_celebration:
        desc = compose_task_description(
            f"Organize and celebrate {refined_title} to create memorable experiences and connect with friends or family. "
            "Confirm timings, prepare a thoughtful gift or greeting, and enjoy the occasion",
            project_name, previous_tasks, context
        )
        return {
            "improved_title": refined_title,
            "description": desc,
            "subtasks": [
                "Select and arrange a thoughtful gift, card, or personalized gesture",
                "Confirm timing, reservation, or venue details with participants",
                "Prepare personal attire and ensure prompt arrival",
                "Enjoy celebration and capture meaningful photos to remember the moment"
            ],
            "priority": priority,
            "energy": "medium",
            "estimated_minutes": 30,
            "category": "Personal"
        }

    # 18. DYNAMIC ADAPTIVE FALLBACK (For any arbitrary task)
    clean_verb = refined_title.split()[0] if refined_title.split() else "Complete"
    clean_subject = " ".join(refined_title.split()[1:]) if len(refined_title.split()) > 1 else refined_title

    desc = compose_task_description(
        f"Execute {refined_title} thoroughly with focused attention to detail and clear milestones. "
        f"Review requirements for {clean_subject} before taking action, work systematically through the core steps, and verify results to ensure complete delivery",
        project_name, previous_tasks, context
    )
    return {
        "improved_title": refined_title,
        "description": desc,
        "subtasks": [
            f"Review prerequisites and set up required tools for {clean_subject}",
            f"Execute initial phase and lay groundwork for {clean_subject}",
            f"Carry out primary actions for {refined_title}",
            "Inspect outcome against requirements and eliminate any rough edges",
            "Finalize task and log completion status in Sage OS"
        ],
        "priority": priority,
        "energy": "medium",
        "estimated_minutes": 30,
        "category": "Personal"
    }

async def improve_task_data(
    title: str,
    context: Optional[str] = None,
    entity_type: Optional[str] = "task",
    project_name: Optional[str] = None,
    previous_tasks: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Improvises raw task data into an executive title, 1-paragraph plain description,
    sequential subtasks, energy level, and duration estimate.
    Incorporates project and previous task trajectory when provided.
    """
    project_prompt_context = ""
    if project_name:
        project_prompt_context += f'\n    Linked Project: "{project_name}"'
    if previous_tasks and len(previous_tasks) > 0:
        prev_str = ", ".join(f'"{t}"' for t in previous_tasks[:5])
        project_prompt_context += f'\n    Preceding Tasks in This Project: [{prev_str}]'

    prompt = f"""
    You are an executive productivity strategist for Sage Life OS.
    Transform the following user task into a polished, executive-ready action item.

    Task Title: "{title}"
    Additional Context: "{context or ''}"
    Entity Type: "{entity_type or 'task'}"{project_prompt_context}

    CRITICAL QUALITY & FORMAT CONSTRAINTS:
    - description: Exactly ONE concise, cohesive, natural paragraph (2 to 3 sentences) describing what this task accomplishes, how it connects to any linked project or previous deliverables, and key execution guidance.
    - FORBIDDEN in description: Do NOT use any markdown headings (no #, ##, ###), no bold or italic asterisks (no * or **), no bullet points. It must be a single plain-text paragraph.
    - subtasks: A list of 3-5 logical, chronological micro-steps to execute the task.
    - priority: "low" | "medium" | "high" | "urgent" based on real impact.
    - energy: "low" | "medium" | "high".
    - estimated_minutes: Integer estimate in minutes (15, 30, 45, 60, etc.).
    - category: "Work" | "Personal" | "Finance" | "Health" | "Errands" | "Learning"

    Respond ONLY with valid JSON:
    {{
      "improved_title": "...",
      "description": "One concise paragraph explaining what needs to be done and key details without any hash symbols or asterisks.",
      "subtasks": ["Step 1", "Step 2", "Step 3"],
      "priority": "medium",
      "energy": "medium",
      "estimated_minutes": 30,
      "category": "Work"
    }}
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
                    "options": {"temperature": 0.2}
                }
            )
            if resp.status_code == 200:
                data = safe_parse_json(resp.json().get("response", ""))
                if isinstance(data, dict) and data.get("improved_title"):
                    desc = clean_plain_paragraph(data.get("description", ""))
                    if desc and "efficiently with high quality" not in desc and "associated checklist items" not in desc:
                        data["description"] = desc
                        return data
    except Exception:
        pass

    # Instant Domain-Aware Heuristic Synthesis Fallback (<5ms execution)
    return synthesize_domain_task(title, context, entity_type, project_name, previous_tasks)

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

async def auto_fill_task_details(
    title: str,
    context: Optional[str] = None,
    project_name: Optional[str] = None,
    previous_tasks: Optional[List[str]] = None,
    entity_type: Optional[str] = "task"
) -> Dict[str, Any]:
    """Expands a task title into a detailed description and 3-5 subtask checklist with project context."""
    return await improve_task_data(title, context, entity_type, project_name, previous_tasks)

def synthesize_project_description(
    project_name: str,
    existing_tasks: Optional[List[str]] = None,
    context: Optional[str] = None
) -> str:
    """Creates a clean, authoritative 1-paragraph project scope with zero markdown formatting (# or *)."""
    clean_name = project_name.strip()
    if not clean_name:
        clean_name = "Strategic Initiative"

    name_lower = clean_name.lower()

    if existing_tasks and len(existing_tasks) > 0:
        tasks_sample = [f"'{t.strip()}'" for t in existing_tasks[:3] if t.strip()]
        if len(tasks_sample) == 1:
            task_clause = f"centered around {tasks_sample[0]}"
        else:
            task_clause = f"encompassing key deliverables such as {', '.join(tasks_sample[:-1])} and {tasks_sample[-1]}"
        main_summary = (
            f"Strategic initiative for {clean_name} to coordinate focused execution across linked milestones, {task_clause}. "
            f"Aims to deliver high-quality outcomes with clear progress tracking, zero unresolved blockers, and complete alignment with Sage OS goals."
        )
    else:
        if any(w in name_lower for w in ["pi", "homelab", "lab", "server", "infra", "nas", "host"]):
            main_summary = (
                f"Infrastructure initiative for {clean_name} covering hardware configuration, network security, and automated service deployment. "
                f"Focuses on maintaining high system uptime, robust telemetry, and resilient long-term operation."
            )
        elif any(w in name_lower for w in ["run", "marathon", "fitness", "workout", "health", "gym"]):
            main_summary = (
                f"Health and fitness initiative for {clean_name} to establish progressive training routines, nutrition habits, and recovery standards. "
                f"Aims to build endurance and physical resilience through consistent, measurable daily workouts."
            )
        elif any(w in name_lower for w in ["finance", "tax", "budget", "ledger", "money", "invest"]):
            main_summary = (
                f"Financial management initiative for {clean_name} to audit account balances, set monthly spending guardrails, and track savings targets. "
                f"Ensures accurate bookkeeping and disciplined financial growth over time."
            )
        elif any(w in name_lower for w in ["code", "app", "web", "software", "api", "feature", "dev", "task"]):
            main_summary = (
                f"Engineering initiative for {clean_name} to build and maintain technical architecture, backend APIs, and responsive user interfaces. "
                f"Focuses on disciplined development, rigorous testing, and reliable deployment with zero regressions."
            )
        else:
            main_summary = (
                f"Project roadmap for {clean_name} to establish clear objectives, track sequential deliverables, and maintain steady progress. "
                f"Designed to eliminate blockers, organize actionable tasks, and achieve successful project completion."
            )

    if context and context.strip():
        main_summary += f" Strategic focus: {context.strip().rstrip('. ')}."

    return clean_plain_paragraph(main_summary)

async def generate_project_description(
    project_name: str,
    existing_tasks: Optional[List[str]] = None,
    context: Optional[str] = None
) -> str:
    """Generates project description via Ollama LLM with heuristic fallback (1 plain paragraph, zero # or *)."""
    prompt = f"""
    You are an executive strategist for Sage Life OS.
    Write a crisp, authoritative project description for: "{project_name}".
    Existing / Linked Deliverables: {existing_tasks or []}
    Context: "{context or ''}"

    REQUIREMENTS:
    - Output exactly ONE concise paragraph (2 to 4 sentences).
    - FORBIDDEN: Do NOT use any markdown headers (no #, ##, ###), no bold or asterisks (no * or **), no bullet lists.
    - Write in clean, plain English describing the objective, core deliverables, and definition of success.
    - Output ONLY the plain text paragraph. No preamble or conversational filler.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.2}
                }
            )
            if resp.status_code == 200:
                text = resp.json().get("response", "").strip()
                cleaned = clean_plain_paragraph(text)
                if cleaned and len(cleaned) > 40:
                    return cleaned
    except Exception:
        pass

    return synthesize_project_description(project_name, existing_tasks, context)
