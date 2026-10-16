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
    def test_changes(self):
        req = request(mode="edit", message="make gym high priority and a habit, and drop the reel",
                      cards=[{"title": "Finish sonar pinout"}, {"title": "Post the shoes reel"}, {"title": "Gym"}])
        text = json.dumps({"reply": "Done.", "changes": [
            {"card": 3, "priority": "high", "kind": "habit"},
            {"card": 2, "remove": True},
            {"card": 9, "priority": "high"},
            {"card": 1, "project": "Nowhere"},
            {"card": 1, "project": "Sage", "branch": "Radar dashboard", "when": "monday 2pm"},
        ]})
        with mock.patch.object(chat_capture, "_answer", return_value=(text, "groq")):
            out = chat_capture.capture(req)
        self.assertEqual(out["reply"], "Done.")
        self.assertEqual(out["changes"], [
            {"card": 2, "kind": "habit", "priority": "high"},
            {"card": 1, "remove": True},
            {"card": 0, "when": "monday 2pm", "projectId": "p-sage", "branchId": "br-radar"},
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


class FakeResponse:
    def __init__(self, status, content=""):
        self.status_code = status
        self._content = content

    def json(self):
        return {"choices": [{"message": {"content": self._content}}]}


GOAL = "I want to launch a YouTube channel about LUMO"


class TestPlan(unittest.TestCase):
    def run_plan(self, raw, **kw):
        with mock.patch.object(chat_capture, "_ask_groq_plan", return_value=json.dumps(raw)):
            return chat_capture.capture(request(mode="plan", message=GOAL, **kw))

    def test_plan_is_cleaned(self):
        raw = {"name": "LUMO on YouTube", "type": "Content", "summary": "Start small.",
               "phases": ["Idea", "Make", "", "Unused", "Publish"],
               "tasks": [{"title": "Publish the first video", "phase": 4, "days": 1, "priority": "high"},
                         {"title": "Pick the channel angle", "phase": 0, "days": "2", "priority": "HIGH"},
                         {"title": "pick the channel angle", "phase": 0, "days": 2},
                         {"title": "Film the clock build", "phase": 1, "days": 400, "priority": "whenever"},
                         {"title": "Mystery", "phase": 9, "days": -3},
                         "not a task"]}
        plan = self.run_plan(raw)["plan"]
        self.assertEqual(plan["type"], "content")
        # Empty and unused stages go; the made-up stage 9 lands in the last one.
        self.assertEqual(plan["phases"], ["Idea", "Make", "Publish"])
        self.assertEqual([(t["title"], t["phase"]) for t in plan["tasks"]],
                         [("Pick the channel angle", 0), ("Film the clock build", 1), ("Publish the first video", 2), ("Mystery", 2)])
        film, mystery = plan["tasks"][1], plan["tasks"][3]
        self.assertEqual((film["days"], film["priority"]), (60, "medium"))
        self.assertEqual(mystery["days"], 1)

    def test_caps_tasks(self):
        raw = {"phases": ["Do"], "tasks": [{"title": f"Task {n}", "phase": 0} for n in range(40)]}
        self.assertEqual(len(self.run_plan(raw)["plan"]["tasks"]), chat_capture.MAX_PLAN_TASKS)

    def test_unknown_type_uses_hint(self):
        raw = {"type": "cooking", "phases": ["A"], "tasks": [{"title": "One"}, {"title": "Two"}]}
        self.assertEqual(self.run_plan(raw, typeHint="content")["plan"]["type"], "content")

    def test_empty_plan_is_an_error(self):
        with mock.patch.object(chat_capture, "_ask_groq_plan", return_value='{"tasks": [{"title": "Only one"}]}'):
            with self.assertRaises(RuntimeError):
                chat_capture.capture(request(mode="plan", message=GOAL))

    def test_prompt_for_existing_project_and_steps(self):
        text = chat_capture._plan_text(request(mode="plan", message="plan out the Radar project", planMode="existing", target="Radar",
                                               targetItems=["Add Nifty prices"], typeHint="technical", days=14))
        for bit in ("existing project Radar", "- Add Nifty prices", "technical project", "about 14 days", "Goal: plan out"):
            self.assertIn(bit, text)
        steps = chat_capture._plan_text(request(mode="plan", message="split C-13 into steps", planMode="steps", target="Sonar Connector Pinout Labeling"))
        self.assertIn("Task: Sonar Connector Pinout Labeling", steps)

    def test_edit_sends_the_plan(self):
        req = request(mode="plan_edit", message="add a testing phase",
                      plan={"name": "LUMO on YouTube", "type": "content", "phases": ["Idea", "Make"],
                            "tasks": [{"title": "Pick the angle", "phase": 0, "days": 2, "priority": "high"}, {"title": "Film it", "phase": 1}]})
        text = chat_capture._plan_text(req)
        self.assertIn("Stage 1: Make\n  - Film it | 1 days | medium", text)
        self.assertIn("His change: add a testing phase", text)


class TestPlanGroq(unittest.TestCase):
    def test_biggest_model_first_and_json_mode_retry(self):
        good = json.dumps({"phases": ["A"], "tasks": [{"title": "One"}, {"title": "Two"}]})
        calls = []

        def post(url, headers, json, timeout):
            calls.append((json["model"], "response_format" in json))
            if len(calls) == 1:
                return FakeResponse(503)
            if len(calls) == 2:
                return FakeResponse(400)
            return FakeResponse(200, good)

        with mock.patch.object(chat_capture.canvas_thinker, "groq_key", return_value="gsk_x"), \
             mock.patch.object(chat_capture.httpx, "post", side_effect=post):
            self.assertEqual(chat_capture._ask_groq_plan("s", "u"), good)
        self.assertEqual(calls[0], ("openai/gpt-oss-120b", True))
        self.assertEqual(calls[1][1], True)
        self.assertEqual(calls[2], (calls[1][0], False))

    def test_no_key_no_local_model(self):
        with mock.patch.object(chat_capture.canvas_thinker, "groq_key", return_value=""), \
             mock.patch.object(chat_capture, "_ask_local") as local:
            with self.assertRaises(RuntimeError):
                chat_capture.capture(request(mode="plan", message=GOAL))
            local.assert_not_called()


if __name__ == "__main__":
    unittest.main()
