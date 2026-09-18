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

def synthesize_domain_task(
    title: str,
    context: Optional[str] = None,
    entity_type: Optional[str] = "task",
    project_name: Optional[str] = None,
    previous_tasks: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Expert domain synthesizer: creates authentic, high-value, domain-specific
    objectives, performance targets, definitions of done, and logical subtasks.
    Zero robotic boilerplate or bureaucratic filler.
    """
    refined_title = heuristic_improve_title(title, entity_type or "task")
    tl = title.lower()

    proj_section = ""
    if project_name or (previous_tasks and len(previous_tasks) > 0):
        lines = ["\n\n### Project Context & Alignment"]
        if project_name:
            lines.append(f"Part of project **{project_name}**.")
        if previous_tasks and len(previous_tasks) > 0:
            lines.append("Builds upon preceding deliverables in this project:")
            for pt in previous_tasks[:5]:
                lines.append(f"- {pt}")
        proj_section = "\n".join(lines)

    ctx_line = f"{proj_section}\n\n### Context & Notes\n{context}" if (context and context.strip()) else proj_section

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
        return {
            "improved_title": refined_title if ("Run" in refined_title or "Cardio" in refined_title) else "Complete Cardio Running Session",
            "description": (
                "### Objective\n"
                "Execute an energizing running session to build cardiovascular endurance, increase aerobic capacity, and clear mental fatigue.\n\n"
                "### Target Performance & Form\n"
                "- **Pacing**: Steady aerobic Zone 2/3 rhythm (sustainable conversational breathing).\n"
                "- **Biomechanics**: Upright spine, relaxed shoulders, compact arm swing, and soft midfoot strike (~165-175 spm cadence).\n"
                "- **Environment**: Safe pedestrian route with planned hydration checkpoints.\n\n"
                "### Definition of Done\n"
                "- Target distance or duration completed without abrupt exhaustion.\n"
                "- 5-minute cool-down walk followed by dedicated lower-body mobility (calves, hamstrings, quads, hip flexors).\n"
                "- Hydration and electrolytes replenished; workout stats recorded."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title if "Workout" in refined_title else f"Execute Strength Session: {refined_title}",
            "description": (
                "### Objective\n"
                "Complete a focused progressive overload resistance training session to build muscular strength, density, and physical resilience.\n\n"
                "### Training Protocol\n"
                "- **Tempo & Control**: Controlled 2-3s eccentric descent with explosive, controlled concentric drive.\n"
                "- **Compound Priority**: Execute heavy compound multi-joint movements before secondary accessories.\n"
                "- **Rest Periods**: 90-120s between compound sets; 60s for isolation accessories.\n\n"
                "### Definition of Done\n"
                "- All prescribed sets and reps logged with working weights.\n"
                "- Core bracing maintained on every repetition with zero technical breakdowns.\n"
                "- Post-workout protein shake consumed and mobility cool-down completed."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                "### Objective\n"
                "Engage in outdoor brisk walking for active recovery, daily step accumulation, and mental decompression.\n\n"
                "### Guidelines\n"
                "- Maintain a purposeful, brisk stride with eyes forward and shoulders back.\n"
                "- Disconnect from urgent work alerts to maximize sensory decompression.\n\n"
                "### Definition of Done\n"
                "- Continuous brisk walk completed in natural daylight or fresh air.\n"
                "- Daily step target achieved and logged."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                "### Objective\n"
                "Release chronic muscular tension, improve joint range of motion, and down-regulate the nervous system through mindful movement.\n\n"
                "### Practice Focus\n"
                "- Deep nasal diaphragmatic breathing synchronized with every posture change.\n"
                "- Avoid forcing range of motion; breathe into tight fascial restrictions.\n\n"
                "### Definition of Done\n"
                "- Full sequence completed in a quiet, distraction-free space.\n"
                "- Mind relaxed and joint mobility visibly restored."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Implement a high-reliability technical solution for **{refined_title}** with clean architecture, strict type safety, and zero regressions.\n\n"
                "### Engineering Standards\n"
                "- **Modularity**: Keep functions pure and decoupled with explicit error boundaries.\n"
                "- **Resilience**: Gracefully handle edge cases, network timeouts, and cold starts.\n"
                "- **Maintainability**: Ensure code is self-documenting with typed interfaces.\n\n"
                "### Definition of Done\n"
                "- Code implementation completed and formatted cleanly.\n"
                "- Unit and integration test suites passing with zero unexpected failures.\n"
                "- Git branch committed with concise semantic message and pushed."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Configure, deploy, or maintain server infrastructure for **{refined_title}** ensuring high availability and secure operations.\n\n"
                "### Operational Safeguards\n"
                "- Verify configuration syntax and port bindings before reloading active daemons.\n"
                "- Monitor CPU, RAM headroom, and journalctl log output for anomalies.\n\n"
                "### Definition of Done\n"
                "- Target service active, enabled at boot, and passing health-check probes.\n"
                "- Zero fatal or critical error entries in journalctl logs.\n"
                "- Auto-restart rules and persistent state verified."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Reconcile and settle payment for **{refined_title}** to maintain flawless account standing and clean financial records.\n\n"
                "### Execution Checklist\n"
                "- Verify billed amount matches meter usage, billing cycle, or contracted rate.\n"
                "- Use secure banking portal or verified payment gateway.\n\n"
                "### Definition of Done\n"
                "- Payment executed and confirmed by issuing provider.\n"
                "- Digital transaction receipt / UTR reference number archived.\n"
                "- Ledger balance and expense entry updated in Sage OS Finance."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                "### Objective\n"
                "Restock kitchen essentials, fresh produce, and household supplies for balanced, stress-free nutrition.\n\n"
                "### Shopping Protocol\n"
                "- Prioritize whole foods: fresh vegetables, high-protein sources, and healthy fats.\n"
                "- Inspect packaging integrity, expiry dates, and freshness markers.\n\n"
                "### Definition of Done\n"
                "- All planned pantry staples and fresh ingredients acquired.\n"
                "- Items unpacked, washed if necessary, and neatly organized in pantry/fridge.\n"
                "- Grocery expense entered into Sage OS Finance."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Prepare nourishing, delicious home-cooked meals for **{refined_title}** to maintain peak physical and mental vitality.\n\n"
                "### Culinary Standards\n"
                "- Prioritize lean protein, fiber-rich vegetables, and clean whole-food seasoning.\n"
                "- Practice 'clean as you go' to keep workspace spotless.\n\n"
                "### Definition of Done\n"
                "- Meal cooked thoroughly to safe temperatures and seasoned to taste.\n"
                "- Portions divided for consumption or stored in airtight meal containers.\n"
                "- Cookware washed, counters wiped down, and kitchen fully reset."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Complete health assessment or medical consultation for **{refined_title}** to safeguard long-term vitality and address clinical needs.\n\n"
                "### Preparation\n"
                "- Note down symptoms, chronology, medications, and specific questions.\n"
                "- Carry past reports and photo identification.\n\n"
                "### Definition of Done\n"
                "- Consultation completed with attending physician or specialist.\n"
                "- Prescribed diagnostics or medications acquired.\n"
                "- Follow-up instructions and appointments documented in calendar."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Execute scheduled inspection, servicing, or maintenance for **{refined_title}** to guarantee mechanical safety and peak vehicle efficiency.\n\n"
                "### Safety Verification\n"
                "- Inspect critical safety components: brakes, tire tread & pressure, fluid levels, lighting.\n"
                "- Ensure all replacement parts meet OEM specifications.\n\n"
                "### Definition of Done\n"
                "- Scheduled maintenance or repair successfully completed.\n"
                "- Multi-point inspection cleared with zero critical warnings.\n"
                "- Service invoice filed and next maintenance mileage logged."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Deep clean, sanitize, and organize **{refined_title}** to create a calm, dust-free, and high-productivity environment.\n\n"
                "### Execution Focus\n"
                "- Declutter all horizontal surfaces before dusting or vacuuming.\n"
                "- Use eco-friendly multi-surface disinfectant for high-touch surfaces.\n\n"
                "### Definition of Done\n"
                "- All clutter removed and returned to designated homes.\n"
                "- Surfaces wiped clean, floors vacuumed/mopped, and trash emptied.\n"
                "- Living space reset to an immaculate baseline state."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Engage in deep focused study on **{refined_title}** to master fundamental principles and build actionable mental models.\n\n"
                "### Deep Work Protocol\n"
                "- 50-minute distraction-free Pomodoro sprint with notifications muted.\n"
                "- Prioritize active recall, synthesis notes, and self-testing over passive scanning.\n\n"
                "### Definition of Done\n"
                "- Designated chapter, research paper, or lecture module completed.\n"
                "- Core insights articulated in personal notes using the Feynman technique.\n"
                "- 3 actionable takeaways or problem solutions produced."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Author high-impact, persuasive content for **{refined_title}** tailored to captivate and inform the target audience.\n\n"
                "### Craft Guidelines\n"
                "- Structure narrative with a compelling hook, substantiated arguments, and crisp takeaways.\n"
                "- Ruthlessly trim passive voice and corporate jargon for punchy readability.\n\n"
                "### Definition of Done\n"
                "- Complete draft written with structured flow and clear headers.\n"
                "- Proofread for rhythm, factual accuracy, and typography.\n"
                "- Final version exported and shared with stakeholders or queued for release."
                f"{ctx_line}"
            ),
            "subtasks": [
                "Outline core narrative arc, target audience, and 3 key takeaways",
                "Draft uninterrupted initial pass focusing on flow without self-editing",
                "Refine structure, tighten sentences, and verify supporting data points",
                "Perform final proofreading sweep and check formatting / visual hierarchy",
                "Export final deliverable and share with intended audience"
            ],
            "priority": priority if priority != "medium" else "high",
            "energy": "high",
            "estimated_minutes": 60,
            "category": "Work"
        }

    # 15. MEETINGS / 1-ON-1 / INTERVIEWS
    if is_meeting:
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Conduct a high-leverage discussion on **{refined_title}** to align perspectives, resolve blockers, and establish ownership.\n\n"
                "### Meeting Hygiene\n"
                "- Distribute clear 3-point agenda prior to starting.\n"
                "- Facilitate active participation and maintain crisp timekeeping.\n\n"
                "### Definition of Done\n"
                "- Key decisions, rationale, and open questions explicitly documented.\n"
                "- Action items with unambiguous owners and deadlines agreed upon.\n"
                "- Meeting notes circulated to participants within 30 minutes of closing."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Coordinate logistics and packing for **{refined_title}** ensuring an effortless, well-prepared travel experience.\n\n"
                "### Travel Readiness\n"
                "- Confirm transport schedules, tickets, accommodation vouchers, and identification.\n"
                "- Download offline maps and emergency contacts.\n\n"
                "### Definition of Done\n"
                "- All bookings, tickets, and reservations verified.\n"
                "- Luggage packed against comprehensive essentials checklist.\n"
                "- Digital copies of IDs and boarding passes secured on mobile device."
                f"{ctx_line}"
            ),
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
        return {
            "improved_title": refined_title,
            "description": (
                f"### Objective\n"
                f"Celebrate **{refined_title}** to create memorable moments and strengthen personal relationships.\n\n"
                "### Details\n"
                "- Focus on thoughtful personalization and genuine presence.\n\n"
                "### Definition of Done\n"
                "- Arrangements, venue, or reservations confirmed.\n"
                "- Gift or greeting card prepared and presented with care.\n"
                "- High-quality memorable experience shared together."
                f"{ctx_line}"
            ),
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

    return {
        "improved_title": refined_title,
        "description": (
            f"### Objective\n"
            f"Execute **{refined_title}** thoroughly with focused effort and complete attention to detail.\n\n"
            "### Execution Strategy\n"
            f"- Define the core requirements for {clean_subject} before taking action.\n"
            "- Work sequentially through preparation, core implementation, and final verification.\n\n"
            "### Definition of Done\n"
            f"- Primary deliverable for {clean_subject} verified and fully functional.\n"
            "- No outstanding blockers or incomplete dependencies remaining.\n"
            "- Outcome verified and logged into Sage OS."
            f"{ctx_line}"
        ),
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
    Improvises raw task data into an executive title, structured description,
    definition of done, sequential subtasks, energy level, and duration estimate.
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

    CRITICAL QUALITY CONSTRAINTS:
    - Never output generic bureaucratic filler or boilerplate (e.g. forbid clichés like "Complete X efficiently with high quality", "All associated checklist items verified and executed", "Any outcomes documented or filed").
    - Provide rich, authentic, domain-specific guidance (e.g. for running/fitness mention pacing, heart-rate zones, hydration, dynamic warmup, stretches; for coding mention tests, edge cases, git commits; for finance mention invoice verification, payment receipts, ledger updates).
    - If Linked Project or Preceding Tasks are provided, explicitly align the Objective, Strategy, and Definition of Done to build upon those preceding deliverables.
    - Craft 3 to 5 clear, actionable, chronological micro-steps in the subtasks checklist.

    Instructions:
    1. improved_title: A crisp, professional, action-oriented title starting with an active imperative verb (e.g., "Schedule Dental Checkup", "Finalize Q3 Budget Report", "Execute 5km Cardio Run & Mobility"). Never include conversational fluff or dates/times in the title.
    2. description: Formatted in clear Markdown with:
       - **Objective**: 1 inspiring sentence on the target outcome.
       - **Target Performance / Key Focus**: Specific domain techniques, form, or standards.
       - **Definition of Done**: Specific, verifiable completion criteria.
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
                    # Sanity check: Ensure LLM didn't return robotic boilerplate
                    desc = data.get("description", "")
                    if "efficiently with high quality" not in desc and "associated checklist items" not in desc:
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
    """
    Synthesizes an authentic, structured Markdown scope for a project/dossier.
    """
    clean_name = project_name.strip()
    if not clean_name:
        clean_name = "Strategic Initiative"

    tasks_block = ""
    if existing_tasks and len(existing_tasks) > 0:
        tasks_block = "\n".join(f"- {t}" for t in existing_tasks[:6])
    else:
        name_lower = clean_name.lower()
        if any(w in name_lower for w in ["pi", "homelab", "lab", "server", "infra", "nas", "host"]):
            tasks_block = (
                "- Hardware provisioning, storage configuration & OS base installation\n"
                "- Network hardening, static IP allocation & SSH key authentication\n"
                "- Core services deployment (Reverse proxy, DNS, automated backups)\n"
                "- System metrics monitoring, telemetry & service health verification"
            )
        elif any(w in name_lower for w in ["run", "marathon", "fitness", "workout", "health", "gym"]):
            tasks_block = (
                "- Baseline endurance benchmarking & target pacing formulation\n"
                "- Progressive weekly training schedule (aerobic, intervals & recovery)\n"
                "- Nutrition, hydration & active recovery routine establishment\n"
                "- Performance milestone assessments & event day execution"
            )
        elif any(w in name_lower for w in ["finance", "tax", "budget", "ledger", "money", "invest"]):
            tasks_block = (
                "- Account audit, balances reconciliation & spending categorization\n"
                "- Monthly budget guardrails formulation across primary cost centers\n"
                "- Recurring bills, subscriptions & obligations consolidation\n"
                "- Surplus allocation & savings target tracking"
            )
        elif any(w in name_lower for w in ["code", "app", "web", "software", "api", "feature", "dev"]):
            tasks_block = (
                "- Technical specification, architecture design & schema modeling\n"
                "- Core backend API endpoints & state services implementation\n"
                "- Responsive frontend UI, interactions & error handling integration\n"
                "- Automated test verification, deployment & release documentation"
            )
        else:
            tasks_block = (
                f"- Define foundational requirements and milestones for {clean_name}\n"
                f"- Coordinate and execute core phase deliverables sequentially\n"
                f"- Review outputs, eliminate blockers, and optimize workflow\n"
                f"- Final verification and archival of completed deliverables"
            )

    ctx_block = f"\n\n### Strategic Focus\n{context}" if context and context.strip() else ""

    return (
        f"### Strategic Objective\n"
        f"Executive initiative for **{clean_name}** to establish a focused, high-leverage roadmap "
        f"with clear milestones and trackable outcomes.\n\n"
        f"### Core Scope & Deliverables\n"
        f"{tasks_block}\n\n"
        f"### Definition of Success\n"
        f"- All primary milestone deliverables completed and verified within Sage OS.\n"
        f"- Zero unresolved blockers or orphaned dependencies across linked work items.\n"
        f"- Strategic objectives documented and archived upon final completion."
        f"{ctx_block}"
    )

async def generate_project_description(
    project_name: str,
    existing_tasks: Optional[List[str]] = None,
    context: Optional[str] = None
) -> str:
    """Generates project description via Ollama LLM with heuristic fallback."""
    prompt = f"""
    You are an executive strategist for Sage Life OS.
    Write a crisp, authoritative project dossier description for: "{project_name}".
    Existing / Linked Deliverables: {existing_tasks or []}
    Context: "{context or ''}"

    Output clear Markdown with:
    ### Strategic Objective
    1-2 sentences stating the vision and core value proposition.

    ### Core Scope & Deliverables
    3-4 bullet points detailing key work streams or deliverables.

    ### Definition of Success
    2-3 concrete criteria defining a successful conclusion.

    Output ONLY the Markdown content. No conversational preamble.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3}
                }
            )
            if resp.status_code == 200:
                text = resp.json().get("response", "").strip()
                if text and len(text) > 40:
                    return text
    except Exception:
        pass

    return synthesize_project_description(project_name, existing_tasks, context)
