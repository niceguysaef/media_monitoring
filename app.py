import json
import os
import random
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path
from time import monotonic, time
from typing import Any, Callable, Dict, List, Optional, Tuple
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


BRAND24_BASE_URL = "https://api-data.brand24.com"
STORE_PATH = Path("data/monitors.json")
UPSTREAM_TIMEOUT_SECONDS = 10
DASHBOARD_CACHE_TTL_SECONDS = 180
PROJECT_CACHE_TTL_SECONDS = 60
MONITOR_LIMIT = int(os.getenv("MONITOR_LIMIT", "25"))

load_dotenv()

RATE_LIMITS = {
    "dashboard": {"limit": 20, "window": 60},
    "monitors_read": {"limit": 30, "window": 60},
    "monitors_create": {"limit": 3, "window": 300},
}

_rate_buckets: Dict[str, List[float]] = {}
_dashboard_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_projects_cache: Optional[Tuple[float, List[Dict[str, str]]]] = None

app = FastAPI(
    title="Media Monitoring Demo API",
    description="Backend-for-frontend proxy for Brand24 analytics dashboard data.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _client_id(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(bucket: str, client_id: str) -> None:
    rule = RATE_LIMITS[bucket]
    now = monotonic()
    key = f"{bucket}:{client_id}"
    recent = [stamp for stamp in _rate_buckets.get(key, []) if now - stamp < rule["window"]]

    if len(recent) >= rule["limit"]:
        retry_after = max(1, int(rule["window"] - (now - recent[0])))
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )

    recent.append(now)
    _rate_buckets[key] = recent


def _cached_dashboard(cache_key: str, loader: Callable[[], Dict[str, Any]]) -> Dict[str, Any]:
    now = time()
    cached = _dashboard_cache.get(cache_key)
    if cached and now - cached[0] < DASHBOARD_CACHE_TTL_SECONDS:
        return {**cached[1], "cache": "hit"}

    value = loader()
    _dashboard_cache[cache_key] = (now, value)
    return {**value, "cache": "miss"}


def _date_range(days: int) -> List[str]:
    today = date.today()
    start = today - timedelta(days=days - 1)
    return [(start + timedelta(days=index)).isoformat() for index in range(days)]


