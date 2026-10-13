"""Tests for the depth face (desk/depth.py): storing a photo and its cutout,
the three-layer render, how much of the time the person hides, and where
`auto` puts the time. The cutout model itself isn't run here; a drawn mask
stands in for it.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import base64
import datetime
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image, ImageDraw  # noqa: E402

from desk import depth  # noqa: E402

NOW = datetime.datetime(2026, 10, 13, 10, 42)


def photo_and_mask(head_top=0, head_bottom=120):
    """A blue sky with a red 'person' standing in the middle; the mask is the person."""
    photo = Image.new("RGB", (640, 432), (40, 90, 200))
    mask = Image.new("L", photo.size, 0)
    for img, fill in ((photo, (220, 30, 30)), (mask, 255)):
        draw = ImageDraw.Draw(img)
        draw.ellipse((240, head_top, 400, head_bottom * 2), fill=fill)
        draw.rectangle((180, head_bottom * 2, 460, 432), fill=fill)
    return photo, mask


class DepthTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = mock.patch.object(depth, "DEPTH_DIR", Path(self.tmp.name) / "depth")
        self.dir.start()

    def tearDown(self):
        self.dir.stop()
        self.tmp.cleanup()

    def test_no_photo(self):
        self.assertFalse(depth.load()["hasPhoto"])
        self.assertIsNone(depth.render(NOW, True))
        self.assertIsNone(depth.describe(NOW, True)["preview"])

    def test_person_in_front_of_the_time(self):
        photo, mask = photo_and_mask()
        depth.set_photo(photo, mask, NOW)
        depth.update({"placement": "middle"})
        frame = depth.render(NOW, True)
        self.assertEqual(frame["depth"].size, (depth.WIDTH, depth.HEIGHT))
        self.assertGreater(frame["coverage"], 0)
        # Over the person the depth picture shows the photo (red), the flat one the white time.
        hidden = [(x, y) for x in range(130, 190) for y in range(60, 150)
                  if frame["mask"].getpixel((x, y)) and sum(frame["flat"].getpixel((x, y))) > 600]
        self.assertTrue(hidden, "the time should cross the person somewhere")
        x, y = hidden[0]
        r, g, b = frame["depth"].getpixel((x, y))
        self.assertGreater(r, 150)
        self.assertLess(g, 80)

    def test_auto_picks_the_least_covered_place(self):
        photo, mask = photo_and_mask(head_top=200, head_bottom=210)  # a short person at the bottom
        depth.set_photo(photo, mask, NOW)
        frame = depth.render(NOW, True)
        self.assertEqual(frame["placement"], "top")
        for forced in ("middle", "bottom"):
            depth.update({"placement": forced})
            self.assertGreaterEqual(depth.render(NOW, True)["coverage"], frame["coverage"])

    def test_without_a_cutout_the_time_sits_on_top(self):
        photo, _ = photo_and_mask()
        meta = depth.set_photo(photo, None, NOW)
        self.assertTrue(meta["hasPhoto"])
        self.assertFalse(meta["cutout"])
        frame = depth.render(NOW, True)
        self.assertEqual(frame["coverage"], 0)
        self.assertEqual(frame["depth"].tobytes(), frame["flat"].tobytes())

    def test_settings_are_checked_and_kept(self):
        photo, mask = photo_and_mask()
        depth.set_photo(photo, mask, NOW)
        depth.update({"placement": "bottom", "photoPosition": "center"})
        self.assertEqual(depth.load()["placement"], "bottom")
        self.assertEqual(depth.load()["photoPosition"], "center")
        with self.assertRaises(ValueError):
            depth.update({"placement": "sideways"})
        with self.assertRaises(ValueError):
            depth.update({"photoPosition": "left"})
        depth.clear()
        self.assertFalse(depth.load()["hasPhoto"])
        self.assertEqual(depth.load()["placement"], "auto")

    def test_upload_is_decoded_and_shrunk(self):
        buf = io.BytesIO()
        Image.new("RGB", (3000, 2000), (10, 20, 30)).save(buf, format="JPEG")
        image = depth.decode_upload("data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode())
        self.assertEqual(max(image.size), depth.KEEP_SIDE)
        with self.assertRaises(ValueError):
            depth.decode_upload("data:image/png;base64,bm90IGEgcGhvdG8=")

    def test_crop_fills_the_window_without_stretching(self):
        for size in ((4000, 3000), (1080, 1920), (320, 216)):
            for pos in depth.PHOTO_POSITIONS:
                x0, y0, x1, y1 = depth._crop_box(size, pos)
                self.assertAlmostEqual((x1 - x0) / (y1 - y0), depth.WIDTH / depth.HEIGHT, places=1)
                self.assertTrue(0 <= x0 < x1 <= size[0] and 0 <= y0 < y1 <= size[1])

    def test_twelve_hour_time(self):
        self.assertEqual(depth.time_text(datetime.datetime(2026, 10, 13, 0, 5), False), "12:05")
        self.assertEqual(depth.time_text(datetime.datetime(2026, 10, 13, 18, 30), False), "6:30")
        self.assertEqual(depth.time_text(datetime.datetime(2026, 10, 13, 18, 30), True), "18:30")

    def test_describe_sends_pictures(self):
        photo, mask = photo_and_mask()
        depth.set_photo(photo, mask, NOW)
        out = depth.describe(NOW, True)
        self.assertTrue(out["preview"]["depth"].startswith("data:image/png;base64,"))
        self.assertEqual(out["preview"]["time"], "10:42")


if __name__ == "__main__":
    unittest.main()
