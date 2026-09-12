import datetime
from typing import Optional

def calculate_next_occurrence(repeat_rule: str, base_date: Optional[datetime.datetime] = None) -> Optional[datetime.datetime]:
    """
    Computes the next occurrence based on repeat rule syntax:
    - 'daily': every day
    - 'weekdays': Monday to Friday
    - 'weekly:mon,wed,fri': specific days of the week
    - 'monthly:N': N-th day of next month (e.g. monthly:1 for rent)
    - 'custom:14d': every 14 days
    """
    if not repeat_rule:
        return None
        
    rule = repeat_rule.strip().lower()
    now = base_date or datetime.datetime.now()
    
    if rule == "daily":
        return now + datetime.timedelta(days=1)
        
    elif rule == "weekdays":
        next_day = now + datetime.timedelta(days=1)
        while next_day.weekday() >= 5: # 5 is Saturday, 6 is Sunday
            next_day += datetime.timedelta(days=1)
        return next_day
        
    elif rule.startswith("weekly:"):
        days_str = rule.split("weekly:")[1]
        target_day_names = [d.strip() for d in days_str.split(",") if d.strip()]
        name_to_weekday = {
            "mon": 0, "monday": 0,
            "tue": 1, "tuesday": 1,
            "wed": 2, "wednesday": 2,
            "thu": 3, "thursday": 3,
            "fri": 4, "friday": 4,
            "sat": 5, "saturday": 5,
            "sun": 6, "sunday": 6,
        }
        target_days = [name_to_weekday[d] for d in target_day_names if d in name_to_weekday]
        if not target_days:
            return now + datetime.timedelta(days=7)
            
        # Find the next day in target_days
        for i in range(1, 8):
            candidate = now + datetime.timedelta(days=i)
            if candidate.weekday() in target_days:
                return candidate
        return now + datetime.timedelta(days=7)
        
    elif rule.startswith("monthly:"):
        try:
            target_day = int(rule.split("monthly:")[1])
            # Advance to next month
            year = now.year
            month = now.month + 1
            if month > 12:
                month = 1
                year += 1
            # Adjust if target_day exceeds month length
            import calendar
            max_days = calendar.monthrange(year, month)[1]
            actual_day = min(target_day, max_days)
            return now.replace(year=year, month=month, day=actual_day)
        except Exception:
            return now + datetime.timedelta(days=30)
            
    elif rule.startswith("custom:"):
        try:
            val = rule.split("custom:")[1]
            if val.endswith("d"):
                days = int(val[:-1])
                return now + datetime.timedelta(days=days)
            elif val.endswith("w"):
                weeks = int(val[:-1])
                return now + datetime.timedelta(weeks=weeks)
        except Exception:
            pass
            
    return now + datetime.timedelta(days=1)
