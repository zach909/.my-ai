"""
Endurance training harness for OneBrain (asi_core.UnifiedBrain).

Constructs a single UnifiedBrain and drives it through a long-running
perceive() conversation across a curriculum of synthetic tasks spanning
every expert domain, periodically consolidating experience into permanent
skills (self_improve), pruning memory so the run stays bounded no matter
how long it goes (maintain), and checkpointing the brain's full backup()
state so a run can be paused and resumed instead of starting over.

Usage:

    python3 -m asi_core.endurance_training --cycles 20000 \\
        --checkpoint /tmp/onebrain.checkpoint.json \\
        --report /tmp/onebrain.report.json

    # Resume a previous run and keep going:
    python3 -m asi_core.endurance_training --cycles 20000 \\
        --resume-from /tmp/onebrain.checkpoint.json \\
        --checkpoint /tmp/onebrain.checkpoint.json
"""

from __future__ import annotations

import argparse
import json
import os
import random
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from .unified_brain import CycleResult, Introspection, UnifiedBrain, create_brain

DEFAULT_EXPERT_NAMES = [
    "coding", "language", "reasoning", "research",
    "math", "vision", "audio", "control",
]


# -- Task curriculum -------------------------------------------------------

@dataclass
class Task:
    """One recurring 'task' the brain is given during a session.

    ``input_fn`` produces a fresh input vector of length ``n_input`` on
    every call (a noisy variant of the task's canonical pattern, so the
    same task is recognizable but never bit-identical). ``reward_fn``
    produces the reward *given to* perceive() for that cycle -- computed
    up front (not from the CycleResult perceive() itself will produce),
    since perceive() takes reward as an input that drives that same
    cycle's plasticity and can only be called once per cycle.
    """
    name: str
    domain: str
    input_fn: Callable[[random.Random, int], List[float]]
    reward_fn: Callable[[random.Random], float]


def _reward_around(low: float, high: float) -> Callable[[random.Random], float]:
    def _gen(rng: random.Random) -> float:
        return rng.uniform(low, high)
    return _gen


def _noisy_pattern(pattern: List[float], noise: float) -> Callable[[random.Random, int], List[float]]:
    def _gen(rng: random.Random, n_input: int) -> List[float]:
        vals = [pattern[i % len(pattern)] for i in range(n_input)]
        return [max(-1.0, min(1.0, v + rng.uniform(-noise, noise))) for v in vals]
    return _gen


def build_task_library(expert_names: Optional[List[str]] = None) -> List[Task]:
    """Two recurring task variants per expert domain: a 'core' pattern the
    brain sees often (a candidate for self-improvement promotion) and a
    'novel' variant that's noisier and rarer, so a session always has both
    reinforcement and genuinely new material to react to."""
    names = expert_names or DEFAULT_EXPERT_NAMES
    tasks: List[Task] = []
    for i, domain in enumerate(names):
        anchor = (i + 1) / (len(names) + 1)
        core_pattern = [anchor, -anchor, anchor * 0.5, -anchor * 0.5]
        tasks.append(Task(
            name=f"{domain}.core",
            domain=domain,
            input_fn=_noisy_pattern(core_pattern, noise=0.05),
            # High, consistent reward: repeated exposure is meant to
            # strengthen this pattern's memory trace past self_improve()'s
            # min_strength and get it promoted to a permanent skill.
            reward_fn=_reward_around(0.75, 0.95),
        ))
        tasks.append(Task(
            name=f"{domain}.novel",
            domain=domain,
            input_fn=_noisy_pattern([-anchor, anchor, 0.0, anchor], noise=0.35),
            # Wider, sometimes-low reward: a harder, less-rehearsed task
            # that occasionally dips below mistake_reward_threshold so the
            # mistake tracker has real (if infrequent) material to log.
            reward_fn=_reward_around(0.15, 0.75),
        ))
    return tasks


# -- Reporting --------------------------------------------------------------

@dataclass
class TaskStats:
    count: int = 0
    reward_ema: float = 0.0
    last_reward: float = 0.0


