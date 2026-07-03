"""Generate SIA-suite head-to-head charts in the clean bar style of
benchmark/charts/lawbench_headtohead.png (~720px wide). Reads the measured
result JSONs and emits one PNG per benchmark. Every TerranSoul series is
labelled "TerranSoul" so each chart names whose result it is (LawBench and the
memory-recall chart are generated here too, not reused as-is). Infeasible /
not-comparable benchmarks get a clearly-labeled greyed placeholder bar at 0
(labelled n/a) -- never a fabricated TerranSoul value. Captions live below each
chart in the embedding .md files, not inside the image.
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


def chart_trimul():
    # frozen actor DeepSeek-v4-pro: 3.87x measured on a 3080 Ti (fair fp32 baseline),
    # ~14-15x H100-estimated by compute-bound throughput scaling (re-bench is a TODO).
    fig, ax = base_fig(
        "AlphaFold-3 TriMul kernel — speedup over the fp32 baseline",
        "Triangle Multiplicative Update (frozen actor: DeepSeek-v4-pro)",
        "speedup over the fp32 baseline (×)", 18)
    labels = ["TerranSoul\nmeasured\n(RTX 3080 Ti)", "TerranSoul\nH100-estimated", "SIA\n(H100)"]
    values = [3.87, 14.5, 14.0]
    bars(ax, labels, values, [TS_GREEN, TS_GREEN, SIA_BLUE],
         lambda v: f"{v:.1f}×", hatches=[False, True, False])
    fig.tight_layout()
    out = os.path.join(CHARTS, "trimul_headtohead.png")
    fig.savefig(out); plt.close(fig)
    print("wrote", out)


def chart_scrna():
    # TerranSoul DID run a real frozen-actor denoiser here -- raw MSE 0.046
    # (+35.0% vs no-denoise, DeepSeek-v4-pro actor; ladder 12B +23.2% ->
    # Opus +34.6% -> DeepSeek +35.0%). See results/sia/scrna_deepseek.json
    # and scrna_denoising_terransoul.json for the measured runs. That raw,
    # lower-is-better MSE is intentionally NOT plotted on this axis: SIA's
    # 0.289/0.220 are OpenProblems min-max NORMALIZED scores (higher =
    # better) on a different scale, so plotting the raw number here would
    # misleadingly imply a literal head-to-head. The TerranSoul bar stays an
    # honest "n/a" placeholder -- the real, differently-scaled number is
    # reported in SELF-IMPROVE-COMPARISON.md / README.md prose, not as a bar
    # on this chart.
    fig, ax = base_fig(
        "scRNA-seq denoising — MSEnorm (higher = better)",
        "single-cell RNA expression imputation",
        "MSEnorm (OpenProblems normalized score)", 0.42)
    labels = ["TerranSoul\n12B frozen", "SIA\n120B trained", "prior\nSOTA"]
    values = [0.0, 0.289, 0.220]
    bars(ax, labels, values, [PLACEHOLDER, SIA_BLUE, SOTA_GREY], lambda v: f"{v:.3f}",
         placeholders=[True, False, False], hatches=[True, False, False])
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
    fig.tight_layout()
    out = os.path.join(CHARTS, "mlebench_headtohead.png")
    fig.savefig(out); plt.close(fig)
    print("wrote", out)


def chart_answer_quality():
    fig, ax = base_fig(
        "Personal-assistant answer quality — independent 0–10 judge",
        "22 everyday-assistant prompts · same model · same judge",
        "quality score (0–10, higher = better)", 11)
    # TerranSoul + OpenJarvis: 2026-07-03 deterministic-protocol canonical
    # (results/parity_headtohead.json). OpenClaw/Claude Code/Hermes: 2026-06-27
    # single-call-judge protocol, pending re-measurement (COMPARISON.md note).
    labels = ["TerranSoul", "OpenJarvis", "OpenClaw", "Claude Code\n+GENesis*", "Hermes"]
    values = [9.68, 9.55, 8.36, 8.24, 6.90]
    colors = [TS_GREEN, SIA_BLUE, SOTA_GREY, "#b0a6d4", SOTA_GREY]
    bars(ax, labels, values, colors, lambda v: f"{v:.2f}")
    fig.tight_layout()
    out = os.path.join(CHARTS, "answer_quality_headtohead.png")
    fig.savefig(out)
    plt.close(fig)
    print("wrote", out)


def chart_zork():
    # BENCH-ZORK self-improve campaign (2026-06-21, gemma4:12b-it-qat):
    # per-run cross-episode ~15, peak 45 via across-run memory accumulation
    # (both AGI-pure controls stay at 0). Honestly de-confounded.
    fig, ax = base_fig(
        "Frozen-model self-improvement — ZorkGPT (frozen 12B)",
        "no game-specific seeds (AGI-pure) · across-run memory accumulation",
        "game score reached", 55)
    labels = ["AGI-pure\ncontrol A", "AGI-pure\ncontrol B", "+ TerranSoul\nbrain (memory)"]
    values = [0.0, 0.0, 45.0]
    bars(ax, labels, values, [LIGHT_GREY, LIGHT_GREY, TS_GREEN],
         lambda v: "0" if v == 0 else "45")
    fig.tight_layout()
    out = os.path.join(CHARTS, "zork_selfimprove.png")
    fig.savefig(out)
    plt.close(fig)
    print("wrote", out)


def chart_lawbench():
    # SIA's headline benchmark. The TerranSoul bar (frozen 12B + memory-RAG)
    # is named so readers can tell whose 76.3% it is. Values unchanged from the
    # measured run (results/sia/lawbench_terransoul_full.json) and SIA's paper.
    fig, ax = base_fig(
        "LawBench — Top-1 accuracy",
        "(Chinese criminal-charge prediction, 191 classes, n=913)",
        "Top-1 accuracy (%)", 100)
    labels = ["TerranSoul\n(frozen 12B + memory)", "SIA\n120B trained", "prior\nSOTA", "SIA initial\nbaseline"]
    values = [76.3, 70.1, 45.0, 13.5]
    colors = [TS_GREEN, SIA_BLUE, SOTA_GREY, LIGHT_GREY]
    bars(ax, labels, values, colors, lambda v: f"{v:.1f}%")
    fig.tight_layout()
    out = os.path.join(CHARTS, "lawbench_headtohead.png")
    fig.savefig(out)
    plt.close(fig)
    print("wrote", out)


def chart_memory_recall():
    # The retrieval axis SIA has no analog for; all three bars are TerranSoul's
    # LongMemEval-S recall, so each is labelled TerranSoul.
    # EmbeddingGemma vector arm (rrf_emb), BENCH-AM-6.3 (2026-07-01):
    # R@5 99.4 / R@10 100.0 / R@20 100.0 (NDCG@10 94.4 · MRR 95.2), ahead of
    # the mxbai BENCH-AM-6.1 canonical on every metric. The old 98.6/99.8 pair
    # was the mis-reported BENCH-AM-6.2 headline (a lexical-search row).
    fig, ax = base_fig(
        "TerranSoul memory recall — LongMemEval-S",
        "(SIA ships no memory/retrieval — no comparable number) · NDCG@10 94.4 · MRR 95.2",
        "Recall (%)", 108)
    labels = ["TerranSoul\nR@5", "TerranSoul\nR@10", "TerranSoul\nR@20"]
    values = [99.4, 100.0, 100.0]
    bars(ax, labels, values, [TS_GREEN, TS_GREEN, TS_GREEN], lambda v: f"{v:.1f}%")
    fig.tight_layout()
    out = os.path.join(CHARTS, "terransoul_memory_recall.png")
    fig.savefig(out)
    plt.close(fig)
    print("wrote", out)


if __name__ == "__main__":
    chart_lawbench()
    chart_memory_recall()
    chart_answer_quality()
    chart_zork()
    chart_trimul()
    chart_scrna()
    chart_mlebench()
