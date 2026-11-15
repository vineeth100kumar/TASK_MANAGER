import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import voice_stt  # noqa: E402


class BudgetTests(unittest.TestCase):
    def test_minute_limit(self):
        b = voice_stt.Budget()
        for i in range(voice_stt.PER_MINUTE):
            self.assertIsNone(b.check(100 + i, "d", 2, False))
            b.spend(100 + i, 2, False)
        self.assertIn("minute", b.check(120, "d", 2, False))
        self.assertIsNone(b.check(200, "d", 2, False))      # a minute later

    def test_short_clips_bill_ten_seconds(self):
        b = voice_stt.Budget()
        b.spend(0, 1, False)
        self.assertEqual(b.day_audio, 10.0)

    def test_always_listening_has_a_smaller_share(self):
        b = voice_stt.Budget()
        b.day, b.wake_clips, b.clips = "d", voice_stt.WAKE_PER_DAY, voice_stt.WAKE_PER_DAY
        self.assertIn("Tap", b.check(1, "d", 2, True))
        self.assertIsNone(b.check(1, "d", 2, False))

    def test_a_new_day_starts_clean(self):
        b = voice_stt.Budget()
        b.day, b.clips = "d1", voice_stt.PER_DAY
        self.assertIsNotNone(b.check(1, "d1", 2, False))
        self.assertIsNone(b.check(1, "d2", 2, False))


class TextTests(unittest.TestCase):
    def test_silence_hallucinations_are_noise(self):
        for t in ("Thank you.", " you ", "", "Thanks for watching!"):
            self.assertTrue(voice_stt.is_noise(t), t)
        self.assertFalse(voice_stt.is_noise("Sage, set a timer for 5 minutes."))

    def test_its_own_old_hint_is_noise(self):
        self.assertTrue(voice_stt.is_noise("Sage, set an alarm for 7:30 AM."))
        self.assertTrue(voice_stt.is_noise("Sage, set a timer for 10 minutes."))
        self.assertEqual(voice_stt.PROMPT, "Sage.")

    def test_doubtful_segments_are_dropped(self):
        data = {"segments": [
            {"text": " Sage, set a timer.", "no_speech_prob": 0.01, "avg_logprob": -0.2},
            {"text": " Thank you.", "no_speech_prob": 0.9, "avg_logprob": -0.4},
        ]}
        self.assertEqual(voice_stt.pick_text(data), "Sage, set a timer.")


if __name__ == "__main__":
    unittest.main()
