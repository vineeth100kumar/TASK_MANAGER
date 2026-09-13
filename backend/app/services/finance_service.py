import datetime

def calc_days_until_due(due_day: int) -> tuple:
    """Calculates days until due in current month (or next month if day already passed)."""
    today = datetime.date.today()
    try:
        due_date = datetime.date(today.year, today.month, min(due_day, 28 if today.month == 2 else 30 if today.month in (4,6,9,11) else 31))
    except ValueError:
        due_date = datetime.date(today.year, today.month, 28)

    diff = (due_date - today).days
    if diff < 0:
        is_overdue = abs(diff) <= 4
        if not is_overdue:
            next_month = today.month + 1 if today.month < 12 else 1
            next_year = today.year if today.month < 12 else today.year + 1
            next_due = datetime.date(next_year, next_month, min(due_day, 28))
            diff = (next_due - today).days
            is_overdue = False
    else:
        is_overdue = False

    return diff, is_overdue