def _brand24_get(
    path: str,
    api_key: str,
    query: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    params = urllib.parse.urlencode(query or {})
    url = f"{BRAND24_BASE_URL}{path}"
    if params:
        url = f"{url}?{params}"

    request = urllib.request.Request(url, headers={"X-Api-Key": api_key})

    try:
        with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
            import json

            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        message = error.read().decode("utf-8") or error.reason
        raise HTTPException(status_code=error.code, detail=message)
    except urllib.error.URLError as error:
        raise HTTPException(status_code=502, detail=f"Brand24 request failed: {error.reason}")


def _brand24_post(
    path: str,
    api_key: str,
    query: Optional[Dict[str, Any]] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    params = urllib.parse.urlencode(query or {})
    url = f"{BRAND24_BASE_URL}{path}"
    if params:
        url = f"{url}?{params}"

    payload = json.dumps(body or {}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "X-Api-Key": api_key},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        message = error.read().decode("utf-8") or error.reason
        raise HTTPException(status_code=error.code, detail=message)
    except urllib.error.URLError as error:
        raise HTTPException(status_code=502, detail=f"Brand24 request failed: {error.reason}")


class KeywordRule(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=80)
    required: List[str] = Field(default_factory=list, max_length=8)
    excluded: List[str] = Field(default_factory=list, max_length=12)


class ProjectCreate(BaseModel):
    projectName: str = Field(..., min_length=1, max_length=120)
    language: Optional[str] = Field(default=None, max_length=40)
    keywords: List[KeywordRule] = Field(..., min_length=1, max_length=10)


class MonitorCreate(ProjectCreate):
    customerName: str = Field(..., min_length=1, max_length=120)


def _read_monitors() -> List[Dict[str, Any]]:
    if not STORE_PATH.exists():
        return []

    try:
        return json.loads(STORE_PATH.read_text())
    except json.JSONDecodeError:
        return []


def _write_monitors(monitors: List[Dict[str, Any]]) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps(monitors[:MONITOR_LIMIT], indent=2))


def _clean_terms(values: List[str]) -> List[str]:
    return [value.strip()[:80] for value in values if value.strip()]


def _extract_project_id(response: Any) -> Optional[str]:
    if isinstance(response, int):
        return str(response)

    if isinstance(response, dict):
        for key in ("projectId", "project_id", "projectID"):
            candidate = response.get(key)
            if candidate:
                return str(candidate)

        if "id" in response and any("project" in key.lower() for key in response.keys()):
            return str(response["id"])

        for value in response.values():
            project_id = _extract_project_id(value)
            if project_id:
                return project_id

    if isinstance(response, list):
        for item in response:
            project_id = _extract_project_id(item)
            if project_id:
                return project_id

    return None


def _safe_response_shape(response: Any) -> str:
    if isinstance(response, list):
        item_types = ", ".join(sorted({type(item).__name__ for item in response[:3]}))
        return f"list(len={len(response)}, item_types={item_types or 'empty'})"
    if isinstance(response, dict):
        parts = [f"object(keys={', '.join(response.keys())})"]
        if "data" in response:
            parts.append(f"data={_safe_response_shape(response['data'])}")
        return "; ".join(parts)
    return type(response).__name__


def _create_brand24_project(payload: ProjectCreate) -> Dict[str, Any]:
    api_key = os.getenv("BRAND24_API_KEY")
    account_id = os.getenv("BRAND24_ACCOUNT_ID")

    keywords = [
        {
            "keyword": keyword.keyword.strip(),
            **({"required": _clean_terms(keyword.required)} if _clean_terms(keyword.required) else {}),
            **({"excluded": _clean_terms(keyword.excluded)} if _clean_terms(keyword.excluded) else {}),
        }
        for keyword in payload.keywords
        if keyword.keyword.strip()
    ]

    if not keywords:
        raise HTTPException(status_code=400, detail="At least one keyword is required.")

    if not api_key or not account_id:
        return {
            "mode": "mock",
            "projectId": f"mock-{uuid4().hex[:10]}",
            "keywords": keywords,
        }

    query: Dict[str, Any] = {"project_name": payload.projectName}
    if payload.language:
        query["language"] = payload.language

    response = _brand24_post(
        f"/api-data/v1/account/{account_id}/create_project",
        api_key,
        query=query,
        body={"keywords": keywords},
    )
    project_id = _extract_project_id(response)
    if not project_id:
        raise HTTPException(
            status_code=502,
            detail=f"Source API did not return a project ID. Response shape: {_safe_response_shape(response)}",
        )

    return {"mode": "live", "projectId": str(project_id), "keywords": keywords}


def _mock_dashboard(brand: str, days: int) -> Dict[str, Any]:
    random.seed(f"{brand}-{days}")
    dates = _date_range(days)
    mentions = []
    sentiment = []
    reach = []
    total_mentions = 0
    total_reach = 0
    positive = 0
    negative = 0

    for index, day in enumerate(dates):
        baseline = 74 + (index % 6) * 8
        spike = 90 if index in {6, 18, 25} else 0
        count = baseline + spike + random.randint(-18, 22)
        pos = int(count * random.uniform(0.42, 0.62))
        neg = int(count * random.uniform(0.08, 0.2))
        daily_reach = count * random.randint(950, 1850)

        mentions.append({"date": day, "mentions": count})
        sentiment.append({"date": day, "positive": pos, "negative": neg, "neutral": count - pos - neg})
        reach.append({"date": day, "reach": daily_reach})

        total_mentions += count
        total_reach += daily_reach
        positive += pos
        negative += neg

    return {
        "mode": "mock",
        "brand": brand,
        "dateRange": {"from": dates[0], "to": dates[-1], "days": days},
        "kpis": {
            "mentions": total_mentions,
            "reach": total_reach,
            "sentimentScore": round(((positive - negative) / max(positive + negative, 1)) * 100),
            "shareOfVoice": 38,
            "engagementLift": 17,
        },
        "mentionsTrend": mentions,
        "sentimentTrend": sentiment,
        "reachTrend": reach,
        "sources": [
            {"name": "News", "value": 35},
            {"name": "X", "value": 24},
            {"name": "Blogs", "value": 18},
            {"name": "Forums", "value": 13},
            {"name": "TikTok", "value": 10},
        ],
        "topics": [
            {"topic": "Product launch", "mentions": 482, "sentiment": "positive"},
            {"topic": "Customer support", "mentions": 339, "sentiment": "mixed"},
            {"topic": "Pricing", "mentions": 271, "sentiment": "neutral"},
            {"topic": "Competitor comparison", "mentions": 198, "sentiment": "positive"},
        ],
        "hashtags": ["#BrandTracking", "#SocialListening", "#LaunchWeek", "#CustomerVoice"],
        "links": [
            {"title": "Launch announcement", "url": "brand.example/launch", "mentions": 144},
            {"title": "Industry comparison", "url": "media.example/ranking", "mentions": 91},
            {"title": "Community discussion", "url": "forum.example/thread", "mentions": 73},
        ],
        "aiSummary": (
            f"{brand} is seeing a sustained lift in conversation volume, led by launch coverage "
            "and comparison posts. Positive sentiment is strongest in news and creator channels, "
            "while support-related discussion is the main watch item."
        ),
        "insights": [
            "Conversation spikes cluster around weekday mornings, suggesting PR and analyst pickup.",
            "News domains create the largest reach multiplier even though social produces more raw mentions.",
            "Pricing questions are frequent but mostly neutral, making them a good content opportunity.",
        ],
        "hotHours": [
            {"hour": "08:00", "mentions": 146},
            {"hour": "11:00", "mentions": 218},
            {"hour": "14:00", "mentions": 172},
            {"hour": "19:00", "mentions": 133},
        ],
    }


def _normalize_series(mapping: Dict[str, Any], value_key: str) -> List[Dict[str, Any]]:
    return [{"date": day, value_key: value} for day, value in sorted(mapping.items())]


def _envelope_payload(response: Dict[str, Any]) -> Dict[str, Any]:
    payload = response.get("message", response.get("data", {}))
    return payload if isinstance(payload, dict) else {}


def _brand24_credentials() -> Tuple[str, str]:
    api_key = os.getenv("BRAND24_API_KEY")
    account_id = os.getenv("BRAND24_ACCOUNT_ID")
    if not api_key or not account_id:
        raise HTTPException(
            status_code=503,
            detail="Brand24 credentials are not configured on the server.",
        )
    return api_key, account_id


def _normalize_projects_response(response: Dict[str, Any]) -> List[Dict[str, str]]:
    """Normalize every projects-list shape observed in the docs and live API."""
    payload: Any = response.get("data", response.get("message", []))
    if isinstance(payload, dict) and "projects_list" in payload:
        payload = payload["projects_list"]

    projects: List[Dict[str, str]] = []
    if isinstance(payload, dict):
        for raw_id, raw_project in payload.items():
            if isinstance(raw_project, str):
                projects.append({"id": str(raw_id), "name": raw_project})
                continue
            if not isinstance(raw_project, dict):
                continue
            project_id = raw_project.get("projectId") or raw_project.get("project_id") or raw_project.get("id") or raw_id
            project_name = raw_project.get("projectName") or raw_project.get("project_name") or raw_project.get("name")
            if project_id and project_name:
                projects.append({"id": str(project_id), "name": str(project_name)})

    if isinstance(payload, list):
        for item in payload:
            if not isinstance(item, dict):
                continue
            project_id = item.get("projectId") or item.get("project_id") or item.get("id")
            project_name = item.get("projectName") or item.get("project_name") or item.get("name")
            if project_id and project_name:
                projects.append({"id": str(project_id), "name": str(project_name)})

    deduplicated = {project["id"]: project for project in projects}
    return sorted(deduplicated.values(), key=lambda project: project["name"].casefold())


def _brand24_projects(force_refresh: bool = False) -> List[Dict[str, str]]:
    global _projects_cache

    now = time()
    if not force_refresh and _projects_cache and now - _projects_cache[0] < PROJECT_CACHE_TTL_SECONDS:
        return _projects_cache[1]

    api_key, account_id = _brand24_credentials()
    response = _brand24_get(f"/api-data/v1/account/{account_id}/projects_list/", api_key)
    projects = _normalize_projects_response(response)
    _projects_cache = (now, projects)
    return projects


def _number(value: Any, default: float = 0) -> float:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return value
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _whole_number(value: Any, default: int = 0) -> int:
    return int(round(_number(value, default)))


def _sentiment_count(day: Dict[str, Any], label: str, mentions: int) -> int:
    explicit = day.get(f"{label}_mentions")
    if explicit is not None:
        return _whole_number(explicit)

    sentiment = day.get("sentiment")
    if not isinstance(sentiment, dict):
        return mentions if label == "neutral" else 0

    value = _number(sentiment.get(label))
    return _whole_number(value * mentions if 0 <= value <= 1 else value)


def _normalize_daily_metrics(payload: Dict[str, Any], expected_dates: List[str]) -> Dict[str, Any]:
    raw_days = payload.get("days") if isinstance(payload.get("days"), list) else []
    days_by_date = {
        str(day.get("date")): day
        for day in raw_days
        if isinstance(day, dict) and day.get("date")
    }

    normalized_days: List[Dict[str, Any]] = []
    source_totals: Dict[str, Dict[str, Any]] = {}
    for day_name in expected_dates:
        raw_day = days_by_date.get(day_name, {})
        mentions = _whole_number(raw_day.get("mentions_count"))
        reach = _whole_number(raw_day.get("reach_total"))
        engagement = raw_day.get("engagement") if isinstance(raw_day.get("engagement"), dict) else {}
        likes = _whole_number(engagement.get("likes", raw_day.get("likes_count")))
        comments = _whole_number(engagement.get("comments", raw_day.get("comments_count")))
        shares = _whole_number(engagement.get("shares", raw_day.get("shares_count")))

        sources: List[Dict[str, Any]] = []
        raw_sources = raw_day.get("by_source") if isinstance(raw_day.get("by_source"), list) else []
        for raw_source in raw_sources:
            if not isinstance(raw_source, dict) or not raw_source.get("source"):
                continue
            source = str(raw_source["source"])
            source_mentions = _whole_number(raw_source.get("mentions_count"))
            source_reach = _whole_number(raw_source.get("reach"))
            sources.append({"source": source, "mentions": source_mentions, "reach": source_reach})
            aggregate = source_totals.setdefault(source, {"source": source, "mentions": 0, "reach": 0})
            aggregate["mentions"] += source_mentions
            aggregate["reach"] += source_reach

        normalized_days.append(
            {
                "date": day_name,
                "mentions": mentions,
                "reach": reach,
                "sentiment": {
                    "positive": _sentiment_count(raw_day, "positive", mentions),
                    "neutral": _sentiment_count(raw_day, "neutral", mentions),
                    "negative": _sentiment_count(raw_day, "negative", mentions),
                },
                "engagement": {"likes": likes, "comments": comments, "shares": shares},
                "sources": sources,
            }
        )

    sentiment_totals = {
        label: sum(day["sentiment"][label] for day in normalized_days)
        for label in ("positive", "neutral", "negative")
    }
    engagement_totals = {
        label: sum(day["engagement"][label] for day in normalized_days)
        for label in ("likes", "comments", "shares")
    }
    return {
        "days": normalized_days,
        "totals": {
            "mentions": sum(day["mentions"] for day in normalized_days),
            "reach": sum(day["reach"] for day in normalized_days),
            "sentiment": sentiment_totals,
            "engagement": engagement_totals,
        },
        "sources": sorted(source_totals.values(), key=lambda source: source["mentions"], reverse=True),
    }


def _feature_state(items: List[Any], upstream_status: Optional[str] = None) -> str:
    if upstream_status == "unavailable":
        return "unavailable"
    return "ready" if items else "empty"


def _normalize_insights(payload: Dict[str, Any]) -> List[Dict[str, str]]:
    raw_insights = payload.get("insights")
    normalized: List[Dict[str, str]] = []
    if isinstance(raw_insights, list):
        for index, item in enumerate(raw_insights):
            if isinstance(item, str) and item.strip():
                normalized.append({"title": f"Insight {index + 1}", "text": item.strip()})
            elif isinstance(item, dict):
                title = item.get("headline") or item.get("title") or item.get("insightType") or f"Insight {index + 1}"
                body = item.get("text") or item.get("description") or item.get("recommendation")
                if body:
                    normalized.append({"title": str(title), "text": str(body)})
    else:
        for key, title in (
            ("headline", "Headline"),
            ("trends", "Trend"),
            ("insights", "Insight"),
            ("recommendations", "Recommendation"),
        ):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                normalized.append({"title": title, "text": value.strip()})
    return normalized


def _briefing_feature_call(
    feature: str,
    path: str,
    api_key: str,
    query: Dict[str, Any],
) -> Tuple[str, Dict[str, Any], Optional[Dict[str, Any]]]:
    try:
        return feature, _envelope_payload(_brand24_get(path, api_key, query)), None
    except HTTPException as error:
        return feature, {}, {
            "feature": feature,
            "status": error.status_code,
            "message": str(error.detail)[:300],
        }


def _live_briefing(project: Dict[str, str], days: int) -> Dict[str, Any]:
    api_key, _ = _brand24_credentials()
    dates = _date_range(days)
    date_query = {"date_from": dates[0], "date_to": dates[-1]}
    requests = {
        "metrics": (
            f"/api-data/v1/project/{project['id']}/daily-metrics",
            {"from": dates[0], "to": dates[-1], "includeBySource": "true"},
        ),
        "summary": (f"/api-data/v1/project/{project['id']}/ai-summary", date_query),
        "events": (f"/api-data/v1/project/{project['id']}/project_events", date_query),
        "topics": (f"/api-data/v1/project/{project['id']}/topics", date_query),
        "insights": (f"/api-data/v1/project/{project['id']}/ai-insights", date_query),
    }

    payloads: Dict[str, Dict[str, Any]] = {}
    warnings: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=len(requests)) as pool:
        futures = [
            pool.submit(_briefing_feature_call, feature, path, api_key, query)
            for feature, (path, query) in requests.items()
        ]
        for future in as_completed(futures):
            feature, payload, warning = future.result()
            payloads[feature] = payload
            if warning:
                warnings.append(warning)

    if not payloads.get("metrics"):
        metrics_warning = next((warning for warning in warnings if warning["feature"] == "metrics"), None)
        raise HTTPException(
            status_code=502,
            detail=metrics_warning["message"] if metrics_warning else "Brand24 daily metrics are unavailable.",
        )

    metrics = _normalize_daily_metrics(payloads["metrics"], dates)
    summary_text = str(payloads.get("summary", {}).get("summary") or "").strip()
    summary_text = summary_text.replace("<br><br>", "\n\n").replace("<br>", "\n")

    event_payload = payloads.get("events", {})
    raw_events = event_payload.get("anomalies") if isinstance(event_payload.get("anomalies"), list) else []
    events = [
        {
            "date": str(item.get("anomaly_date", "")),
            "description": str(item.get("description", "")),
            "mentions": _whole_number(item.get("peak_mentions")),
            "reach": _whole_number(item.get("peak_reach")),
        }
        for item in raw_events
        if isinstance(item, dict)
    ]

    topic_payload = payloads.get("topics", {})
    raw_topics = topic_payload.get("topics") if isinstance(topic_payload.get("topics"), list) else []
    topics = [
        {
            "id": str(item.get("topic_id", index)),
            "name": str(item.get("topic_name") or "Untitled topic"),
            "description": str(item.get("description") or ""),
            "mentions": _whole_number(item.get("mentions")),
            "reach": _whole_number(item.get("reach")),
            "sentiment": item.get("sentiment") if isinstance(item.get("sentiment"), dict) else {},
            "shareOfVoice": _number(item.get("share_of_voice")),
        }
        for index, item in enumerate(raw_topics)
        if isinstance(item, dict)
    ]

    insights = _normalize_insights(payloads.get("insights", {}))
    return {
        "project": project,
        "dateRange": {"from": dates[0], "to": dates[-1], "days": days},
        "metrics": metrics,
        "summary": {"status": "ready" if summary_text else "empty", "text": summary_text},
        "events": {"status": _feature_state(events), "items": events},
        "topics": {
            "status": _feature_state(topics, str(topic_payload.get("status") or "")),
            "items": topics,
        },
        "insights": {"status": _feature_state(insights), "items": insights},
        "warnings": sorted(warnings, key=lambda warning: warning["feature"]),
    }


