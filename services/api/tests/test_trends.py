import pytest

from scholarlens.trends import compute_trend

BASE = {y: 1_000_000 * (1.05 ** (y - 2015)) for y in range(2015, 2027)}  # science grows 5%/yr
BASELINE = {y: int(v) for y, v in BASE.items()}
NOW = 2026


def counts_with_share_growth(rate: float, start_share=100e-6) -> dict[int, int]:
    return {y: int(BASELINE[y] * start_share * ((1 + rate) ** (y - 2015))) for y in BASELINE}


def test_growth_is_measured_against_science_not_raw_counts():
    # Raw counts rise 5%/yr purely because all science does: that is "stable", not growth.
    counts = {y: int(BASELINE[y] * 100e-6) for y in BASELINE}
    t = compute_trend(counts, BASELINE, NOW)
    assert t.label == "stable"
    assert abs(t.annual_growth) < 0.01
    assert t.baseline_growth == pytest.approx(0.05, abs=0.005)


@pytest.mark.parametrize(
    "rate,label",
    [(0.40, "surging"), (0.15, "growing"), (0.0, "stable"), (-0.12, "cooling"), (-0.30, "declining")],
)
def test_labels(rate, label):
    t = compute_trend(counts_with_share_growth(rate), BASELINE, NOW)
    assert t.label == label
    assert t.annual_growth == pytest.approx(rate, abs=0.02)
    if rate != 0.0:  # a flat line has no variance to explain, so R² is meaningless there
        assert t.fit_r2 > 0.95


def test_current_year_is_partial_and_excluded():
    counts = counts_with_share_growth(0.15)
    counts[2026] = 5  # indexing lag makes the current year look like a crash
    t = compute_trend(counts, BASELINE, NOW)
    assert t.points[-1].partial
    assert t.label == "growing"


def test_peaked_topic():
    shares = [10, 30, 80, 150, 220, 260, 240, 190, 150, 120, 100, 90]
    counts = {y: int(BASELINE[y] * s * 1e-6 * 10) for y, s in zip(sorted(BASELINE), shares, strict=True)}
    t = compute_trend(counts, BASELINE, NOW)
    assert t.label == "peaked"
    assert t.peak_year == 2020


def test_insufficient_data():
    t = compute_trend({2024: 3, 2025: 4}, BASELINE, NOW)
    assert t.label == "insufficient_data"
    assert t.annual_growth is None


def test_empty_inputs_do_not_crash():
    assert compute_trend({}, {}, NOW).label == "insufficient_data"
