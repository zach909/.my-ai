"""Inference utilities for TinyGPT."""

import torch
from pathlib import Path
from typing import List, Optional, Union

from config import ModelConfig, InferenceConfig
from model import GPT
from tokenizer import Tokenizer


class Inferencer:
    """Handles model inference and generation."""

    def __init__(
        self,
        model_path: Union[str, Path],
        tokenizer_path: Union[str, Path],
        device: str = "cuda",
    ):
        """Initialize inferencer.

        Args:
            model_path: Path to saved model checkpoint.
            tokenizer_path: Path to tokenizer directory.
            device: Device to use ('cuda' or 'cpu').
        """
        self.device = torch.device(device)

        # Load tokenizer
        self.tokenizer = Tokenizer.from_checkpoint(tokenizer_path)

        # Load model
        checkpoint = torch.load(model_path, map_location=self.device)
        config = checkpoint["config"]
        self.model = GPT(config).to(self.device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()

    def generate(
        self,
        prompt: str,
        config: InferenceConfig = InferenceConfig(),
    ) -> str:
        """Generate text from a prompt.

        Args:
            prompt: Input prompt text.
            config: Inference configuration.

        Returns:
            Generated text.
        """
        # Encode prompt
        input_ids = torch.tensor(
            self.tokenizer.encode(prompt, add_special_tokens=True),
            dtype=torch.long,
        ).unsqueeze(0).to(self.device)

        # Generate
        with torch.no_grad():
            generated_ids = self.model.generate(
                input_ids,
                max_length=config.max_length,
                temperature=config.temperature,
                top_k=config.top_k if config.top_k > 0 else None,
                top_p=config.top_p if config.top_p < 1.0 else None,
                repetition_penalty=config.repetition_penalty,
            )

        # Decode
        generated_text = self.tokenizer.decode(generated_ids[0].tolist())
        return generated_text

    def batch_generate(
        self,
        prompts: List[str],
        config: InferenceConfig = InferenceConfig(),
    ) -> List[str]:
        """Generate text for multiple prompts.

        Args:
            prompts: List of input prompts.
            config: Inference configuration.

        Returns:
            List of generated texts.
        """
        results = []
        for prompt in prompts:
            result = self.generate(prompt, config)
            results.append(result)
        return results
