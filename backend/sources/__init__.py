"""Data enrichment sources for Prime Champs."""

from backend.sources.instagram import InstagramScraper
from backend.sources.onlyfans import OnlyFansScraper, check_athlete_onlyfans
from backend.sources.tiktok import TikTokScraper
from backend.sources.web_search import WebSearchScraper, WikipediaScraper, search_athlete_news, get_wikipedia_info

__all__ = [
    "InstagramScraper",
    "OnlyFansScraper",
    "check_athlete_onlyfans",
    "TikTokScraper",
    "WebSearchScraper",
    "WikipediaScraper",
    "search_athlete_news",
    "get_wikipedia_info",
    "MultiSourceEnricher",
]


class MultiSourceEnricher:
    """
    Enrich athlete data from multiple sources.

    Sources:
    - Instagram: Followers, engagement, bio, verified status, profile pic
    - OnlyFans: Check if already has account (disqualifier or shows interest)
    - TikTok: Cross-platform reach
    - Web Search: Recent news, achievements, talking points
    - Wikipedia: Bio, career stats, achievements
    """

    def __init__(self):
        self.instagram = InstagramScraper()
        self.onlyfans = OnlyFansScraper()
        self.tiktok = TikTokScraper()
        self.web_search = WebSearchScraper()
        self.wikipedia = WikipediaScraper()

    def enrich_athlete(
        self,
        name: str,
        instagram_handle: str = None,
        sport: str = None,
        include_sources: list = None
    ) -> dict:
        """
        Enrich athlete from all available sources.

        Args:
            name: Athlete's name
            instagram_handle: Instagram username (without @)
            sport: Sport category
            include_sources: List of sources to include, or None for all
                Options: 'instagram', 'onlyfans', 'tiktok', 'web', 'wikipedia'

        Returns:
            Dict with enrichment data from all sources
        """
        all_sources = ['instagram', 'onlyfans', 'tiktok', 'web', 'wikipedia']
        sources = include_sources or all_sources

        result = {
            "instagram": None,
            "onlyfans": None,
            "tiktok": None,
            "web_search": None,
            "wikipedia": None,
            "errors": [],
        }

        # Instagram
        if 'instagram' in sources and instagram_handle:
            try:
                result["instagram"] = self.instagram.scrape_profile(instagram_handle)
            except Exception as e:
                result["errors"].append(f"Instagram: {str(e)}")

        # OnlyFans check
        if 'onlyfans' in sources and instagram_handle:
            try:
                result["onlyfans"] = check_athlete_onlyfans(instagram_handle)
            except Exception as e:
                result["errors"].append(f"OnlyFans: {str(e)}")

        # TikTok (try same handle as Instagram)
        if 'tiktok' in sources and instagram_handle:
            try:
                result["tiktok"] = self.tiktok.scrape_profile(instagram_handle)
            except Exception as e:
                result["errors"].append(f"TikTok: {str(e)}")

        # Web search for news
        if 'web' in sources:
            try:
                result["web_search"] = self.web_search.search_athlete(name, sport or "")
            except Exception as e:
                result["errors"].append(f"Web search: {str(e)}")

        # Wikipedia
        if 'wikipedia' in sources:
            try:
                result["wikipedia"] = self.wikipedia.get_athlete_info(name)
            except Exception as e:
                result["errors"].append(f"Wikipedia: {str(e)}")

        return result

    def quick_enrich(self, instagram_handle: str) -> dict:
        """
        Quick enrichment - just Instagram + OnlyFans check.

        This is faster and cheaper for initial screening.
        """
        return self.enrich_athlete(
            name="",
            instagram_handle=instagram_handle,
            include_sources=['instagram', 'onlyfans']
        )

    def full_enrich(self, name: str, instagram_handle: str, sport: str) -> dict:
        """
        Full enrichment from all sources.

        Use this for high-priority leads before outreach.
        """
        return self.enrich_athlete(
            name=name,
            instagram_handle=instagram_handle,
            sport=sport,
            include_sources=None  # All sources
        )
