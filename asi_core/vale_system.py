"""
Background Value (Vale) System - Complete Reference Implementation

Vale is a strictly zero-sum scalar assigned to every neuron in the mesh.
It represents accumulated "stability capital": neurons that hold a large
share of vale change slowly (they are treated as consolidated, trustworthy
knowledge), while neurons holding little vale are free to change quickly
(they are treated as raw plastic capacity available for new learning).

Because the total amount of vale in the system is fixed, no neuron can gain
stability without an equal amount of plasticity capacity being released
somewhere else. This document/module treats that constraint as an
invariant, not a guideline: every operation that touches vale is defined in
terms of a single conserving primitive (`_apply_conserving`) that either
preserves the system-wide (or transfer-local) sum exactly, or reports the
shortfall when the bounds make exact conservation impossible.

See docs/VALE_SYSTEM.md for the full mathematical specification. This
module is the executable counterpart of that document; the two are kept in
sync deliberately -- section headers below mirror section headers there.
"""

import math
import random
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple, Union


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class ValeError(Exception):
    """Base class for vale-system errors."""


class ValeConfigError(ValeError):
    """Raised when a ValeConfig describes an infeasible system."""


class ValeInvariantError(ValeError):
    """Raised when the zero-sum or bounds invariant has been violated."""


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------

class DonorPolicy(Enum):
    """How a donor set shares the burden of giving up vale."""
    PROPORTIONAL = "proportional"       # give proportional to current vale ("wealth tax")
    UNIFORM = "uniform"                 # give equal absolute amounts
    INVERSE_UTILITY = "inverse_utility"  # least-useful neurons give first


class RecipientPolicy(Enum):
    """How a recipient set shares an incoming amount of vale."""
    PROPORTIONAL_HEADROOM = "proportional_headroom"  # more room -> more received
    UNIFORM = "uniform"                              # equal absolute amounts
    UTILITY_WEIGHTED = "utility_weighted"             # most-useful neurons receive first


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class ValeConfig:
    """
    Static configuration for a ValeSystem.

    v_min / v_max bound every individual neuron's vale. v_total is the
    conserved system-wide sum. Feasibility requires
    n_neurons * v_min <= v_total <= n_neurons * v_max; this is validated
    at construction time (see "Edge cases").
    """
    n_neurons: int
    v_min: float = 0.01
    v_max: float = 0.99
    v_total: Optional[float] = None          # default: n_neurons * 0.5 * (v_min+v_max)... see below
    v_init: Optional[float] = None           # default: v_total / n_neurons (uniform init)
    init_jitter: float = 0.0                 # optional Gaussian jitter std-dev at init

    # Learning-equation parameters
    utility_learning_rate: float = 0.02      # eta_v: how fast utility differences move vale
    utility_ema_decay: float = 0.98          # smoothing of raw per-tick utility signals
    plasticity_gamma: float = 1.0            # shape of the plasticity(v) curve

    # Long-term stability parameters
    relax_rate: float = 0.002                # eta_r: pull toward target distribution per tick
    target_distribution: Optional[Callable[[int], List[float]]] = None  # n -> target vale vector
    freeze_threshold: float = 0.97           # fraction of v_max considered "frozen"
    max_frozen_fraction: float = 0.25        # hard ceiling on frozen-neuron fraction
    renormalize_every: int = 500             # ticks between float-drift correction passes

    epsilon: float = 1e-9

    def __post_init__(self):
        if self.n_neurons < 1:
            raise ValeConfigError("n_neurons must be >= 1")
        if not (0.0 <= self.v_min < self.v_max):
            raise ValeConfigError("require 0 <= v_min < v_max")
        if self.v_total is None:
            self.v_total = self.n_neurons * 0.5 * (self.v_min + self.v_max)
        if self.v_init is None:
            self.v_init = self.v_total / self.n_neurons
        lo = self.n_neurons * self.v_min
        hi = self.n_neurons * self.v_max
        if not (lo - self.epsilon <= self.v_total <= hi + self.epsilon):
            raise ValeConfigError(
                f"v_total={self.v_total} infeasible for n={self.n_neurons} "
                f"neurons with bounds [{self.v_min}, {self.v_max}] "
                f"(feasible range is [{lo}, {hi}])"
            )
        if not (self.v_min - self.epsilon <= self.v_init <= self.v_max + self.epsilon):
            raise ValeConfigError("v_init must lie within [v_min, v_max]")


