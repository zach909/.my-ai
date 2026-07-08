"""Command-line interface for TinyGPT."""

import argparse
import logging
from pathlib import Path

from inference import Inferencer
from config import InferenceConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(description="TinyGPT Chat Interface")
    parser.add_argument(
        "--model",
        type=str,
        required=True,
        help="Path to model checkpoint",
    )
    parser.add_argument(
        "--tokenizer",
        type=str,
        required=True,
        help="Path to tokenizer directory",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cuda",
        choices=["cuda", "cpu"],
        help="Device to use",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.7,
        help="Sampling temperature",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=50,
        help="Top-k sampling parameter",
    )
    parser.add_argument(
        "--top-p",
        type=float,
        default=0.9,
        help="Top-p (nucleus) sampling parameter",
    )
    parser.add_argument(
        "--repetition-penalty",
        type=float,
        default=1.0,
        help="Repetition penalty",
    )
    parser.add_argument(
        "--max-length",
        type=int,
        default=256,
        help="Maximum generation length",
    )

    args = parser.parse_args()

    # Initialize inferencer
    logger.info("Loading model and tokenizer...")
    inferencer = Inferencer(
        model_path=args.model,
        tokenizer_path=args.tokenizer,
        device=args.device,
    )

    # Create inference config
    config = InferenceConfig(
        temperature=args.temperature,
        top_k=args.top_k,
        top_p=args.top_p,
        repetition_penalty=args.repetition_penalty,
        max_length=args.max_length,
    )

    # Interactive chat loop
    logger.info("Starting chat interface. Type 'exit' to quit.")
    print("\nTinyGPT Chat Interface")
    print("=" * 50)
    print("Type 'exit' to quit\n")

    while True:
        try:
            prompt = input("You: ").strip()
            if prompt.lower() == "exit":
                print("Goodbye!")
                break
            if not prompt:
                continue

            print("\nGenerating...")
            response = inferencer.generate(prompt, config)
            print(f"\nAssistant: {response}\n")

        except KeyboardInterrupt:
            print("\n\nInterrupted by user.")
            break
        except Exception as e:
            logger.error(f"Error: {e}")
            print(f"Error: {e}\n")


if __name__ == "__main__":
    main()
