"""SentencePiece tokenizer wrapper for TinyGPT."""

import os
from pathlib import Path
from typing import List, Union

try:
    import sentencepiece as spm
except ImportError:
    raise ImportError("Install sentencepiece: pip install sentencepiece")

from config import TokenizerConfig


class Tokenizer:
    """SentencePiece tokenizer for TinyGPT."""

    def __init__(self, model_path: Union[str, Path]):
        """Initialize tokenizer from a trained SentencePiece model.

        Args:
            model_path: Path to the .model file.
        """
        self.model_path = Path(model_path)
        self.sp = spm.SentencePieceProcessor()
        self.sp.Load(str(self.model_path))

    @classmethod
    def train(
        cls,
        texts: List[str],
        output_dir: Union[str, Path] = "tokenizer",
        config: TokenizerConfig = TokenizerConfig(),
    ) -> "Tokenizer":
        """Train a new SentencePiece tokenizer.

        Args:
            texts: List of training texts.
            output_dir: Directory to save the tokenizer.
            config: Tokenizer configuration.

        Returns:
            Initialized Tokenizer instance.
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(exist_ok=True)

        # Write temporary training data
        train_file = output_dir / "train.txt"
        with open(train_file, "w", encoding="utf-8") as f:
            for text in texts:
                f.write(text + "\n")

        # Train SentencePiece model
        model_prefix = str(output_dir / "sp")
        spm.SentencePieceTrainer.train(
            input=str(train_file),
            model_prefix=model_prefix,
            vocab_size=config.vocab_size,
            model_type=config.model_type,
            character_coverage=config.character_coverage,
            num_threads=config.num_threads,
            unk_id=0,
            bos_id=1,
            eos_id=2,
            pad_id=3,
        )

        # Load and return
        model_path = Path(model_prefix + ".model")
        return cls(model_path)

    @classmethod
    def from_checkpoint(cls, checkpoint_dir: Union[str, Path]) -> "Tokenizer":
        """Load tokenizer from checkpoint directory.

        Args:
            checkpoint_dir: Directory containing sp.model.

        Returns:
            Initialized Tokenizer instance.
        """
        model_path = Path(checkpoint_dir) / "sp.model"
        return cls(model_path)

    def encode(self, text: str, add_special_tokens: bool = True) -> List[int]:
        """Encode text to token IDs.

        Args:
            text: Text to encode.
            add_special_tokens: Whether to add BOS token at start.

        Returns:
            List of token IDs.
        """
        tokens = self.sp.EncodeAsIds(text)
        if add_special_tokens:
            tokens = [self.bos_id] + tokens
        return tokens

    def decode(self, tokens: List[int]) -> str:
        """Decode token IDs to text.

        Args:
            tokens: List of token IDs.

        Returns:
            Decoded text.
        """
        return self.sp.DecodeIds(tokens)

    def batch_encode(self, texts: List[str]) -> List[List[int]]:
        """Encode multiple texts.

        Args:
            texts: List of texts.

        Returns:
            List of token ID lists.
        """
        return [self.encode(text) for text in texts]

    def batch_decode(self, batch_tokens: List[List[int]]) -> List[str]:
        """Decode multiple token sequences.

        Args:
            batch_tokens: List of token ID lists.

        Returns:
            List of decoded texts.
        """
        return [self.decode(tokens) for tokens in batch_tokens]

    def save(self, output_dir: Union[str, Path]):
        """Save tokenizer to directory.

        Args:
            output_dir: Directory to save to.
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(exist_ok=True)
        # SentencePiece model is self-contained, just copy it
        import shutil
        shutil.copy(self.model_path, output_dir / "sp.model")

    @property
    def vocab_size(self) -> int:
        """Get vocabulary size."""
        return self.sp.GetPieceSize()

    @property
    def bos_id(self) -> int:
        """Beginning of sequence token."""
        return self.sp.bos_id()

    @property
    def eos_id(self) -> int:
        """End of sequence token."""
        return self.sp.eos_id()

    @property
    def pad_id(self) -> int:
        """Padding token."""
        return self.sp.pad_id()

    @property
    def unk_id(self) -> int:
        """Unknown token."""
        return self.sp.unk_id()