@dataclass
class EnduranceReport:
    total_cycles: int = 0
    total_wall_seconds: float = 0.0
    stopped_reason: str = "not_started"
    skills_created: List[str] = field(default_factory=list)
    extensions_created: List[str] = field(default_factory=list)
    checkpoints_written: int = 0
    mistakes_logged: int = 0
    mistakes_repeated: int = 0
    vale_invariant_ok: bool = True
    task_stats: Dict[str, TaskStats] = field(default_factory=dict)
    introspection_history: List[Dict] = field(default_factory=list)
    final_introspection: Optional[Dict] = None

    @property
    def cycles_per_second(self) -> float:
        if self.total_wall_seconds <= 0:
            return 0.0
        return self.total_cycles / self.total_wall_seconds

    def to_dict(self) -> Dict:
        return {
            "total_cycles": self.total_cycles,
            "total_wall_seconds": self.total_wall_seconds,
            "cycles_per_second": self.cycles_per_second,
            "stopped_reason": self.stopped_reason,
            "skills_created": self.skills_created,
            "extensions_created": self.extensions_created,
            "checkpoints_written": self.checkpoints_written,
            "mistakes_logged": self.mistakes_logged,
            "mistakes_repeated": self.mistakes_repeated,
            "vale_invariant_ok": self.vale_invariant_ok,
            "task_stats": {
                name: {"count": s.count, "reward_ema": s.reward_ema, "last_reward": s.last_reward}
                for name, s in self.task_stats.items()
            },
            "introspection_history": self.introspection_history,
            "final_introspection": self.final_introspection,
        }


def _introspection_to_dict(intro: Introspection) -> Dict:
    return {
        "average_vale": intro.average_vale,
        "average_surprise": intro.average_surprise,
        "memory_size": intro.memory_size,
        "active_skills": intro.active_skills,
        "active_experts": intro.active_experts,
        "removal_candidates": intro.removal_candidates,
    }


# -- Trainer ------------------------------------------------------------

class EnduranceTrainer:
    """Drives one UnifiedBrain through a long training session.

    A session is a loop of perceive() cycles ("talk to it") drawn from a
    task curriculum ("give it tasks"), interleaved with self_improve()
    ("train it") and maintain() calls that keep memory bounded so the
    session can run indefinitely ("very long endurance") without the
    brain's state growing without limit. Checkpointing via backup()/
    restore() lets a session be resumed instead of starting from scratch.
    """

    def __init__(
        self,
        brain: UnifiedBrain,
        tasks: Optional[List[Task]] = None,
        seed: Optional[int] = 7,
    ):
        self.brain = brain
        self.tasks = tasks if tasks is not None else build_task_library()
        self.rng = random.Random(seed)
        self.report = EnduranceReport()

    def _checkpoint(self, path: str) -> None:
        payload = self.brain.backup()
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w") as f:
            json.dump(payload, f)
        os.replace(tmp_path, path)
        self.report.checkpoints_written += 1

    def run(
        self,
        max_cycles: Optional[int] = None,
        max_seconds: Optional[float] = None,
        checkpoint_every: int = 500,
        checkpoint_path: Optional[str] = None,
        introspect_every: int = 200,
        introspect_history_limit: int = 200,
        self_improve_every: int = 25,
        maintain_every: int = 50,
        min_strength: float = 1.5,
        on_progress: Optional[Callable[[int, CycleResult], None]] = None,
    ) -> EnduranceReport:
        if max_cycles is None and max_seconds is None:
            raise ValueError("run() needs at least one of max_cycles/max_seconds")

        start = time.monotonic()
        cycle = 0
        stopped_reason = "max_cycles"
        try:
            while True:
                if max_cycles is not None and cycle >= max_cycles:
                    stopped_reason = "max_cycles"
                    break
                if max_seconds is not None and (time.monotonic() - start) >= max_seconds:
                    stopped_reason = "max_seconds"
                    break

                task = self.rng.choice(self.tasks)
                input_vector = task.input_fn(self.rng, self.brain.mesh.n_input)
                reward = task.reward_fn(self.rng)
                result = self.brain.perceive(input_vector, reward=reward)

                stats = self.report.task_stats.setdefault(task.name, TaskStats())
                stats.count += 1
                stats.last_reward = reward
                decay = 0.95
                stats.reward_ema = decay * stats.reward_ema + (1 - decay) * reward

                cycle += 1

                if self_improve_every and cycle % self_improve_every == 0:
                    created = self.brain.self_improve(min_strength=min_strength)
                    self.report.skills_created.extend(created)

                if maintain_every and cycle % maintain_every == 0:
                    maint = self.brain.maintain()
                    if not maint["vale_invariant_ok"]:
                        self.report.vale_invariant_ok = False

                if introspect_every and cycle % introspect_every == 0:
                    snap = _introspection_to_dict(self.brain.introspect())
                    snap["cycle"] = cycle
                    self.report.introspection_history.append(snap)
                    if len(self.report.introspection_history) > introspect_history_limit:
                        self.report.introspection_history.pop(0)

                if checkpoint_path and checkpoint_every and cycle % checkpoint_every == 0:
                    self._checkpoint(checkpoint_path)

                if on_progress is not None:
                    on_progress(cycle, result)
        except KeyboardInterrupt:
            stopped_reason = "keyboard_interrupt"

        self.report.total_cycles = cycle
        self.report.total_wall_seconds = time.monotonic() - start
        self.report.stopped_reason = stopped_reason
        self.report.mistakes_logged = len(self.brain.mistakes.records)
        self.report.mistakes_repeated = sum(
            1 for r in self.brain.mistakes.records.values() if r.occurrences > 1
        )
        self.report.final_introspection = _introspection_to_dict(self.brain.introspect())

        if checkpoint_path:
            self._checkpoint(checkpoint_path)

        return self.report

    def bundle_extension(self, name: str, purpose: str) -> Optional[str]:
        """Package everything self_improve() has promoted so far into a
        named Extension. Returns the extension name, or None if no skills
        have been learned yet (nothing to bundle)."""
        if not self.brain._pattern_skills:
            return None
        ext = self.brain.create_extension(name, purpose=purpose)
        self.report.extensions_created.append(ext.name)
        return ext.name


