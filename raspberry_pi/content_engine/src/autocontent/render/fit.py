"""Auto-fit text measurement and script injection for Playwright."""

FIT_TEXT_JS = """
window.fitText = function(selector, maxWidth, maxHeight, minPx, maxPx) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, reason: "Element not found: " + selector };

    el.style.overflowWrap = "normal";
    el.style.wordBreak = "normal";
    el.style.hyphens = "none";

    let low = minPx;
    let high = maxPx;
    let best = minPx;

    // Check if even minPx overflows
    el.style.fontSize = minPx + "px";
    if (el.scrollWidth > maxWidth || el.scrollHeight > maxHeight) {
        return {
            success: false,
            overflow: true,
            fontSize: minPx,
            scrollWidth: el.scrollWidth,
            scrollHeight: el.scrollHeight,
            maxWidth: maxWidth,
            maxHeight: maxHeight,
            reason: `Text overflows at minimum font-size ${minPx}px (${el.scrollWidth}x${el.scrollHeight} > ${maxWidth}x${maxHeight})`
        };
    }

    // Binary search for largest fitting font size
    while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        el.style.fontSize = mid + "px";

        if (el.scrollWidth <= maxWidth && el.scrollHeight <= maxHeight) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    el.style.fontSize = best + "px";
    return {
        success: true,
        fontSize: best,
        scrollWidth: el.scrollWidth,
        scrollHeight: el.scrollHeight
    };
};

window.fitListItems = function(itemsSelector, maxBottomY, startPx, minPx, grow) {
    const container = document.querySelector(itemsSelector);
    if (!container) return { success: true };
    let textEls = container.querySelectorAll('.list-text');
    if (!textEls.length) {
        // grid_pill lists use .item-text: start from its own size so lists that fit look the same
        textEls = container.querySelectorAll('.item-text');
        if (!textEls.length) return { success: true };
        // normally a list that fits keeps the size the style gives it; `grow` (a reel, watched
        // full screen) lets it run up to startPx instead of staying feed-sized
        if (!grow) startPx = Math.min(startPx, Math.round(parseFloat(window.getComputedStyle(textEls[0]).fontSize)));
        if (grow) textEls.forEach(el => {
            el.style.overflowWrap = 'normal';     // big type must not break "best-sellers" mid-word
            el.style.wordBreak = 'normal';
            el.style.hyphens = 'none';
            el.style.textWrap = 'balance';
        });
    }

    let currentPx = startPx;
    while (currentPx >= minPx) {
        textEls.forEach(el => el.style.fontSize = currentPx + "px");
        const rect = container.getBoundingClientRect();
        let overflowH = false;
        textEls.forEach(el => {
            if (el.scrollWidth > el.clientWidth) overflowH = true;
        });

        if (rect.bottom <= maxBottomY && !overflowH) {
            return { success: true, fontSize: currentPx, bottom: rect.bottom };
        }
        currentPx -= 1;
    }

    // Try at minPx
    textEls.forEach(el => el.style.fontSize = minPx + "px");
    const rect = container.getBoundingClientRect();
    let overflowH = false;
    textEls.forEach(el => {
        if (el.scrollWidth > el.clientWidth) overflowH = true;
    });

    if (rect.bottom <= maxBottomY && !overflowH) {
        return { success: true, fontSize: minPx, bottom: rect.bottom };
    }

    return {
        success: false,
        fontSize: minPx,
        bottom: rect.bottom,
        maxBottomY: maxBottomY,
        reason: `List items exceed bottom boundary (${Math.round(rect.bottom)} > ${maxBottomY}) or overflow horizontally at minimum font-size ${minPx}px`
    };
};
"""