def _live_dashboard(project_id: str, api_key: str, brand: str, days: int) -> Dict[str, Any]:
    dates = _date_range(days)
    params = {"date_from": dates[0], "date_to": dates[-1]}

    mentions_count = _brand24_get(
        f"/api-data/v1/project/{project_id}/mentions/count",
        api_key,
        params,
    )
    sentiment = _brand24_get(
        f"/api-data/v1/project/{project_id}/mentions/sentiment",
        api_key,
        params,
    )
    reach = _brand24_get(
        f"/api-data/v1/project/{project_id}/mentions/reach",
        api_key,
        params,
    )
    topics = _brand24_get(f"/api-data/v1/project/{project_id}/topics", api_key, params)
    summary = _brand24_get(f"/api-data/v1/project/{project_id}/ai-summary", api_key, params)
    insights = _brand24_get(f"/api-data/v1/project/{project_id}/ai-insights", api_key, params)

    count_data = _envelope_payload(mentions_count)
    reach_data = _envelope_payload(reach)
    sentiment_data = _envelope_payload(sentiment)
    topics_data = _envelope_payload(topics)
    summary_data = _envelope_payload(summary)
    insights_data = _envelope_payload(insights)

    mention_counts = count_data.get("mentions_count", {})
    mentions_trend = [{"date": day, "mentions": mention_counts.get(day, 0)} for day in dates]

    social_reach = reach_data.get("social_media_reach", {})
    non_social_reach = reach_data.get("non_social_media_reach", {})
    reach_trend = [
        {
            "date": day,
            "reach": social_reach.get(day, 0) + non_social_reach.get(day, 0),
        }
        for day in dates
    ]

    positive_mentions = sentiment_data.get("positive_mentions", {})
    negative_mentions = sentiment_data.get("negative_mentions", {})
    total_mentions = sentiment_data.get("mentions", mention_counts)
    sentiment_trend = []
    for day in dates:
        positive_day = positive_mentions.get(day, 0)
        negative_day = negative_mentions.get(day, 0)
        total_day = total_mentions.get(day, 0)
        sentiment_trend.append(
            {
                "date": day,
                "positive": positive_day,
                "negative": negative_day,
                "neutral": max(total_day - positive_day - negative_day, 0),
            }
        )

    positive = sum(item["positive"] for item in sentiment_trend)
    negative = sum(item["negative"] for item in sentiment_trend)

    return {
        "mode": "live",
        "brand": brand,
        "dateRange": {"from": dates[0], "to": dates[-1], "days": days},
        "kpis": {
            "mentions": count_data.get("total", sum(item["mentions"] for item in mentions_trend)),
            "reach": reach_data.get(
                "total",
                reach_data.get("social_media_reach_total", 0) + reach_data.get("non_social_media_reach_total", 0),
            ),
            "sentimentScore": round(((positive - negative) / max(positive + negative, 1)) * 100),
            "shareOfVoice": None,
            "engagementLift": None,
        },
        "mentionsTrend": mentions_trend,
        "sentimentTrend": sentiment_trend,
        "reachTrend": reach_trend,
        "sources": [],
        "topics": topics_data.get("topics", []),
        "hashtags": [],
        "links": [],
        "aiSummary": summary_data.get("summary", ""),
        "insights": [
            value
            for value in [
                insights_data.get("headline"),
                insights_data.get("trends"),
                insights_data.get("insights"),
                insights_data.get("recommendations"),
            ]
            if value
        ],
        "hotHours": [],
    }


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/projects")
def projects(
    request: Request,
    refresh: bool = Query(False),
) -> Dict[str, Any]:
    _check_rate_limit("monitors_read", _client_id(request))
    project_list = _brand24_projects(force_refresh=refresh)
    return {
        "projects": project_list,
        "source": "brand24",
        "syncedAt": int(time()),
    }