# -- CLI ---------------------------------------------------------------

def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default="default", choices=["tiny", "small", "default", "large", "massive"])
    parser.add_argument("--cycles", type=int, default=None, help="Stop after this many perceive() cycles.")
    parser.add_argument("--seconds", type=float, default=None, help="Stop after this many wall-clock seconds.")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--checkpoint", default=None, help="Path to periodically write brain.backup() to.")
    parser.add_argument("--checkpoint-every", type=int, default=500)
    parser.add_argument("--resume-from", default=None, help="Path to a previous --checkpoint file to restore from.")
    parser.add_argument("--report", default=None, help="Path to write the final EnduranceReport JSON to.")
    parser.add_argument("--self-improve-every", type=int, default=25)
    parser.add_argument("--maintain-every", type=int, default=50)
    parser.add_argument("--introspect-every", type=int, default=200)
    parser.add_argument("--min-strength", type=float, default=1.5)
    parser.add_argument("--bundle-extension", default=None, help="Name to bundle learned skills into as an Extension.")
    parser.add_argument(
        "--parallel-workers", type=int, default=0,
        help="Distribute each settle tick's per-neuron update across this many "
             "subprocesses once the mesh has enough active neurons to be worth "
             "it (see NeuralMesh's class docstring). 0 (default) is the "
             "original single-process behavior; most useful with --config "
             "massive or a custom UnifiedBrain built with a large n_neurons.",
    )
    parser.add_argument("--quiet", action="store_true")
    return parser


def main(argv: Optional[List[str]] = None) -> EnduranceReport:
    args = _build_arg_parser().parse_args(argv)
    if args.cycles is None and args.seconds is None:
        args.cycles = 5000

    brain = create_brain(args.config, expert_names=DEFAULT_EXPERT_NAMES, parallel_workers=args.parallel_workers)
    try:
        if args.resume_from:
            with open(args.resume_from) as f:
                brain.restore(json.load(f))

        trainer = EnduranceTrainer(brain, seed=args.seed)

        def _progress(cycle: int, result: CycleResult) -> None:
            if not args.quiet and cycle % max(1, (args.introspect_every or 200)) == 0:
                print(f"[cycle {cycle}] avg_vale={result.average_vale:.3f} "
                      f"skills={len(result.active_skills)} experts={result.active_experts}")

        report = trainer.run(
            max_cycles=args.cycles,
            max_seconds=args.seconds,
            checkpoint_every=args.checkpoint_every,
            checkpoint_path=args.checkpoint,
            introspect_every=args.introspect_every,
            self_improve_every=args.self_improve_every,
            maintain_every=args.maintain_every,
            min_strength=args.min_strength,
            on_progress=_progress,
        )

        if args.bundle_extension:
            trainer.bundle_extension(args.bundle_extension, purpose="Endurance training session output")

        if not args.quiet:
            print(f"\nStopped: {report.stopped_reason}")
            print(f"Cycles: {report.total_cycles} in {report.total_wall_seconds:.1f}s "
                  f"({report.cycles_per_second:.1f}/s)")
            print(f"Skills learned: {len(report.skills_created)}")
            print(f"Extensions created: {report.extensions_created}")
            print(f"Vale invariant held throughout: {report.vale_invariant_ok}")

        if args.report:
            with open(args.report, "w") as f:
                json.dump(report.to_dict(), f, indent=2)

        return report
    finally:
        brain.close()


if __name__ == "__main__":
    main()
