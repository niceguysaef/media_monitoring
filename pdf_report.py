from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


PAGE_WIDTH, PAGE_HEIGHT = landscape(A4)

ORANGE_DARK = HexColor("#B83A18")
ORANGE = HexColor("#ED6E1F")
ORANGE_LIGHT = HexColor("#F89A32")
GOLD = HexColor("#ECA81A")
SOFT = HexColor("#FFF1E6")
SURFACE = HexColor("#FFFAF6")
TEXT = HexColor("#24150E")
MUTED = HexColor("#7C6256")
LINE = HexColor("#ECD6C7")
WHITE = HexColor("#FFFFFF")
POSITIVE = HexColor("#287A55")
NEUTRAL = HexColor("#6C78A2")
NEGATIVE = HexColor("#C84B38")


def _safe_text(value: Any) -> str:
    return (
        str(value or "")
        .replace("\u2011", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2026", "...")
        .replace("\u00a0", " ")
        .replace("\u2022", "-")
    )


def _compact(value: Any) -> str:
    number = float(value or 0)
    absolute = abs(number)
    if absolute >= 1_000_000_000:
        return f"{number / 1_000_000_000:.1f}B".replace(".0B", "B")
    if absolute >= 1_000_000:
        return f"{number / 1_000_000:.1f}M".replace(".0M", "M")
    if absolute >= 1_000:
        return f"{number / 1_000:.1f}K".replace(".0K", "K")
    return f"{number:,.0f}"


def _wrap_lines(text: Any, font: str, size: float, width: float, max_lines: Optional[int] = None) -> List[str]:
    raw_words = _safe_text(text).replace("\n", " \n ").split()
    words: List[str] = []
    for word in raw_words:
        if word == "\n" or pdfmetrics.stringWidth(word, font, size) <= width:
            words.append(word)
            continue
        chunk = ""
        for character in word:
            candidate = f"{chunk}{character}"
            if chunk and pdfmetrics.stringWidth(candidate, font, size) > width:
                words.append(chunk)
                chunk = character
            else:
                chunk = candidate
        if chunk:
            words.append(chunk)
    lines: List[str] = []
    current = ""
    for word in words:
        if word == "\n":
            lines.append(current)
            current = ""
            continue
        candidate = f"{current} {word}".strip()
        if not current or pdfmetrics.stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
        if max_lines and len(lines) >= max_lines:
            break
    if current and (not max_lines or len(lines) < max_lines):
        lines.append(current)
    if max_lines and len(lines) == max_lines and words:
        original = " ".join(word for word in words if word != "\n")
        rendered = " ".join(lines)
        if len(rendered) < len(original):
            line = lines[-1]
            while line and pdfmetrics.stringWidth(f"{line}...", font, size) > width:
                line = line[:-1].rstrip()
            lines[-1] = f"{line}..."
    return lines


def _text(
    pdf: canvas.Canvas,
    value: Any,
    x: float,
    top: float,
    width: float,
    size: float = 10,
    font: str = "Helvetica",
    color: Any = TEXT,
    leading: Optional[float] = None,
    max_lines: Optional[int] = None,
    align: str = "left",
) -> float:
    leading = leading or size * 1.25
    lines = _wrap_lines(value, font, size, width, max_lines)
    pdf.setFont(font, size)
    pdf.setFillColor(color)
    for index, line in enumerate(lines):
        baseline = PAGE_HEIGHT - top - size - index * leading
        if align == "center":
            pdf.drawCentredString(x + width / 2, baseline, line)
        elif align == "right":
            pdf.drawRightString(x + width, baseline, line)
        else:
            pdf.drawString(x, baseline, line)
    return top + max(len(lines), 1) * leading


def _rect(pdf: canvas.Canvas, x: float, top: float, width: float, height: float, fill: Any, stroke: Any = None, radius: float = 0) -> None:
    pdf.setFillColor(fill)
    if stroke:
        pdf.setStrokeColor(stroke)
        pdf.setLineWidth(0.7)
    else:
        pdf.setStrokeColor(fill)
    y = PAGE_HEIGHT - top - height
    if radius:
        pdf.roundRect(x, y, width, height, radius, fill=1, stroke=1 if stroke else 0)
    else:
        pdf.rect(x, y, width, height, fill=1, stroke=1 if stroke else 0)


def _line(pdf: canvas.Canvas, x1: float, top1: float, x2: float, top2: float, color: Any = LINE, width: float = 0.7) -> None:
    pdf.setStrokeColor(color)
    pdf.setLineWidth(width)
    pdf.line(x1, PAGE_HEIGHT - top1, x2, PAGE_HEIGHT - top2)


def _header(pdf: canvas.Canvas, title: str, kicker: str, page: int, total: int) -> None:
    _rect(pdf, 0, 0, PAGE_WIDTH, 74, ORANGE_DARK)
    _text(pdf, kicker.upper(), 38, 15, 610, 9, "Helvetica-Bold", HexColor("#FFD9BD"), max_lines=1)
    _text(pdf, title, 38, 33, 700, 21, "Helvetica-Bold", WHITE, max_lines=1)
    _text(pdf, f"{page:02d} / {total:02d}", 742, 31, 62, 10, "Helvetica-Bold", WHITE, align="right", max_lines=1)


def _footer(pdf: canvas.Canvas, project: str, period: str) -> None:
    _line(pdf, 38, 566, PAGE_WIDTH - 38, 566)
    _text(pdf, f"{project}  -  {period}", 38, 572, 520, 7.5, color=MUTED, max_lines=1)
    _text(pdf, "Zestar Media Intelligence", 600, 572, 204, 7.5, "Helvetica-Bold", MUTED, align="right", max_lines=1)


def _line_chart(pdf: canvas.Canvas, values: Sequence[float], labels: Sequence[str], x: float, top: float, width: float, height: float, color: Any) -> None:
    left = x + 34
    right = x + width - 8
    chart_top = top + 12
    bottom = top + height - 30
    maximum = max([float(value or 0) for value in values] or [1]) or 1
    for tick in range(5):
        y_top = chart_top + (bottom - chart_top) * tick / 4
        _line(pdf, left, y_top, right, y_top, LINE, 0.5)
        label = maximum * (4 - tick) / 4
        _text(pdf, _compact(label), x, y_top - 5, 28, 7, color=MUTED, align="right", max_lines=1)
    if not values:
        return
    step = (right - left) / max(len(values) - 1, 1)
    points: List[Tuple[float, float]] = []
    for index, value in enumerate(values):
        px = left + index * step
        py_top = bottom - (float(value or 0) / maximum) * (bottom - chart_top)
        points.append((px, py_top))
    pdf.setStrokeColor(color)
    pdf.setLineWidth(2)
    for first, second in zip(points, points[1:]):
        pdf.line(first[0], PAGE_HEIGHT - first[1], second[0], PAGE_HEIGHT - second[1])
    pdf.setFillColor(color)
    for px, py_top in points:
        pdf.circle(px, PAGE_HEIGHT - py_top, 2.4, fill=1, stroke=0)
    label_step = max(1, (len(labels) + 6) // 7)
    for index, label in enumerate(labels):
        if index % label_step == 0 or index == len(labels) - 1:
            px = left + index * step
            _text(pdf, label, px - 24, bottom + 8, 48, 6.5, color=MUTED, align="center", max_lines=1)


def _horizontal_bars(
    pdf: canvas.Canvas,
    items: Sequence[Tuple[str, float]],
    x: float,
    top: float,
    width: float,
    row_height: float = 42,
    color: Any = ORANGE,
    value_suffix: str = "",
) -> None:
    maximum = max([float(value or 0) for _, value in items] or [1]) or 1
    label_width = min(190, width * 0.42)
    bar_left = x + label_width
    bar_width = width - label_width - 48
    for index, (label, value) in enumerate(items):
        row_top = top + index * row_height
        _text(pdf, label, x, row_top + 7, label_width - 8, 8.5, "Helvetica-Bold", TEXT, max_lines=1, align="right")
        _rect(pdf, bar_left, row_top + 4, bar_width, 20, SOFT)
        _rect(pdf, bar_left, row_top + 4, max(1, bar_width * float(value or 0) / maximum), 20, color)
        _text(pdf, f"{_compact(value)}{value_suffix}", bar_left + bar_width + 5, row_top + 7, 44, 8, "Helvetica-Bold", TEXT, max_lines=1)


def _source_name(value: Any) -> str:
    normalized = _safe_text(value).lower()
    if normalized == "twitter":
        return "X / Twitter"
    if normalized == "youtube":
        return "YouTube"
    if normalized == "tiktok":
        return "TikTok"
    return normalized.title() if normalized else "Other"


def _top_entries(items: Iterable[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    return list(items or [])[:limit]


def build_pdf_report(dataset: Dict[str, Any], options: Dict[str, Any]) -> bytes:
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=1)
    language = str(options.get("language") or "en").lower()
    malay = language == "ms"
    t = lambda english, bahasa: bahasa if malay else english
    sections = set(options.get("sections") or [])
    metrics = dataset["metrics"]
    totals = metrics["totals"]
    project = _safe_text(dataset["project"]["name"])
    period = f"{dataset['dateRange']['from']} to {dataset['dateRange']['to']}"
    total_engagement = sum(float(value or 0) for value in totals["engagement"].values())
    sentiment_total = sum(float(value or 0) for value in totals["sentiment"].values()) or 1
    shares = {key: float(value or 0) / sentiment_total * 100 for key, value in totals["sentiment"].items()}
    dominant = max(shares, key=shares.get)
    dominant_label = {
        "positive": t("Positive", "Positif"),
        "neutral": "Neutral",
        "negative": t("Negative", "Negatif"),
    }[dominant]
    peak = max(metrics["days"], key=lambda item: sum(item["engagement"].values()), default=None)
    top_source = metrics.get("sources", [{}])[0] if metrics.get("sources") else None

    page_keys = ["cover"]
    if "overview" in sections:
        page_keys.append("overview")
    if "daily" in sections:
        page_keys.append("daily")
    if "sources" in sections:
        page_keys.append("source-performance")
    if "topics" in sections:
        page_keys.append("topics")
    if sections.intersection({"sources", "authors"}):
        page_keys.append("who-where")
    if "mentions" in sections:
        page_keys.append("mentions")
    if sections.intersection({"links", "hashtags"}):
        page_keys.append("signals")
    page_keys.append("methodology")
    total_pages = len(page_keys)
    page = 0

    pdf.setTitle(_safe_text(options.get("reportTitle") or t("Media Intelligence Report", "Laporan Risikan Media")))
    pdf.setAuthor("Zestar Media Intelligence")
    pdf.setSubject(f"Media monitoring report for {project}")

    # Cover
    page += 1
    _rect(pdf, 0, 0, 530, PAGE_HEIGHT, ORANGE_DARK)
    _rect(pdf, 530, 0, PAGE_WIDTH - 530, PAGE_HEIGHT, GOLD)
    _text(pdf, t("MEDIA INTELLIGENCE", "RISIKAN MEDIA"), 48, 55, 390, 11, "Helvetica-Bold", HexColor("#FFD9BD"), max_lines=1)
    _text(pdf, options.get("reportTitle") or t("Media Intelligence Report", "Laporan Risikan Media"), 48, 135, 430, 34, "Helvetica-Bold", WHITE, leading=40, max_lines=3)
    _text(pdf, project, 48, 340, 410, 18, "Helvetica-Bold", WHITE, max_lines=2)
    _text(pdf, period, 48, 400, 410, 11, color=HexColor("#FFE8D7"), max_lines=1)
    _text(pdf, options.get("organization") or t("Prepared for client review", "Disediakan untuk semakan klien"), 575, 195, 220, 20, "Helvetica-Bold", TEXT, leading=25, max_lines=3, align="center")
    _text(pdf, t("Live monitoring snapshot", "Petikan pemantauan langsung"), 575, 320, 220, 11, color=TEXT, align="center", max_lines=2)
    _text(pdf, "Zestar Media Intelligence", 575, 515, 220, 9, "Helvetica-Bold", TEXT, align="center", max_lines=1)
    pdf.showPage()

    if "overview" in sections:
        page += 1
        _header(pdf, t("The conversation at a glance", "Perbualan secara ringkas"), t("Executive overview", "Ringkasan eksekutif"), page, total_pages)
        kpis = [
            (t("MENTIONS", "SEBUTAN"), _compact(totals["mentions"]), t("Across the period", "Sepanjang tempoh")),
            (t("ESTIMATED REACH", "ANGGARAN CAPAIAN"), _compact(totals["reach"]), t("Potential exposure", "Potensi pendedahan")),
            (t("ENGAGEMENT", "PENGLIBATAN"), _compact(total_engagement), t("Likes, comments, shares", "Suka, komen, kongsi")),
            (t("PEAK DAY", "HARI PUNCAK"), peak["date"] if peak else "-", t("Highest engagement", "Penglibatan tertinggi")),
        ]
        for index, (label, value, detail) in enumerate(kpis):
            left = 42 + index * 197
            _text(pdf, label, left, 112, 170, 8.5, "Helvetica-Bold", MUTED, max_lines=1)
            _text(pdf, value, left, 138, 170, 25, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
            _text(pdf, detail, left, 180, 170, 8.5, color=MUTED, max_lines=1)
        _rect(pdf, 42, 238, 360, 215, SOFT, LINE, 8)
        _text(pdf, t("Sentiment composition", "Komposisi sentimen"), 62, 260, 320, 14, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
        sentiment_items = [
            (t("Positive", "Positif"), shares["positive"], POSITIVE),
            ("Neutral", shares["neutral"], NEUTRAL),
            (t("Negative", "Negatif"), shares["negative"], NEGATIVE),
        ]
        segment_left = 62
        for _, share, color in sentiment_items:
            segment_width = 300 * share / 100
            if segment_width:
                _rect(pdf, segment_left, 306, segment_width, 30, color)
            segment_left += segment_width
        for index, (label, share, color) in enumerate(sentiment_items):
            row_top = 357 + index * 26
            _rect(pdf, 64, row_top + 2, 8, 8, color)
            _text(pdf, label, 80, row_top, 130, 8.5, "Helvetica-Bold", TEXT, max_lines=1)
            _text(pdf, f"{share:.1f}%", 230, row_top, 130, 8.5, "Helvetica-Bold", color, align="right", max_lines=1)
        _rect(pdf, 430, 238, 368, 215, WHITE, LINE, 8)
        _text(pdf, t("What stands out", "Perkara utama"), 452, 260, 320, 14, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
        takeaway = t(
            f"{dominant_label} sentiment represents {shares[dominant]:.1f}% of classified mentions. " + (f"{_source_name(top_source['source'])} leads source volume with {_compact(top_source['mentions'])} mentions." if top_source else "No source breakdown was returned."),
            f"Sentimen {dominant_label.lower()} merangkumi {shares[dominant]:.1f}% sebutan terkelas. " + (f"{_source_name(top_source['source'])} mendahului jumlah sumber dengan {_compact(top_source['mentions'])} sebutan." if top_source else "Tiada pecahan sumber diterima."),
        )
        _text(pdf, takeaway, 452, 306, 320, 15, color=TEXT, leading=20, max_lines=6)
        _footer(pdf, project, period)
        pdf.showPage()

    if "daily" in sections:
        page += 1
        _header(pdf, t("Attention moved through distinct daily peaks", "Puncak harian menunjukkan perubahan perhatian"), t("Daily timeline", "Garis masa harian"), page, total_pages)
        days = metrics.get("days", [])
        labels = [item["date"][5:] for item in days]
        mentions = [item["mentions"] for item in days]
        engagements = [sum(item["engagement"].values()) for item in days]
        _text(pdf, t("Mentions", "Sebutan"), 42, 104, 350, 15, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
        _text(pdf, t("Engagement", "Penglibatan"), 432, 104, 350, 15, "Helvetica-Bold", GOLD, max_lines=1)
        _line_chart(pdf, mentions, labels, 42, 136, 360, 325, ORANGE_DARK)
        _line_chart(pdf, engagements, labels, 432, 136, 366, 325, GOLD)
        if peak:
            _rect(pdf, 42, 482, 756, 55, SOFT, LINE, 7)
            _text(pdf, t("Highest engagement", "Penglibatan tertinggi"), 62, 497, 150, 9, "Helvetica-Bold", MUTED, max_lines=1)
            _text(pdf, f"{peak['date']}  -  {_compact(sum(peak['engagement'].values()))}", 220, 493, 540, 13, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
        _footer(pdf, project, period)
        pdf.showPage()

    if "sources" in sections:
        page += 1
        _header(pdf, t("A small group of sources drove most visibility", "Beberapa sumber memacu keterlihatan"), t("Source performance", "Prestasi sumber"), page, total_pages)
        source_items = [(_source_name(item["source"]), item["mentions"]) for item in metrics.get("sources", [])[:7]]
        _horizontal_bars(pdf, source_items, 42, 128, 520, 50)
        _rect(pdf, 595, 128, 203, 278, SOFT, LINE, 8)
        _text(pdf, t("Leading source", "Sumber utama"), 618, 155, 158, 11, "Helvetica-Bold", MUTED, max_lines=1)
        _text(pdf, _source_name(top_source["source"]) if top_source else "-", 618, 195, 158, 23, "Helvetica-Bold", ORANGE_DARK, max_lines=2)
        if top_source:
            _text(pdf, f"{_compact(top_source['mentions'])} {t('mentions', 'sebutan')}", 618, 275, 158, 12, "Helvetica-Bold", TEXT, max_lines=1)
            _text(pdf, f"{_compact(top_source['reach'])} {t('estimated reach', 'anggaran capaian')}", 618, 305, 158, 10, color=MUTED, max_lines=2)
        _text(pdf, t("Source reach is aggregated and is not a unique-audience count.", "Capaian sumber ialah agregat dan bukan kiraan khalayak unik."), 618, 350, 158, 9, color=MUTED, leading=12, max_lines=4)
        _footer(pdf, project, period)
        pdf.showPage()

    if "topics" in sections:
        page += 1
        _header(pdf, t("The leading themes reveal where attention clustered", "Tema utama menunjukkan tumpuan perhatian"), t("Topics and share of voice", "Topik dan bahagian suara"), page, total_pages)
        topics = _top_entries(dataset.get("topics", {}).get("items", []), 6)
        _horizontal_bars(pdf, [(item["name"], item["shareOfVoice"]) for item in topics], 38, 125, 455, 54, ORANGE, "%")
        _text(pdf, t("What the top themes cover", "Liputan tema utama"), 530, 120, 270, 14, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
        for index, item in enumerate(topics[:3]):
            row_top = 165 + index * 122
            _text(pdf, str(index + 1), 530, row_top, 24, 13, "Helvetica-Bold", GOLD, max_lines=1)
            _text(pdf, item["name"], 562, row_top, 230, 11.5, "Helvetica-Bold", TEXT, max_lines=2)
            _text(pdf, item.get("description") or t("No description available.", "Tiada penerangan tersedia."), 562, row_top + 36, 230, 8.5, color=MUTED, leading=11, max_lines=5)
        if not topics:
            _text(pdf, t("No topics were available for this period.", "Tiada topik tersedia bagi tempoh ini."), 180, 280, 480, 15, color=MUTED, align="center", max_lines=2)
        _footer(pdf, project, period)
        pdf.showPage()

    if sections.intersection({"sources", "authors"}):
        page += 1
        _header(pdf, t("Publishers and influential voices shaped visibility", "Penerbit dan suara berpengaruh membentuk keterlihatan"), t("Who and where", "Siapa dan di mana"), page, total_pages)
        source_data = dataset.get("sources", {})
        domains = _top_entries(source_data.get("domains", {}).get("items", []), 6)
        authors = _top_entries(source_data.get("authors", {}).get("items", []), 6)
        _text(pdf, t("Leading domains", "Domain utama"), 42, 112, 350, 15, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
        _text(pdf, t("Influential authors", "Pengarang berpengaruh"), 430, 112, 368, 15, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
        for index, item in enumerate(domains):
            row_top = 155 + index * 58
            _text(pdf, str(index + 1), 42, row_top, 20, 11, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
            _text(pdf, item["domain"], 72, row_top, 280, 10.5, "Helvetica-Bold", TEXT, max_lines=1)
            _text(pdf, f"{_compact(item['mentions'])} {t('mentions', 'sebutan')}  -  {_compact(item['reach'])} {t('reach', 'capaian')}", 72, row_top + 24, 300, 8, color=MUTED, max_lines=1)
        for index, item in enumerate(authors):
            row_top = 155 + index * 58
            _text(pdf, str(index + 1), 430, row_top, 20, 11, "Helvetica-Bold", GOLD, max_lines=1)
            _text(pdf, item["name"], 460, row_top, 286, 10.5, "Helvetica-Bold", TEXT, max_lines=1)
            _text(pdf, f"{_compact(item['followers'])} {t('followers', 'pengikut')}  -  {_compact(item['reach'])} {t('reach', 'capaian')}", 460, row_top + 24, 300, 8, color=MUTED, max_lines=1)
        _footer(pdf, project, period)
        pdf.showPage()

    if "mentions" in sections:
        page += 1
        _header(pdf, t("Representative mentions show how coverage was framed", "Sebutan wakil menunjukkan bingkai liputan"), t("Featured coverage", "Liputan pilihan"), page, total_pages)
        candidates = [item for item in dataset.get("mentions", {}).get("items", []) if item.get("title") or item.get("content")][:3]
        card_width = 242
        for index, item in enumerate(candidates):
            left = 42 + index * 259
            _rect(pdf, left, 112, card_width, 412, SOFT if index == 0 else WHITE, LINE, 8)
            sentiment = str(item.get("sentiment") or "neutral").lower()
            sentiment_color = POSITIVE if sentiment == "positive" else NEGATIVE if sentiment == "negative" else NEUTRAL
            _text(pdf, f"{_source_name(item.get('category'))}  -  {sentiment.title()}", left + 18, 135, card_width - 36, 9, "Helvetica-Bold", sentiment_color, max_lines=1)
            _text(pdf, item.get("title") or t("Untitled mention", "Sebutan tanpa tajuk"), left + 18, 178, card_width - 36, 14, "Helvetica-Bold", TEXT, leading=17, max_lines=4)
            _text(pdf, item.get("content") or item.get("restrictionReason") or t("No excerpt supplied by the data source.", "Tiada petikan dibekalkan oleh sumber data."), left + 18, 265, card_width - 36, 9, color=MUTED, leading=12, max_lines=12)
            source_line = f"{item.get('host') or t('Source unavailable', 'Sumber tidak tersedia')}\n{item.get('date') or ''}"
            _text(pdf, source_line, left + 18, 470, card_width - 36, 8.5, "Helvetica-Bold", ORANGE_DARK, leading=11, max_lines=2)
            url = item.get("sourceUrl")
            if isinstance(url, str) and url.startswith(("http://", "https://")):
                pdf.linkURL(url, (left + 15, PAGE_HEIGHT - 518, left + card_width - 15, PAGE_HEIGHT - 466), relative=0)
        if not candidates:
            _text(pdf, t("No unrestricted mention excerpts were available for this period.", "Tiada petikan sebutan tanpa sekatan tersedia bagi tempoh ini."), 150, 280, 540, 15, color=MUTED, align="center", max_lines=2)
        _footer(pdf, project, period)
        pdf.showPage()

    if sections.intersection({"links", "hashtags"}):
        page += 1
        _header(pdf, t("Links and hashtags reveal the conversation signals", "Pautan dan tanda pagar menunjukkan isyarat perbualan"), t("Conversation signals", "Isyarat perbualan"), page, total_pages)
        source_data = dataset.get("sources", {})
        links = _top_entries(source_data.get("links", {}).get("items", []), 7) if "links" in sections else []
        hashtags = _top_entries(source_data.get("hashtags", {}).get("items", []), 8) if "hashtags" in sections else []
        _text(pdf, t("Trending links", "Pautan sohor kini"), 42, 112, 350, 15, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
        _text(pdf, t("Trending hashtags", "Tanda pagar sohor kini"), 440, 112, 350, 15, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
        for index, item in enumerate(links):
            row_top = 158 + index * 50
            _text(pdf, item["url"], 42, row_top, 282, 8.5, "Helvetica-Bold", TEXT, leading=10.5, max_lines=2)
            _text(pdf, f"{_compact(item['mentions'])} {t('mentions', 'sebutan')}", 330, row_top, 80, 8, "Helvetica-Bold", ORANGE_DARK, align="right", max_lines=1)
            pdf.linkURL(item["url"], (42, PAGE_HEIGHT - row_top - 27, 410, PAGE_HEIGHT - row_top + 2), relative=0)
        for index, item in enumerate(hashtags):
            row_top = 158 + index * 42
            _text(pdf, item["hashtag"], 440, row_top, 210, 10, "Helvetica-Bold", ORANGE_DARK, max_lines=1)
            _text(pdf, f"{_compact(item['mentions'])}  -  {_compact(item['reach'])} {t('reach', 'capaian')}", 650, row_top, 140, 8, color=MUTED, align="right", max_lines=1)
        _footer(pdf, project, period)
        pdf.showPage()

    page += 1
    _header(pdf, t("Read the findings within the limits of the available data", "Tafsir dapatan berdasarkan had data yang tersedia"), t("Methodology", "Metodologi"), page, total_pages)
    mention_data = dataset.get("mentions", {})
    notes = [
        t("Metrics are generated from a live monitoring snapshot for the selected project and reporting period.", "Metrik dijana daripada petikan pemantauan langsung bagi projek dan tempoh laporan yang dipilih."),
        t("Reach represents potential exposure and should not be interpreted as a unique-audience count.", "Capaian mewakili potensi pendedahan dan bukan kiraan khalayak unik."),
        t("Individual mentions do not include per-post reach, likes, comments, or shares. Featured coverage is representative, not performance-ranked.", "Sebutan individu tidak mempunyai capaian, suka, komen atau perkongsian setiap siaran. Liputan pilihan ialah wakil dan bukan kedudukan prestasi."),
        t("Facebook, Instagram, and X may restrict post text or source links in API responses.", "Facebook, Instagram dan X mungkin mengehadkan teks siaran atau pautan sumber dalam respons API."),
        t(f"Raw mentions were capped at {mention_data.get('limit', 0):,} rows.", f"Sebutan mentah dihadkan kepada {mention_data.get('limit', 0):,} baris.") if mention_data.get("truncated") else t("All available mention pages for this period were included.", "Semua halaman sebutan yang tersedia bagi tempoh ini telah disertakan."),
    ]
    for index, note in enumerate(notes):
        row_top = 125 + index * 80
        _text(pdf, str(index + 1), 58, row_top, 25, 14, "Helvetica-Bold", ORANGE_DARK, align="center", max_lines=1)
        _text(pdf, note, 105, row_top, 675, 11.5, color=TEXT, leading=15, max_lines=3)
    _footer(pdf, project, period)
    pdf.showPage()

    pdf.save()
    return output.getvalue()