@app.get("/api/projects/{project_id}/briefing")
def project_briefing(
    project_id: str,
    request: Request,
    days: int = Query(7, ge=1, le=31),
) -> Dict[str, Any]:
    _check_rate_limit("dashboard", _client_id(request))
    project = next((item for item in _brand24_projects() if item["id"] == project_id), None)
    if not project:
        raise HTTPException(status_code=404, detail="Project is not available in the connected Brand24 account.")

    return _cached_dashboard(
        f"briefing:{project_id}:{days}",
        lambda: _live_briefing(project, days),
    )


@app.post("/api/projects")
def create_project(payload: ProjectCreate, request: Request) -> Dict[str, Any]:
    global _projects_cache

    _check_rate_limit("monitors_create", _client_id(request))
    _brand24_credentials()
    created = _create_brand24_project(payload)
    if created["mode"] != "live":
        raise HTTPException(status_code=503, detail="Brand24 project creation is unavailable.")

    _projects_cache = None
    projects_after_creation = _brand24_projects(force_refresh=True)
    project = next(
        (item for item in projects_after_creation if item["id"] == created["projectId"]),
        {"id": created["projectId"], "name": payload.projectName},
    )
    return {
        "project": project,
        "configuration": {
            "language": payload.language,
            "keywords": created["keywords"],
        },
    }


