"""Tests for the zero-sum Value System in neurolang.py.

Guards the spec's Value System invariants (design doc, "Value System"):

  * higher-value neuron changes less easily; lower-value neuron changes more
    (plasticity == 1 - vale, and expected_change grows as value drops / input
    rises);
  * reinforcing a neuron is zero-sum — the total value across the mesh is
    conserved when a neuron is rewarded or punished;
  * a punished neuron becomes more plastic; a rewarded neuron becomes less so;
  * clamping to [0, 1] never leaks or invents value.

Run with: python3 test_value_system.py   (pure-stdlib except torch, which
neurolang.py already requires — no external APIs).
"""
from neurolang import NeuroRuntime


def check(cond, msg):
    print(f"{'ok  ' if cond else 'FAIL'} {msg}")
    if not cond:
        raise SystemExit(1)


def approx(a, b, tol=1e-6):
    return abs(a - b) <= tol


def build(vals):
    rt = NeuroRuntime()
    for name, v in vals.items():
        rt.declare(name)
        rt.set_vale(name, v)
    return rt


def test_plasticity_ranking():
    rt = build({"hi": 0.9, "lo": 0.2})
    hi, lo = rt.neurons["hi"], rt.neurons["lo"]
    check(lo.plasticity() > hi.plasticity(),
          "lower-value neuron is more plastic than higher-value neuron")
    # More input + lower value => greater change than less input + higher value.
    check(lo.expected_change(2.0) > hi.expected_change(0.5),
          "more input & lower value produces greater expected change")
    # For a fixed neuron, more input => at least as much change (tanh-monotone).
    check(lo.expected_change(3.0) >= lo.expected_change(1.0),
          "more input produces greater (or equal) change for a fixed neuron")


def test_reward_is_zero_sum():
    rt = build({"a": 0.5, "b": 0.5, "c": 0.5})
    before = rt.total_value()
    rt.reward("a", 0.8)
    check(approx(rt.total_value(), before), "total value conserved after a reward")
    rt.reward("b", -0.6)
    check(approx(rt.total_value(), before), "total value conserved after a punishment")
    check(rt.neurons["a"].vale.item() > 0.5, "positive reward raised the target's value")
    check(rt.neurons["b"].vale.item() < 0.5, "negative reward lowered the target's value")


def test_punish_increases_plasticity():
    rt = build({"x": 0.7, "y": 0.5, "z": 0.5})
    p0 = rt.neurons["x"].plasticity()
    for _ in range(3):                       # "repeatedly produces poor results"
        rt.reward("x", -1.0)
    check(rt.neurons["x"].plasticity() > p0,
          "repeated poor results make the neuron more plastic")


def test_clamp_conserves_value():
    # Target already near the ceiling; a big reward must not push total above the
    # conserved sum, and donors clamped at 0 must not create negative value.
    rt = build({"t": 0.95, "d1": 0.02, "d2": 0.02})
    before = rt.total_value()
    rt.reward("t", 1.0)                       # wants +0.2 but donors have ~0.04 to give
    total = rt.total_value()
    check(approx(total, before), "clamped redistribution still conserves total value")
    for nm, n in rt.neurons.items():
        v = n.vale.item()
        check(0.0 <= v <= 1.0, f"neuron {nm} value stays within [0, 1] (={v:.4f})")


def test_single_neuron_is_trivially_conserved():
    rt = build({"solo": 0.4})
    before = rt.total_value()
    rt.reward("solo", 0.9)                    # nothing to trade with
    check(approx(rt.total_value(), before), "a lone neuron's value is unchanged (conserved)")


def main():
    test_plasticity_ranking()
    test_reward_is_zero_sum()
    test_punish_increases_plasticity()
    test_clamp_conserves_value()
    test_single_neuron_is_trivially_conserved()
    print("\nAll value-system tests passed.")


if __name__ == "__main__":
    main()
