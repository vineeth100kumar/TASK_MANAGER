"""song.py: cleaning Groq's answer, reading LRC lyrics, folding to ASCII.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import unittest

from desk import song


class SongTests(unittest.TestCase):
    def test_answer_is_checked_and_trimmed(self):
        about = song.clean_about({"genre": "Synth‑pop", "bpm": "171.4", "energy": 3,
                                  "facts": ["It’s from 2019 — After Hours.", 7, "", "b", "c", "d"]})
        self.assertEqual(about["bpm"], 171)
        self.assertEqual(about["energy"], 1.0)
        self.assertEqual(about["facts"][0], "It's from 2019 - After Hours.")
        self.assertEqual(len(about["facts"]), 3)
        self.assertEqual(song.clean_about({"bpm": 900, "energy": "x"})["bpm"], 0)
        self.assertEqual(song.clean_about({"bpm": 900, "energy": "x"})["energy"], 0.5)

    def test_lrc_lines_in_order_with_gaps(self):
        lines = song.parse_lrc("[00:12.50] Second\n[00:01.00]First\n[00:20.00]\n[00:30.00][01:00.00] Chorus")
        self.assertEqual(lines, [(1.0, "First"), (12.5, "Second"), (20.0, ""), (30.0, "Chorus"), (60.0, "Chorus")])
        self.assertEqual(song.line_at(lines, 0.5), -1)
        self.assertEqual(song.line_at(lines, 13), 1)
        self.assertEqual(song.line_at(lines, 25), 2)

    def test_lyrics_in_another_script_are_left_out(self):
        self.assertEqual(song.usable([(1.0, "你好世界你好")]), [])
        self.assertEqual(song.usable([(1.0, "Café del Mar")]), [(1.0, "Cafe del Mar")])

    def test_long_text_is_cut(self):
        self.assertTrue(song.ascii_text("x" * 200).endswith("..."))
        self.assertLessEqual(len(song.ascii_text("x" * 200)), song.FACT_LEN)


if __name__ == "__main__":
    unittest.main()