@app.get("/api/dashboard")
def dashboard(
    request: Request,
    brand: str = Query("Acme", min_length=1),
    days: int = Query(30, ge=7, le=31),
    project_id: Optional[str] = Query(None),
) -> Dict[str, Any]:
    _check_rate_limit("dashboard", _client_id(request))

    api_key = os.getenv("BRAND24_API_KEY")
    selected_project_id = project_id or os.getenv("BRAND24_PROJECT_ID")

    if api_key and selected_project_id and not selected_project_id.startswith("mock-"):
        return _cached_dashboard(
            f"live:{selected_project_id}:{brand}:{days}",
            lambda: _live_dashboard(project_id=selected_project_id, api_key=api_key, brand=brand, days=days),
        )

    return _cached_dashboard(f"mock:{brand}:{days}", lambda: _mock_dashboard(brand=brand, days=days))


@app.get("/api/monitors")
def monitors(request: Request) -> Dict[str, Any]:
    _check_rate_limit("monitors_read", _client_id(request))
    return {"monitors": _read_monitors()}


@app.post("/api/monitors")
def create_monitor(payload: MonitorCreate, request: Request) -> Dict[str, Any]:
    _check_rate_limit("monitors_create", _client_id(request))
    project = _create_brand24_project(payload)
    monitors = _read_monitors()
    monitor = {
        "id": uuid4().hex,
        "customerName": payload.customerName,
        "projectName": payload.projectName,
        "brand24ProjectId": project["projectId"],
        "mode": project["mode"],
        "language": payload.language,
        "keywords": project["keywords"],
        "createdAt": date.today().isoformat(),
    }

    monitors.insert(0, monitor)
    _write_monitors(monitors)

    return {"monitor": monitor}