# ---------------------------------------------------------------------------
# Core system
# ---------------------------------------------------------------------------

class ValeSystem:
    """
    Manages the zero-sum vale ledger for a population of neurons.

    Internal data structures
    -------------------------
    v[i]            : current vale of neuron i                 (list[float])
    utility_ema[i]  : smoothed utility signal driving redistribution
    activation_ema[i]: smoothed |activation| used as a fallback utility term
    age[i]          : number of ticks the neuron has existed
    frozen[i]        : derived, True when v[i] >= freeze_threshold * v_max
    tick            : global step counter
    _history        : bounded ring buffer of summary snapshots (diagnostics/tests)
    """

    def __init__(self, config: ValeConfig, seed: Optional[int] = None):
        self.cfg = config
        self._rng = random.Random(seed)

        n = config.n_neurons
        self.v: List[float] = self._initial_distribution(n)
        self.utility_ema: List[float] = [0.0] * n
        self.activation_ema: List[float] = [0.0] * n
        self.age: List[int] = [0] * n

        self.tick: int = 0
        self._history: deque = deque(maxlen=2000)
        self.last_shortfall: float = 0.0

        self._validate(strict=True)

    # -- initialization -----------------------------------------------------

    def _initial_distribution(self, n: int) -> List[float]:
        """
        Uniform initialization with optional bounded Gaussian jitter.
        Jitter is applied then re-balanced with the conserving primitive so
        v_total is exact even when init_jitter > 0 (see "Initialization").
        """
        base = [self.cfg.v_init] * n
        if self.cfg.init_jitter > 0 and n > 1:
            noise = [self._rng.gauss(0.0, self.cfg.init_jitter) for _ in range(n)]
            mean = sum(noise) / n
            desired = [x - mean for x in noise]  # mean-centered => zero-sum by construction
            self.v = list(base)
            self._apply_conserving(desired)
            return self.v
        return base

    # -- invariant checking ---------------------------------------------------

    def _validate(self, strict: bool = False) -> bool:
        total = sum(self.v)
        ok_total = abs(total - self.cfg.v_total) <= max(1e-6, 1e-9 * len(self.v))
        ok_bounds = all(self.cfg.v_min - 1e-9 <= x <= self.cfg.v_max + 1e-9 for x in self.v)
        if strict and not (ok_total and ok_bounds):
            raise ValeInvariantError(
                f"vale invariant violated: total={total} (expected {self.cfg.v_total}), "
                f"bounds_ok={ok_bounds}"
            )
        return ok_total and ok_bounds

    def validate_invariant(self) -> bool:
        """Public, non-raising check. Use `_validate(strict=True)` to raise."""
        return self._validate(strict=False)

    # -- the conserving primitive --------------------------------------------

    def _apply_conserving(
        self,
        desired: Union[Dict[int, float], List[float]],
        participants: Optional[Iterable[int]] = None,
    ) -> Tuple[Dict[int, float], float]:
        """
        Apply per-neuron deltas subject to [v_min, v_max], redistributing any
        clipping overflow across the remaining `participants` in proportion
        to their available headroom, iterating to convergence (water-filling).

        `desired` should sum to ~0 over `participants` for a true zero-sum
        transfer; the one intentional exception is drift renormalization,
        which injects a small non-zero net sum on purpose.

        Returns (actual_delta_per_index, unresolved_shortfall). A non-zero
        shortfall means the requested transfer could not be completed
        without violating a bound -- e.g. every donor was already at v_min.
        """
        idx = list(participants) if participants is not None else list(range(len(self.v)))
        if isinstance(desired, list):
            remaining = {i: desired[i] for i in idx if abs(desired[i]) > self.cfg.epsilon}
        else:
            remaining = {i: d for i, d in desired.items() if abs(d) > self.cfg.epsilon}

        actual: Dict[int, float] = {i: 0.0 for i in idx}
        max_rounds = len(idx) + 3

        for _ in range(max_rounds):
            if not remaining:
                break
            overflow = 0.0
            for i, d in list(remaining.items()):
                v_new = self.v[i] + d
                if v_new > self.cfg.v_max + self.cfg.epsilon:
                    clipped = self.cfg.v_max - self.v[i]
                    overflow += d - clipped
                    self.v[i] = self.cfg.v_max
                    actual[i] += clipped
                elif v_new < self.cfg.v_min - self.cfg.epsilon:
                    clipped = self.cfg.v_min - self.v[i]
                    overflow += d - clipped
                    self.v[i] = self.cfg.v_min
                    actual[i] += clipped
                else:
                    self.v[i] = v_new
                    actual[i] += d

            if abs(overflow) <= self.cfg.epsilon:
                remaining = {}
                break

            if overflow > 0:
                candidates = [i for i in idx if self.v[i] < self.cfg.v_max - self.cfg.epsilon]
                headroom = {i: self.cfg.v_max - self.v[i] for i in candidates}
            else:
                candidates = [i for i in idx if self.v[i] > self.cfg.v_min + self.cfg.epsilon]
                headroom = {i: self.v[i] - self.cfg.v_min for i in candidates}

            total_headroom = sum(headroom.values())
            if not candidates or total_headroom <= self.cfg.epsilon:
                self.last_shortfall = overflow
                return actual, overflow

            remaining = {
                i: overflow * (headroom[i] / total_headroom)
                for i in candidates
            }

        self.last_shortfall = 0.0
        return actual, 0.0

    # -- runtime update (the learning equation) -------------------------------

    def step(self, utility: Optional[Sequence[float]] = None, dt: float = 1.0) -> Dict:
        """
        Advance the vale ledger by one tick.

        1. Ingest/derive a utility signal u_i for every neuron and smooth it
           with an EMA.
        2. Apply the mean-centered redistribution update:
               delta_i = eta_v * dt * (u_i - mean(u))
           This is zero-sum *by construction*: sum(delta_i) == 0 exactly,
           because it is a deviation from the mean. Bound clipping is then
           reconciled by `_apply_conserving`.
        3. Apply a slow relaxation toward the configured target distribution
           to prevent runaway polarization (also mean-centered).
        4. Enforce the max-frozen-fraction safety valve.
        5. Periodically correct floating-point drift.
        """
        n = len(self.v)
        if n == 0:
            self.tick += 1
            return self.statistics()

        if utility is None:
            u_raw = self._fallback_utility()
        else:
            u_raw = self._sanitize(list(utility))

        decay = self.cfg.utility_ema_decay
        self.utility_ema = [
            decay * self.utility_ema[i] + (1 - decay) * u_raw[i] for i in range(n)
        ]

        u = self.utility_ema
        ubar = sum(u) / n
        desired = [self.cfg.utility_learning_rate * dt * (u[i] - ubar) for i in range(n)]
        self._apply_conserving(desired)

        if self.cfg.relax_rate > 0 and n > 1:
            target = self._target_distribution()
            relax = [self.cfg.relax_rate * dt * (target[i] - self.v[i]) for i in range(n)]
            rbar = sum(relax) / n
            relax = [r - rbar for r in relax]  # mean-center: guarantees zero-sum even if
            self._apply_conserving(relax)      # `target` doesn't sum to exactly v_total

        self._enforce_frozen_fraction()

        self.age = [a + 1 for a in self.age]
        self.tick += 1

        if self.cfg.renormalize_every and self.tick % self.cfg.renormalize_every == 0:
            self._renormalize()

        self._record_snapshot()
        return self.statistics()

    def record_activity(self, neuron_id: int, activation: float, contribution: float = 0.0):
        """
        Hook for external callers (learning systems, memory systems) to feed
        per-tick signals that inform the fallback utility function when an
        explicit utility vector isn't supplied to `step()`.
        `contribution` should be a signed estimate of how much this neuron's
        recent activity reduced (positive) or increased (negative) error.
        """
        decay = self.cfg.utility_ema_decay
        self.activation_ema[neuron_id] = (
            decay * self.activation_ema[neuron_id] + (1 - decay) * abs(activation)
        )
        # contribution folded directly into the utility EMA so it participates
        # in the very next step() even before the fallback path recomputes it
        self.utility_ema[neuron_id] = (
            decay * self.utility_ema[neuron_id] + (1 - decay) * contribution
        )

    def _fallback_utility(self) -> List[float]:
        """
        Utility signal used when the caller doesn't supply one explicitly.
        Rewards moderate, homeostatic activity (neither dead nor saturated)
        using the activation EMA collected via `record_activity`.
        """
        target = 0.3
        return [-(abs(a - target)) for a in self.activation_ema]

    @staticmethod
    def _sanitize(values: List[float]) -> List[float]:
        return [0.0 if (v is None or math.isnan(v) or math.isinf(v)) else v for v in values]

    def _target_distribution(self) -> List[float]:
        n = len(self.v)
        if self.cfg.target_distribution is not None:
            target = list(self.cfg.target_distribution(n))
            tsum = sum(target)
            if tsum > 0:
                scale = self.cfg.v_total / tsum
                target = [t * scale for t in target]
            return target
        return [self.cfg.v_total / n] * n

    def _enforce_frozen_fraction(self):
        """
        Safety valve ("forgetting prevention" cuts both ways): if too many
        neurons have frozen solid, the system loses its ability to learn
        anything new. Force-demote the least-useful frozen neurons back to
        v_init whenever the frozen fraction exceeds the configured ceiling.
        """
        n = len(self.v)
        if n == 0:
            return
        threshold = self.cfg.freeze_threshold * self.cfg.v_max
        frozen = [i for i in range(n) if self.v[i] >= threshold]
        max_frozen = int(self.cfg.max_frozen_fraction * n)
        if len(frozen) <= max_frozen:
            return
        frozen.sort(key=lambda i: self.utility_ema[i])  # least useful first
        excess = frozen[: len(frozen) - max_frozen]
        self.demote(excess, amount=sum(max(0.0, self.v[i] - self.cfg.v_init) for i in excess))

    def _renormalize(self):
        """
        Correct accumulated floating-point drift by nudging every neuron by
        an equal share of (v_total - sum(v)). This is the one place a
        non-mean-centered (net non-zero) delta is applied on purpose: its
        entire point is to restore sum(v) == v_total exactly.
        """
        drift = self.cfg.v_total - sum(self.v)
        if abs(drift) <= self.cfg.epsilon:
            return
        n = len(self.v)
        self._apply_conserving([drift / n] * n)
        # Any residual (all neurons saturated) is intentionally left as
        # last_shortfall for callers/tests to notice.

    def _record_snapshot(self):
        self._history.append({
            "tick": self.tick,
            "mean": sum(self.v) / len(self.v) if self.v else 0.0,
            "min": min(self.v) if self.v else 0.0,
            "max": max(self.v) if self.v else 0.0,
            "frozen": sum(1 for x in self.v if x >= self.cfg.freeze_threshold * self.cfg.v_max),
        })

    # -- promotion / demotion / transfer (explicit API) ------------------------

    def transfer(
        self,
        from_ids: Sequence[int],
        to_ids: Sequence[int],
        amount: float,
        donor_policy: DonorPolicy = DonorPolicy.PROPORTIONAL,
        recipient_policy: RecipientPolicy = RecipientPolicy.PROPORTIONAL_HEADROOM,
    ) -> float:
        """
        Move up to `amount` of vale from from_ids to to_ids, respecting
        bounds. Returns the amount actually transferred (<= amount; less
        only if donors or recipients ran out of headroom).

        Implemented as two independently-conserving water-fills of the same
        feasible amount T: T is withdrawn from `from_ids` (bounded by their
        combined headroom-down) and then deposited into `to_ids` (bounded by
        their combined headroom-up). Because both legs move exactly T, the
        system-wide sum is unaffected regardless of how each side
        internally distributes it -- donors are never asked to "give back"
        to cover a recipient-side shortfall, or vice versa.
        """
        if amount < 0:
            raise ValueError("amount must be >= 0")
        from_ids = list(dict.fromkeys(from_ids))
        to_ids = list(dict.fromkeys(to_ids))
        if not from_ids or not to_ids or amount == 0:
            return 0.0

        donor_capacity = sum(self.v[i] - self.cfg.v_min for i in from_ids)
        recip_capacity = sum(self.cfg.v_max - self.v[i] for i in to_ids)
        transferable = min(amount, donor_capacity, recip_capacity)
        if transferable <= self.cfg.epsilon:
            return 0.0

        donor_weights = self._weights(from_ids, donor_policy.value, donor=True)
        recip_weights = self._weights(to_ids, recipient_policy.value, donor=False)

        take_desired = {i: -transferable * donor_weights[i] for i in from_ids}
        self._apply_conserving(take_desired, participants=from_ids)

        give_desired = {i: transferable * recip_weights[i] for i in to_ids}
        self._apply_conserving(give_desired, participants=to_ids)

        return transferable

    def _weights(self, ids: Sequence[int], policy: str, donor: bool) -> Dict[int, float]:
        n = len(ids)
        if policy in ("uniform",):
            return {i: 1.0 / n for i in ids}
        if policy == "inverse_utility":
            raw = {i: 1.0 / (abs(self.utility_ema[i]) + 1e-6) for i in ids}
        elif policy == "utility_weighted":
            shifted = {i: self.utility_ema[i] - min(self.utility_ema[j] for j in ids) + 1e-6 for i in ids}
            raw = shifted
        else:  # proportional (vale) for donors, proportional headroom for recipients
            if donor:
                raw = {i: self.v[i] for i in ids}
            else:
                raw = {i: (self.cfg.v_max - self.v[i]) for i in ids}
        total = sum(raw.values())
        if total <= self.cfg.epsilon:
            return {i: 1.0 / n for i in ids}
        return {i: raw[i] / total for i in ids}

    def promote(
        self,
        neuron_ids: Sequence[int],
        amount: float,
        donors: Optional[Sequence[int]] = None,
        donor_policy: DonorPolicy = DonorPolicy.PROPORTIONAL,
    ) -> float:
        """Raise stability of `neuron_ids`, funded by `donors` (default: everyone else)."""
        neuron_set = set(neuron_ids)
        donors = list(donors) if donors is not None else [
            i for i in range(len(self.v)) if i not in neuron_set
        ]
        if not donors:
            return 0.0
        return self.transfer(donors, list(neuron_ids), amount, donor_policy=donor_policy)

    def demote(
        self,
        neuron_ids: Sequence[int],
        amount: float,
        recipients: Optional[Sequence[int]] = None,
        recipient_policy: RecipientPolicy = RecipientPolicy.PROPORTIONAL_HEADROOM,
    ) -> float:
        """Lower stability of `neuron_ids`, releasing capital to `recipients` (default: everyone else)."""
        neuron_set = set(neuron_ids)
        recipients = list(recipients) if recipients is not None else [
            i for i in range(len(self.v)) if i not in neuron_set
        ]
        if not recipients:
            return 0.0
        return self.transfer(list(neuron_ids), recipients, amount, recipient_policy=recipient_policy)

    def protect(self, neuron_ids: Sequence[int], target: Optional[float] = None) -> float:
        """
        Convenience for memory consolidation: push neurons close to v_max
        (default target = freeze_threshold * v_max).
        """
        target = target if target is not None else self.cfg.freeze_threshold * self.cfg.v_max
        amount = sum(max(0.0, target - self.v[i]) for i in neuron_ids)
        return self.promote(list(neuron_ids), amount)

    def release(self, neuron_ids: Sequence[int]) -> float:
        """Convenience: return neurons to v_init, releasing their capital back to the pool."""
        amount = sum(max(0.0, self.v[i] - self.cfg.v_init) for i in neuron_ids)
        return self.demote(list(neuron_ids), amount)

    # -- plasticity / learning-rate interface -----------------------------------

    def plasticity(self, neuron_id: int) -> float:
        """
        Plasticity multiplier in [0, 1]: 1.0 at v_min (fully plastic), 0.0 at
        v_max (fully stable). Shape controlled by `plasticity_gamma`.
        """
        span = self.cfg.v_max - self.cfg.v_min
        if span <= 0:
            return 0.0
        frac = (self.cfg.v_max - self.v[neuron_id]) / span
        frac = min(1.0, max(0.0, frac))
        return frac ** self.cfg.plasticity_gamma

    def effective_learning_rate(self, neuron_id: int, base_lr: float) -> float:
        return base_lr * self.plasticity(neuron_id)

    def consolidation_penalty(self, neuron_id: int, weight: float, anchor: float, lam: float) -> float:
        """
        Elastic-weight-consolidation-style penalty gradient that anchors a
        weight to `anchor` (its value when the owning neuron was last
        promoted/protected) in proportion to the neuron's current vale.
        Subtract this from a weight update to resist forgetting.
        """
        return lam * self.v[neuron_id] * (weight - anchor)

    def is_frozen(self, neuron_id: int) -> bool:
        return self.v[neuron_id] >= self.cfg.freeze_threshold * self.cfg.v_max

    # -- population changes -------------------------------------------------

    def add_neurons(self, count: int, policy: str = "rescale") -> List[int]:
        """
        Grow the population by `count` neurons.

        policy="rescale" (default): existing neurons fund the new neurons'
            v_init out of the *existing* pool -- the pre-growth v_total is
            preserved exactly, it is simply re-partitioned across more
            neurons (each existing neuron ends up holding a little less).
        policy="grow": v_total increases by count * v_init; the system gains
            fresh capital rather than redistributing existing capital.
            Documented as the one deliberate exception to strict
            conservation -- use only when neurogenesis should not cost
            existing neurons anything.
        """
        if count <= 0:
            raise ValueError("count must be > 0")
        n_old = len(self.v)
        new_ids = list(range(n_old, n_old + count))
        self.utility_ema.extend([0.0] * count)
        self.activation_ema.extend([0.0] * count)
        self.age.extend([0] * count)

        if policy == "grow":
            self.cfg.v_total += count * self.cfg.v_init
            self.v.extend([self.cfg.v_init] * count)
        elif policy == "rescale":
            # New neurons must land at >= v_min immediately, which is itself
            # real capital; bump v_total to match the append so the
            # invariant holds mid-operation, then have existing neurons buy
            # the new neurons up from v_min to v_init via a normal transfer
            # (which conserves this now-current v_total exactly).
            self.cfg.v_total += count * self.cfg.v_min
            self.v.extend([self.cfg.v_min] * count)
            topup = count * (self.cfg.v_init - self.cfg.v_min)
            donors = list(range(n_old))
            if topup > 0 and donors:
                self.transfer(donors, new_ids, topup)
        else:
            raise ValueError(f"unknown policy: {policy}")

        self._validate(strict=True)
        return new_ids

    def remove_neurons(self, neuron_ids: Sequence[int]):
        """
        Remove neurons and return their vale to the remaining population
        (spread proportional to headroom). v_total shrinks by their
        contribution's worth only if headroom is insufficient to fully
        absorb it (recorded as last_shortfall); otherwise v_total is
        adjusted downward by exactly the removed neurons' vale so the
        invariant among *remaining* neurons stays exact.
        """
        remove_set = set(neuron_ids)
        keep = [i for i in range(len(self.v)) if i not in remove_set]
        if not keep:
            self.v, self.utility_ema, self.activation_ema, self.age = [], [], [], []
            self.cfg.v_total = 0.0
            return

        freed = sum(self.v[i] for i in remove_set)

        new_v = [self.v[i] for i in keep]
        new_u = [self.utility_ema[i] for i in keep]
        new_a = [self.activation_ema[i] for i in keep]
        new_age = [self.age[i] for i in keep]

        self.v, self.utility_ema, self.activation_ema, self.age = new_v, new_u, new_a, new_age

        headroom = {i: self.cfg.v_max - self.v[i] for i in range(len(self.v))}
        total_headroom = sum(headroom.values())
        if total_headroom > self.cfg.epsilon:
            distribute = min(freed, total_headroom)
            desired = [distribute * (headroom[i] / total_headroom) for i in range(len(self.v))]
            self._apply_conserving(desired)
            self.cfg.v_total = self.cfg.v_total - freed + distribute
        else:
            self.cfg.v_total -= freed

        self._validate(strict=True)

    # -- persistence ----------------------------------------------------------

    def to_dict(self) -> Dict:
        return {
            "config": {
                "n_neurons": len(self.v),
                "v_min": self.cfg.v_min,
                "v_max": self.cfg.v_max,
                "v_total": self.cfg.v_total,
                "utility_learning_rate": self.cfg.utility_learning_rate,
                "utility_ema_decay": self.cfg.utility_ema_decay,
                "plasticity_gamma": self.cfg.plasticity_gamma,
                "relax_rate": self.cfg.relax_rate,
                "freeze_threshold": self.cfg.freeze_threshold,
                "max_frozen_fraction": self.cfg.max_frozen_fraction,
                "renormalize_every": self.cfg.renormalize_every,
            },
            "v": list(self.v),
            "utility_ema": list(self.utility_ema),
            "activation_ema": list(self.activation_ema),
            "age": list(self.age),
            "tick": self.tick,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "ValeSystem":
        cfg_data = dict(data["config"])
        cfg = ValeConfig(**cfg_data)
        obj = cls.__new__(cls)
        obj.cfg = cfg
        obj._rng = random.Random()
        obj.v = list(data["v"])
        obj.utility_ema = list(data["utility_ema"])
        obj.activation_ema = list(data["activation_ema"])
        obj.age = list(data["age"])
        obj.tick = data.get("tick", 0)
        obj._history = deque(maxlen=2000)
        obj.last_shortfall = 0.0
        obj._validate(strict=True)
        return obj

    # -- diagnostics ------------------------------------------------------------

    def statistics(self) -> Dict:
        n = len(self.v)
        if n == 0:
            return {"n": 0, "tick": self.tick}
        mean = sum(self.v) / n
        variance = sum((x - mean) ** 2 for x in self.v) / n
        frozen_count = sum(1 for i in range(n) if self.is_frozen(i))
        return {
            "n": n,
            "tick": self.tick,
            "v_total": sum(self.v),
            "v_total_target": self.cfg.v_total,
            "mean": mean,
            "std": math.sqrt(variance),
            "min": min(self.v),
            "max": max(self.v),
            "frozen_count": frozen_count,
            "frozen_fraction": frozen_count / n,
            "last_shortfall": self.last_shortfall,
        }

    def history(self) -> List[Dict]:
        return list(self._history)


__all__ = [
    "ValeSystem",
    "ValeConfig",
    "DonorPolicy",
    "RecipientPolicy",
    "ValeError",
    "ValeConfigError",
    "ValeInvariantError",
]
