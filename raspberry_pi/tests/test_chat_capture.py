"""Tests for chat_capture.py: the AI's names turn back into ids, made-up names
are dropped, and Groq falls back to the local model.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chat_capture  # noqa: E402
from chat_capture import ChatCaptureRequest  # noqa: E402

MESSAGE = "tmrw morning finish the sonar pinout for ci4 and then look at camera focus. remind me to post the shoes reel sat 6pm. gym mon wed fri 7am"


def request(**kw):
    base = dict(
        message=MESSAGE,
        projects=[{"id": "p-ci4", "name": "Ci4 Work", "key": "C"},
                  {"id": "p-bk", "name": "Baby Kolourz", "key": "B"},
                  {"id": "p-sage", "name": "Sage", "key": "S", "branches": [{"id": "br-radar", "name": "Radar dashboard"}]}],
        areas=[{"id": "a-fit", "name": "Fitness"}],
        openItems=[{"id": "i13", "key": "C-13", "title": "Sonar Connector Pinout Labeling"},
                   {"id": "b3", "key": "B-3", "title": "Shoot reel/post for shoes"}],
        tags=["reels"],
    )
    base.update(kw)
    return ChatCaptureRequest(**base)


class TestSplit(unittest.TestCase):
    def answer(self, items, req=None):
        text = "<think>hmm</think>Sure:\n```json\n" + json.dumps({"items": items}) + "\n```"
        with mock.patch.object(chat_capture, "_answer", return_value=(text, "groq")):
            return chat_capture.capture(req or request())

    def test_names_become_ids(self):
        out = self.answer([
            {"text": "tmrw morning finish the sonar pinout for ci4", "title": "Finish sonar pinout", "kind": "task", "project": "ci4 work", "same_as": "C-13"},
            {"text": "remind me to post the shoes reel sat 6pm", "title": "Post the shoes reel", "kind": "reminder", "project": "Baby Kolourz", "tags": ["reels", "made-up"]},
            {"text": "gym mon wed fri 7am", "title": "Gym", "kind": "habit", "area": "Fitness", "context": "personal"},
        ])
        self.assertEqual(out["engine"], "groq")
        a, b, c = out["items"]
        self.assertEqual((a["projectId"], a["sameAsId"]), ("p-ci4", "i13"))
        self.assertEqual((b["kind"], b["projectId"], b["tags"]), ("reminder", "p-bk", ["reels"]))
        self.assertEqual((c["kind"], c["areaId"], c["context"]), ("habit", "a-fit", "personal"))

    def test_made_up_names_are_dropped(self):
        out = self.answer([{"text": "gym mon wed fri 7am", "title": "Gym", "kind": "chore", "project": "Health", "branch": "Legs", "area": "Gymnastics", "same_as": "X-1"}])
        item = out["items"][0]
        for key in ("projectId", "branchId", "areaId", "sameAsId", "kind"):
            self.assertNotIn(key, item)

    def test_branch_only_inside_its_project(self):
        out = self.answer([{"text": "look at camera focus", "title": "Camera focus", "project": "Sage", "branch": "Radar dashboard"},
                           {"text": "gym mon wed fri 7am", "title": "Gym", "project": "Ci4 Work", "branch": "Radar dashboard"}])
        self.assertEqual(out["items"][0]["branchId"], "br-radar")
        self.assertNotIn("branchId", out["items"][1])

    def test_text_must_be_from_the_message(self):
        # The app re-reads dates from `text`, so rewritten words fall back to the title.
        out = self.answer([{"text": "Tomorrow at 9: sonar pinout", "title": "Sonar pinout"}])
        self.assertEqual(out["items"][0]["text"], "Sonar pinout")

    def test_garbage_gives_no_items(self):
        with mock.patch.object(chat_capture, "_answer", return_value=("I can't help with that", "local")):
            self.assertEqual(chat_capture.capture(request())["items"], [])


class TestEdit(unittest.TestCase):
    def edit(self, changes, cards=None, message="follow-up"):
        req = request(mode="edit", message=message,
                      cards=cards if cards is not None else [{"title": "Finish sonar pinout"}, {"title": "Post the shoes reel"}, {"title": "Gym"}])
        with mock.patch.object(chat_capture, "_answer", return_value=(json.dumps({"reply": "Done.", "changes": changes}), "groq")):
            return chat_capture.capture(req)

    def test_card_changes(self):
        out = self.edit([
            {"card": 3, "priority": "high", "kind": "habit"},
            {"card": 2, "remove": True},
            {"card": 9, "priority": "high"},
            {"card": 1, "project": "Nowhere"},
            {"card": 1, "project": "Sage", "branch": "Radar dashboard", "when": "monday 2pm"},
        ])
        self.assertEqual(out["reply"], "Done.")
        self.assertEqual(out["changes"], [
            {"card": 2, "kind": "habit", "priority": "high"},
            {"card": 1, "delete": True},
            {"card": 0, "when": "monday 2pm", "projectId": "p-sage", "branchId": "br-radar"},
        ])

    def test_items_by_key(self):
        out = self.edit([
            {"item": "C-13", "done": True, "note": "ask Ravi", "subtask": "order cables", "add_tags": ["#Parts"]},
            {"item": "B-3", "remove_tags": ["reels"], "no_reminder": True, "reminder_minutes_before": 30, "clear_date": True, "no_repeat": True},
            {"item": "X-99", "done": True},
            {"item": "C-13", "reminder_minutes_before": "soon"},
        ], cards=[])
        self.assertEqual(out["changes"], [
            {"itemId": "i13", "done": True, "addTags": ["parts"], "note": "ask Ravi", "subtask": "order cables"},
            {"itemId": "b3", "clearDate": True, "noRepeat": True, "noReminder": True, "reminderMinutesBefore": 30, "removeTags": ["reels"]},
        ])


class TestEngines(unittest.TestCase):
    def test_groq_then_local(self):
        with mock.patch.object(chat_capture.canvas_thinker, "groq_key", return_value="gsk_x"), \
             mock.patch.object(chat_capture, "_ask_groq", side_effect=RuntimeError("busy")), \
             mock.patch.object(chat_capture, "_ask_local", return_value='{"items": []}') as local:
            self.assertEqual(chat_capture._answer("s", "u"), ('{"items": []}', "local"))
            local.assert_called_once()

    def test_no_key_goes_local(self):
        with mock.patch.object(chat_capture.canvas_thinker, "groq_key", return_value=""), \
             mock.patch.object(chat_capture, "_ask_groq") as groq, \
             mock.patch.object(chat_capture, "_ask_local", return_value="{}"):
            self.assertEqual(chat_capture._answer("s", "u")[1], "local")
            groq.assert_not_called()
            self.assertEqual(chat_capture.engine(), "local")

    def test_prompt_lists_context(self):
        text = chat_capture._user_text(request(today="Fri 16 Oct 2026"))
        for bit in ("Today is Fri 16 Oct 2026.", "- Ci4 Work (key C)", "- Sage (key S): Radar dashboard", "Areas: Fitness", "- C-13: Sonar Connector Pinout Labeling", "Tags: reels", "Message: tmrw morning"):
            self.assertIn(bit, text)


if __name__ == "__main__":
    unittest.main()
