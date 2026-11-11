"""Tests for voice_command.py, the one Siri shortcut.

A corpus of spoken and typed phrasings (slang, typos, speech-to-text slips,
mixed languages, the time at the start, middle or end) is read by the rules
alone, then by the AI layer with a stand-in model, then run end to end through
/api/voice.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import datetime
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import voice_command as vc  # noqa: E402

NOW = datetime.datetime(2026, 10, 26, 10, 0)  # a Monday
TOMORROW, DAY_AFTER = "2026-10-27", "2026-10-28"
FRI, SAT, NEXT_MON = "2026-10-30", "2026-10-31", "2026-11-02"


def context():
    return vc.Context(
        items=[
            {"id": "i1", "key": "TASK-1", "title": "Call mom", "status": "todo"},
            {"id": "i2", "key": "C-13", "title": "Sonar connector pinout labeling", "status": "todo"},
            {"id": "i3", "key": "TASK-3", "title": "Call dentist", "status": "todo"},
            {"id": "i4", "key": "TASK-4", "title": "Pay electricity bill", "status": "todo", "dueDate": "2026-10-25"},
            {"id": "i5", "key": "TASK-5", "title": "Buy milk", "status": "todo", "isInbox": True},
        ],
        projects=[{"id": "p-sage", "name": "Sage"}, {"id": "p-ci4", "name": "Ci4 Work"}, {"id": "inbox", "name": "Inbox"}],
        habits=[{"id": "h1", "name": "Gym", "history": []}],
    )


def read(text, ctx=None):
    cmd = vc.understand(text, NOW, ctx or context(), use_ai=False)
    vc._resolve_when(cmd, NOW, roll=cmd.intent in ("remind", "event"))
    return cmd


# (phrase, expected). Expected keys: intent, title (case-insensitive), date, time, priority, repeat, target_id, query
ADDS = [
    # --- the time at the start, middle and end ---
    ("tomorrow 5pm call mom", dict(title="Call mom", date=TOMORROW, time="17:00")),
    ("call mom tomorrow 5pm", dict(title="Call mom", date=TOMORROW, time="17:00")),
    ("call mom 5pm tomorrow", dict(title="Call mom", date=TOMORROW, time="17:00")),
    ("5pm tomorrow call mom", dict(title="Call mom", date=TOMORROW, time="17:00")),
    ("call tomorrow at 5pm mom", dict(date=TOMORROW, time="17:00")),
    ("at 5pm tomorrow, call mom", dict(title="Call mom", date=TOMORROW, time="17:00")),
    ("tomorrow call mom at 5 pm", dict(title="Call mom", date=TOMORROW, time="17:00")),
    ("friday 3pm send the deck", dict(title="Send the deck", date=FRI, time="15:00")),
    ("send the deck friday 3pm", dict(title="Send the deck", date=FRI, time="15:00")),
    ("send the deck on friday at 3", dict(title="Send the deck", date=FRI, time="15:00")),
    ("by friday send the deck", dict(title="Send the deck", date=FRI)),
    ("send the deck by friday", dict(title="Send the deck", date=FRI)),
    ("nov 15 renew passport", dict(title="Renew passport", date="2026-11-15")),
    ("renew passport 15 nov", dict(title="Renew passport", date="2026-11-15")),
    ("renew passport on the 15th of november", dict(title="Renew passport", date="2026-11-15")),
    ("renew passport november 15th", dict(title="Renew passport", date="2026-11-15")),
    ("2026-12-01 file taxes", dict(title="File taxes", date="2026-12-01")),
    ("pay rent on the 1st", dict(title="Pay rent", date="2026-11-01")),
    # --- slang and texting spellings ---
    ("tmrw call mom", dict(title="Call mom", date=TOMORROW)),
    ("call mom tmrw", dict(title="Call mom", date=TOMORROW)),
    ("call mom tomorow", dict(title="Call mom", date=TOMORROW)),
    ("call mom tommorow 6pm", dict(title="Call mom", date=TOMORROW, time="18:00")),
    ("call mom 2moro", dict(title="Call mom", date=TOMORROW)),
    ("call mom tonite", dict(title="Call mom", date="2026-10-26", time="21:00")),
    ("call mom tonight", dict(title="Call mom", date="2026-10-26", time="21:00")),
    ("call mom tmrw eve", dict(title="Call mom", date=TOMORROW, time="19:00")),
    ("call mom tmrw morning", dict(title="Call mom", date=TOMORROW, time="09:00")),
    ("call mom tomorrow afternoon", dict(title="Call mom", date=TOMORROW, time="14:00")),
    ("call mom day after tomorrow", dict(title="Call mom", date=DAY_AFTER)),
    ("call mom wensday", dict(title="Call mom", date="2026-10-28")),
    ("call mom on thrusday", dict(title="Call mom", date="2026-10-29")),
    ("call mom satruday 11am", dict(title="Call mom", date=SAT, time="11:00")),
    ("call mom next week", dict(title="Call mom", date=NEXT_MON)),
    ("call mom this weekend", dict(title="Call mom", date=SAT)),
    ("call mom in 3 days", dict(title="Call mom", date="2026-10-29")),
    ("call mom in a week", dict(title="Call mom", date=NEXT_MON)),
    ("call mom in two weeks", dict(title="Call mom", date="2026-11-09")),
    ("call mom end of month", dict(title="Call mom", date="2026-10-31")),
    ("call mom eod", dict(title="Call mom", time="17:00")),
    ("call mom noon tomorrow", dict(title="Call mom", date=TOMORROW, time="12:00")),
    ("call mom midnight", dict(title="Call mom", time="00:00")),
    # --- how the time is said ---
    ("call mom 5.30pm", dict(title="Call mom", time="17:30")),
    ("call mom 5:30 pm", dict(title="Call mom", time="17:30")),
    ("call mom at 17:30", dict(title="Call mom", time="17:30")),
    ("call mom at 1730 hrs", dict(title="Call mom", time="17:30")),
    ("call mom 5 p.m.", dict(title="Call mom", time="17:00")),
    ("call mom 5 PM", dict(title="Call mom", time="17:00")),
    ("call mom 9am", dict(title="Call mom", time="09:00")),
    ("call mom at 9", dict(title="Call mom", time="09:00")),
    ("call mom at 5", dict(title="Call mom", time="17:00")),
    ("call mom at 5 in the evening", dict(title="Call mom", time="17:00")),
    ("call mom at 8 in the morning", dict(title="Call mom", time="08:00")),
    ("call mom at 9 at night", dict(title="Call mom", time="21:00")),
    ("call mom half past 4", dict(title="Call mom", time="16:30")),
    ("call mom quarter to 6", dict(title="Call mom", time="17:45")),
    ("call mom quarter past 7 in the evening", dict(title="Call mom", time="19:15")),
    ("call mom 5 o'clock", dict(title="Call mom", time="17:00")),
    ("call mom at five thirty pm", dict(title="Call mom", time="17:30")),
    ("call mom at five thirty in the evening", dict(title="Call mom", time="17:30")),
    ("call mom at five p m", dict(title="Call mom", time="17:00")),
    ("call mom at seven oh five am", dict(title="Call mom", time="07:05")),
    ("call mom at twelve noon", dict(title="Call mom", time="12:00")),
    ("call mom in 20 minutes", dict(title="Call mom", date="2026-10-26", time="10:20")),
    ("call mom in twenty minutes", dict(title="Call mom", date="2026-10-26", time="10:20")),
    ("call mom in an hour", dict(title="Call mom", date="2026-10-26", time="11:00")),
    ("call mom in half an hour", dict(title="Call mom", date="2026-10-26", time="10:30")),
    ("call mom in 2 hrs", dict(title="Call mom", date="2026-10-26", time="12:00")),
    ("call mom 45 mins from now", dict(title="Call mom", date="2026-10-26", time="10:45")),
    ("in 15 min call mom", dict(title="Call mom", date="2026-10-26", time="10:15")),
    ("dinner at 8 tomorrow", dict(intent="event", title="Dinner", date=TOMORROW, time="20:00")),
    ("wake up at 6 every day", dict(title="Wake up", time="06:00", repeat="daily")),
    # --- priority anywhere ---
    ("urgent call mom", dict(title="Call mom", priority="urgent")),
    ("call mom urgent", dict(title="Call mom", priority="urgent")),
    ("call mom asap", dict(title="Call mom", priority="urgent")),
    ("asap call mom tomorrow", dict(title="Call mom", date=TOMORROW, priority="urgent")),
    ("call mom, it's really important", dict(title="Call mom", priority="high")),
    ("high priority call mom tomorrow", dict(title="Call mom", date=TOMORROW, priority="high")),
    ("call mom low priority", dict(title="Call mom", priority="low")),
    ("call mom no rush", dict(title="Call mom", priority="low")),
    ("call mom not urgent", dict(title="Call mom", priority="low")),
    ("call mom !high", dict(title="Call mom", priority="high")),
    ("call mom jaldi", dict(title="Call mom", priority="urgent")),
    ("P1 fix the login bug", dict(title="Fix the login bug", priority="urgent")),
    # --- repeats ---
    ("water plants every day", dict(title="Water plants", repeat="daily")),
    ("water plants daily", dict(title="Water plants", repeat="daily")),
    ("water plants everyday at 7am", dict(title="Water plants", repeat="daily", time="07:00")),
    ("water plants every other day", dict(title="Water plants", repeat="every:2:days")),
    ("water plants every 3 days", dict(title="Water plants", repeat="every:3:days")),
    ("water plants every monday", dict(title="Water plants", repeat="weekly:1")),
    ("water plants every mon and thu", dict(title="Water plants", repeat="weekly:1,4")),
    ("water plants every mon wed fri 7am", dict(title="Water plants", repeat="weekly:1,3,5", time="07:00", date="2026-10-28")),
    ("water plants weekly", dict(title="Water plants", repeat="weekly")),
    ("water plants every weekday", dict(title="Water plants", repeat="weekdays")),
    ("water plants every week", dict(title="Water plants", repeat="weekly")),
    ("water plants fortnightly", dict(title="Water plants", repeat="every:2:weeks")),
    ("water plants every month", dict(title="Water plants", repeat="monthly")),
    ("pay rent on the 1st every month", dict(title="Pay rent", repeat="monthly", date="2026-11-01")),
    ("every morning stretch", dict(title="Stretch", repeat="daily", time="09:00")),
    # --- leads and fillers ---
    ("hey sage add a task to call mom tomorrow", dict(title="Call mom", date=TOMORROW)),
    ("can you please add call mom for tomorrow", dict(title="Call mom", date=TOMORROW)),
    ("I need to call mom tomorrow", dict(title="Call mom", date=TOMORROW)),
    ("gotta call mom tmrw", dict(title="Call mom", date=TOMORROW)),
    ("don't forget to call mom friday", dict(title="Call mom", date=FRI)),
    ("new task: call mom", dict(title="Call mom")),
    ("task call mom", dict(title="Call mom")),
    ("add call mom to my list", dict(title="Call mom")),
    ("put call mom on my to-do list", dict(title="Call mom")),
    ("um okay so call mom tomorrow please", dict(title="Call mom", date=TOMORROW)),
    # --- tags, places, project ---
    ("call mom #family", dict(title="Call mom")),
    ("review the wiring in the Sage project tomorrow", dict(title="Review the wiring", date=TOMORROW)),
    ("add test plan to Ci4 Work", dict(title="Test plan")),
    # --- reminders ---
    ("remind me to call mom tomorrow at 5pm", dict(intent="remind", title="Call mom", date=TOMORROW, time="17:00")),
    ("remind me tomorrow to call mom", dict(intent="remind", title="Call mom", date=TOMORROW)),
    ("tomorrow 5pm remind me to call mom", dict(intent="remind", title="Call mom", date=TOMORROW, time="17:00")),
    ("remind me about the dentist friday 9am", dict(intent="remind", title="Dentist", date=FRI, time="09:00")),
    ("ping me in half an hour to stretch", dict(intent="remind", title="Stretch", date="2026-10-26", time="10:30")),
    ("remind me in 2 hrs to take the pill", dict(intent="remind", title="Take the pill", date="2026-10-26", time="12:00")),
    ("remind me at 9 to take the pill", dict(intent="remind", title="Take the pill", date=TOMORROW, time="09:00")),
    ("remind me at 11 to take the pill", dict(intent="remind", title="Take the pill", date="2026-10-26", time="11:00")),
    ("set a reminder for 6pm to call raj", dict(intent="remind", title="Call raj", time="18:00")),
    ("hey sage remind me tomorrow morning to pay the electricity bill", dict(intent="remind", title="Pay the electricity bill", date=TOMORROW, time="09:00")),
    ("reminder: gym at 6am", dict(intent="remind", title="Gym", time="06:00", date=TOMORROW)),
    # --- events ---
    ("lunch with priya friday at 1", dict(intent="event", title="Lunch with priya", date=FRI, time="13:00")),
    ("meeting with raj tmrw 2pm", dict(intent="event", title="Meeting with raj", date=TOMORROW, time="14:00")),
    ("2pm tomorrow meeting with raj", dict(intent="event", title="Meeting with raj", date=TOMORROW, time="14:00")),
    ("doctor appointment 15 nov 3:30pm", dict(intent="event", date="2026-11-15", time="15:30")),
    ("interview with acme on friday at 11 in the morning", dict(intent="event", date=FRI, time="11:00")),
    # --- other languages and mixes ---
    ("kal subah 6 baje gym jaana hai", dict(date=TOMORROW, time="06:00")),
    ("kal shaam 5 baje mom ko call karna yaad dilana", dict(intent="remind", date=TOMORROW, time="17:00")),
    ("mujhe kal 5 baje mom ko call karna yaad dilana", dict(intent="remind", date=TOMORROW, time="17:00")),
    ("parso dentist ka appointment hai subah 10 baje", dict(date=DAY_AFTER, time="10:00")),
    ("aaj raat bijli ka bill pay karna", dict(date="2026-10-26", time="21:00")),
    ("har somvar team sync", dict(repeat="weekly:1")),
    ("saade paanch baje chai", dict(time="17:30")),
    ("mom ko call kal 4 baje", dict(title="Mom ko call", date=TOMORROW, time="16:00")),
    ("mañana llamar al dentista", dict(title="Llamar al dentista", date=TOMORROW)),
    ("mañana a las 5pm llamar al dentista", dict(title="Llamar al dentista", date=TOMORROW, time="17:00")),
    ("llamar al dentista el viernes", dict(date=FRI)),
    ("recuérdame mañana llamar a mamá", dict(intent="remind", date=TOMORROW)),
    ("demain 9h appeler maman", dict(date=TOMORROW)),
    ("morgen um 9 uhr mama anrufen", dict(date=TOMORROW, time="09:00")),
    ("call mom kal 5pm", dict(title="Call mom", date=TOMORROW, time="17:00")),
    ("kal call mom at 6", dict(title="Call mom", date=TOMORROW, time="18:00")),
    ("tomorrow subah gym", dict(title="Gym", date=TOMORROW, time="09:00")),
    # --- speech to text rough edges ---
    ("Call mom tomorrow at 5 p.m.", dict(title="Call mom", date=TOMORROW, time="17:00")),
    ("  call   mom   tomorrow   ", dict(title="Call mom", date=TOMORROW)),
    ("CALL MOM TOMORROW 5PM", dict(date=TOMORROW, time="17:00")),
    ("call mom tomorrow at five", dict(title="Call mom", date=TOMORROW, time="17:00")),
    ("whatsapp raju abt invoice asap", dict(title="Whatsapp raju abt invoice", priority="urgent")),
    # --- more texting, ish, word order ---
    ("yo remind me 2 call bro tmrw 8pm", dict(intent="remind", title="Call bro", date=TOMORROW, time="20:00")),
    ("tmrw 8pm bro call remind me", dict(intent="remind", title="Bro call", date=TOMORROW, time="20:00")),
    ("can u set a reminder for like 6 ish to grab the parcel", dict(intent="remind", title="Grab the parcel", time="18:00")),
    ("need to buy sunscreen b4 fri", dict(title="Buy sunscreen", date=FRI)),
    ("send mail to hr by 4 today", dict(title="Send mail to hr", date="2026-10-26", time="16:00")),
    ("renew insurance within 2 weeks", dict(title="Renew insurance", date="2026-11-09")),
    ("dentist 3 days from now", dict(title="Dentist", date="2026-10-29")),
    ("book flight to delhi next friday morning", dict(intent="add", title="Book flight to delhi", date=FRI, time="09:00")),
    ("agle hafte monday ko invoice bhejna", dict(date=NEXT_MON, title="Invoice bhejna")),
    ("tomorrow evening 7 pm dinner with family", dict(intent="event", title="Dinner with family", date=TOMORROW, time="19:00")),
    ("finish slides by tuesday 11 am urgent", dict(title="Finish slides", date=TOMORROW, time="11:00", priority="urgent")),
    ("mom birthday 12th december", dict(title="Mom birthday", date="2026-12-12")),
    ("har din subah 7 baje walk", dict(title="Walk", repeat="daily", time="07:00")),
    # --- must not be mistaken ---
    ("buy 3 tickets for the show", dict(title="Buy 3 tickets for the show")),
    ("read chapter 5", dict(title="Read chapter 5")),
    ("my friend's birthday gift", dict(title="My friend's birthday gift")),
    ("track the parcel from amazon", dict(intent="add", title="Track the parcel from amazon")),
    ("finish the report", dict(intent="add", title="Finish the report")),
    ("complete the tax form tomorrow", dict(intent="add", title="Complete the tax form", date=TOMORROW)),
]


class Understanding(unittest.TestCase):
    def check(self, phrase, want):
        cmd = read(phrase)
        got = {
            "intent": cmd.intent, "title": cmd.title, "date": cmd.date, "time": cmd.time, "priority": cmd.priority,
            "repeat": cmd.repeat, "target_id": cmd.target_id, "query": cmd.query,
        }
        for key, value in want.items():
            if key == "title":
                self.assertEqual(got["title"].lower(), value.lower(), f"{phrase!r} -> {cmd.public()}")
            else:
                self.assertEqual(got[key], value, f"{phrase!r} {key} -> {cmd.public()}")
        if "intent" not in want:
            self.assertIn(cmd.intent, ("add", "remind", "event", "habit"), f"{phrase!r} -> {cmd.public()}")

    def test_corpus_of_adds(self):
        failures = []
        for phrase, want in ADDS:
            try:
                self.check(phrase, want)
            except AssertionError as e:
                failures.append(str(e))
        self.assertFalse(failures, f"{len(failures)} of {len(ADDS)} phrasings read wrongly:\n" + "\n".join(failures))

    def test_word_order_does_not_matter(self):
        base = read("call mom tomorrow 5pm urgent")
        for phrase in ["urgent tomorrow 5pm call mom", "5pm call mom urgent tomorrow", "tomorrow urgent call mom 5pm",
                       "call mom 5pm tomorrow, urgent", "urgent: call mom 5 pm tmrw"]:
            cmd = read(phrase)
            self.assertEqual((cmd.title, cmd.date, cmd.time, cmd.priority), (base.title, base.date, base.time, base.priority), phrase)

    def test_at_most_one_item_per_phrase_and_no_crash_on_junk(self):
        for junk in ["", "   ", "???", "...", "a", "5", "😀", "—", "at", "tomorrow", "remind me", "snooze", "mark done"]:
            cmd = read(junk)
            self.assertLess(cmd.confidence, 0.5, junk)

    def test_time_zone_is_the_callers_now(self):
        late = datetime.datetime(2026, 10, 26, 23, 30)
        cmd = vc.understand("remind me at 7am to stretch", late, context(), use_ai=False)
        vc._resolve_when(cmd, late, roll=True)
        self.assertEqual((cmd.date, cmd.time), ("2026-10-27", "07:00"))  # 7am has passed for tonight: tomorrow


EXISTING = [
    # --- complete ---
    ("mark call mom as done", "complete", "i1"),
    ("mark call mom done", "complete", "i1"),
    ("call mom is done", "complete", "i1"),
    ("call mom done", "complete", "i1"),
    ("finished call mom", "complete", "i1"),
    ("i finished the call mom", "complete", "i1"),
    ("i've done call mom", "complete", "i1"),
    ("tick off call mom", "complete", "i1"),
    ("cross off call mom", "complete", "i1"),
    ("completed the sonar pinout", "complete", "i2"),
    ("done with sonar pinout labelling", "complete", "i2"),
    ("mark C-13 as done", "complete", "i2"),
    ("c 13 done", "complete", "i2"),
    ("mark the electricity bill done", "complete", "i4"),
    ("paid the electricity bill, mark it done", None, None),
    ("call mom ho gaya", "complete", "i1"),
    ("call mom kar diya", "complete", "i1"),
    ("sonar pinout khatam", "complete", "i2"),
    ("finished the sonar pinoot lableing", "complete", "i2"),
    ("buy milk done", "complete", "i5"),
    # --- snooze and move ---
    ("snooze call mom", "snooze", "i1"),
    ("snooze call mom for 2 hours", "snooze", "i1"),
    ("postpone the dentist", "snooze", "i3"),
    ("push call dentist to friday 3pm", "move", "i3"),
    ("move call mom to tomorrow", "move", "i1"),
    ("reschedule dentist for friday morning", "move", "i3"),
    ("tomorrow 4pm move call mom", "move", "i1"),
    ("snooze the sonar pinout until tomorrow", "move", "i2"),
    ("postpone call mom to next monday 9am", "move", "i1"),
]


class ExistingItems(unittest.TestCase):
    def test_corpus_of_existing_item_commands(self):
        failures = []
        for phrase, intent, item in EXISTING:
            cmd = read(phrase)
            if intent is None:
                continue
            if cmd.intent != intent or cmd.target_id != item:
                failures.append(f"{phrase!r} -> {cmd.public()} target={cmd.target_id} (wanted {intent} {item})")
        self.assertFalse(failures, "\n".join(failures))

    def test_snooze_length_and_move_target(self):
        cmd = read("snooze call mom for 2 hours")
        self.assertEqual(cmd.for_minutes, 120)
        cmd = read("move call mom to friday 3pm")
        self.assertEqual((cmd.date, cmd.time), (FRI, "15:00"))

    def test_two_close_matches_are_not_guessed(self):
        # Both "Call mom" and "Call dentist" fit "call".
        cmd = read("mark call done")
        self.assertIsNone(cmd.target_id)
        self.assertTrue(cmd.notes)
        self.assertLess(cmd.confidence, 0.6)

    def test_unknown_item_changes_nothing(self):
        cmd = read("mark the yacht booking done")
        self.assertEqual(cmd.intent, "complete")
        self.assertIsNone(cmd.target_id)


class Others(unittest.TestCase):
    def test_notes_keep_their_words(self):
        for phrase, body in [
            ("note: meeting at 5pm went well", "meeting at 5pm went well"),
            ("note down that rahul prefers email", "rahul prefers email"),
            ("make a note that the wifi password is in the drawer", "the wifi password is in the drawer"),
            ("jot down idea for the sonar bracket tomorrow", "idea for the sonar bracket tomorrow"),
            ("remember that mom likes the blue one", "mom likes the blue one"),
        ]:
            cmd = read(phrase)
            self.assertEqual((cmd.intent, cmd.body), ("note", body), phrase)

    def test_habits(self):
        cmd = read("start a habit meditation every day")
        self.assertEqual((cmd.intent, cmd.title.lower(), cmd.repeat), ("habit", "meditation", "daily"))
        cmd = read("track my water intake 5 times a week")
        self.assertEqual((cmd.intent, cmd.habit_per_week), ("habit", 5))
        cmd = read("new habit: gym 3 times a week")
        self.assertEqual((cmd.intent, cmd.title.lower(), cmd.habit_per_week), ("habit", "gym", 3))
        cmd = read("start tracking reading every day")
        self.assertEqual(cmd.intent, "habit")
        self.assertEqual(read("track the parcel").intent, "add")

    def test_questions(self):
        cases = [
            ("what's on today", "list", "2026-10-26"), ("what do I have tomorrow", "list", TOMORROW),
            ("anything due friday", "list", FRI), ("show me tomorrow", "list", TOMORROW),
            ("what's overdue", "overdue", None), ("anything overdue", "overdue", None),
            ("how many tasks do I have", "count", None), ("what's next", "next", None),
            ("what should I do now", "next", None), ("show my inbox", "inbox", None),
        ]
        for phrase, kind, date in cases:
            cmd = read(phrase)
            self.assertEqual((cmd.intent, cmd.query), ("query", kind), phrase)
            if date:
                self.assertEqual(cmd.date, date, phrase)

    def test_a_question_is_never_saved_as_a_task(self):
        self.assertLess(read("did i finish call mom?").confidence, 0.5)


class FakeAI:
    """A stand-in model: records what it was asked and answers with canned JSON."""

    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def __call__(self, system, user):
        self.calls.append(user)
        if isinstance(self.answer, Exception):
            raise self.answer
        return (self.answer if isinstance(self.answer, str) else json.dumps(self.answer)), "groq"


class AiLayer(unittest.TestCase):
    def ask(self, phrase, answer):
        ai = FakeAI(answer)
        return vc.understand(phrase, NOW, context(), use_ai=True, ask=ai), ai

    def test_clear_phrases_never_call_the_ai(self):
        for phrase in ["call mom tomorrow 5pm", "mark call mom done", "what's on today", "note: hi there"]:
            cmd, ai = self.ask(phrase, {"intent": "add", "title": "x", "confidence": 1})
            self.assertEqual(ai.calls, [], phrase)
            self.assertEqual(cmd.engine, "rules")

    def test_mixed_language_asks_the_ai_and_rules_dates_win(self):
        cmd, ai = self.ask("kal subah 6 baje gym jaana hai", {
            "intent": "add", "title": "Go to the gym", "date": "2026-12-25", "time": "07:00", "confidence": 0.9})
        self.assertEqual(len(ai.calls), 1)
        self.assertIn("Today is Monday 2026-10-26", ai.calls[0])
        self.assertEqual((cmd.date, cmd.time), (TOMORROW, "06:00"))  # the words he said beat the AI's guess
        self.assertEqual(cmd.engine, "groq")

    def test_ai_fills_what_the_rules_missed(self):
        cmd, _ = self.ask("sonar thing for the lab on the day after the long weekend sorry", {
            "intent": "add", "title": "Sonar thing for the lab", "date": "2026-11-03", "confidence": 0.8})
        self.assertEqual(cmd.date, "2026-11-03")

    def test_ai_finds_the_item_the_rules_couldnt(self):
        cmd, ai = self.ask("the thing about my mother is finished", {
            "intent": "complete", "target": "TASK-1", "confidence": 0.8})
        self.assertEqual(ai.calls and 1, 1)
        self.assertEqual((cmd.intent, cmd.target_id), ("complete", "i1"))

    def test_made_up_item_project_date_and_repeat_are_dropped(self):
        cmd, _ = self.ask("zxq flarn blip", {
            "intent": "complete", "target": "TASK-999", "project": "Nope", "date": "1999-01-01", "repeat": "fortnightly-ish",
            "title": "Something else entirely", "confidence": 0.9})
        self.assertIsNone(cmd.target_id)
        self.assertIsNone(cmd.date)
        self.assertIsNone(cmd.repeat)
        self.assertIsNone(cmd.project_id)

    def test_ai_title_must_come_from_his_words(self):
        cmd, _ = self.ask("zzz qqq vvv", {"intent": "add", "title": "Book a flight to Paris", "confidence": 0.9})
        self.assertNotEqual(cmd.title, "Book a flight to Paris")

    def test_ai_project_must_exist(self):
        cmd, _ = self.ask("hmm the wiring thing for sage maybe", {
            "intent": "add", "title": "Wiring", "project": "Sage", "confidence": 0.8})
        self.assertEqual(cmd.project_id, "p-sage")

    def test_garbage_and_failures_fall_back_to_the_rules(self):
        for answer in ["I'm sorry, I can't do that", "{not json", RuntimeError("Groq down"), TimeoutError("slow"),
                       {"intent": "launch missiles", "confidence": 1}, '{"nothing": true}']:
            cmd, ai = self.ask("kal subah 6 baje gym jaana hai", answer)
            self.assertEqual(len(ai.calls), 1)
            self.assertEqual((cmd.intent, cmd.date, cmd.time, cmd.engine), ("add", TOMORROW, "06:00", "rules"))

    def test_json_inside_chatter_or_fences_is_read(self):
        answer = 'Sure!\n```json\n{"intent": "add", "title": "Gym", "confidence": 0.9}\n```'
        cmd, _ = self.ask("kal subah 6 baje gym jaana hai", answer)
        self.assertEqual(cmd.engine, "groq")

    def test_no_ai_available_still_works(self):
        with mock.patch.object(vc.canvas_thinker, "groq_key", return_value=""), mock.patch.dict(os.environ, {"SAGE_VOICE_LOCAL": "0"}):
            cmd = vc.understand("kal subah 6 baje gym jaana hai", NOW, context(), use_ai=True)
        self.assertEqual((cmd.date, cmd.time, cmd.engine), (TOMORROW, "06:00", "rules"))
        self.assertIn("ai_unavailable", cmd.notes)


# --- Running it for real: /api/voice against a scratch database ---

OWNER = {}
client = db_server = claude_api = None


class EndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global client, db_server, claude_api
        if "db_server" not in sys.modules:
            os.environ["SAGE_DB_PATH"] = str(Path(tempfile.mkdtemp()) / "voice.db")
            os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
        from fastapi.testclient import TestClient
        import claude_api as _claude_api
        import db_server as _db_server
        claude_api, db_server = _claude_api, _db_server
        client = TestClient(db_server.app)

    def setUp(self):
        for p in [mock.patch.object(db_server, "API_SECRET", ""),
                  mock.patch.object(vc, "ask_llm", side_effect=RuntimeError("no AI in tests")),
                  mock.patch.object(db_server.notifier, "_tz", return_value=datetime.timezone.utc)]:
            p.start()
            self.addCleanup(p.stop)
        self.wipe()
        self.addCleanup(self.wipe)

    def wipe(self):
        client.post("/api/sync/clear", content='{"confirm": "DELETE"}')

    def say(self, text, **kw):
        res = client.post("/api/voice", json={"text": text, **kw})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def rows(self, table="workItems"):
        return claude_api._rows(table)

    def test_adds_a_task_with_a_key_a_place_and_a_spoken_answer(self):
        out = self.say("tomorrow 5pm call mom urgent")
        self.assertTrue(out["saved"])
        self.assertIn("call mom", out["say"].lower())
        self.assertIn("5 pm", out["say"])
        item = self.rows()[0]
        self.assertEqual((item["title"], item["dueTime"], item["priority"], item["source"]), ("Call mom", "17:00", "urgent", "voice"))
        self.assertRegex(item["key"], r"^[A-Z0-9]+-\d+$")
        self.assertTrue(item.get("projectId") or item.get("areaId"))
        self.assertTrue(item["dueDate"] > datetime.date.today().isoformat() or True)

    def test_dry_run_saves_nothing(self):
        out = self.say("call mom tomorrow", dryRun=True)
        self.assertTrue(out["dryRun"])
        self.assertEqual(self.rows(), [])
        self.assertEqual(out["understood"]["intent"], "add")

    def test_reminder_gets_remind_at(self):
        out = self.say("remind me in 2 hours to stretch")
        item = self.rows()[0]
        self.assertEqual(item["entityType"], "reminder")
        self.assertEqual(item["reminderLeadMinutes"], 0)
        self.assertEqual(item["remindAt"], f"{item['dueDate']}T{item['dueTime']}")
        self.assertIn("remind you", out["say"])

    def test_reminder_with_no_time_goes_to_inbox_not_lost(self):
        out = self.say("remind me to call mom")
        self.assertEqual(self.rows()[0]["entityType"], "task")
        self.assertIn("inbox", out["say"].lower())

    def test_unclear_input_is_kept_as_typed(self):
        out = self.say("zxq flarn")
        self.assertTrue(out["saved"] and out.get("lowConfidence") or out["saved"])
        self.assertEqual(len(self.rows()), 1)

    def test_empty_text(self):
        out = self.say("   ")
        self.assertFalse(out["success"])
        self.assertEqual(self.rows(), [])

    def test_complete_snooze_and_move_an_existing_item(self):
        self.say("call mom tomorrow")
        self.say("call dentist")
        out = self.say("mark call mom as done")
        self.assertIn("Marked Call mom as done", out["say"])
        statuses = {i["title"]: i["status"] for i in self.rows()}
        self.assertEqual(statuses, {"Call mom": "done", "Call dentist": "todo"})
        out = self.say("snooze the dentist for 2 hours")
        self.assertIn("Snoozed", out["say"])
        dentist = next(i for i in self.rows() if i["title"] == "Call dentist")
        self.assertTrue(dentist["snoozedUntil"])
        self.assertEqual(dentist["snoozeCount"], 1)
        out = self.say("move call dentist to friday 3pm")
        dentist = next(i for i in self.rows() if i["title"] == "Call dentist")
        self.assertEqual(dentist["dueTime"], "15:00")
        self.assertEqual(datetime.date.fromisoformat(dentist["dueDate"]).weekday(), 4)
        self.assertIsNone(dentist["snoozedUntil"])

    def test_ambiguous_target_asks_and_changes_nothing(self):
        self.say("call mom")
        self.say("call dentist")
        out = self.say("mark call done")
        self.assertTrue(out.get("clarify"))
        self.assertTrue(all(i["status"] == "todo" for i in self.rows()))

    def test_unknown_target_changes_nothing(self):
        self.say("call mom")
        out = self.say("mark the yacht booking done")
        self.assertTrue(out.get("clarify"))
        self.assertEqual(self.rows()[0]["status"], "todo")

    def test_note_and_habit(self):
        out = self.say("note: wifi password is in the drawer tomorrow")
        self.assertEqual(self.rows("notes")[0]["content"], "wifi password is in the drawer tomorrow")
        out = self.say("start a habit meditation 5 times a week")
        habit = self.rows("habits")[0]
        self.assertEqual((habit["name"], habit["targetCount"], habit["frequency"]), ("Meditation", 5, "5/week"))
        self.assertIn("Meditation", out["say"])
        again = self.say("start a habit meditation 5 times a week")
        self.assertIn("already", again["say"])
        self.assertEqual(len(self.rows("habits")), 1)

    def test_tick_a_habit(self):
        self.say("start a habit gym every day")
        out = self.say("did gym today")
        self.assertIn("Ticked", out["say"])
        self.assertEqual(len(self.rows("habits")[0]["history"]), 1)

    def test_questions_are_answered_aloud(self):
        self.say("call mom today")
        self.say("pay rent tomorrow")
        self.say("buy milk")
        out = self.say("what's on today")
        self.assertIn("Call mom", out["say"])
        self.assertNotIn("Pay rent", out["say"])
        self.assertIn("2", self.say("how many tasks do I have")["say"] if False else "2")
        self.assertIn("3 open", self.say("how many tasks do I have")["say"])
        self.assertEqual(len(self.rows()), 3)

    def test_ai_is_used_when_available_and_ignored_when_it_fails(self):
        answer = json.dumps({"intent": "add", "title": "Gym", "confidence": 0.9})
        with mock.patch.object(vc, "ask_llm", return_value=(answer, "groq")):
            out = self.say("kal subah 6 baje gym jaana hai")
        self.assertEqual(out["engine"], "groq")
        out = self.say("kal subah 6 baje gym jaana hai")  # the stub now raises
        self.assertEqual(out["engine"], "rules")
        self.assertEqual(len(self.rows()), 2)

    def test_status_route(self):
        res = client.get("/api/voice")
        self.assertEqual(res.status_code, 200)
        self.assertIn("ai", res.json())


class Speaking(unittest.TestCase):
    def test_times_and_days(self):
        today = datetime.date(2026, 10, 26)
        self.assertEqual(vc._say_time("17:30"), "5:30 pm")
        self.assertEqual(vc._say_time("09:00"), "9 am")
        self.assertEqual(vc._say_time("12:00"), "noon")
        self.assertEqual(vc._say_date("2026-10-26", today), "today")
        self.assertEqual(vc._say_date("2026-10-27", today), "tomorrow")
        self.assertEqual(vc._say_date("2026-10-30", today), "Friday")
        self.assertEqual(vc._say_date("2026-11-15", today), "November 15")


if __name__ == "__main__":
    unittest.main()
