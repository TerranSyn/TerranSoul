"""Faithful reference implementation of the AlphaFold-3 / AlphaFold-2 style
Triangle Multiplicative Update ("outgoing edges"), used as the BASELINE for the
SIA-suite TriMul kernel benchmark.

The pair representation x has shape [B, N, N, D]. The update is:

    x  = LayerNorm_in(x)
    a  = (Wl @ x) * sigmoid(Wlg @ x) * mask          # left  projection + gate
    b  = (Wr @ x) * sigmoid(Wrg @ x) * mask          # right projection + gate
    o  = einsum('b i k d, b j k d -> b i j d', a, b) # the heavy triangle mult
    o  = LayerNorm_out(o)
    o  = (Wo @ o) * sigmoid(Wog @ x_in_normed)       # output projection + gate

All learnable tensors are kept in a plain dict so an optimized candidate can be
handed exactly the same weights for an apples-to-apples correctness check.
"""
from __future__ import annotations
import torch
import torch.nn.functional as F


def make_params(D: int, H: int, device, dtype=torch.float32, seed: int = 0):
    g = torch.Generator(device="cpu").manual_seed(seed)

    def lin(out_f, in_f, scale):
        w = (torch.randn(out_f, in_f, generator=g) * scale).to(device=device, dtype=dtype)
        b = (torch.randn(out_f, generator=g) * 0.02).to(device=device, dtype=dtype)
        return w, b

    p = {}
    p["norm_in_w"] = torch.ones(D, device=device, dtype=dtype)
    p["norm_in_b"] = torch.zeros(D, device=device, dtype=dtype)
    p["left_w"], p["left_b"] = lin(H, D, (1.0 / D) ** 0.5)
    p["right_w"], p["right_b"] = lin(H, D, (1.0 / D) ** 0.5)
    p["left_gate_w"], p["left_gate_b"] = lin(H, D, (1.0 / D) ** 0.5)
    p["right_gate_w"], p["right_gate_b"] = lin(H, D, (1.0 / D) ** 0.5)
    p["norm_out_w"] = torch.ones(H, device=device, dtype=dtype)
    p["norm_out_b"] = torch.zeros(H, device=device, dtype=dtype)
    p["out_w"], p["out_b"] = lin(D, H, (1.0 / H) ** 0.5)
    p["out_gate_w"], p["out_gate_b"] = lin(D, D, (1.0 / D) ** 0.5)
    return p


def reference_trimul(x: torch.Tensor, mask: torch.Tensor, p: dict) -> torch.Tensor:
    """Baseline reference. x:[B,N,N,D], mask:[B,N,N,1]."""
    xn = F.layer_norm(x, (x.shape[-1],), p["norm_in_w"], p["norm_in_b"])
    a = F.linear(xn, p["left_w"], p["left_b"]) * torch.sigmoid(
        F.linear(xn, p["left_gate_w"], p["left_gate_b"])
    ) * mask
    b = F.linear(xn, p["right_w"], p["right_b"]) * torch.sigmoid(
        F.linear(xn, p["right_gate_w"], p["right_gate_b"])
    ) * mask
    # The heavy triangle multiplication (sum over shared index k):
    o = torch.einsum("b i k d, b j k d -> b i j d", a, b)
    o = F.layer_norm(o, (o.shape[-1],), p["norm_out_w"], p["norm_out_b"])
    out_gate = torch.sigmoid(F.linear(xn, p["out_gate_w"], p["out_gate_b"]))
    o = F.linear(o, p["out_w"], p["out_b"]) * out_gate
    return o


def make_inputs(B: int, N: int, D: int, device, dtype=torch.float32, seed: int = 1):
    g = torch.Generator(device="cpu").manual_seed(seed)
    x = (torch.randn(B, N, N, D, generator=g)).to(device=device, dtype=dtype)
    mask = (torch.rand(B, N, N, 1, generator=g) > 0.1).to(device=device, dtype=dtype)
    return x, mask
