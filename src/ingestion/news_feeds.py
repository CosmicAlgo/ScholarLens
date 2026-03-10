"""
News feed client for HackerNews and DZone RSS aggregation.
"""
import requests
import logging
from typing import List, Dict
from datetime import datetime

class NewsFeedClient:
    """Aggregates tech news from HackerNews and DZone."""
    
    HN_BASE = "https://hacker-news.firebaseio.com/v0"
    DZONE_FEEDS = {
        "home": "http://feeds.dzone.com/home",
        "java": "http://feeds.dzone.com/java",
        "devops": "http://feeds.dzone.com/devops",
        "ai-ml": "http://feeds.dzone.com/ai-ml",
        "cloud": "http://feeds.dzone.com/cloud",
        "webdev": "http://feeds.dzone.com/webdev"
    }
    
    def get_hackernews_top(self, limit: int = 15) -> List[Dict]:
        """
        Fetch top stories from HackerNews.
        Returns list of {title, url, score, comments, time_ago, author}.
        """
        stories = []
        
        try:
            # Get top story IDs
            resp = requests.get(f"{self.HN_BASE}/topstories.json", timeout=10)
            if resp.status_code != 200:
                return []
            
            story_ids = resp.json()[:limit]
            
            # Fetch each story
            for sid in story_ids:
                try:
                    item_resp = requests.get(f"{self.HN_BASE}/item/{sid}.json", timeout=5)
                    if item_resp.status_code == 200:
                        item = item_resp.json()
                        if item and item.get("type") == "story":
                            stories.append({
                                "id": sid,
                                "title": item.get("title", ""),
                                "url": item.get("url", f"https://news.ycombinator.com/item?id={sid}"),
                                "score": item.get("score", 0),
                                "comments": len(item.get("kids", [])),
                                "author": item.get("by", "unknown"),
                                "time_ago": self._time_ago(item.get("time", 0)),
                                "source": "HackerNews"
                            })
                except Exception:
                    continue
                    
        except Exception as e:
            logging.error(f"HackerNews fetch failed: {e}")
        
        return stories
    
    def get_dzone_feed(self, zone: str = "home", limit: int = 10) -> List[Dict]:
        """
        Fetch articles from DZone RSS feed.
        Returns list of {title, url, summary, zone, published}.
        """
        articles = []
        
        try:
            import feedparser
        except ImportError:
            logging.error("feedparser not installed. Run: pip install feedparser")
            return []
        
        feed_url = self.DZONE_FEEDS.get(zone, self.DZONE_FEEDS["home"])
        
        try:
            feed = feedparser.parse(feed_url)
            
            for entry in feed.entries[:limit]:
                articles.append({
                    "title": entry.get("title", ""),
                    "url": entry.get("link", ""),
                    "summary": self._clean_summary(entry.get("summary", "")),
                    "zone": zone.upper(),
                    "published": entry.get("published", ""),
                    "time_ago": self._parse_time_ago(entry.get("published_parsed")),
                    "source": "DZone"
                })
                
        except Exception as e:
            logging.error(f"DZone RSS fetch failed: {e}")
        
        return articles
    
    def get_all_feeds(self, hn_limit: int = 10, dzone_limit: int = 10) -> Dict:
        """
        Fetch from all sources at once.
        Returns {hackernews: [...], dzone: [...]}.
        """
        return {
            "hackernews": self.get_hackernews_top(hn_limit),
            "dzone": self.get_dzone_feed("home", dzone_limit)
        }
    
    def _time_ago(self, unix_time: int) -> str:
        """Convert Unix timestamp to 'X hours ago' format."""
        if not unix_time:
            return "unknown"
        
        now = datetime.now().timestamp()
        diff = now - unix_time
        
        if diff < 3600:
            mins = int(diff / 60)
            return f"{mins}m ago"
        elif diff < 86400:
            hours = int(diff / 3600)
            return f"{hours}h ago"
        else:
            days = int(diff / 86400)
            return f"{days}d ago"
    
    def _parse_time_ago(self, time_struct) -> str:
        """Convert feedparser time struct to 'X hours ago'."""
        if not time_struct:
            return "recently"
        
        try:
            from time import mktime
            published_ts = mktime(time_struct)
            return self._time_ago(int(published_ts))
        except:
            return "recently"
    
    def _clean_summary(self, html_summary: str) -> str:
        """Strip HTML tags from summary."""
        import re
        clean = re.sub(r'<[^>]+>', '', html_summary)
        return clean[:200] + "..." if len(clean) > 200 else clean
