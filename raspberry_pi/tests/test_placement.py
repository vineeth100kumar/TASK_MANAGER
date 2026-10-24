import placement

P = [{"id": "p1", "name": "Misumi"}, {"id": "p2", "name": "Kolourz"}]


def test_alarm_needs_no_place():
    assert not placement.needs_place({"title": "Alarm", "labels": ["alarm"]})
    assert placement.needs_place({"title": "Call bank"})
    assert not placement.needs_place({"title": "x", "areaId": "a"})


def test_named_project():
    assert placement.choose_project("Order from misumi", P, []) == "p1"


def test_similar_tasks():
    items = [{"projectId": "p2", "title": "Reel on baby essentials"}]
    assert placement.choose_project("Reel about baby essentials", P, items) == "p2"


def test_nothing_fits():
    assert placement.choose_project("Weather jacket", P, []) is None
