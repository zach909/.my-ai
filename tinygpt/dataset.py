"""Dataset loading and preprocessing for TinyGPT."""

import json
from pathlib import Path
from typing import List, Optional, Tuple, Union

import torch
from torch.utils.data import Dataset

from tokenizer import Tokenizer


class MarkdownDataset(Dataset):
    """Dataset for loading Markdown files."""

    def __init__(
        self,
        file_paths: List[Union[str, Path]],
        tokenizer: Tokenizer,
        context_length: int = 1024,
        stride: int = 256,
    ):
        """Initialize Markdown dataset.

        Args:
            file_paths: List of .md file paths.
            tokenizer: Tokenizer instance.
            context_length: Max sequence length.
            stride: Stride for sliding window (for data augmentation).
        """
        self.tokenizer = tokenizer
        self.context_length = context_length
        self.stride = stride
        self.examples = []

        # Load and tokenize all files
        all_text = ""
        for file_path in file_paths:
            with open(file_path, "r", encoding="utf-8") as f:
                all_text += f.read() + "\n"

        # Tokenize entire corpus
        tokens = self.tokenizer.encode(all_text, add_special_tokens=False)

        # Create sliding window examples
        for i in range(0, len(tokens) - context_length, stride):
            self.examples.append(tokens[i : i + context_length + 1])

    def __len__(self) -> int:
        """Get dataset size."""
        return len(self.examples)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        """Get a single example.

        Args:
            idx: Example index.

        Returns:
            Tuple of (input_ids, labels). Labels are shifted by 1.
        """
        example = self.examples[idx]
        input_ids = torch.tensor(example[:-1], dtype=torch.long)
        labels = torch.tensor(example[1:], dtype=torch.long)
        return input_ids, labels


class ChatDataset(Dataset):
    """Dataset for supervised fine-tuning on chat data."""

    def __init__(
        self,
        json_path: Union[str, Path],
        tokenizer: Tokenizer,
        context_length: int = 1024,
    ):
        """Initialize chat dataset from JSON.

        Args:
            json_path: Path to JSON file with chat data.
            tokenizer: Tokenizer instance.
            context_length: Max sequence length.

        Expected JSON format:
            [{"user": "...", "assistant": "..."}, ...]
        """
        self.tokenizer = tokenizer
        self.context_length = context_length
        self.examples = []

        # Load JSON
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Convert to prompt-completion pairs
        for item in data:
            user_text = item.get("user", "")
            assistant_text = item.get("assistant", "")
            full_text = f"User: {user_text}\nAssistant: {assistant_text}"

            tokens = self.tokenizer.encode(full_text, add_special_tokens=True)

            # Truncate or pad to context_length
            if len(tokens) > context_length + 1:
                tokens = tokens[: context_length + 1]
            elif len(tokens) < context_length + 1:
                pad_token = self.tokenizer.pad_id
                tokens.extend([pad_token] * (context_length + 1 - len(tokens)))

            self.examples.append(tokens)

    def __len__(self) -> int:
        """Get dataset size."""
        return len(self.examples)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        """Get a single example.

        Args:
            idx: Example index.

        Returns:
            Tuple of (input_ids, labels). Labels are shifted by 1.
        """
        example = self.examples[idx]
        input_ids = torch.tensor(example[:-1], dtype=torch.long)
        labels = torch.tensor(example[1:], dtype=torch.long)
        return input_ids, labels


def create_train_val_split(
    file_paths: List[Union[str, Path]],
    tokenizer: Tokenizer,
    val_split: float = 0.1,
    context_length: int = 1024,
) -> Tuple[MarkdownDataset, MarkdownDataset]:
    """Create train/validation split from Markdown files.

    Args:
        file_paths: List of .md file paths.
        tokenizer: Tokenizer instance.
        val_split: Fraction for validation set (0.1 = 10%).
        context_length: Max sequence length.

    Returns:
        Tuple of (train_dataset, val_dataset).
    """
    full_dataset = MarkdownDataset(file_paths, tokenizer, context_length)
    val_size = int(len(full_dataset) * val_split)
    train_size = len(full_dataset) - val_size

    train_examples = full_dataset.examples[:train_size]
    val_examples = full_dataset.examples[train_size:]

    # Create new dataset instances
    train_dataset = MarkdownDataset.__new__(MarkdownDataset)
    train_dataset.tokenizer = tokenizer
    train_dataset.context_length = context_length
    train_dataset.examples = train_examples

    val_dataset = MarkdownDataset.__new__(MarkdownDataset)
    val_dataset.tokenizer = tokenizer
    val_dataset.context_length = context_length
    val_dataset.examples = val_examples

    return train_dataset, val_dataset
