from typing import List, Dict, Any

class ResearchMetrics:
    """
    Calculates advanced metrics for a given set of 'related' papers.
    """
    def __init__(self, related_papers: List[Dict[str, Any]]):
        self.papers = related_papers

    def calculate_saturation(self) -> str:
        """
        Determines if a topic is 'Saturated' based on volume.
        MVP Logic: >10 papers = Saturated, 5-10 = Mature, <5 = Emerging
        """
        count = len(self.papers)
        if count > 100:
            return "SATURATED (High Research Volume)"
        elif count > 50:
            return "MATURE (Established)"
        else:
            return "EMERGING (New / Niche)"

    def calculate_growth_trend(self) -> str:
        """
        Example logic: Compare last 3 years vs previous 3 years.
        """
        years = [p['year'] for p in self.papers if isinstance(p.get('year'), int)]
        if not years:
            return "Unknown"
            
        years.sort()
        latest_year = max(years)
        
        if len(years) < 5:
            return "Too few data points (Need 5+)"

        # 1. Determine "Recent" window (Last 3 Years)
        # Using 3.0 divisor for Rate calculation essentially
        split_year = latest_year - 3
        
        recent_years = [y for y in years if y >= split_year]
        old_years = [y for y in years if y < split_year]
        
        if not old_years:
             return "NEW / EMERGING (No prior history)"
             
        # 2. Calculate RATES (Papers per Year)
        # Avoid division by zero. 
        # Old span starts from min_year to split_year.
        min_year = min(years)
        old_span = max(1, split_year - min_year)
        
        # Recent span is fixed at ~4 years (inclusive) for simplicity or calculated
        recent_span = max(1, latest_year - split_year + 1)

        old_rate = len(old_years) / float(old_span)
        recent_rate = len(recent_years) / float(recent_span)
        
        # 3. Compare Rates
        # Must have significant recent volume (5+) to claim "Explosive"
        if recent_rate > (old_rate * 1.5) and len(recent_years) >= 10:
            return "EXPLOSIVE GROWTH (+++)"
        elif recent_rate > old_rate:
            return "STEADY GROWTH (+)"
        else:
            return "DECLINING / STABLE (-)"

    def get_summary(self) -> Dict[str, Any]:
        return {
            "total_papers": len(self.papers),
            "status": self.calculate_saturation(),
            "trend": self.calculate_growth_trend()
        }
