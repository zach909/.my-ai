"""Tests for the OneBrain endurance training harness."""

import json
import os
import tempfile
import unittest

from asi_core.endurance_training import (
    EnduranceTrainer,
    Task,
    _reward_around,
    build_task_library,
)
from asi_core.unified_brain import UnifiedBrain


def make_brain(**overrides):
    config = dict(n_neurons=16, n_dimensions=4, n_input=4, n_groups=2, hd_dimensions=64, seed=1)
    config.update(overrides)
    return UnifiedBrain(**config)


class TestTaskLibrary(unittest.TestCase):
    def test_two_tasks_per_expert_name(self):
        tasks = build_task_library(["coding", "language", "math"])
        self.assertEqual(len(tasks), 6)
        self.assertEqual({t.domain for t in tasks}, {"coding", "language", "math"})

    def test_input_fn_matches_requested_length(self):
        tasks = build_task_library(["coding"])
        import random
        rng = random.Random(0)
        for task in tasks:
            vec = task.input_fn(rng, 7)
            self.assertEqual(len(vec), 7)
            self.assertTrue(all(-1.0 <= v <= 1.0 for v in vec))


class TestEnduranceTrainerRun(unittest.TestCase):
    def test_run_requires_a_stop_condition(self):
        trainer = EnduranceTrainer(make_brain())
        with self.assertRaises(ValueError):
            trainer.run()

    def test_run_executes_requested_cycle_count(self):
        trainer = EnduranceTrainer(make_brain())
        report = trainer.run(max_cycles=40, self_improve_every=10, maintain_every=10, introspect_every=20)
        self.assertEqual(report.total_cycles, 40)
        self.assertEqual(report.stopped_reason, "max_cycles")
        self.assertGreater(report.total_wall_seconds, 0.0)

    def test_run_tracks_per_task_statistics(self):
        trainer = EnduranceTrainer(make_brain(), tasks=[
            Task(name="only.core", domain="only", input_fn=lambda rng, n: [0.1] * n, reward_fn=_reward_around(0.8, 0.9)),
        ])
        report = trainer.run(max_cycles=15, self_improve_every=0, maintain_every=0, introspect_every=0)
        self.assertIn("only.core", report.task_stats)
        self.assertEqual(report.task_stats["only.core"].count, 15)

    def test_vale_invariant_holds_across_a_run(self):
        trainer = EnduranceTrainer(make_brain(), tasks=build_task_library(["coding", "math"]))
        report = trainer.run(max_cycles=150, maintain_every=25)
        self.assertTrue(report.vale_invariant_ok)

    def test_repeated_high_reward_task_promotes_a_skill(self):
        # Mirrors the README's own self-improvement example: a pattern
        # seen often enough at high reward should get promoted by
        # self_improve(), which EnduranceTrainer calls periodically.
        steady_task = Task(
            name="steady.core", domain="steady",
            input_fn=lambda rng, n: [0.9] * n,
            reward_fn=_reward_around(0.95, 0.95),
        )
        trainer = EnduranceTrainer(make_brain(), tasks=[steady_task], seed=3)
        report = trainer.run(max_cycles=120, self_improve_every=10, min_strength=1.2)
        self.assertGreater(len(report.skills_created), 0)
        self.assertTrue(any(name in trainer.brain.skills for name in report.skills_created))

    def test_checkpoint_written_and_resumable(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "checkpoint.json")
            trainer = EnduranceTrainer(make_brain(seed=5))
            report = trainer.run(max_cycles=30, checkpoint_path=path, checkpoint_every=10)
            self.assertGreater(report.checkpoints_written, 0)
            self.assertTrue(os.path.exists(path))

            with open(path) as f:
                backup = json.load(f)

            resumed = make_brain(seed=5)
            resumed.restore(backup)
            self.assertAlmostEqual(
                sum(resumed.vale.v), sum(trainer.brain.vale.v), places=6
            )

    def test_bundle_extension_returns_none_with_no_skills_learned(self):
        trainer = EnduranceTrainer(make_brain(), tasks=build_task_library(["coding"]))
        trainer.run(max_cycles=5, self_improve_every=0)
        self.assertIsNone(trainer.bundle_extension("empty", purpose="nothing learned yet"))

    def test_bundle_extension_packages_learned_skills(self):
        steady_task = Task(
            name="steady.core", domain="steady",
            input_fn=lambda rng, n: [0.9] * n,
            reward_fn=_reward_around(0.95, 0.95),
        )
        trainer = EnduranceTrainer(make_brain(), tasks=[steady_task], seed=3)
        trainer.run(max_cycles=120, self_improve_every=10, min_strength=1.2)
        ext_name = trainer.bundle_extension("trained_bundle", purpose="test bundle")
        self.assertEqual(ext_name, "trained_bundle")
        self.assertEqual(trainer.report.extensions_created, ["trained_bundle"])


if __name__ == "__main__":
    unittest.main()
