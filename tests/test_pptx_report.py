from io import BytesIO
from unittest import TestCase
from zipfile import ZipFile

from pptx import Presentation

from pptx_report import build_pptx_report


SAMPLE_DATASET = {
    "project": {"id": "demo", "name": "Demo Brand"},
    "dateRange": {"from": "2026-08-27", "to": "2026-09-02"},
    "metrics": {
        "totals": {
            "mentions": 1280,
            "reach": 2750000,
            "engagement": {"likes": 8400, "comments": 2100, "shares": 1300},
            "sentiment": {"positive": 490, "neutral": 610, "negative": 180},
        },
        "days": [
            {
                "date": f"2026-0{8 if day < 32 else 9}-{day if day < 32 else day - 31:02d}",
                "mentions": 100 + index * 24,
                "engagement": {"likes": 220 + index * 40, "comments": 60 + index * 8},
            }
            for index, day in enumerate(range(27, 34))
        ],
        "sources": [
            {"source": "news", "mentions": 540, "reach": 1200000},
            {"source": "twitter", "mentions": 360, "reach": 870000},
            {"source": "tiktok", "mentions": 240, "reach": 610000},
            {"source": "youtube", "mentions": 140, "reach": 70000},
        ],
    },
    "topics": {
        "items": [
            {"name": "Launch coverage", "shareOfVoice": 42.5, "description": "News and social discussion focused on the launch announcement."},
            {"name": "Customer response", "shareOfVoice": 31.0, "description": "Customers discussed product quality and availability."},
            {"name": "Market comparison", "shareOfVoice": 18.5, "description": "Commentary compared the launch with competing offers."},
        ]
    },
    "sources": {
        "domains": {"items": [{"domain": f"source-{i}.example", "mentions": 50 - i, "reach": 90000 - i * 5000} for i in range(6)]},
        "authors": {"items": [{"name": f"Author {i + 1}", "followers": 800000 - i * 70000, "reach": 45000 - i * 3000} for i in range(6)]},
        "links": {"items": [{"url": f"https://example.com/coverage/{i + 1}", "mentions": 12 - i} for i in range(6)]},
        "hashtags": {"items": [{"hashtag": f"#demo{i + 1}", "mentions": 90 - i * 7, "reach": 300000 - i * 18000} for i in range(8)]},
    },
    "mentions": {
        "items": [
            {"title": f"Representative coverage item {i + 1}", "content": "A concise excerpt showing how the story was framed for its audience.", "category": "news", "sentiment": ["positive", "neutral", "negative"][i], "host": "example.com", "date": "2026-09-01"}
            for i in range(3)
        ],
        "truncated": False,
        "limit": 10000,
    },
}


class PptxReportTests(TestCase):
    def test_generates_valid_editable_deck(self) -> None:
        content = build_pptx_report(
            SAMPLE_DATASET,
            {
                "language": "en",
                "reportTitle": "Media Intelligence Report",
                "organization": "Client Review",
                "sections": ["overview", "daily", "mentions", "sources", "topics", "authors", "links", "hashtags"],
            },
        )

        deck = Presentation(BytesIO(content))
        self.assertEqual(len(deck.slides), 10)
        self.assertGreater(len(content), 40_000)

        with ZipFile(BytesIO(content)) as archive:
            chart_files = [name for name in archive.namelist() if name.startswith("ppt/charts/chart") and name.endswith(".xml")]
            self.assertGreaterEqual(len(chart_files), 4)


if __name__ == "__main__":
    output = build_pptx_report(
        SAMPLE_DATASET,
        {
            "language": "en",
            "reportTitle": "Hosted PowerPoint Export Test",
            "organization": "Client Review",
            "sections": ["overview", "daily", "mentions", "sources", "topics", "authors", "links", "hashtags"],
        },
    )
    with open("outputs/hosted-powerpoint-export-test.pptx", "wb") as destination:
        destination.write(output)
