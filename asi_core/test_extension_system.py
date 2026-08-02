"""Tests for the Extension System (spec Part 3 sections 25-27)."""

import unittest

from asi_core.extension_system import ExtensionSystem, ExtensionStage, ExtensionError


class TestExtensionCreation(unittest.TestCase):
    def test_create_returns_extension_in_created_stage(self):
        system = ExtensionSystem()
        ext = system.create("coding", purpose="write and debug code", skills=["pattern_1", "pattern_2"])
        self.assertEqual(ext.stage, ExtensionStage.CREATED)
        self.assertEqual(ext.skills, ["pattern_1", "pattern_2"])

    def test_create_deduplicates_skills(self):
        system = ExtensionSystem()
        ext = system.create("coding", purpose="x", skills=["a", "a", "b"])
        self.assertEqual(ext.skills, ["a", "b"])

    def test_create_duplicate_name_raises(self):
        system = ExtensionSystem()
        system.create("coding", purpose="x")
        with self.assertRaises(ExtensionError):
            system.create("coding", purpose="y")


class TestExtensionLifecycle(unittest.TestCase):
    def test_default_test_requires_at_least_one_skill(self):
        system = ExtensionSystem()
        system.create("empty", purpose="x")
        self.assertFalse(system.test("empty"))
        self.assertEqual(system.get("empty").stage, ExtensionStage.FAILED)

        system.create("populated", purpose="x", skills=["a"])
        self.assertTrue(system.test("populated"))
        self.assertEqual(system.get("populated").stage, ExtensionStage.TESTED)

    def test_custom_test_function_is_used(self):
        system = ExtensionSystem()
        system.create("coding", purpose="x", skills=["a", "b"])
        passed = system.test("coding", test_fn=lambda ext: len(ext.skills) >= 5)
        self.assertFalse(passed)
        self.assertEqual(system.get("coding").stage, ExtensionStage.FAILED)

    def test_test_function_exception_marks_failed_not_raised(self):
        system = ExtensionSystem()
        system.create("coding", purpose="x", skills=["a"])

        def bad_test(ext):
            raise RuntimeError("boom")

        passed = system.test("coding", test_fn=bad_test)
        self.assertFalse(passed)
        self.assertEqual(system.get("coding").test_results["error"], "boom")

    def test_optimize_requires_tested_stage(self):
        system = ExtensionSystem()
        system.create("coding", purpose="x", skills=["a"])
        with self.assertRaises(ExtensionError):
            system.optimize("coding")

    def test_full_lifecycle_creation_to_quantization(self):
        system = ExtensionSystem()
        system.create("coding", purpose="x", skills=["a", "b"])
        self.assertTrue(system.test("coding"))
        system.optimize("coding")
        self.assertEqual(system.get("coding").stage, ExtensionStage.OPTIMIZED)
        system.quantize("coding")
        ext = system.get("coding")
        self.assertEqual(ext.stage, ExtensionStage.QUANTIZED)
        self.assertTrue(ext.quantized)

    def test_quantize_requires_optimized_stage(self):
        system = ExtensionSystem()
        system.create("coding", purpose="x", skills=["a"])
        system.test("coding")
        with self.assertRaises(ExtensionError):
            system.quantize("coding")


class TestExtensionMerge(unittest.TestCase):
    def test_merge_combines_skills_and_removes_source(self):
        system = ExtensionSystem()
        system.create("web", purpose="x", skills=["html", "css"])
        system.create("scripting", purpose="y", skills=["js", "css"])
        merged = system.merge("scripting", into="web")
        self.assertEqual(set(merged.skills), {"html", "css", "js"})
        self.assertIsNone(system.get("scripting"))


class TestExtensionQueries(unittest.TestCase):
    def test_list_by_stage(self):
        system = ExtensionSystem()
        system.create("a", purpose="x", skills=["s"])
        system.create("b", purpose="y")
        system.test("a")
        system.test("b")
        tested = system.list_by_stage(ExtensionStage.TESTED)
        failed = system.list_by_stage(ExtensionStage.FAILED)
        self.assertEqual([e.name for e in tested], ["a"])
        self.assertEqual([e.name for e in failed], ["b"])

    def test_remove_extension(self):
        system = ExtensionSystem()
        system.create("a", purpose="x")
        system.remove("a")
        self.assertIsNone(system.get("a"))

    def test_operating_on_missing_extension_raises(self):
        system = ExtensionSystem()
        with self.assertRaises(ExtensionError):
            system.test("nope")


if __name__ == "__main__":
    unittest.main()
