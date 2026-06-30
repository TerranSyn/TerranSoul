"""Generate SIA-suite head-to-head charts in the clean bar style of
benchmark/charts/lawbench_headtohead.png (~720px wide). Reads the measured
result JSONs and emits one PNG per benchmark. The LawBench chart already exists
and is reused as-is (not regenerated). Infeasible / not-comparable benchmarks
get a clearly-labeled greyed placeholder bar at 0 with an annotation -- never a
fabricated TerranSoul value.
"""
import json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "..", "results", "sia")
CHARTS = os.path.join(HERE, "..", "..", "charts")
os.makedirs(CHARTS, exist_ok=True)

TS_GREEN = "#2e9e5b"
SIA_BLUE = "#4878cf"
SOTA_GREY = "#9e9e9e"
LIGHT_GREY = "#d0d0d0"
PLACEHOLDER = "#cfd2d6"


def load(name):
    p = os.path.join(RES, name)
    return json.load(open(p)) if os.path.exists(p) else None


def base_fig(title, subtitle, ylabel, ymax):
    fig, ax = plt.subplots(figsize=(7.2, 4.0), dpi=100)
    ax.set_title(f"{title}\n{subtitle}", fontsize=12, fontweight="bold")
    ax.set_ylabel(ylabel, fontsize=10)
    ax.set_ylim(0, ymax)
    ax.grid(axis="y", color="#e6e6e6", linewidth=0.9)
    ax.set_axisbelow(True)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    return fig, ax


def bars(ax, labels, values, colors, fmt, placeholders=None, hatches=None):
    x = range(len(labels))
    placeholders = placeholders or [False] * len(labels)
    for i, (v, c, ph) in enumerate(zip(values, colors, placeholders)):
        h = "//" if (hatches and hatches[i]) else None
        ax.bar(i, v, width=0.62, color=c, edgecolor="#7a7d82" if ph else "none",
               hatch=h, linewidth=1.0 if ph else 0)
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=9.5)
    ymax = ax.get_ylim()[1]
    for i, v in enumerate(values):
        txt = "n/a" if placeholders[i] else fmt(v)
        ax.text(i, v + ymax * 0.02, txt, ha="center", va="bottom",
                fontsize=10.5, fontweight="bold",
                color="#7a7d82" if placeholders[i] else "black")


def annotate(ax, text):
    ax.text(0.5, 0.93, text, transform=ax.transAxes, ha="center", va="top",
            fontsize=8.2, color="#333", style="italic",
            bbox=dict(boxstyle="round,pad=0.4", fc="#f4f5f7", ec="#cfd2d6", lw=0.8))


def chart_trimul():
    d = load("trimul_terransoul.json")
    su = d.get("speedup") if d else None
    ran = bool(d and d.get("any_correct") and su)
    fig, ax = base_fig(
        "AlphaFold-3 TriMul kernel — speedup over baseline",
        "Triangle Multiplicative Update (lower latency = higher speedup)",
        "speedup vs each system's own baseline (×)", max(18, (su or 1) * 1.3))
    labels = ["TerranSoul\n12B frozen\n(RTX 3080 Ti)", "SIA\n120B trained\n(H100)", "baseline"]
    if ran:
        values = [su, 14.0, 1.0]
        bars(ax, labels, values, [TS_GREEN, SIA_BLUE, LIGHT_GREY], lambda v: f"{v:.2f}×")
        annotate(ax, f"TerranSoul: frozen 12B agent, best correct kernel {d['best_latency_ms']} ms "
                     f"vs {d['reference_latency_ms']} ms fp32 ref (rel-err {d['best_rel_err']:.1e}).\n"
                     f"Different hardware/method from SIA's H100 Triton run — each ÷ its own baseline.")
    else:
        values = [0.0, 14.0, 1.0]
        bars(ax, labels, values, [PLACEHOLDER, SIA_BLUE, LIGHT_GREY], lambda v: f"{v:.2f}×",
             placeholders=[True, False, False], hatches=[True, False, False])
        annotate(ax, "TerranSoul: frozen 12B produced no correct kernel faster than the reference "
                     "within budget.")
    fig.tight_layout()
    out = os.path.join(CHARTS, "trimul_headtohead.png")
    fig.savefig(out); plt.close(fig)
    print("wrote", out, "| ran:", ran, "| speedup:", su)


def chart_scrna():
    d = load("scrna_denoising_terransoul.json")
    fig, ax = base_fig(
        "scRNA-seq denoising — MSEnorm (higher = better)",
        "single-cell RNA expression imputation",
        "MSEnorm (OpenProblems normalized score)", 0.42)
    labels = ["TerranSoul\n12B frozen", "SIA\n120B trained", "prior\nSOTA"]
    values = [0.0, 0.289, 0.220]
    bars(ax, labels, values, [PLACEHOLDER, SIA_BLUE, SOTA_GREY], lambda v: f"{v:.3f}",
         placeholders=[True, False, False], hatches=[True, False, False])
    if d and d.get("any_correct"):
        annotate(ax, f"TerranSoul DID run a real denoiser (frozen 12B; PBMC3k, molecular-CV): raw MSE "
                     f"{d['best_mse']} ({d['improvement_pct_vs_baseline']:+.1f}% vs no-denoise).\n"
                     f"Not on SIA's OpenProblems NORMALIZED scale — no comparable bar drawn.")
    else:
        annotate(ax, "TerranSoul not run on SIA's normalized scale (off-domain dataset/harness).")
    fig.tight_layout()
    out = os.path.join(CHARTS, "scrna_denoising_headtohead.png")
    fig.savefig(out); plt.close(fig)
    print("wrote", out)


def chart_mlebench():
    fig, ax = base_fig(
        "OpenAI MLE-Bench Hard — benchmark attempted",
        "real Kaggle ML-pipeline competitions (SIA ranks #1)",
        "completed full benchmark run", 1.7)
    labels = ["TerranSoul\n12B frozen", "SIA\n120B trained"]
    values = [0.0, 1.0]
    bars(ax, labels, values, [PLACEHOLDER, SIA_BLUE],
         lambda v: "#1" if v >= 1 else "", placeholders=[True, False], hatches=[True, False])
    ax.set_yticks([])
    annotate(ax, "TerranSoul not run: requires the MLE-Bench harness + Kaggle credentials,\n"
                 "tens of GB of competition data, and multi-hour containerized GPU runs.\n"
                 "(Docker is present; the Kaggle data/harness/compute budget is not.)")
    fig.tight_layout()
    out = os.path.join(CHARTS, "mlebench_headtohead.png")
    fig.savefig(out); plt.close(fig)
    print("wrote", out)


if __name__ == "__main__":
    chart_trimul()
    chart_scrna()
    chart_mlebench()
    print("LawBench chart reused as-is:", os.path.join(CHARTS, "lawbench_headtohead.png"))
